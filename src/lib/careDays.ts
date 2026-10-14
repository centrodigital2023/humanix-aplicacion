// «Días con cuidado» — lógica pura, sin base de datos.
//
// Un contador que SUMA y nunca se reinicia. Las rachas («lleva 12 días seguidos») castigan el día que se rompen: justo
// cuando una familia está agotada. Aquí se cuentan los días distintos en que hubo cuidado (un servicio terminado o en
// curso, o un parte escrito por una persona) y se celebran umbrales (7, 14, 30…) sin que ningún día perdido le quite
// nada a los anteriores.
//
// Límite honesto: se cuenta lo que la app puede leer (las reservas de los últimos ~200 días). Un contador de toda la
// vida exigiría guardarlo en una tabla (migración); se dejó fuera para no tocar la base.
//
// En la ruta «enfermedad» (tono sobrio) no hay umbrales ni felicitaciones: solo «han estado acompañados N días».

import { msOf, plural } from "./intelShared";
import { bogotaDayIndex, type RouteTone } from "./careJourney";

export const CARE_DAY_MILESTONES = [7, 14, 30, 60, 100, 180, 365] as const;

export interface CareDaysBooking {
  status: string;
  scheduled_at: string;
  completed_at?: string | null;
}

export interface CareDaysLog {
  created_at: string;
  system_generated?: boolean | null;
}

export interface CareDaysReport {
  /** Días distintos con cuidado dentro de lo que se puede leer. */
  total: number;
  /** Días con cuidado en los últimos 7 (contando hoy). */
  thisWeek: number;
  /** Mayor umbral alcanzado, o `null` si aún no llega al primero. */
  reached: number | null;
  /** Siguiente umbral, o `null` si ya pasó el último. */
  next: number | null;
  /** Días que faltan para el siguiente umbral. */
  toNext: number | null;
  /** Umbral que se cruzó en los últimos 7 días (para celebrarlo una vez), o `null`. */
  crossedThisWeek: number | null;
  /** `false` en el tono sobrio: nada de confeti. */
  celebrate: boolean;
  headline: string;
  line: string;
}

/** Un servicio que cruza la medianoche cubre más de un día; se acotan a 3 para no inflar con datos dañados. */
const MAX_SPAN_DAYS = 3;

/** Días (índices de calendario de Colombia) con cuidado. */
export function careDaySet(
  bookings: readonly CareDaysBooking[],
  logs: readonly CareDaysLog[],
  now: number,
): Set<number> {
  const days = new Set<number>();
  for (const b of bookings) {
    if (b.status !== "completed" && b.status !== "in_progress") continue;
    const start = msOf(b.scheduled_at);
    if (!Number.isFinite(start) || start > now) continue;
    const first = bogotaDayIndex(start);
    const endMs = msOf(b.completed_at);
    const last = Number.isFinite(endMs) ? bogotaDayIndex(Math.min(endMs, now)) : first;
    for (let d = first; d <= Math.max(first, Math.min(last, first + MAX_SPAN_DAYS - 1)); d++)
      days.add(d);
  }
  for (const l of logs) {
    if (l.system_generated) continue;
    const t = msOf(l.created_at);
    if (Number.isFinite(t) && t <= now) days.add(bogotaDayIndex(t));
  }
  return days;
}

export function careDaysReport(input: {
  bookings: readonly CareDaysBooking[];
  logs?: readonly CareDaysLog[];
  now: number;
  tone?: RouteTone;
}): CareDaysReport {
  const { bookings, logs = [], now, tone = "warm" } = input;
  const days = careDaySet(bookings, logs, now);
  const today = bogotaDayIndex(now);
  const total = days.size;
  const weekAgo = today - 7;
  const thisWeek = [...days].filter((d) => d > weekAgo && d <= today).length;
  const totalBeforeWeek = total - thisWeek;

  const reached = [...CARE_DAY_MILESTONES].reverse().find((m) => total >= m) ?? null;
  const next = CARE_DAY_MILESTONES.find((m) => total < m) ?? null;
  const crossed =
    [...CARE_DAY_MILESTONES].reverse().find((m) => totalBeforeWeek < m && total >= m) ?? null;
  const celebrate = tone === "warm";

  let headline: string;
  let line: string;
  if (total === 0) {
    headline = "Aquí empieza su historia de cuidado";
    line = "Cuando haya un primer servicio, cada día con cuidado se irá sumando aquí.";
  } else if (!celebrate) {
    headline = `Han estado acompañados ${plural(total, "día", "días")}`;
    line = "Cada día de compañía cuenta, sin metas ni presión.";
  } else {
    headline = `${plural(total, "día", "días")} con cuidado`;
    if (crossed !== null) line = `¡Llegaron a ${crossed} días con cuidado! Cada uno cuenta.`;
    else if (next !== null && next - total <= 3)
      line = `Falta${next - total === 1 ? "" : "n"} ${plural(next - total, "día", "días")} para llegar a ${next}.`;
    else if (thisWeek > 0)
      line = `${plural(thisWeek, "día", "días")} con cuidado esta semana. Esto solo suma.`;
    else line = "Esto solo suma: ningún día sin servicio le quita nada a los anteriores.";
  }

  return {
    total,
    thisWeek,
    reached,
    next,
    toNext: next === null ? null : next - total,
    crossedThisWeek: celebrate ? crossed : null,
    celebrate,
    headline,
    line,
  };
}

/** Aclaración corta para la pantalla: el contador mira solo lo que la app puede leer. */
export const CARE_DAYS_WINDOW_NOTE = "Cuenta lo registrado en los últimos meses.";
