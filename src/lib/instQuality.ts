// Calidad y cumplimiento de la institución — lógica pura.
//
// Con lo que la institución ya puede leer de sus propios servicios (reservas, parte del turno, contratos y el perfil
// público de los profesionales) mide seis cosas que importan a quien responde por la atención: si el turno se cumplió, si
// el profesional llegó a tiempo, si las horas registradas son las contratadas, si el servicio quedó documentado, si hay
// contrato firmado y si quien atendió tiene el RETHUS verificado.
//
// Nada se inventa: un porcentaje exige una muestra mínima (si no, queda «sin datos»), cada número dice de dónde sale y un
// dato que no se cargó no se confunde con un 0 %. Es una guía para revisar y mejorar, no una acusación: un servicio con
// menos horas registradas puede ser un cierre anticipado o tardío del parte. No contacta a nadie ni cambia nada.

import {
  PUNCTUAL_GRACE_MIN,
  SHORT_MIN_HOURS,
  SHORT_RATIO,
  VERY_LATE_MIN,
  cancelledBy,
  contractedHours,
  dueInPeriod,
  isCompleted,
  isUnclosed,
  isUnstarted,
  lateMinutes,
  workedHours,
  type InstBooking,
  type InstContractShift,
  type InstLog,
  type InstProFact,
} from "./instData";
import {
  hoursEs,
  inPeriod,
  median,
  msOf,
  num,
  pctOf,
  plural,
  round1,
  type Period,
} from "./intelShared";
import { formatCOP } from "./pricing";

export type QualityStatus = "ok" | "watch" | "alert" | "unknown";
export type QualityKey =
  | "reliability"
  | "punctuality"
  | "hours_logged"
  | "documentation"
  | "contracts"
  | "verified";

export interface QualityMetric {
  key: QualityKey;
  label: string;
  /** Porcentaje 0–100, o `null` si todavía no hay muestra suficiente (o el dato no se cargó). */
  value: number | null;
  /** Porcentaje desde el que se considera en verde. */
  target: number;
  status: QualityStatus;
  /** Servicios (o profesionales) en los que se basa el número. */
  sample: number;
  /** De dónde sale el número, en una frase, para no dejar un porcentaje sin contexto. */
  detail: string;
}

/** Servicios mínimos para hablar de un porcentaje (con menos, un solo caso lo cambiaría todo). */
export const MIN_SAMPLE = 5;
/** Servicios mínimos para hablar de contratos y de profesionales verificados. */
export const MIN_SAMPLE_SMALL = 3;

/** Desde `ok` está en verde; desde `watch`, en amarillo; por debajo, en rojo. */
export const THRESHOLDS: Record<QualityKey, { ok: number; watch: number }> = {
  reliability: { ok: 92, watch: 80 },
  punctuality: { ok: 90, watch: 75 },
  hours_logged: { ok: 95, watch: 85 },
  documentation: { ok: 90, watch: 70 },
  contracts: { ok: 95, watch: 80 },
  verified: { ok: 98, watch: 85 },
};

const LABEL: Record<QualityKey, string> = {
  reliability: "Turnos cumplidos",
  punctuality: "Llegadas puntuales",
  hours_logged: "Horas registradas",
  documentation: "Servicios documentados",
  contracts: "Con contrato firmado",
  verified: "Horas con RETHUS verificado",
};

/** Cuántos servicios se listan para revisar en cada categoría. */
export const REVIEW_LIMIT = 5;

export function statusOf(key: QualityKey, value: number | null): QualityStatus {
  if (value === null) return "unknown";
  const t = THRESHOLDS[key];
  return value >= t.ok ? "ok" : value >= t.watch ? "watch" : "alert";
}

export interface ReviewItem {
  bookingId: string;
  scheduledAt: string;
  professionalId: string;
}

export interface ShortItem extends ReviewItem {
  contracted: number;
  worked: number;
  /** Lo que valen las horas contratadas que no quedaron registradas. */
  value: number;
}

export type QualitySeverity = "warn" | "info" | "good";

export interface QualityInsight {
  id: string;
  severity: QualitySeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface QualityReport {
  hasData: boolean;
  period: Period;
  services: {
    due: number;
    completed: number;
    cancelled: number;
    cancelledByProfessional: number;
    cancelledByInstitution: number;
    cancelledUnknown: number;
    unstarted: number;
    unclosed: number;
  };
  metrics: QualityMetric[];
  counts: Record<QualityStatus, number>;
  level: QualityStatus;
  headline: string;
  punctuality: { onTime: number; late: number; veryLate: number; medianLateMin: number | null };
  hours: {
    contracted: number;
    worked: number;
    shortServices: number;
    unloggedHours: number;
    valueAtStake: number;
  };
  /** Alertas del parte dentro del periodo (`null` si el parte no se cargó). */
  incidents: { count: number; services: number } | null;
  review: {
    unstarted: ReviewItem[];
    unclosed: ReviewItem[];
    short: ShortItem[];
    undocumented: ReviewItem[];
    noContract: ReviewItem[];
  };
  insights: QualityInsight[];
}

export interface QualityInput {
  bookings: InstBooking[];
  /** Registros del parte y los servicios cuyo parte se pidió (`null` si no se cargó). */
  logs: { rows: InstLog[]; queried: string[] } | null;
  /** Turnos de contratos (`null` si no se cargaron). */
  contractShifts: InstContractShift[] | null;
  /** Perfil público por profesional (`null` si no se cargó). */
  pros: Record<string, InstProFact> | null;
  period: Period;
  now: number;
}

const newestFirst = (a: ReviewItem, b: ReviewItem) =>
  msOf(b.scheduledAt) - msOf(a.scheduledAt) || a.bookingId.localeCompare(b.bookingId);

const toItem = (b: InstBooking): ReviewItem => ({
  bookingId: b.id,
  scheduledAt: b.scheduled_at,
  professionalId: b.professional_id,
});

const top = <T extends ReviewItem>(xs: T[]): T[] =>
  [...xs].sort(newestFirst).slice(0, REVIEW_LIMIT);

const SIGNED = ["active", "completed"];

/** Servicios cuyo turno pertenece a un contrato firmado por ambas partes (vigente o terminado). */
export function signedBookingIds(shifts: InstContractShift[]): Set<string> {
  return new Set(
    shifts
      .filter((c) => c.booking_id && SIGNED.includes(c.contract_status ?? ""))
      .map((c) => c.booking_id as string),
  );
}
/** Redondeo para comparar horas con decimales sin que el ruido de la coma flotante decida el resultado. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function buildQualityReport(input: QualityInput): QualityReport {
  const { period, now } = input;
  const due = dueInPeriod(input.bookings, period, now);
  const completed = due.filter(isCompleted);
  const cancelled = due.filter((b) => b.status === "cancelled");
  const byPro = cancelled.filter((b) => cancelledBy(b) === "professional");
  const byInstitution = cancelled.filter((b) => cancelledBy(b) === "client");
  const unstarted = due.filter((b) => isUnstarted(b, now));
  const unclosed = due.filter((b) => isUnclosed(b, now));

  // ── Turnos cumplidos ─────────────────────────────────────────────────────────
  // No cuentan contra el profesional las cancelaciones de la propia institución ni las de motivo desconocido.
  const reliabilityBase = completed.length + byPro.length + unstarted.length;
  const reliabilityValue =
    reliabilityBase >= MIN_SAMPLE ? pctOf(completed.length, reliabilityBase) : null;

  // ── Puntualidad ──────────────────────────────────────────────────────────────
  const arrivals = due
    .filter((b) => isCompleted(b) || b.status === "in_progress")
    .map((b) => lateMinutes(b))
    .filter((m): m is number => m !== null);
  const lateOnes = arrivals.filter((m) => m > PUNCTUAL_GRACE_MIN);
  const onTime = arrivals.length - lateOnes.length;
  const punctualityValue = arrivals.length >= MIN_SAMPLE ? pctOf(onTime, arrivals.length) : null;
  const medianLate = median(lateOnes);

  // ── Horas registradas ────────────────────────────────────────────────────────
  const timed = completed
    .map((b) => ({ b, worked: workedHours(b), contracted: contractedHours(b) }))
    .filter((x): x is { b: InstBooking; worked: number; contracted: number } => x.worked !== null);
  const contractedSum = timed.reduce((s, x) => s + x.contracted, 0);
  const creditedSum = timed.reduce((s, x) => s + Math.min(x.worked, x.contracted), 0);
  // Todo servicio con horas registradas tiene horas contratadas (si no, el registro es un dato dañado y queda fuera).
  const hoursValue =
    timed.length >= MIN_SAMPLE ? Math.round((creditedSum / contractedSum) * 100) : null;
  const short: ShortItem[] = timed
    .filter(
      // Redondeado a 6 decimales: 4,8 h de 6 h es justo el 80 % y no debe quedar «corto» por el ruido de la coma flotante.
      (x) =>
        round6(x.worked / x.contracted) < SHORT_RATIO &&
        round6(x.contracted - x.worked) >= SHORT_MIN_HOURS,
    )
    .map((x) => {
      const rate =
        num(x.b.hourly_rate) || (x.contracted > 0 ? num(x.b.total_amount) / x.contracted : 0);
      return {
        ...toItem(x.b),
        contracted: round1(x.contracted),
        worked: round1(x.worked),
        value: Math.round((x.contracted - x.worked) * rate),
      };
    });
  const unloggedHours = round1(short.reduce((s, x) => s + (x.contracted - x.worked), 0));
  const valueAtStake = short.reduce((s, x) => s + x.value, 0);

  // ── Documentación ────────────────────────────────────────────────────────────
  let documentationValue: number | null = null;
  let docPopulation: InstBooking[] = [];
  let undocumented: InstBooking[] = [];
  if (input.logs) {
    const queried = new Set(input.logs.queried);
    const withLog = new Set(input.logs.rows.map((r) => r.booking_id));
    docPopulation = completed.filter((b) => queried.has(b.id));
    undocumented = docPopulation.filter((b) => !withLog.has(b.id));
    documentationValue =
      docPopulation.length >= MIN_SAMPLE
        ? pctOf(docPopulation.length - undocumented.length, docPopulation.length)
        : null;
  }

  // ── Alertas del parte ────────────────────────────────────────────────────────
  let incidents: QualityReport["incidents"] = null;
  if (input.logs) {
    const rows = input.logs.rows.filter(
      (r) =>
        (r.is_alert === true || r.event_type === "incident") &&
        inPeriod(msOf(r.created_at), period),
    );
    incidents = { count: rows.length, services: new Set(rows.map((r) => r.booking_id)).size };
  }

  // ── Contratos ────────────────────────────────────────────────────────────────
  let contractsValue: number | null = null;
  let contractsCovered = 0;
  let contractPopulation: InstBooking[] = [];
  let noContract: InstBooking[] = [];
  if (input.contractShifts) {
    const signed = signedBookingIds(input.contractShifts);
    // Solo los servicios que nacieron de un turno publicado tienen contrato inteligente.
    contractPopulation = due.filter((b) => b.job_offer_id && b.status !== "cancelled");
    noContract = contractPopulation.filter((b) => isCompleted(b) && !signed.has(b.id));
    contractsCovered = contractPopulation.filter((b) => signed.has(b.id)).length;
    contractsValue =
      contractPopulation.length >= MIN_SAMPLE_SMALL
        ? pctOf(contractsCovered, contractPopulation.length)
        : null;
  }

  // ── Profesionales verificados ────────────────────────────────────────────────
  let verifiedValue: number | null = null;
  let unverifiedPros = 0;
  let unverifiedShare = 0;
  const proIds = new Set(completed.map((b) => b.professional_id));
  if (input.pros) {
    const facts = input.pros;
    const totalHours = completed.reduce((s, b) => s + contractedHours(b), 0);
    const verifiedHours = completed
      .filter((b) => facts[b.professional_id]?.rethusVerified === true)
      .reduce((s, b) => s + contractedHours(b), 0);
    unverifiedPros = [...proIds].filter((id) => facts[id]?.rethusVerified !== true).length;
    if (completed.length >= MIN_SAMPLE_SMALL && totalHours > 0) {
      verifiedValue = Math.round((verifiedHours / totalHours) * 100);
      unverifiedShare = 100 - verifiedValue;
    }
  }

  // ── Métricas ─────────────────────────────────────────────────────────────────
  const metric = (
    key: QualityKey,
    value: number | null,
    sample: number,
    minimum: number,
    detail: string,
    notLoaded = false,
  ): QualityMetric => ({
    key,
    label: LABEL[key],
    value,
    target: THRESHOLDS[key].ok,
    status: statusOf(key, value),
    sample,
    detail:
      value !== null
        ? detail
        : notLoaded
          ? "Todavía no se cargaron estos datos."
          : `Faltan servicios para medirlo: se necesitan al menos ${minimum} y hay ${sample}.`,
  });

  const metrics: QualityMetric[] = [
    metric(
      "reliability",
      reliabilityValue,
      reliabilityBase,
      MIN_SAMPLE,
      `${completed.length} de ${reliabilityBase} turnos se cumplieron` +
        (byPro.length
          ? `; ${plural(byPro.length, "lo canceló el profesional", "los canceló el profesional")}`
          : "") +
        (unstarted.length
          ? `; ${plural(unstarted.length, "sigue sin iniciar", "siguen sin iniciar")}`
          : "") +
        ".",
    ),
    metric(
      "punctuality",
      punctualityValue,
      arrivals.length,
      MIN_SAMPLE,
      `${onTime} de ${arrivals.length} llegadas fueron a tiempo (hasta ${PUNCTUAL_GRACE_MIN} min de margen).`,
    ),
    metric(
      "hours_logged",
      hoursValue,
      timed.length,
      MIN_SAMPLE,
      `Entre el inicio y el cierre del parte quedaron ${hoursEs(round1(creditedSum))} h de ${hoursEs(round1(contractedSum))} h contratadas.`,
    ),
    metric(
      "documentation",
      documentationValue,
      docPopulation.length,
      MIN_SAMPLE,
      `${docPopulation.length - undocumented.length} de ${docPopulation.length} servicios terminados tienen parte del turno.`,
      input.logs === null,
    ),
    metric(
      "contracts",
      contractsValue,
      contractPopulation.length,
      MIN_SAMPLE_SMALL,
      `${contractsCovered} de ${contractPopulation.length} servicios de turnos publicados tienen contrato firmado por ambas partes.`,
      input.contractShifts === null,
    ),
    metric(
      "verified",
      verifiedValue,
      proIds.size,
      MIN_SAMPLE_SMALL,
      `El ${verifiedValue} % de las horas las prestó personal con RETHUS verificado.`,
      input.pros === null,
    ),
  ];

  const counts: Record<QualityStatus, number> = { ok: 0, watch: 0, alert: 0, unknown: 0 };
  for (const m of metrics) counts[m.status] += 1;
  const level: QualityStatus =
    counts.alert > 0 ? "alert" : counts.watch > 0 ? "watch" : counts.ok > 0 ? "ok" : "unknown";

  const report: QualityReport = {
    hasData: due.length > 0,
    period,
    services: {
      due: due.length,
      completed: completed.length,
      cancelled: cancelled.length,
      cancelledByProfessional: byPro.length,
      cancelledByInstitution: byInstitution.length,
      cancelledUnknown: cancelled.length - byPro.length - byInstitution.length,
      unstarted: unstarted.length,
      unclosed: unclosed.length,
    },
    metrics,
    counts,
    level,
    headline: "",
    punctuality: {
      onTime,
      late: lateOnes.length,
      veryLate: lateOnes.filter((m) => m > VERY_LATE_MIN).length,
      medianLateMin: medianLate === null ? null : Math.round(medianLate),
    },
    hours: {
      contracted: round1(contractedSum),
      worked: round1(timed.reduce((s, x) => s + x.worked, 0)),
      shortServices: short.length,
      unloggedHours,
      valueAtStake,
    },
    incidents,
    review: {
      unstarted: top(unstarted.map(toItem)),
      unclosed: top(unclosed.map(toItem)),
      short: top(short),
      undocumented: top(undocumented.map(toItem)),
      noContract: top(noContract.map(toItem)),
    },
    insights: [],
  };
  report.headline = qualityHeadline(report);
  report.insights = qualityInsights(report, {
    unverifiedPros,
    unverifiedShare,
    docPopulation: docPopulation.length,
    undocumented: undocumented.length,
    contractPopulation: contractPopulation.length,
    noContract: noContract.length,
  });
  return report;
}

/** Una frase para el encabezado de la tarjeta. */
export function qualityHeadline(r: QualityReport): string {
  if (!r.hasData) return "Aún no hay servicios en este periodo para medir.";
  const { alert, watch, ok, unknown } = r.counts;
  if (alert > 0) return `${plural(alert, "indicador pide", "indicadores piden")} tu atención.`;
  if (watch > 0)
    return `Vas bien: ${plural(watch, "indicador se puede mejorar", "indicadores se pueden mejorar")}.`;
  if (ok > 0)
    return unknown > 0
      ? `Todo en verde en lo que ya se puede medir (${plural(ok, "indicador", "indicadores")}).`
      : "Todo en verde: cumples la meta en los seis indicadores.";
  return `Aún no hay muestra suficiente: se necesitan al menos ${MIN_SAMPLE} servicios por indicador.`;
}

interface InsightContext {
  unverifiedPros: number;
  unverifiedShare: number;
  docPopulation: number;
  undocumented: number;
  contractPopulation: number;
  noContract: number;
}

const SEVERITY_ORDER: Record<QualitySeverity, number> = { warn: 0, info: 1, good: 2 };

/** Hallazgos en lenguaje claro, de lo que pide atención a lo informativo. */
export function qualityInsights(r: QualityReport, c: InsightContext): QualityInsight[] {
  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no hay servicios para medir",
        detail:
          "Cuando tus profesionales presten servicios, aquí verás si llegaron a tiempo, si quedó el parte y si hay contrato firmado.",
      },
    ];
  }
  const out: QualityInsight[] = [];
  const metric = (key: QualityKey) => r.metrics.find((m) => m.key === key)!;

  if (r.services.unstarted > 0) {
    out.push({
      id: "unstarted",
      severity: "warn",
      title: `${plural(r.services.unstarted, "servicio confirmado sin inicio", "servicios confirmados sin inicio")}`,
      detail:
        "Pasaron más de 2 h de la hora programada y nadie inició el servicio: pudo haber una inasistencia.",
      action:
        "Confirma con el profesional y cierra o cancela el servicio para que quede el registro.",
    });
  }
  if (r.services.unclosed > 0) {
    out.push({
      id: "unclosed",
      severity: "warn",
      title: `${plural(r.services.unclosed, "servicio en curso sin cerrar", "servicios en curso sin cerrar")}`,
      detail: "Pasaron más de 12 h del fin previsto y nadie lo cerró.",
      action: "Pide al profesional que lo cierre desde el servicio.",
    });
  }

  const p = metric("punctuality");
  if (p.status === "watch" || p.status === "alert") {
    out.push({
      id: "late_arrivals",
      severity: "warn",
      title: `${r.punctuality.late} de ${r.punctuality.onTime + r.punctuality.late} llegadas fueron tarde`,
      detail:
        `La demora típica fue de ${r.punctuality.medianLateMin ?? 0} min` +
        (r.punctuality.veryLate > 0
          ? ` y ${plural(r.punctuality.veryLate, "llegada pasó", "llegadas pasaron")} de ${VERY_LATE_MIN} min.`
          : "."),
      action: "En «Equipo» ves quiénes se retrasan más; háblalo con ellos antes del próximo turno.",
    });
  } else if (p.status === "ok") {
    out.push({
      id: "punctual",
      severity: "good",
      title: `El ${p.value} % de las llegadas fue puntual`,
      detail: "Tus pacientes casi nunca esperaron a quien los cuida.",
    });
  }

  const reliability = metric("reliability");
  if (r.services.cancelledByProfessional >= 2 || reliability.status === "alert") {
    out.push({
      id: "professional_cancellations",
      severity: "warn",
      title: `${plural(r.services.cancelledByProfessional, "cancelación", "cancelaciones")} de profesionales en el periodo`,
      detail:
        "Cada una dejó un turno por cubrir: el cupo se reabre y se invita a tu equipo de confianza.",
      action: "Suma más personas a tu equipo de confianza para tener plan B.",
    });
  } else if (reliability.status === "ok") {
    out.push({
      id: "reliable",
      severity: "good",
      title: `El ${reliability.value} % de los turnos se cumplió`,
      detail: "Tus turnos se cubrieron sin sobresaltos.",
    });
  }

  if (r.hours.shortServices > 0) {
    out.push({
      id: "hours_short",
      severity: r.hours.shortServices >= 2 ? "warn" : "info",
      title: `${plural(r.hours.shortServices, "servicio con menos horas registradas que las contratadas", "servicios con menos horas registradas que las contratadas")}`,
      detail: `Faltaron ${hoursEs(r.hours.unloggedHours)} h (unos ${formatCOP(r.hours.valueAtStake)}) entre el inicio y el cierre del parte. Puede deberse a un cierre anticipado o tardío; no es una acusación.`,
      action: "Revísalos con el profesional antes de cerrar la cuenta del mes.",
    });
  }

  const doc = metric("documentation");
  if (doc.status === "watch" || doc.status === "alert") {
    out.push({
      id: "docs_low",
      severity: "warn",
      title: `${c.undocumented} de ${c.docPopulation} servicios sin parte del turno`,
      detail: "Sin parte no queda evidencia de lo que pasó durante el servicio.",
      action: "Pide a los profesionales que registren llegada, salida y novedades en cada turno.",
    });
  }

  if (c.noContract > 0) {
    out.push({
      id: "contracts_gap",
      severity: "warn",
      title: `${plural(c.noContract, "servicio se prestó", "servicios se prestaron")} sin contrato firmado por ambas partes`,
      detail:
        "Un contrato firmado deja evidencia verificable de lo acordado y protege a las dos partes.",
      action: "Revisa los contratos pendientes en Inicio → Contratos inteligentes.",
    });
  }

  const v = metric("verified");
  if (v.status === "watch" || v.status === "alert") {
    out.push({
      id: "unverified",
      severity: "warn",
      title: `${plural(c.unverifiedPros, "profesional sin RETHUS verificado prestó", "profesionales sin RETHUS verificado prestaron")} el ${c.unverifiedShare} % de las horas`,
      detail:
        "El RETHUS verificado confirma que la persona está registrada como talento humano en salud.",
      action: "Pídeles completar la verificación antes de asignarles más turnos.",
    });
  }

  if (r.incidents && r.incidents.count > 0) {
    out.push({
      id: "alerts_logged",
      severity: "info",
      title: `${plural(r.incidents.count, "alerta registrada", "alertas registradas")} en ${plural(r.incidents.services, "servicio", "servicios")}`,
      detail:
        "Son avisos que los profesionales dejaron en el parte. Ábrelos para ver qué pasó y cómo se resolvió; no son una calificación.",
    });
  }

  if (r.counts.unknown > 0 && r.counts.ok + r.counts.watch + r.counts.alert === 0) {
    out.push({
      id: "thin_sample",
      severity: "info",
      title: "Aún no hay muestra suficiente",
      detail: `Los porcentajes aparecen desde ${MIN_SAMPLE} servicios para que un solo caso no defina el resultado.`,
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
