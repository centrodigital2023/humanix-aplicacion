// Datos de las reservas de una institución y lo que de ellas se puede decir con certeza — lógica pura.
//
// Los motores de calidad, equipo, costos y el resumen del día leen las mismas filas (lo que la propia institución ya puede
// leer de `service_bookings`, su parte y sus contratos). Aquí viven los tipos de esas filas y las cuentas por servicio que
// todos comparten: cuántos minutos tarde llegó, cuántas horas se registraron de verdad, quién canceló y qué servicios
// quedaron sin iniciar o sin cerrar. Si un dato falta o es absurdo, la cuenta devuelve `null`: nunca se inventa.

import { HOUR_MS, inPeriod, msOf, num, type Period } from "./intelShared";
import type { RawBooking } from "./moneyFlow";
import { inferCancelParty } from "./serviceCancel";

/** Reserva de la institución (ella es quien contrata: `client_id`). */
export interface InstBooking extends RawBooking {
  professional_id: string;
  job_offer_id?: string | null;
  started_at?: string | null;
  arrived_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
}

/** Registro del parte de un servicio (solo lo necesario para contar documentación y alertas). */
export interface InstLog {
  booking_id: string;
  event_type?: string | null;
  is_alert?: boolean | null;
  created_at: string;
}

/** Turno de un contrato inteligente y el estado del contrato al que pertenece. */
export interface InstContractShift {
  booking_id: string | null;
  contract_status: string | null;
}

/** Lo que se sabe del perfil público de un profesional. */
export interface InstProFact {
  name?: string | null;
  rethusVerified?: boolean | null;
  verified?: boolean | null;
}

/** Minutos de margen para llamar «puntual» a una llegada. */
export const PUNCTUAL_GRACE_MIN = 10;
/** Minutos de retraso desde los que una llegada es «muy tarde». */
export const VERY_LATE_MIN = 30;
/** Un servicio de menos de esta fracción de lo contratado se revisa… */
export const SHORT_RATIO = 0.8;
/** …siempre que además falten al menos tantas horas. */
export const SHORT_MIN_HOURS = 1;
/** Horas tras la hora programada desde las que un servicio confirmado sin inicio se da por «sin inicio». */
export const NO_START_HOURS = 2;
/** Horas tras el fin previsto desde las que un servicio «en curso» se da por «sin cerrar». */
export const NO_CLOSE_EXTRA_HOURS = 12;
/** Un registro de trabajo más largo que esto (veces lo contratado) es un dato dañado, no una jornada. */
const MAX_WORKED_RATIO = 3;
/** Una llegada más de esta cantidad de horas antes del turno no es una llegada: es un dato dañado. */
const MAX_EARLY_HOURS = 6;

const SETTLED = ["completed"] as const;
const ONGOING = ["in_progress"] as const;
const ANNOUNCED = ["confirmed", "in_route"] as const;

export const isCompleted = (b: InstBooking) => (SETTLED as readonly string[]).includes(b.status);

/**
 * Servicios que ya debieron empezar dentro del periodo: programados desde el inicio hasta el fin del periodo y antes de
 * ahora. Las solicitudes sin confirmar («pending») no cuentan: nadie quedó comprometido.
 */
export function dueInPeriod(bookings: InstBooking[], period: Period, now: number): InstBooking[] {
  return bookings.filter((b) => {
    const t = msOf(b.scheduled_at);
    return b.status !== "pending" && inPeriod(t, period) && t < now;
  });
}

/** Horas contratadas del servicio (nunca negativas). */
export function contractedHours(b: InstBooking): number {
  return Math.max(0, num(b.duration_hours));
}

/**
 * Minutos que llegó tarde el profesional (0 si llegó a tiempo o antes). Usa la llegada que registró, o el inicio si no
 * marcó la llegada. `null` sin dato, o si la hora no tiene sentido (mucho antes del turno o después de que terminara).
 */
export function lateMinutes(b: InstBooking): number | null {
  const scheduled = msOf(b.scheduled_at);
  const arrivedAt = msOf(b.arrived_at);
  const arrival = Number.isFinite(arrivedAt) ? arrivedAt : msOf(b.started_at);
  if (!Number.isFinite(scheduled) || !Number.isFinite(arrival)) return null;
  if (arrival < scheduled - MAX_EARLY_HOURS * HOUR_MS) return null;
  if (arrival > scheduled + Math.max(1, contractedHours(b)) * HOUR_MS) return null;
  return Math.max(0, Math.round((arrival - scheduled) / 60_000));
}

/** Horas que quedaron registradas entre el inicio y el cierre del servicio. `null` sin ambas horas o con datos dañados. */
export function workedHours(b: InstBooking): number | null {
  const contracted = contractedHours(b);
  const start = msOf(b.started_at);
  const end = msOf(b.completed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  // Sin horas contratadas cualquier registro «sobra»: queda fuera por la misma regla de datos dañados.
  const worked = (end - start) / HOUR_MS;
  return worked > contracted * MAX_WORKED_RATIO ? null : worked;
}

/** ¿Quién canceló? «professional», «client» (la institución) o «unknown» si no eligió un motivo de la lista. */
export function cancelledBy(b: InstBooking): "professional" | "client" | "unknown" | null {
  return b.status === "cancelled" ? inferCancelParty(b.cancel_reason) : null;
}

/** Confirmado (o «en camino») y ya pasaron más de 2 h de la hora programada sin que nadie iniciara el servicio. */
export function isUnstarted(b: InstBooking, now: number): boolean {
  if (!(ANNOUNCED as readonly string[]).includes(b.status)) return false;
  if (Number.isFinite(msOf(b.started_at)) || Number.isFinite(msOf(b.arrived_at))) return false;
  // Una fecha dañada da NaN y la comparación es falsa: nunca se llama «sin iniciar» a lo que no tiene fecha.
  return now - msOf(b.scheduled_at) > NO_START_HOURS * HOUR_MS;
}

/** «En curso» y ya pasaron más de 12 h del fin previsto: nadie cerró el servicio. */
export function isUnclosed(b: InstBooking, now: number): boolean {
  if (!(ONGOING as readonly string[]).includes(b.status)) return false;
  const scheduled = msOf(b.scheduled_at);
  if (!Number.isFinite(scheduled)) return false;
  return now - (scheduled + contractedHours(b) * HOUR_MS) > NO_CLOSE_EXTRA_HOURS * HOUR_MS;
}

/** Nombre de cada profesional del que se conoce (sin nombre, no aparece: la pantalla dice «Profesional»). */
export function proNames(pros: Record<string, InstProFact> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, fact] of Object.entries(pros ?? {})) {
    const name = fact.name?.trim();
    if (name) out[id] = name;
  }
  return out;
}

/** El servicio terminado más reciente de cada profesional (la fecha de inicio manda; a igualdad, el id menor). */
export function lastCompletedByPro(bookings: InstBooking[]): Record<string, string> {
  // Una fecha dañada da NaN: ese servicio nunca queda como «el más reciente».
  const done = bookings
    .filter((b) => isCompleted(b) && Number.isFinite(msOf(b.scheduled_at)))
    .sort((a, b) => msOf(b.scheduled_at) - msOf(a.scheduled_at) || a.id.localeCompare(b.id));
  const out: Record<string, string> = {};
  for (const b of done) if (!(b.professional_id in out)) out[b.professional_id] = b.id;
  return out;
}
