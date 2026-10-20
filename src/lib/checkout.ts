// Pagar un plan (Mercado Pago, dentro de Humanix en /pagar) con mensajes claros y amables. Dos formas: «once», un mes
// con tarjeta, PSE (Bancolombia, Nequi y demás bancos) o efectivo (por defecto), y «recurring», cobro automático
// mensual con tarjeta.
//
// Un solo camino para /planes, la tarjeta de plan de los paneles y la franja de planes: llevan a `payPageHref`. El
// servidor decide qué se puede pagar (ver `planBilling.checkoutDecision`); aquí solo se traduce su respuesta.
import { PLAN_CATALOG, longDateEs, type PlanKey } from "./plans";

export interface CheckoutErrorPayload {
  error?: string;
  current_plan?: string;
  ends_at?: string | null;
}

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
  if (payload?.error === "invalid_form") {
    return "Revisa los datos del formulario: falta algo para completar el pago.";
  }
  if (payload?.error === "not_configured") {
    return "Los pagos se están configurando. Inténtalo de nuevo en unos minutos.";
  }
  if (payload?.error === "unknown_plan")
    return "Ese plan no está disponible. Elige uno de la lista.";
  return "Casi lo tenemos: no pudimos completar el pago. Inténtalo de nuevo en un momento.";
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

/** Forma de pago elegida: un mes (tarjeta, PSE o efectivo) o cobro automático mensual con tarjeta. */
export type PayMode = "once" | "recurring";

/** Valor de `modo` en la URL de /pagar. */
export function payModeOf(v: unknown): PayMode {
  return v === "recurrente" || v === "recurring" ? "recurring" : "once";
}

/**
 * Página donde se paga un plan, dentro de Humanix. `returnTo` es el panel al que vuelve quien paga (el servidor lo
 * vuelve a validar contra su rol).
 */
export function payPageHref(
  plan: PlanKey,
  opts: { mode?: PayMode; returnTo?: string | null } = {},
): string {
  const q = new URLSearchParams({ plan });
  if (opts.mode === "recurring") q.set("modo", "recurrente");
  if (opts.returnTo) q.set("from", opts.returnTo);
  return `/pagar?${q.toString()}`;
}

/** Mensaje de la acción «later» (plan menor con uno vigente) para quien toca una tarjeta deshabilitada. */
export const LATER_MESSAGE =
  "Tu plan actual sigue vigente. Cuando termine podrás elegir otro; así no pierdes los días que ya pagaste.";
