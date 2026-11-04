// Pago retenido tipo InDrive (turnos por Bre-B). Lógica pura y probada (`escrow.test.ts`); la base decide
// (migración 20261104180000_breb_escrow.sql: `hx_booking_escrow_before`, `hx_escrow_release`, `hx_escrow_tick`).
//
//   La familia paga al pedir → 🔒 Humanix lo guarda → el profesional termina → la familia confirma (o pasan 24 h sin
//   reportes) → 💸 se libera y entra a la cola de pagos al profesional.
//   Si se cancela con el pago adentro, o el equipo le da la razón a la familia en un reclamo → ↩️ devolución completa.
//
// Estados en `service_bookings.escrow_status` (NULL = efectivo o sin pagar):
//   held · released · disputed · refunding · refunded

export const ESCROW_WINDOW_HOURS = 24;
export const ESCROW_REMINDER_LEAD_HOURS = 3;
export const DISPUTE_REASON_MIN = 5;
export const DISPUTE_REASON_MAX = 500;

export type EscrowStatus = "held" | "released" | "disputed" | "refunding" | "refunded";

export interface EscrowBooking {
  status: string;
  payment_method?: string | null;
  paid_at?: string | null;
  escrow_status?: string | null;
  release_due_at?: string | null;
  release_reason?: string | null;
  client_confirmed_at?: string | null;
}

/** En qué punto está el dinero del turno, en una palabra que la pantalla entiende. */
export type EscrowStage =
  | "cash" // efectivo: no hay nada retenido
  | "unpaid" // Bre-B sin pagar
  | "protected" // pagado y retenido, el turno aún no termina
  | "awaiting_client" // terminado, esperando que la familia confirme (o se cumpla el plazo)
  | "disputed" // la familia reportó un problema: lo revisa el equipo
  | "released" // liberado al profesional
  | "refunding" // se le está devolviendo a la familia
  | "refunded"; // devuelto

export function escrowStage(b: EscrowBooking): EscrowStage {
  if (b.payment_method === "CASH") return "cash";
  switch (b.escrow_status) {
    case "released":
      return "released";
    case "disputed":
      return "disputed";
    case "refunding":
      return "refunding";
    case "refunded":
      return "refunded";
    case "held":
      return b.status === "completed" ? "awaiting_client" : "protected";
  }
  return b.paid_at ? "protected" : "unpaid";
}

/** Horas que le quedan a la familia para revisar (redondeado hacia arriba; 0 si ya venció o no aplica). */
export function hoursToRelease(releaseDueAt: string | null | undefined, now: number): number {
  if (!releaseDueAt) return 0;
  const due = Date.parse(releaseDueAt);
  if (!Number.isFinite(due)) return 0;
  return Math.max(0, Math.ceil((due - now) / 3_600_000));
}

/** La familia puede confirmar o reportar mientras el turno terminado tenga el pago retenido y el plazo abierto. */
export function canClientDecide(b: EscrowBooking, now: number): boolean {
  if (escrowStage(b) !== "awaiting_client") return false;
  if (!b.release_due_at) return true;
  const due = Date.parse(b.release_due_at);
  return !Number.isFinite(due) || due > now;
}

/** Estados del turno en los que la familia ya puede pagar: desde que lo pide hasta que termina. */
export const PAYABLE_BOOKING_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "confirmed",
  "accepted",
  "in_route",
  "in_progress",
  "completed",
]);

export function canPayBooking(b: EscrowBooking): boolean {
  return b.payment_method !== "CASH" && !b.paid_at && PAYABLE_BOOKING_STATUSES.has(b.status);
}

export type ConfirmResult =
  "released" | "already_released" | "confirmed" | "forbidden" | "not_completed" | "not_releasable";

export type ReportResult =
  | "disputed"
  | "already_disputed"
  | "forbidden"
  | "reason_required"
  | "not_disputable"
  | "window_closed";

export const CONFIRM_MESSAGE: Record<ConfirmResult, string> = {
  released: "¡Listo! Liberamos el pago. Gracias por confiar en Humanix 💚",
  already_released: "El pago ya estaba liberado.",
  confirmed: "Gracias por confirmar que el turno terminó.",
  forbidden: "Solo quien contrató el turno puede confirmarlo.",
  not_completed: "El turno aún no ha terminado.",
  not_releasable: "Este pago ya no se puede liberar desde aquí.",
};

export const REPORT_MESSAGE: Record<ReportResult, string> = {
  disputed: "Recibimos tu reporte. El pago queda retenido mientras lo revisamos.",
  already_disputed: "Ya tenemos tu reporte y lo estamos revisando.",
  forbidden: "Solo quien contrató el turno puede reportar un problema.",
  reason_required: "Cuéntanos en pocas palabras qué pasó.",
  not_disputable: "Este pago ya no está retenido.",
  window_closed: "Pasaron las 24 h para revisar el turno. Escríbenos y te ayudamos.",
};

export function isConfirmResult(v: unknown): v is ConfirmResult {
  return typeof v === "string" && v in CONFIRM_MESSAGE;
}
export function isReportResult(v: unknown): v is ReportResult {
  return typeof v === "string" && v in REPORT_MESSAGE;
}

/** Valida el texto del reclamo igual que la base (5 a 500 caracteres, sin espacios a los lados). */
export function validateDisputeReason(
  text: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = (text ?? "").trim();
  if (value.length < DISPUTE_REASON_MIN)
    return { ok: false, message: REPORT_MESSAGE.reason_required };
  if (value.length > DISPUTE_REASON_MAX)
    return { ok: false, message: `Máximo ${DISPUTE_REASON_MAX} caracteres.` };
  return { ok: true, value };
}

/** Plazo en palabras: «en 5 h», «en menos de 1 h». */
export function releaseInWords(hours: number): string {
  if (hours <= 1) return "en menos de 1 h";
  return `en ${hours} h`;
}
