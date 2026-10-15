// Agenda institucional de los próximos 7 días — lógica pura, sin base de datos.
//
// Lee lo que la institución ya puede leer: sus servicios (`service_bookings`, ella es `client_id`) y los turnos de sus
// ofertas (`job_offer_shifts`). Todo se cuenta en días de Colombia y nada se inventa: un estado viene de la base de datos
// y una alerta siempre dice por qué aparece.
//
// Qué ve cada plan (la puerta es de interfaz: son cuentas sobre datos propios):
//  - Todas las instituciones: la semana con el estado real de cada turno, los contadores, las posiciones sin cubrir y
//    las alertas de hoy (sin iniciar, sin confirmar, sin ir en camino, sin cerrar, sin cubrir).
//  - IPS Mejorado (`inst_agenda_insights`): riesgo de inasistencia por profesional según su historial, reporte de
//    utilización de 30 días y exportación (CSV e iCal).

import {
  NO_START_HOURS,
  PUNCTUAL_GRACE_MIN,
  cancelledBy,
  contractedHours,
  isUnclosed,
  isUnstarted,
  lateMinutes,
  workedHours,
  type InstBooking,
} from "./instData";
import {
  DAY_MS,
  HOUR_MS,
  bogotaDayIndex,
  bogotaWeekday,
  dayLabelEs,
  msOf,
  pctOf,
  plural,
  startOfBogotaDay,
  timeLabelEs,
  weekdayNameEs,
} from "./intelShared";

export const AGENDA_DAYS = 7;
/** Ventana del reporte de utilización. */
export const REPORT_DAYS = 30;
/** Historial con el que se mide la confiabilidad de cada profesional. */
export const RELIABILITY_DAYS = 60;
/** Una solicitud sin confirmar que empieza dentro de este plazo es una alerta. */
export const UNCONFIRMED_ALERT_HOURS = 24;
/** Un turno confirmado que empieza dentro de este plazo y nadie va en camino es una alerta. */
export const NOT_ON_WAY_MIN = 60;
/** Posiciones sin cubrir que empiezan dentro de este plazo son urgentes. */
export const UNCOVERED_URGENT_HOURS = 48;
/** Una cancelación del profesional con menos de esta antelación cuenta como cancelación tardía. */
export const LATE_CANCEL_HOURS = 12;

export type AgendaStatus =
  | "pending"
  | "confirmed"
  | "in_route"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "unclosed";

export const STATUS_LABEL: Record<AgendaStatus, string> = {
  pending: "Sin confirmar",
  confirmed: "Confirmado",
  in_route: "En camino",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "Sin iniciar",
  unclosed: "Sin cerrar",
};

export type AlertKind = "no_show" | "not_on_way" | "unconfirmed_soon" | "unclosed" | "uncovered";
export type AlertSeverity = "critical" | "high" | "watch";

export interface AgendaAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  at: number;
  bookingId?: string;
}

export type ProRiskLevel = "reliable" | "watch" | "risk" | "new";

export interface ProReliability {
  proId: string;
  /** Turnos que ya debían ocurrir en la ventana (sin contar los que canceló la institución). */
  due: number;
  completed: number;
  noShows: number;
  lateCancels: number;
  punctualPct: number | null;
  level: ProRiskLevel;
  /** Por qué tiene ese nivel, en una frase. */
  reason: string;
}

export interface AgendaShift {
  id: string;
  professionalId: string;
  professionalName: string | null;
  title: string;
  startsAt: number;
  endsAt: number;
  hours: number;
  status: AgendaStatus;
  /** Solo con el plan: confiabilidad del profesional asignado. */
  risk: ProReliability | null;
}

export interface AgendaDay {
  day: number;
  startMs: number;
  label: string;
  isToday: boolean;
  shifts: AgendaShift[];
  /** Posiciones de turnos publicados que aún nadie cubre. */
  openPositions: number;
  /** Horas de turnos activos (sin cancelados). */
  hours: number;
  alerts: number;
}

export interface AgendaKpis {
  /** Turnos de la semana, sin contar cancelados. */
  total: number;
  /** Sin confirmar, confirmados o en camino, aún por empezar. */
  scheduled: number;
  inProgress: number;
  completed: number;
  /** Turnos de hoy que nadie inició (inasistencia probable). */
  noShows: number;
  cancelled: number;
  openPositions: number;
  alerts: number;
}

export interface AgendaView {
  days: AgendaDay[];
  kpis: AgendaKpis;
  alerts: AgendaAlert[];
  headline: string;
}

export interface AgendaOfferShift {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  positions: number;
  filled: number;
  status: string;
}

export interface AgendaInput {
  bookings: readonly InstBooking[];
  openShifts?: readonly AgendaOfferShift[];
  /** Nombre de cada profesional (por id). */
  names?: Readonly<Record<string, string>>;
  /** Título de cada oferta (por id), para nombrar el turno. */
  titles?: Readonly<Record<string, string>>;
  /** Confiabilidad por profesional (solo con el plan). */
  reliability?: Readonly<Record<string, ProReliability>> | null;
  now: number;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, high: 1, watch: 2 };

/** Estado que se muestra: el de la base de datos, salvo lo que ya se sabe que se quedó sin iniciar o sin cerrar. */
export function agendaStatus(b: InstBooking, now: number): AgendaStatus {
  if (isUnstarted(b, now)) return "no_show";
  if (isUnclosed(b, now)) return "unclosed";
  switch (b.status) {
    case "pending":
    case "confirmed":
    case "in_route":
    case "in_progress":
    case "completed":
    case "cancelled":
      return b.status;
    default:
      return "pending";
  }
}

function firstName(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n ? n.split(/\s+/)[0] : null;
}

function inMinutes(t: number, now: number): string {
  const min = Math.max(1, Math.round((t - now) / 60_000));
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  return `en ${h} h`;
}

/** Alertas de un servicio (como mucho una: la más importante). */
export function bookingAlert(b: InstBooking, now: number, name: string | null): AgendaAlert | null {
  const start = msOf(b.scheduled_at);
  if (!Number.isFinite(start)) return null;
  const who = name ?? "el profesional";
  const at = timeLabelEs(start);
  if (isUnstarted(b, now)) {
    return {
      id: `no_show:${b.id}`,
      kind: "no_show",
      severity: "critical",
      title: `Turno de las ${at} sin iniciar`,
      detail: `Pasaron más de ${NO_START_HOURS} h y ${who} no marcó llegada ni inicio. Confirma con la persona o busca un reemplazo.`,
      at: start,
      bookingId: b.id,
    };
  }
  if (isUnclosed(b, now)) {
    return {
      id: `unclosed:${b.id}`,
      kind: "unclosed",
      severity: "watch",
      title: `Turno de las ${at} sin cerrar`,
      detail: `Sigue «en curso» mucho después de su fin previsto. Pide a ${who} que lo cierre para que el parte quede completo.`,
      at: start,
      bookingId: b.id,
    };
  }
  const startedOrArrived =
    Number.isFinite(msOf(b.started_at)) || Number.isFinite(msOf(b.arrived_at));
  if (
    b.status === "confirmed" &&
    !startedOrArrived &&
    start > now &&
    start - now <= NOT_ON_WAY_MIN * 60_000
  ) {
    return {
      id: `not_on_way:${b.id}`,
      kind: "not_on_way",
      severity: "high",
      title: `Empieza ${inMinutes(start, now)} y nadie va en camino`,
      detail: `${name ?? "El profesional"} aún no marcó «en camino». Un recordatorio corto suele bastar.`,
      at: start,
      bookingId: b.id,
    };
  }
  if (b.status === "pending" && start > now && start - now <= UNCONFIRMED_ALERT_HOURS * HOUR_MS) {
    return {
      id: `unconfirmed:${b.id}`,
      kind: "unconfirmed_soon",
      severity: "high",
      title: `Sin confirmar y empieza ${inMinutes(start, now)}`,
      detail: `Nadie ha confirmado este turno. Confírmalo con ${who} o busca a otra persona a tiempo.`,
      at: start,
      bookingId: b.id,
    };
  }
  return null;
}

/** Alerta por posiciones sin cubrir de un turno publicado (solo turnos abiertos que aún no empiezan). */
export function uncoveredAlert(s: AgendaOfferShift, now: number): AgendaAlert | null {
  const start = msOf(s.starts_at);
  const open = Math.max(0, Math.floor(s.positions) - Math.floor(s.filled));
  if (s.status !== "open" || open === 0 || !Number.isFinite(start) || start <= now) return null;
  const urgent = start - now <= UNCOVERED_URGENT_HOURS * HOUR_MS;
  return {
    id: `uncovered:${s.id}`,
    kind: "uncovered",
    severity: urgent ? "high" : "watch",
    title: `${plural(open, "posición", "posiciones")} sin cubrir · ${s.title}`,
    detail: `El turno del ${dayLabelEs(start)} a las ${timeLabelEs(start)} aún no tiene a nadie${urgent ? " y empieza pronto" : ""}. Revisa las postulaciones o ajusta la tarifa.`,
    at: start,
  };
}

/** La semana: hoy y los 6 días siguientes, en hora de Colombia. */
export function buildAgenda(input: AgendaInput): AgendaView {
  const { now } = input;
  const names = input.names ?? {};
  const titles = input.titles ?? {};
  const today = bogotaDayIndex(now);
  const lastDay = today + AGENDA_DAYS - 1;
  const inWindow = (t: number) => {
    if (!Number.isFinite(t)) return false;
    const d = bogotaDayIndex(t);
    return d >= today && d <= lastDay;
  };

  const days: AgendaDay[] = Array.from({ length: AGENDA_DAYS }, (_, i) => {
    const startMs = startOfBogotaDay(now) + i * DAY_MS;
    return {
      day: today + i,
      startMs,
      label: dayLabelEs(startMs),
      isToday: i === 0,
      shifts: [],
      openPositions: 0,
      hours: 0,
      alerts: 0,
    };
  });
  const dayOf = (t: number) => days[bogotaDayIndex(t) - today];

  const alerts: AgendaAlert[] = [];
  const kpis: AgendaKpis = {
    total: 0,
    scheduled: 0,
    inProgress: 0,
    completed: 0,
    noShows: 0,
    cancelled: 0,
    openPositions: 0,
    alerts: 0,
  };

  const seen = new Set<string>();
  for (const b of input.bookings) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const start = msOf(b.scheduled_at);
    if (!inWindow(start)) continue;
    const name = names[b.professional_id] ?? null;
    const status = agendaStatus(b, now);
    const hours = contractedHours(b);
    const shift: AgendaShift = {
      id: b.id,
      professionalId: b.professional_id,
      professionalName: name,
      title: (b.job_offer_id && titles[b.job_offer_id]) || "Servicio",
      startsAt: start,
      endsAt: start + hours * HOUR_MS,
      hours,
      status,
      risk: input.reliability?.[b.professional_id] ?? null,
    };
    const day = dayOf(start);
    day.shifts.push(shift);
    if (status === "cancelled") {
      kpis.cancelled++;
    } else {
      kpis.total++;
      day.hours += hours;
      if (status === "completed") kpis.completed++;
      else if (status === "in_progress" || status === "unclosed") kpis.inProgress++;
      else if (status === "no_show") kpis.noShows++;
      else kpis.scheduled++;
    }
    const alert = bookingAlert(b, now, name);
    if (alert) {
      alerts.push(alert);
      day.alerts++;
    }
  }

  const seenShift = new Set<string>();
  for (const s of input.openShifts ?? []) {
    if (seenShift.has(s.id)) continue;
    seenShift.add(s.id);
    const start = msOf(s.starts_at);
    if (!inWindow(start) || s.status !== "open" || start <= now) continue;
    const open = Math.max(0, Math.floor(s.positions) - Math.floor(s.filled));
    if (open === 0) continue;
    const day = dayOf(start);
    day.openPositions += open;
    kpis.openPositions += open;
    const alert = uncoveredAlert(s, now);
    if (alert) {
      alerts.push(alert);
      day.alerts++;
    }
  }

  for (const d of days)
    d.shifts.sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id));
  alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.at - b.at);
  kpis.alerts = alerts.length;

  return { days, kpis, alerts, headline: agendaHeadline(days[0], kpis, alerts) };
}

/** Una frase para arriba de la agenda. Calma cuando todo está en orden; concreta cuando algo pide atención. */
export function agendaHeadline(
  today: AgendaDay,
  kpis: AgendaKpis,
  alerts: readonly AgendaAlert[],
): string {
  const critical = alerts.filter((a) => a.severity === "critical").length;
  if (critical > 0) {
    return `${plural(critical, "turno", "turnos")} de hoy sin iniciar: conviene actuar ya.`;
  }
  const high = alerts.filter((a) => a.severity === "high").length;
  if (high > 0)
    return `${plural(high, "asunto", "asuntos")} para resolver pronto. El resto de la semana va en orden.`;
  if (kpis.total === 0 && kpis.openPositions === 0) {
    return "Semana tranquila: no hay turnos en los próximos 7 días.";
  }
  const active = today.shifts.filter((s) => s.status !== "cancelled").length;
  return active > 0
    ? `Hoy ${active === 1 ? "hay 1 turno" : `hay ${active} turnos`} y todo va en orden.`
    : "Todo en orden para esta semana.";
}

// ─── Confiabilidad por profesional (plan IPS Mejorado) ──────────────────────

/** Historial de cada profesional con la institución en los últimos `RELIABILITY_DAYS` días. */
export function proReliability(
  bookings: readonly InstBooking[],
  now: number,
): Record<string, ProReliability> {
  const since = now - RELIABILITY_DAYS * DAY_MS;
  const acc = new Map<
    string,
    {
      due: number;
      completed: number;
      noShows: number;
      lateCancels: number;
      onTime: number;
      timed: number;
    }
  >();
  const seen = new Set<string>();
  for (const b of bookings) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const start = msOf(b.scheduled_at);
    if (!Number.isFinite(start) || start < since || start >= now || b.status === "pending")
      continue;
    const by = cancelledBy(b);
    if (by === "client") continue; // la institución canceló: no dice nada del profesional
    const a = acc.get(b.professional_id) ?? {
      due: 0,
      completed: 0,
      noShows: 0,
      lateCancels: 0,
      onTime: 0,
      timed: 0,
    };
    a.due++;
    if (b.status === "completed") a.completed++;
    if (isUnstarted(b, now)) a.noShows++;
    if (by === "professional") {
      const cancelledAt = msOf(b.cancelled_at);
      if (Number.isFinite(cancelledAt) && start - cancelledAt < LATE_CANCEL_HOURS * HOUR_MS)
        a.lateCancels++;
    }
    const late = lateMinutes(b);
    if (late !== null) {
      a.timed++;
      if (late <= PUNCTUAL_GRACE_MIN) a.onTime++;
    }
    acc.set(b.professional_id, a);
  }
  const out: Record<string, ProReliability> = {};
  for (const [proId, a] of acc) {
    const punctualPct = a.timed >= 3 ? pctOf(a.onTime, a.timed) : null;
    let level: ProRiskLevel;
    let reason: string;
    if (a.noShows > 0) {
      level = "risk";
      reason = `${plural(a.noShows, "turno", "turnos")} sin iniciar en ${RELIABILITY_DAYS} días.`;
    } else if (a.lateCancels >= 2) {
      level = "risk";
      reason = `${a.lateCancels} cancelaciones con menos de ${LATE_CANCEL_HOURS} h de aviso.`;
    } else if (a.lateCancels === 1) {
      level = "watch";
      reason = `Una cancelación con menos de ${LATE_CANCEL_HOURS} h de aviso.`;
    } else if (punctualPct !== null && punctualPct < 70) {
      level = "watch";
      reason = `Llegó a tiempo en el ${punctualPct} % de los turnos con registro.`;
    } else if (a.completed >= 3) {
      level = "reliable";
      reason = `${a.completed} turnos cumplidos sin inasistencias.`;
    } else {
      level = "new";
      reason = "Aún hay poco historial con tu institución.";
    }
    out[proId] = {
      proId,
      due: a.due,
      completed: a.completed,
      noShows: a.noShows,
      lateCancels: a.lateCancels,
      punctualPct,
      level,
      reason,
    };
  }
  return out;
}

/** Para quien no tiene historial con la institución: el primer turno juntos. */
export const NEW_PRO: Omit<ProReliability, "proId"> = {
  due: 0,
  completed: 0,
  noShows: 0,
  lateCancels: 0,
  punctualPct: null,
  level: "new",
  reason: "Primer turno con tu institución: un recordatorio el día anterior ayuda.",
};

/** Confiabilidad para cada profesional de la semana (los que no tienen historial quedan como «nuevo»). */
export function reliabilityFor(
  proIds: readonly string[],
  history: Readonly<Record<string, ProReliability>>,
): Record<string, ProReliability> {
  const out: Record<string, ProReliability> = {};
  for (const id of proIds) out[id] = history[id] ?? { proId: id, ...NEW_PRO };
  return out;
}

// ─── Reporte de utilización (plan IPS Mejorado) ─────────────────────────────

export interface UtilizationReport {
  /** Turnos que debían ocurrir en la ventana (sin solicitudes sin confirmar ni cancelaciones de la institución). */
  committed: number;
  completed: number;
  noShows: number;
  proCancels: number;
  clientCancels: number;
  completionPct: number | null;
  noShowPct: number | null;
  contractedHours: number;
  workedHours: number;
  /** Horas registradas frente a contratadas, solo en turnos completados con ambos datos. */
  utilizationPct: number | null;
  punctualPct: number | null;
  /** Turnos completados por día de la semana (lunes = 0). */
  byWeekday: number[];
  busiestWeekday: number | null;
  insights: string[];
}

export function utilizationReport(
  bookings: readonly InstBooking[],
  now: number,
): UtilizationReport {
  const since = now - REPORT_DAYS * DAY_MS;
  let committed = 0;
  let completed = 0;
  let noShows = 0;
  let proCancels = 0;
  let clientCancels = 0;
  let contracted = 0;
  let worked = 0;
  let onTime = 0;
  let timed = 0;
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  const seen = new Set<string>();
  for (const b of bookings) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const start = msOf(b.scheduled_at);
    if (!Number.isFinite(start) || start < since || start >= now || b.status === "pending")
      continue;
    const by = cancelledBy(b);
    if (by === "client") {
      clientCancels++;
      continue;
    }
    committed++;
    if (by === "professional") proCancels++;
    if (isUnstarted(b, now)) noShows++;
    if (b.status === "completed") {
      completed++;
      byWeekday[bogotaWeekday(start)]++;
      const w = workedHours(b);
      if (w !== null && contractedHours(b) > 0) {
        worked += w;
        contracted += contractedHours(b);
      }
    }
    const late = lateMinutes(b);
    if (late !== null) {
      timed++;
      if (late <= PUNCTUAL_GRACE_MIN) onTime++;
    }
  }
  const completionPct = pctOf(completed, committed);
  const noShowPct = pctOf(noShows, committed);
  const utilizationPct = contracted > 0 ? Math.round((worked / contracted) * 100) : null;
  const punctualPct = timed >= 3 ? pctOf(onTime, timed) : null;
  const max = Math.max(...byWeekday);
  const busiestWeekday = max > 0 ? byWeekday.indexOf(max) : null;

  const insights: string[] = [];
  if (committed === 0) {
    insights.push(`Aún no hay turnos para medir en los últimos ${REPORT_DAYS} días.`);
  } else {
    insights.push(`Se cumplieron ${completed} de ${committed} turnos (${completionPct} %).`);
    if (noShows > 0) {
      insights.push(
        noShowPct !== null && noShowPct >= 10
          ? `Las inasistencias llegan al ${noShowPct} %: confirmar 24 h antes y recordar 1 h antes las reduce.`
          : `${plural(noShows, "turno quedó", "turnos quedaron")} sin iniciar.`,
      );
    } else {
      insights.push("Ningún turno quedó sin iniciar.");
    }
    if (utilizationPct !== null) {
      insights.push(
        utilizationPct < 90
          ? `Se registró el ${utilizationPct} % de las horas contratadas: revisa los cierres anticipados.`
          : `Se registró el ${utilizationPct} % de las horas contratadas.`,
      );
    }
    if (busiestWeekday !== null) {
      insights.push(`El día con más turnos cumplidos es el ${weekdayNameEs(busiestWeekday)}.`);
    }
  }
  return {
    committed,
    completed,
    noShows,
    proCancels,
    clientCancels,
    completionPct,
    noShowPct,
    contractedHours: contracted,
    workedHours: worked,
    utilizationPct,
    punctualPct,
    byWeekday,
    busiestWeekday,
    insights,
  };
}

// ─── Exportar y recordar ────────────────────────────────────────────────────

/** Celda CSV segura: comillas dobladas y sin fórmulas (una celda que empieza por = + - @ se neutraliza). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Agenda de la semana en CSV (sin teléfonos ni direcciones). */
export function agendaCsv(view: AgendaView): string {
  const rows: Array<Array<string | number>> = [
    ["Día", "Hora", "Fin", "Turno", "Profesional", "Horas", "Estado"],
  ];
  for (const d of view.days) {
    for (const s of d.shifts) {
      rows.push([
        d.label,
        timeLabelEs(s.startsAt),
        timeLabelEs(s.endsAt),
        s.title,
        s.professionalName ?? "Profesional",
        String(Math.round(s.hours * 100) / 100).replace(".", ","),
        STATUS_LABEL[s.status],
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function icsDate(t: number): string {
  return new Date(t)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function icsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Calendario iCal con los turnos activos de la semana (para Google Calendar, Outlook o el celular). */
export function agendaIcs(view: AgendaView, now: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Humanix//Agenda institucional//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const d of view.days) {
    for (const s of d.shifts) {
      if (s.status === "cancelled") continue;
      const end = s.endsAt > s.startsAt ? s.endsAt : s.startsAt + HOUR_MS;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${s.id}@humanix.lat`,
        `DTSTAMP:${icsDate(now)}`,
        `DTSTART:${icsDate(s.startsAt)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsText(`${s.title} · ${s.professionalName ?? "Profesional"}`)}`,
        `DESCRIPTION:${icsText(`Estado: ${STATUS_LABEL[s.status]}`)}`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** Recordatorio corto para el profesional (sin pagos ni datos de pacientes). La institución elige a quién enviarlo. */
export function reminderText(
  s: Pick<AgendaShift, "title" | "startsAt" | "professionalName">,
  now: number,
): string {
  const name = firstName(s.professionalName);
  const days = bogotaDayIndex(s.startsAt) - bogotaDayIndex(now);
  const when =
    days <= 0
      ? `hoy a las ${timeLabelEs(s.startsAt)}`
      : days === 1
        ? `mañana a las ${timeLabelEs(s.startsAt)}`
        : `el ${dayLabelEs(s.startsAt)} a las ${timeLabelEs(s.startsAt)}`;
  return `Hola${name ? ` ${name}` : ""}, te recordamos tu turno de ${s.title} ${when}. Si algo cambia, avísanos por Humanix. ¡Gracias!`;
}

/** Turnos a los que conviene mandar recordatorio: confirmados o sin confirmar, de las próximas 48 h. */
export function needsReminder(s: Pick<AgendaShift, "status" | "startsAt">, now: number): boolean {
  return (
    (s.status === "confirmed" || s.status === "pending") &&
    s.startsAt > now &&
    s.startsAt - now <= 48 * HOUR_MS
  );
}
