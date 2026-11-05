// «Acciones del servicio»: qué botones ve cada parte en /servicio/$bookingId según el estado y cómo se pagó.
// Lo comparten la familia, la EPS/IPS (ambas son «client») y el profesional. El círculo de cuidado no ve acciones.
// Lógica pura y testeable. Quién puede hacer qué lo vuelve a validar la base de datos; aquí solo se decide la pantalla.
import { COP } from "@/lib/commissionMatrix";

export type ActionSide = "client" | "professional" | "viewer";

export type ServiceActionId =
  | "confirm_finish" // la familia/EPS confirma que el turno terminó (libera el pago retenido)
  | "report" // reportar un problema (radicado PQRS ligado al turno; el pago retenido sigue retenido)
  | "reschedule" // proponer otra fecha y hora
  | "contact" // ir al chat del servicio
  | "cancel"; // cancelar (o «Rechazar» cuando el profesional aún no acepta)

export type ActionBooking = {
  status: string;
  payment_method?: string | null;
  paid_at?: string | null;
  total_amount: number;
  platform_fee_amount?: number | null;
  /** Pago retenido (migración 20261104180000): held · released · disputed · refunding · refunded. */
  escrow_status?: string | null;
};

/** Estados en los que cada parte puede cancelar. Una vez «Cuidando», lo que procede es reportar un problema. */
const CANCELLABLE = new Set(["pending", "confirmed", "in_route"]);
/** Reprogramar solo antes de que el profesional salga. Igual que hx_request_reschedule. */
const RESCHEDULABLE = new Set(["pending", "confirmed"]);
/** Se puede reportar desde que hay un acuerdo hasta que el turno termina. */
const REPORTABLE = new Set(["confirmed", "in_route", "in_progress"]);
const CONTACTABLE = new Set(["confirmed", "in_route", "in_progress", "completed"]);

export function isCashBooking(b: Pick<ActionBooking, "payment_method">): boolean {
  return b.payment_method === "CASH";
}

/** Bre-B ya cobrado (el dinero está en Humanix, retenido hasta terminar). */
export function isBrebPaid(b: Pick<ActionBooking, "payment_method" | "paid_at">): boolean {
  return !isCashBooking(b) && !!b.paid_at;
}

export function canCancel(side: ActionSide, b: ActionBooking): boolean {
  return side !== "viewer" && CANCELLABLE.has(b.status);
}

export function canReschedule(side: ActionSide, b: ActionBooking): boolean {
  return side !== "viewer" && RESCHEDULABLE.has(b.status);
}

/** Reportar un problema mientras el turno está abierto (igual que hx_report_service_issue). Ya terminado, el reclamo del
 * pago retenido vive en la tarjeta de pago (EscrowDecision). */
export function canReport(side: ActionSide, b: ActionBooking): boolean {
  return side !== "viewer" && REPORTABLE.has(b.status);
}

/** La familia/EPS confirma que el turno terminó (si pagó por Bre-B, eso libera el pago retenido). */
export function canConfirmFinish(side: ActionSide, b: ActionBooking): boolean {
  return side === "client" && b.status === "in_progress";
}

export function canContact(side: ActionSide, b: ActionBooking): boolean {
  return side !== "viewer" && CONTACTABLE.has(b.status);
}

/** Acciones visibles, en el orden en que se muestran. */
export function serviceActions(side: ActionSide, b: ActionBooking): ServiceActionId[] {
  const out: ServiceActionId[] = [];
  if (canConfirmFinish(side, b)) out.push("confirm_finish");
  if (canContact(side, b)) out.push("contact");
  if (canReschedule(side, b)) out.push("reschedule");
  if (canReport(side, b)) out.push("report");
  if (canCancel(side, b)) out.push("cancel");
  return out;
}

export function cancelLabel(side: ActionSide, status: string): string {
  return side === "professional" && status === "pending" ? "Rechazar" : "Cancelar";
}

/**
 * Qué pasa con el dinero si se cancela, en palabras claras, para mostrar antes de confirmar.
 *  - Bre-B pagado y retenido: se devuelve completo a quien pagó (lo hace el servidor al cancelar).
 *  - Bre-B sin pagar: no se cobra nada y el cobro pendiente se anula.
 *  - Efectivo: nadie paga nada; al profesional se le libera la comisión que tenía apartada en su billetera.
 */
export function cancelMoneyNote(side: Exclude<ActionSide, "viewer">, b: ActionBooking): string {
  const total = Number(b.total_amount ?? 0);
  if (isCashBooking(b)) {
    const fee = Number(b.platform_fee_amount ?? 0);
    if (side === "professional") {
      return b.status === "pending" || fee <= 0
        ? "Era en efectivo: no se cobra nada."
        : `Era en efectivo: liberamos los ${COP(fee)} de comisión apartados en tu billetera.`;
    }
    return "Era en efectivo: no pagas nada.";
  }
  if (isBrebPaid(b)) {
    // Ya liberado: el dinero salió al profesional, así que no hay devolución automática.
    if (b.escrow_status === "released") {
      return side === "client"
        ? `Tu pago de ${COP(total)} ya se le entregó al profesional: el equipo de Humanix te contacta para devolvértelo.`
        : `El pago de ${COP(total)} ya te llegó: el equipo de Humanix te contacta para devolvérselo a quien te contrató.`;
    }
    return side === "client"
      ? `Te devolvemos los ${COP(total)} que pagaste. Llegan a tu llave Bre-B.`
      : `Le devolvemos a quien te contrató los ${COP(total)} que pagó con Bre-B.`;
  }
  return side === "client"
    ? "Aún no habías pagado: no se cobra nada."
    : "Aún no lo habían pagado: no se cobra nada.";
}

// ── Reportar un problema (hx_report_service_issue) ───────────────────────────

export type IssueKind = "no_show" | "late" | "safety" | "care_quality" | "payment" | "other";

export const ISSUE_KINDS: Record<
  "client" | "professional",
  readonly { id: IssueKind; label: string }[]
> = {
  client: [
    { id: "no_show", label: "El profesional no llegó" },
    { id: "late", label: "Llegó o va muy tarde" },
    { id: "care_quality", label: "Algo no estuvo bien en el cuidado" },
    { id: "safety", label: "Me siento inseguro o hubo maltrato" },
    { id: "payment", label: "Problema con el pago" },
    { id: "other", label: "Otro problema" },
  ],
  professional: [
    { id: "no_show", label: "No me recibieron en el domicilio" },
    { id: "late", label: "Voy a llegar muy tarde" },
    { id: "safety", label: "Me siento inseguro o hubo maltrato" },
    { id: "payment", label: "Problema con el pago" },
    { id: "other", label: "Otro problema" },
  ],
};

export const ISSUE_DETAIL_MIN = 5;
export const ISSUE_DETAIL_MAX = 500;

export type IssueResult =
  | "reported"
  | "already_reported"
  | "forbidden"
  | "not_reportable"
  | "detail_required"
  | "invalid_kind";

export const ISSUE_RESULT_MESSAGE: Record<IssueResult, string> = {
  reported: "Recibimos tu reporte. El equipo de Humanix lo revisa y te escribe pronto.",
  already_reported: "Ya tenemos tu reporte y lo estamos revisando.",
  forbidden: "Solo las partes del servicio pueden reportar un problema.",
  not_reportable: "Este turno ya no admite reportes desde aquí. Escríbenos por PQRS.",
  detail_required: "Cuéntanos en pocas palabras qué pasó.",
  invalid_kind: "Elige qué pasó.",
};

export function validateIssue(
  kind: string,
  detail: string,
): { ok: true; kind: IssueKind; detail: string } | { ok: false; message: string } {
  const all = new Set<string>(
    [...ISSUE_KINDS.client, ...ISSUE_KINDS.professional].map((k) => k.id),
  );
  if (!all.has(kind)) return { ok: false, message: ISSUE_RESULT_MESSAGE.invalid_kind };
  const value = (detail ?? "").trim();
  if (value.length < ISSUE_DETAIL_MIN)
    return { ok: false, message: ISSUE_RESULT_MESSAGE.detail_required };
  if (value.length > ISSUE_DETAIL_MAX)
    return { ok: false, message: `Máximo ${ISSUE_DETAIL_MAX} caracteres.` };
  return { ok: true, kind: kind as IssueKind, detail: value };
}
