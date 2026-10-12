// Datos de prueba de las funciones inteligentes de la institución (no es una prueba: no se carga en la app).
import type { InstBooking, InstContractShift, InstLog } from "./instData";
import { DAY, HOUR, NOW, bogota, iso, nextId } from "./intel.fixture";

export { DAY, HOUR, NOW };

/** Instante de Colombia a las `hour` en punto de hace `daysAgo` días (negativo: dentro de tantos días). */
export const dayAt = (daysAgo: number, hour = 8): number =>
  bogota("2026-10-14T00:00:00") - daysAgo * DAY + hour * HOUR;

/** Servicio terminado hace `daysAgo` días: 08:00–14:00, llegada puntual, 6 h × $25.000 = $150.000, profesional p1. */
export function ib(daysAgo: number, over: Partial<InstBooking> = {}): InstBooking {
  const start = dayAt(daysAgo, 8);
  return {
    id: nextId("ib"),
    status: "completed",
    professional_id: "p1",
    job_offer_id: "o1",
    scheduled_at: new Date(start).toISOString(),
    arrived_at: new Date(start).toISOString(),
    started_at: new Date(start).toISOString(),
    completed_at: new Date(start + 6 * HOUR).toISOString(),
    cancelled_at: null,
    cancel_reason: null,
    duration_hours: 6,
    hourly_rate: 25_000,
    total_amount: 150_000,
    professional_payout: 150_000,
    platform_fee_amount: 0,
    ...over,
  };
}

/** El mismo servicio, pero el profesional llegó (y empezó) `min` minutos tarde; el cierre queda donde estaba. */
export function late(b: InstBooking, min: number): InstBooking {
  const t = new Date(new Date(b.scheduled_at).getTime() + min * 60_000).toISOString();
  return { ...b, arrived_at: t, started_at: t };
}

/** Servicio acordado para dentro de `daysAhead` días a las 08:00 (todavía sin llegada, inicio ni cierre). */
export function ahead(daysAhead: number, over: Partial<InstBooking> = {}): InstBooking {
  return ib(-daysAhead, {
    status: "confirmed",
    arrived_at: null,
    started_at: null,
    completed_at: null,
    professional_payout: 0,
    ...over,
  });
}

/** Servicio cancelado hace `daysAgo` días con el motivo dado (sin llegada ni cierre). */
export function cancelled(
  daysAgo: number,
  reason: string | null,
  over: Partial<InstBooking> = {},
): InstBooking {
  return ib(daysAgo, {
    status: "cancelled",
    arrived_at: null,
    started_at: null,
    completed_at: null,
    cancelled_at: new Date(dayAt(daysAgo, 6)).toISOString(),
    cancel_reason: reason,
    professional_payout: 0,
    ...over,
  });
}

/** Un registro del parte de un servicio. */
export function logFor(bookingId: string, over: Partial<InstLog> = {}): InstLog {
  return {
    booking_id: bookingId,
    event_type: "note",
    is_alert: false,
    created_at: iso(-HOUR),
    ...over,
  };
}

/** El turno del servicio pertenece a un contrato en ese estado («active» y «completed» están firmados). */
export function contractOf(bookingId: string, status = "active"): InstContractShift {
  return { booking_id: bookingId, contract_status: status };
}

/** Cuenta de ids de prueba: `ids(3)` → ["ib…", …] para armar listas largas sin repetir. */
export const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
