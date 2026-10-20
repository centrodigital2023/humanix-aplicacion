// Regreso desde Mercado Pago (/pago/exito): lógica pura y probada (`paymentReturn.test.ts`).
//
// - `safeReturnPath`: a dónde se redirige después. Solo rutas internas conocidas: un `from` arbitrario permitía
//   mandar a la persona a otro sitio o ejecutar `javascript:` desde una página de Humanix.
// - `paymentIdFromSearch`: el id que Mercado Pago agrega a la URL de regreso (`payment_id` o `collection_id`).
// - `confirmReturnedPayment`: el servidor consulta el pago en Mercado Pago y lo aplica con la MISMA lógica del
//   webhook. Así el plan o los créditos se activan aunque el aviso de Mercado Pago tarde o no llegue, y la página
//   muestra lo que de verdad pasó, no lo que dice la URL.
// - `confirmReturnedSubscription`: lo mismo al volver de una suscripción (`preapproval_id` en la URL): se consulta la
//   suscripción y su último cobro, y el cobro se aplica con la metadata que le pone el servidor.
import {
  RETURN_PATHS,
  parsePreapprovalReference,
  withSubscriptionMetadata,
  type MpPreapproval,
} from "./planBilling";
import {
  isCreditsPayment,
  processMercadoPagoPayment,
  resolveUserId,
  type MpPayment,
  type RestFn,
} from "../../supabase/functions/_shared/mpPayment";

const EXTRA_RETURN_PATHS = ["/dashboard", "/creditos", "/planes"] as const;

/** Ruta interna permitida para volver; cualquier otra cosa → /dashboard. */
export function safeReturnPath(raw: unknown): string {
  let value = typeof raw === "string" ? raw : "";
  try {
    value = decodeURIComponent(value);
  } catch {
    return "/dashboard";
  }
  const allowed: readonly string[] = [...RETURN_PATHS, ...EXTRA_RETURN_PATHS];
  return allowed.includes(value) ? value : "/dashboard";
}

const PAYMENT_ID_RE = /^\d{1,20}$/;

export function paymentIdFromSearch(search: URLSearchParams): string | null {
  for (const key of ["payment_id", "collection_id"]) {
    const v = (search.get(key) ?? "").trim();
    if (PAYMENT_ID_RE.test(v)) return v;
  }
  return null;
}

const PREAPPROVAL_ID_RE = /^[0-9a-z]{8,64}$/i;

export function preapprovalIdFromSearch(search: URLSearchParams): string | null {
  const v = (search.get("preapproval_id") ?? "").trim();
  return PREAPPROVAL_ID_RE.test(v) ? v : null;
}

export type ConfirmResult =
  | { ok: true; state: "active"; plan: string; periodEnd: string | null }
  | { ok: true; state: "credited"; credits: number | null }
  | { ok: true; state: "pending" }
  | { ok: true; state: "failed" }
  | { ok: false; code: "invalid" | "not_found" | "forbidden" | "review" | "not_configured" };

export async function confirmReturnedPayment(input: {
  paymentId: unknown;
  userId: string;
  fetchPayment: (id: string) => Promise<MpPayment | null>;
  rest: RestFn;
  now: () => number;
}): Promise<ConfirmResult> {
  const id = String(input.paymentId ?? "");
  if (!PAYMENT_ID_RE.test(id)) return { ok: false, code: "invalid" };

  const payment = await input.fetchPayment(id);
  if (!payment) return { ok: false, code: "not_found" };
  // Solo la dueña del pago puede confirmarlo: el usuario lo fijó nuestro servidor al crear la preferencia.
  if (resolveUserId(payment) !== input.userId) return { ok: false, code: "forbidden" };

  return applyReturned(payment, input);
}

export async function confirmReturnedSubscription(input: {
  preapprovalId: unknown;
  userId: string;
  fetchPreapproval: (id: string) => Promise<MpPreapproval | null>;
  /** Último cobro de la suscripción ya consultado en Mercado Pago, o `null` si aún no hay. */
  fetchLatestPayment: (preapprovalId: string) => Promise<MpPayment | null>;
  cancelPreapproval?: (id: string) => Promise<void>;
  rest: RestFn;
  now: () => number;
}): Promise<ConfirmResult> {
  const id = String(input.preapprovalId ?? "");
  if (!PREAPPROVAL_ID_RE.test(id)) return { ok: false, code: "invalid" };

  const pre = await input.fetchPreapproval(id);
  if (!pre) return { ok: false, code: "not_found" };
  // Solo la dueña de la suscripción puede confirmarla: la fijó nuestro servidor en `external_reference`.
  if (parsePreapprovalReference(pre.external_reference)?.userId !== input.userId) {
    return { ok: false, code: "forbidden" };
  }
  if (pre.status === "cancelled") return { ok: true, state: "failed" };

  const payment = await input.fetchLatestPayment(id);
  if (!payment) return { ok: true, state: "pending" }; // Mercado Pago aún no intenta el primer cobro.
  const enriched = withSubscriptionMetadata(payment, pre);
  if (!enriched) return { ok: false, code: "review" };
  return applyReturned(enriched, input);
}

async function applyReturned(
  payment: MpPayment,
  input: {
    userId: string;
    rest: RestFn;
    now: () => number;
    cancelPreapproval?: (id: string) => Promise<void>;
  },
): Promise<ConfirmResult> {
  const outcome = await processMercadoPagoPayment(payment, {
    rest: input.rest,
    now: input.now,
    source: "return",
    cancelPreapproval: input.cancelPreapproval,
  });

  switch (outcome.result) {
    case "activated":
      return { ok: true, state: "active", plan: outcome.plan, periodEnd: outcome.periodEnd };
    case "credited":
      return { ok: true, state: "credited", credits: outcome.credits };
    case "pending":
      return { ok: true, state: "pending" };
    case "failed":
    case "reversed":
      return { ok: true, state: "failed" };
    case "rejected":
      return { ok: false, code: "review" };
    case "already_applied": {
      // Ya lo aplicó el webhook (o una visita anterior): se muestra el estado real.
      if (isCreditsPayment(payment)) {
        const credits = Number(payment.metadata?.credits);
        return {
          ok: true,
          state: "credited",
          credits: Number.isInteger(credits) && credits > 0 ? credits : null,
        };
      }
      const rows = (await (
        await input.rest(
          `mp_subscriptions?user_id=eq.${input.userId}&select=plan,status,current_period_end`,
        )
      ).json()) as Array<{ plan: string; status: string; current_period_end: string | null }>;
      const row = rows[0];
      if (row && (row.status === "active" || row.status === "approved")) {
        return { ok: true, state: "active", plan: row.plan, periodEnd: row.current_period_end };
      }
      return { ok: true, state: "pending" };
    }
  }
}
