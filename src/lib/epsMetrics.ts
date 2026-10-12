// Resumen operativo del portal EPS/IPS con datos reales de la propia institución — lógica pura.
//
// Reemplaza las cifras que el portal inventaba (tendencias al azar, facturación = servicios × $85.000, reingresos y
// cumplimiento fijos): todo sale de los servicios de la institución y de las alertas y puntajes de riesgo ligados a esos
// mismos servicios. Un dato que no se pudo cargar llega como `null` y la pantalla lo dice; nunca se muestra como cero.
// No mueve dinero ni contacta a nadie.

import { dueInPeriod, isCompleted, workedHours, type InstBooking } from "./instData";
import {
  DAY_MS,
  bogotaDayIndex,
  BOGOTA_OFFSET_MS,
  dateEs,
  inPeriod,
  msOf,
  num,
  round1,
  type Period,
} from "./intelShared";

export type EpsLevel = "critical" | "high" | "medium" | "low";

export const EPS_LEVELS: readonly EpsLevel[] = ["critical", "high", "medium", "low"];

export const EPS_LEVEL_LABEL: Record<EpsLevel, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Moderado",
  low: "Bajo",
};

/** Servicios terminados con horas registradas desde los que se habla de una duración promedio. */
export const MIN_SERVICES_FOR_DURATION = 3;
/** Desde estos días de periodo las barras agrupan por semana (si no, son demasiadas para leerlas). */
export const WEEKLY_FROM_DAYS = 35;

/** Alerta clínica ligada a un servicio de la institución. */
export interface EpsAlertRow {
  booking_id: string | null;
  patient_id: string;
  severity: string;
  status: string;
  created_at: string;
}

/** Puntaje de riesgo clínico ligado a un servicio de la institución. */
export interface EpsRiskRow {
  patient_id: string;
  score: number | string | null;
  level: string;
  calculated_at: string;
}

export interface EpsPoint {
  /** Inicio del grupo (medianoche de Colombia, ms UTC). */
  dayMs: number;
  /** «14 oct». */
  label: string;
  services: number;
  alerts: number;
}

export interface EpsMetrics {
  hasData: boolean;
  period: Period;
  services: {
    /** En curso ahora. */
    active: number;
    /** Terminados dentro del periodo. */
    completed: number;
    cancelled: number;
  };
  /** Horas registradas por servicio terminado (`null` con menos de 3 servicios con horas). */
  avgHours: number | null;
  /** `null` si las alertas no se pudieron cargar. */
  alerts: {
    /** Sin atender todavía, sea cual sea su fecha. */
    active: number;
    activeCritical: number;
    /** Creadas dentro del periodo. */
    inPeriod: number;
    bySeverity: Record<EpsLevel, number>;
  } | null;
  /** `null` si los puntajes no se pudieron cargar. */
  risk: {
    patients: number;
    /** Promedio del último puntaje de cada paciente (`null` sin pacientes). */
    avg: number | null;
    levels: Record<EpsLevel, number>;
  } | null;
  /** Servicios terminados y alertas por día (o por semana si el periodo es largo). */
  points: EpsPoint[];
  bucketDays: 1 | 7;
}

export interface EpsInput {
  bookings: InstBooking[];
  alerts: EpsAlertRow[] | null;
  risks: EpsRiskRow[] | null;
  period: Period;
  now: number;
}

const isLevel = (v: string): v is EpsLevel => (EPS_LEVELS as readonly string[]).includes(v);
const zeroLevels = (): Record<EpsLevel, number> => ({ critical: 0, high: 0, medium: 0, low: 0 });

/** «14 oct»: el día y el mes, sin el año (cabe bajo cada barra). */
const shortDay = (t: number) => dateEs(t).split(" ").slice(0, 2).join(" ");

export function buildEpsMetrics(input: EpsInput): EpsMetrics {
  const { period } = input;
  const due = dueInPeriod(input.bookings, period, input.now);
  const completed = due.filter(isCompleted);
  const hours = completed.map(workedHours).filter((h): h is number => h !== null);
  const avgHours =
    hours.length >= MIN_SERVICES_FOR_DURATION
      ? round1(hours.reduce((s, h) => s + h, 0) / hours.length)
      : null;

  // ── Alertas ──────────────────────────────────────────────────────────────────
  let alerts: EpsMetrics["alerts"] = null;
  if (input.alerts) {
    const inside = input.alerts.filter((a) => inPeriod(msOf(a.created_at), period));
    const bySeverity = zeroLevels();
    for (const a of inside) if (isLevel(a.severity)) bySeverity[a.severity] += 1;
    const open = input.alerts.filter((a) => a.status === "active");
    alerts = {
      active: open.length,
      activeCritical: open.filter((a) => a.severity === "critical").length,
      inPeriod: inside.length,
      bySeverity,
    };
  }

  // ── Riesgo: el último puntaje de cada paciente ───────────────────────────────
  let risk: EpsMetrics["risk"] = null;
  if (input.risks) {
    const latest = new Map<string, { score: number; level: EpsLevel }>();
    const newestFirst = [...input.risks].sort(
      (a, b) => msOf(b.calculated_at) - msOf(a.calculated_at),
    );
    for (const r of newestFirst) {
      if (latest.has(r.patient_id) || !isLevel(r.level)) continue;
      latest.set(r.patient_id, { score: num(r.score), level: r.level });
    }
    const levels = zeroLevels();
    let total = 0;
    for (const { score, level } of latest.values()) {
      levels[level] += 1;
      total += score;
    }
    risk = {
      patients: latest.size,
      avg: latest.size > 0 ? Math.round(total / latest.size) : null,
      levels,
    };
  }

  // ── Barras: por día, o por semana si el periodo es largo ─────────────────────
  const firstDay = bogotaDayIndex(period.from);
  const lastDay = bogotaDayIndex(period.to - 1);
  const days = Math.max(0, lastDay - firstDay + 1);
  const size: 1 | 7 = days > WEEKLY_FROM_DAYS ? 7 : 1;
  const points: EpsPoint[] = Array.from({ length: Math.ceil(days / size) }, (_, i) => {
    const dayMs = (firstDay + i * size) * DAY_MS - BOGOTA_OFFSET_MS;
    return { dayMs, label: shortDay(dayMs), services: 0, alerts: 0 };
  });
  const bucketOf = (t: number) => Math.floor((bogotaDayIndex(t) - firstDay) / size);
  // Lo que cuenta ya cayó dentro del periodo: su barra siempre existe.
  for (const b of completed) points[bucketOf(msOf(b.scheduled_at))].services += 1;
  if (input.alerts) {
    for (const a of input.alerts) {
      const t = msOf(a.created_at);
      if (inPeriod(t, period)) points[bucketOf(t)].alerts += 1;
    }
  }

  return {
    hasData: input.bookings.length > 0,
    period,
    services: {
      active: input.bookings.filter((b) => b.status === "in_progress").length,
      completed: completed.length,
      cancelled: due.filter((b) => b.status === "cancelled").length,
    },
    avgHours,
    alerts,
    risk,
    points,
    bucketDays: size,
  };
}

/**
 * Ids de los servicios más recientes (de los últimos `lookbackDays` días y los que vienen), hasta `max`: de ahí se piden
 * las alertas y los puntajes de riesgo. Si hay más, `truncated` lo dice para no presentar una parte como si fuera todo.
 */
export function recentBookingIds(
  bookings: ReadonlyArray<{ id: string; scheduled_at: string }>,
  now: number,
  lookbackDays: number,
  max: number,
): { ids: string[]; truncated: boolean } {
  const since = now - lookbackDays * DAY_MS;
  // Una fecha dañada da NaN y la comparación es falsa: ese servicio no entra.
  const recent = bookings
    .filter((b) => msOf(b.scheduled_at) >= since)
    .sort((a, b) => msOf(b.scheduled_at) - msOf(a.scheduled_at) || a.id.localeCompare(b.id));
  return { ids: recent.slice(0, max).map((b) => b.id), truncated: recent.length > max };
}
