// Regreso desde Mercado Pago (/pago/exito): lógica pura y probada (`paymentReturn.test.ts`).
//
// - `safeReturnPath`: a dónde se redirige después. Solo rutas internas conocidas: un `from` arbitrario permitía
//   mandar a la persona a otro sitio o ejecutar `javascript:` desde una página de Humanix.
// - `paymentIdFromSearch`: el id que Mercado Pago agrega a la URL de regreso (`payment_id` o `collection_id`).
// - `confirmReturnedPayment`: el servidor consulta el pago en Mercado Pago y lo aplica con la MISMA lógica del
//   webhook. Así el plan o los créditos se activan aunque el aviso de Mercado Pago tarde o no llegue, y la página
//   muestra lo que de verdad pasó, no lo que dice la URL.
import { RETURN_PATHS } from "./planBilling";
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

  const outcome = await processMercadoPagoPayment(payment, {
    rest: input.rest,
    now: input.now,
    source: "return",
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
