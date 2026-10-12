// Informe de gestión de la institución, listo para la gerencia — lógica pura.
//
// Junta lo que ya calcularon los motores de costos, calidad, equipo y cobertura en un resumen con una frase de apertura,
// cifras clave, una sección por tema, lo que hay que atender y lo que va bien, y lo entrega como texto para copiar o
// descargar y como CSV de servicios para auditoría. No calcula nada nuevo ni inventa lo que no hay: un indicador sin
// muestra suficiente dice «sin datos suficientes» y no se rellena con ceros. El informe en texto circula fuera de la
// aplicación: no incluye nombres de profesionales ni datos de pacientes (el CSV de auditoría sí lleva el nombre del
// profesional, porque una auditoría lo necesita), y no habla de pagos fuera de la página web.

import { STATUS_ES, bogotaDateTime, decimalEs, toCsv, type CsvColumn } from "./careExport";
import { MIN_SERVICES_FOR_RATE, type CostReport } from "./instCost";
import {
  cancelledBy,
  contractedHours,
  dueInPeriod,
  isCompleted,
  lateMinutes,
  proNames,
  workedHours,
  type InstBooking,
  type InstContractShift,
  type InstLog,
  type InstProFact,
} from "./instData";
import { forecastHeadline, HORIZON_DAYS, type ForecastReport } from "./instForecast";
import { signedBookingIds, type QualityReport, type QualityStatus } from "./instQuality";
import type { TeamReport } from "./instTeam";
import {
  BOGOTA_OFFSET_MS,
  dateEs,
  hoursEs,
  joinEs,
  periodPhrase,
  plural,
  type Period,
} from "./intelShared";
import { paidAmount } from "./moneyFlow";
import { formatCOP } from "./pricing";

export interface ReportKpi {
  label: string;
  value: string;
  hint?: string;
}

export interface ReportSection {
  id: "service" | "investment" | "quality" | "team" | "forecast";
  title: string;
  lines: string[];
}

export interface ExecutiveReport {
  title: string;
  periodLabel: string;
  generatedLabel: string;
  headline: string;
  kpis: ReportKpi[];
  sections: ReportSection[];
  /** Lo que conviene atender, en frases cortas. */
  attention: string[];
  /** Lo que va bien. */
  highlights: string[];
  /** El mismo informe en texto plano (para copiar o descargar). */
  text: string;
}

export interface ReportInput {
  institutionName: string;
  period: Period;
  cost: CostReport;
  quality: QualityReport;
  team: TeamReport;
  forecast: ForecastReport | null;
  now: number;
}

const STATUS_WORD: Record<QualityStatus, string> = {
  ok: "en verde",
  watch: "por mejorar",
  alert: "en rojo",
  unknown: "sin datos suficientes",
};

const money = (n: number) => formatCOP(n);
const MAX_ATTENTION = 6;
const MAX_HIGHLIGHTS = 4;

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} %`;

export function buildExecutiveReport(input: ReportInput): ExecutiveReport {
  const { cost, quality, team, forecast, period, now } = input;
  const name = input.institutionName.trim() || "la institución";
  const phrase = periodPhrase(period);
  const metric = (key: string) => quality.metrics.find((m) => m.key === key);
  const value = (key: string): number | null => metric(key)?.value ?? null;

  // ── Frase de apertura ────────────────────────────────────────────────────────
  const lead =
    cost.services > 0
      ? `En ${phrase} se prestaron ${plural(cost.services, "servicio", "servicios")} (${hoursEs(cost.hours)} h), con una inversión de ${money(cost.spent)}.`
      : `En ${phrase} no hubo servicios terminados.`;
  const punctual = value("punctuality");
  const docs = value("documentation");
  const contracts = value("contracts");
  const reliability = value("reliability");
  const qualityParts: string[] = [];
  if (reliability !== null) qualityParts.push(`se cumplió el ${reliability} % de los turnos`);
  if (punctual !== null) qualityParts.push(`el ${punctual} % de las llegadas fue puntual`);
  if (docs !== null) qualityParts.push(`el ${docs} % de los servicios quedó documentado`);
  if (contracts !== null)
    qualityParts.push(`el ${contracts} % de los turnos publicados tiene contrato firmado`);
  const headline = [lead, qualityParts.length ? `En calidad: ${joinEs(qualityParts)}.` : ""]
    .filter(Boolean)
    .join(" ");

  // ── Cifras clave ─────────────────────────────────────────────────────────────
  const kpis: ReportKpi[] = [
    { label: "Servicios prestados", value: String(cost.services) },
    { label: "Horas atendidas", value: `${hoursEs(cost.hours)} h` },
    { label: "Inversión", value: money(cost.spent) },
  ];
  if (cost.avgPerHour !== null)
    kpis.push({ label: "Costo por hora", value: money(cost.avgPerHour) });
  for (const m of quality.metrics) {
    if (m.value !== null)
      kpis.push({ label: m.label, value: `${m.value} %`, hint: `Meta: ${m.target} %` });
  }
  // Sin turnos (o con turnos sin cupos) no hay porcentaje: no se inventa una cobertura.
  if (forecast && forecast.totals.coveragePct !== null) {
    kpis.push({
      label: `Cobertura de los próximos ${HORIZON_DAYS} días`,
      value: `${forecast.totals.coveragePct} %`,
    });
  }

  // ── Secciones ────────────────────────────────────────────────────────────────
  const service: string[] = [
    `${plural(cost.services, "servicio terminado", "servicios terminados")} (${hoursEs(cost.hours)} h) en ${phrase}.`,
  ];
  const q = quality.services;
  if (q.cancelled > 0) {
    const parts = [
      `${q.cancelledByProfessional} por profesionales`,
      `${q.cancelledByInstitution} por la institución`,
    ];
    if (q.cancelledUnknown > 0) parts.push(`${q.cancelledUnknown} sin motivo identificable`);
    service.push(
      `${plural(q.cancelled, "servicio cancelado", "servicios cancelados")}: ${joinEs(parts)}.`,
    );
  }
  if (team.totals.professionals > 0)
    service.push(
      `${plural(team.totals.professionals, "profesional prestó", "profesionales prestaron")} servicios en el periodo.`,
    );
  if (q.unstarted > 0)
    service.push(
      `${plural(q.unstarted, "servicio confirmado sigue sin iniciar", "servicios confirmados siguen sin iniciar")}.`,
    );
  if (q.unclosed > 0)
    service.push(
      `${plural(q.unclosed, "servicio en curso sin cerrar", "servicios en curso sin cerrar")}.`,
    );

  const investment: string[] = [];
  if (cost.services > 0) {
    investment.push(
      `Inversión del periodo: ${money(cost.spent)} en ${plural(cost.services, "servicio", "servicios")}.`,
    );
    if (cost.avgPerHour !== null) investment.push(`Costo por hora: ${money(cost.avgPerHour)}.`);
  } else {
    investment.push("No hubo servicios terminados en el periodo.");
  }
  if (cost.previous.services > 0) {
    // Un porcentaje sobre muy pocos servicios no dice nada («+1100 %»): se muestra solo con base suficiente.
    const note =
      cost.previous.spent > 0 && cost.previous.services >= MIN_SERVICES_FOR_RATE
        ? signed(Math.round(((cost.spent - cost.previous.spent) / cost.previous.spent) * 100))
        : plural(cost.previous.services, "servicio", "servicios");
    investment.push(`Periodo anterior: ${money(cost.previous.spent)} (${note}).`);
  }
  if (cost.rate.position === "above" && cost.rate.diffPct !== null && cost.rate.marketMedian)
    investment.push(
      `El costo por hora está ${cost.rate.diffPct} % por encima de la mediana de la ciudad (${money(cost.rate.marketMedian)}); referencia sin distinguir especialidades.`,
    );
  else if (cost.rate.position === "below" && cost.rate.diffPct !== null)
    investment.push("El costo por hora está por debajo del rango de la ciudad.");
  else if (cost.rate.position === "within")
    investment.push("El costo por hora está dentro del rango de la ciudad.");
  for (const d of cost.drivers.slice(0, 3))
    investment.push(`- ${d.label}: ${money(d.spent)} (${d.share} % del gasto).`);
  if (cost.upcoming30.services > 0)
    investment.push(
      `Acordado para los próximos 30 días: ${money(cost.upcoming30.amount)} en ${plural(cost.upcoming30.services, "servicio", "servicios")}.`,
    );
  const cur = cost.current;
  if (cur.settledToDate + cur.committed > 0)
    investment.push(
      `Mes en curso (${cur.label}): ${money(cur.settledToDate)} a la fecha; proyección de ${
        cur.projectedHigh > cur.projectedLow
          ? `${money(cur.projectedLow)} a ${money(cur.projectedHigh)}`
          : money(cur.projectedLow)
      }.`,
    );

  const quality_: string[] = [];
  for (const m of quality.metrics) {
    quality_.push(
      m.value === null
        ? `- ${m.label}: sin datos suficientes.`
        : `- ${m.label}: ${m.value} % (${STATUS_WORD[m.status]}; meta ${m.target} %). ${m.detail}`,
    );
  }
  if (quality.hours.shortServices > 0)
    quality_.push(
      `${plural(quality.hours.shortServices, "servicio con menos horas registradas que las contratadas", "servicios con menos horas registradas que las contratadas")}: ${hoursEs(quality.hours.unloggedHours)} h, unos ${money(quality.hours.valueAtStake)} para revisar.`,
    );
  if (quality.incidents && quality.incidents.count > 0)
    quality_.push(
      `${plural(quality.incidents.count, "alerta registrada", "alertas registradas")} en el parte, en ${plural(quality.incidents.services, "servicio", "servicios")}.`,
    );

  const teamLines: string[] = [];
  if (team.hasData) {
    teamLines.push(
      `${plural(team.totals.professionals, "profesional activo", "profesionales activos")} en el periodo.`,
    );
    if (team.concentration.topShare !== null && team.concentration.risk !== "none")
      teamLines.push(
        `El profesional con más horas prestó el ${team.concentration.topShare} % del total (${
          {
            single: "dependencia total",
            high: "dependencia alta",
            moderate: "concentración moderada",
            healthy: "reparto sano",
            none: "",
          }[team.concentration.risk]
        }).`,
      );
  }
  teamLines.push(
    team.bench.teamSize > 0
      ? `Equipo de confianza: ${plural(team.bench.teamSize, "persona", "personas")}, ${team.bench.active} con servicios en los últimos 30 días.`
      : "Aún no hay equipo de confianza.",
  );
  if (team.candidates.length > 0)
    teamLines.push(
      `${plural(team.candidates.length, "profesional podría sumarse", "profesionales podrían sumarse")} al equipo de confianza por su historial.`,
    );

  const forecastLines: string[] = [];
  if (forecast) {
    forecastLines.push(forecastHeadline(forecast));
    if (forecast.next48.openHours > 0)
      forecastLines.push(
        `${hoursEs(forecast.next48.openHours)} h sin cubrir en las próximas 48 horas.`,
      );
    if (forecast.pattern)
      forecastLines.push(
        `${forecast.pattern.label.charAt(0).toUpperCase()}${forecast.pattern.label.slice(1)} suelen quedar sin cubrir.`,
      );
  }

  const sections: ReportSection[] = [
    { id: "service", title: "Servicio prestado", lines: service },
    { id: "investment", title: "Inversión", lines: investment },
    { id: "quality", title: "Calidad y cumplimiento", lines: quality_ },
    { id: "team", title: "Equipo", lines: teamLines },
  ];
  if (forecast)
    sections.push({ id: "forecast", title: `Próximos ${HORIZON_DAYS} días`, lines: forecastLines });

  // ── Para atender y lo que va bien ────────────────────────────────────────────
  // El informe circula fuera de la aplicación (gerencia, auditoría): no lleva nombres de profesionales. Los hallazgos del
  // equipo que nombran a una persona se resumen en cifras; el detalle está en «Equipo» y en el CSV de auditoría.
  const teamInsights = team.insights.filter((i) => !i.professionalId || i.id === "single");
  const toReview = team.members.filter((m) => m.reliability === "review").length;
  const reliable = team.members.filter((m) => m.reliability === "excellent").length;
  const teamWarn: string[] = [];
  if (team.concentration.risk === "high" && team.concentration.topShare !== null)
    teamWarn.push(`Una sola persona prestó el ${team.concentration.topShare} % de las horas`);
  if (toReview > 0)
    teamWarn.push(
      `${plural(toReview, "profesional tiene", "profesionales tienen")} puntualidad o cumplimiento por revisar`,
    );
  const teamGood =
    reliable > 0
      ? [
          `${plural(reliable, "profesional muy confiable", "profesionales muy confiables")} en el periodo`,
        ]
      : [];
  const titles = (xs: Array<{ severity: string; title: string }>, severity: string) =>
    xs.filter((i) => i.severity === severity).map((i) => i.title);
  const attention = [
    ...titles(quality.insights, "warn"),
    ...titles(cost.insights, "warn"),
    ...titles(teamInsights, "warn"),
    ...teamWarn,
    ...titles(forecast?.insights ?? [], "warn"),
  ].slice(0, MAX_ATTENTION);
  const highlights = [
    ...titles(quality.insights, "good"),
    ...titles(cost.insights, "good"),
    ...titles(teamInsights, "good"),
    ...teamGood,
    ...titles(forecast?.insights ?? [], "good"),
  ].slice(0, MAX_HIGHLIGHTS);

  const title = `Informe de gestión · ${name}`;
  const generatedLabel = `Generado el ${dateEs(now)}`;
  const report: ExecutiveReport = {
    title,
    periodLabel: period.label,
    generatedLabel,
    headline,
    kpis,
    sections,
    attention,
    highlights,
    text: "",
  };
  report.text = reportText(report);
  return report;
}

/** El informe en texto plano: encabezados en mayúsculas, una idea por línea. */
export function reportText(r: Omit<ExecutiveReport, "text">): string {
  const out: string[] = [
    r.title.toUpperCase(),
    `${r.periodLabel} · ${r.generatedLabel}`,
    "",
    "RESUMEN",
    r.headline,
    "",
    "CIFRAS CLAVE",
  ];
  for (const k of r.kpis) out.push(`- ${k.label}: ${k.value}${k.hint ? ` (${k.hint})` : ""}`);
  for (const s of r.sections) {
    out.push("", s.title.toUpperCase());
    out.push(...s.lines);
  }
  if (r.attention.length) {
    out.push("", "PARA ATENDER");
    for (const a of r.attention) out.push(`- ${a}`);
  }
  if (r.highlights.length) {
    out.push("", "LO QUE VA BIEN");
    for (const h of r.highlights) out.push(`- ${h}`);
  }
  out.push(
    "",
    "Este informe se calculó con los servicios, partes del turno y contratos de la institución registrados en Humanix. Un indicador sin datos suficientes no se completa: se muestra como tal.",
  );
  return out.join("\n");
}

// ─── CSV de servicios (auditoría) ────────────────────────────────────────────

export interface ServicesCsvInput {
  bookings: InstBooking[];
  period: Period;
  now: number;
  /** Nombre de cada profesional (si no se conoce, la celda queda vacía). */
  names: Record<string, string>;
  offers: Record<string, { title?: string | null; specialty?: string | null }>;
  /** Servicios con parte del turno (`null` si no se cargó el parte: la celda queda vacía, no «No»). */
  documented: Set<string> | null;
  /**
   * Servicios cuyo parte se consultó. Del resto (los más antiguos, si el tope de filas se alcanzó) no se sabe: la celda
   * queda vacía. Si no se indica, se asume que se consultaron todos.
   */
  queried?: Set<string> | null;
  /** Servicios con contrato firmado (`null` si no se cargaron). */
  signed: Set<string> | null;
  /** RETHUS verificado por profesional (`null` si no se cargó). */
  verified: Record<string, boolean | null> | null;
}

/** Lo que se leyó de la base para armar el CSV (cada parte es `null` si no se pudo cargar). */
export interface CsvContextInput {
  logs: { rows: InstLog[]; queried: string[] } | null;
  contractShifts: InstContractShift[] | null;
  pros: Record<string, InstProFact> | null;
}

/**
 * Los datos del CSV que no son las reservas, a partir de lo leído: un dato que no se cargó queda en `null` (la celda
 * queda vacía) y nunca se confunde con un «No».
 */
export function csvContext(
  input: CsvContextInput,
): Pick<ServicesCsvInput, "names" | "documented" | "queried" | "signed" | "verified"> {
  const { logs, contractShifts, pros } = input;
  return {
    names: proNames(pros),
    documented: logs ? new Set(logs.rows.map((r) => r.booking_id)) : null,
    queried: logs ? new Set(logs.queried) : null,
    signed: contractShifts ? signedBookingIds(contractShifts) : null,
    verified: pros
      ? Object.fromEntries(Object.entries(pros).map(([id, f]) => [id, f.rethusVerified ?? null]))
      : null,
  };
}

const yesNo = (v: boolean | null | undefined) =>
  v === null || v === undefined ? "" : v ? "Sí" : "No";

/** Servicios hechos por reserva directa, sin turno publicado: no tienen contrato inteligente. */
const NOT_APPLICABLE = "No aplica";

const PARTY_ES = {
  professional: "Profesional",
  client: "Institución",
  unknown: "Sin dato",
} as const;

/** Un renglón por servicio del periodo que ya debió empezar, del más reciente al más antiguo. */
export function servicesCsv(input: ServicesCsvInput): string {
  const rows = dueInPeriod(input.bookings, input.period, input.now).sort(
    (a, b) =>
      new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime() ||
      a.id.localeCompare(b.id),
  );
  const offerOf = (b: InstBooking) => (b.job_offer_id ? input.offers[b.job_offer_id] : undefined);
  const columns: Array<CsvColumn<InstBooking>> = [
    { header: "Fecha", value: (b) => bogotaDateTime(b.scheduled_at) },
    { header: "Estado", value: (b) => STATUS_ES[b.status] ?? b.status },
    { header: "Profesional", value: (b) => input.names[b.professional_id] ?? "" },
    { header: "Especialidad", value: (b) => offerOf(b)?.specialty ?? "" },
    { header: "Turno u oferta", value: (b) => offerOf(b)?.title ?? "" },
    { header: "Horas contratadas", value: (b) => decimalEs(contractedHours(b)) },
    { header: "Horas registradas", value: (b) => decimalEs(workedHours(b) ?? "", 2) },
    {
      header: "Minutos de retraso",
      value: (b) => {
        const m = lateMinutes(b);
        return m === null ? "" : m;
      },
    },
    { header: "Valor (COP)", value: (b) => (isCompleted(b) ? paidAmount(b) : "") },
    {
      header: "Parte del turno",
      value: (b) => {
        if (!input.documented) return "";
        if (input.queried && !input.queried.has(b.id)) return "";
        return yesNo(input.documented.has(b.id));
      },
    },
    {
      header: "Contrato firmado",
      value: (b) => {
        if (!b.job_offer_id) return NOT_APPLICABLE;
        return yesNo(input.signed ? input.signed.has(b.id) : null);
      },
    },
    {
      header: "RETHUS verificado",
      value: (b) => yesNo(input.verified ? (input.verified[b.professional_id] ?? null) : null),
    },
    {
      header: "Quién canceló",
      value: (b) => {
        const party = cancelledBy(b);
        return party ? PARTY_ES[party] : "";
      },
    },
    {
      header: "Motivo de cancelación",
      value: (b) => (b.status === "cancelled" ? (b.cancel_reason ?? "") : ""),
    },
  ];
  return toCsv(rows, columns);
}

/** «informe-de-gestion-2026-10-14.txt»: la fecha es la de Colombia. */
export function reportFilename(
  kind: "informe" | "servicios",
  ext: "txt" | "csv",
  now: number,
): string {
  const day = new Date(now + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
  return `${kind === "informe" ? "informe-de-gestion" : "servicios"}-${day}.${ext}`;
}
