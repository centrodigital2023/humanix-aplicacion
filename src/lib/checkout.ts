// Abrir el pago de un plan (Mercado Pago, solo en la web) con mensajes claros y amables. Dos formas: «once», un mes
// con PSE, Nequi, tarjeta o efectivo (por defecto), y «recurring», suscripción con cobro automático con tarjeta.
//
// Un solo camino para /planes, la tarjeta de plan de los paneles y la franja de planes: llama a
// `mp-create-subscription`, devuelve la URL del pago o un mensaje para la persona. El servidor decide qué se puede
// pagar (ver `planBilling.checkoutDecision`); aquí solo se traduce su respuesta.
import { PLAN_CATALOG, longDateEs, type PlanKey } from "./plans";

export interface CheckoutErrorPayload {
  error?: string;
  current_plan?: string;
  ends_at?: string | null;
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; message: string };

type Invoke = (
  name: string,
  opts: { body: Record<string, unknown> },
) => Promise<{ data: unknown; error: unknown }>;

/** Mensaje para la persona según lo que respondió el servidor. Nunca muestra detalles técnicos. */
export function checkoutErrorMessage(
  payload: CheckoutErrorPayload | null,
  requested: PlanKey,
): string {
  if (payload?.error === "downgrade_while_active") {
    const current =
      payload.current_plan && payload.current_plan in PLAN_CATALOG
        ? PLAN_CATALOG[payload.current_plan as PlanKey].label
        : "actual";
    const end = payload.ends_at ? Date.parse(payload.ends_at) : NaN;
    const when = Number.isFinite(end) ? ` hasta el ${longDateEs(end)}` : "";
    return `Tu plan ${current} sigue vigente${when}. Podrás pasar a ${PLAN_CATALOG[requested].label} cuando termine: así no pierdes lo que ya pagaste.`;
  }
  if (payload?.error === "already_subscribed") {
    return "Tu plan ya se renueva solo cada mes: no hace falta pagarlo de nuevo.";
  }
  if (payload?.error === "missing_email") {
    return "Se necesita el correo de tu cuenta para la suscripción. Revisa tu perfil e inténtalo de nuevo.";
  }
  if (payload?.error === "unknown_plan")
    return "Ese plan no está disponible. Elige uno de la lista.";
  return "Casi lo tenemos: no pudimos abrir el pago. Inténtalo de nuevo en un momento.";
}

/** Cuerpo JSON de un error de Edge Function (`FunctionsHttpError.context` es la respuesta), si lo hay. */
export async function readErrorPayload(err: unknown): Promise<CheckoutErrorPayload | null> {
  const ctx = (err as { context?: unknown } | null)?.context;
  if (!ctx || typeof (ctx as Response).json !== "function") return null;
  try {
    const body = await (ctx as Response).clone().json();
    return body && typeof body === "object" ? (body as CheckoutErrorPayload) : null;
  } catch {
    return null;
  }
}

/** Respuesta de la acción de servidor `startPlanPayment` (pago único de un mes). */
export type StartOnceResult =
  | { ok: true; url: string }
  | ({ ok: false; error: string } & CheckoutErrorPayload);
export type StartOnce = (input: {
  plan: PlanKey;
  returnTo: string | null;
}) => Promise<StartOnceResult>;

export async function startCheckout(
  invoke: Invoke,
  input: {
    plan: PlanKey;
    email?: string | null;
    returnTo?: string | null;
    mode?: "once" | "recurring";
    /** Pago único por la acción de servidor (PSE). Si no está configurada, se usa la Edge Function. */
    startOnce?: StartOnce;
  },
): Promise<CheckoutResult> {
  void invoke;
  void input;
  return { ok: false, message: "Los pagos en línea no están disponibles." };
}

/** Mensaje de la acción «later» (plan menor con uno vigente) para quien toca una tarjeta deshabilitada. */
export const LATER_MESSAGE =
  "Tu plan actual sigue vigente. Cuando termine podrás elegir otro; así no pierdes los días que ya pagaste.";
