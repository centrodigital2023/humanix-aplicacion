// Confirmación del pago o la suscripción cuando la persona vuelve de Mercado Pago, y cancelación de la renovación
// automática (acciones de servidor).
// El servidor consulta el pago directamente en Mercado Pago y lo aplica con la misma lógica del webhook
// (`supabase/functions/_shared/mpPayment.ts`). Solo la dueña del pago puede confirmarlo. Ver `paymentReturn.ts`.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  confirmReturnedPayment,
  confirmReturnedSubscription,
  type ConfirmResult,
} from "./paymentReturn";
import {
  checkoutDecision,
  preferenceRequest,
  returnPathFor,
  type MpPreapproval,
  type SubscriptionRow,
} from "./planBilling";
import { makeRest, type MpPayment } from "../../supabase/functions/_shared/mpPayment";

const input = z.object({ paymentId: z.string().regex(/^\d{1,20}$/) });

export const confirmMercadoPagoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!token || !supabaseUrl || !serviceKey) return { ok: false, code: "not_configured" };

    return confirmReturnedPayment({
      paymentId: data.paymentId,
      userId: context.userId,
      now: Date.now,
      rest: makeRest(supabaseUrl, serviceKey),
      fetchPayment: async (id) => {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`mp_fetch_${r.status}`);
        return (await r.json()) as MpPayment;
      },
    });
  });

const MP_BASE = "https://api.mercadopago.com";

function serverConfig() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return token && supabaseUrl && serviceKey ? { token, supabaseUrl, serviceKey } : null;
}

async function mpFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T | null> {
  const r = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`mp_fetch_${r.status}`);
  return (await r.json()) as T;
}

const subInput = z.object({ preapprovalId: z.string().regex(/^[0-9a-z]{8,64}$/i) });

export const confirmMercadoPagoSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, code: "not_configured" };
    const { token } = cfg;
    const cancelPreapproval = async (id: string) => {
      await mpFetch(token, `/preapproval/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
    };

    return confirmReturnedSubscription({
      preapprovalId: data.preapprovalId,
      userId: context.userId,
      now: Date.now,
      rest: makeRest(cfg.supabaseUrl, cfg.serviceKey),
      cancelPreapproval,
      fetchPreapproval: (id) =>
        mpFetch<MpPreapproval>(token, `/preapproval/${encodeURIComponent(id)}`),
      fetchLatestPayment: async (id) => {
        const found = await mpFetch<{
          results?: Array<{ payment?: { id?: unknown } | null; date_created?: string }>;
        }>(token, `/authorized_payments/search?preapproval_id=${encodeURIComponent(id)}`);
        const latest = (found?.results ?? [])
          .filter((r) => r.payment?.id)
          .sort((a, b) =>
            String(b.date_created ?? "").localeCompare(String(a.date_created ?? "")),
          )[0];
        if (!latest?.payment?.id) return null;
        return mpFetch<MpPayment>(
          token,
          `/v1/payments/${encodeURIComponent(String(latest.payment.id))}`,
        );
      },
    });
  });

export type CancelRenewalResult = { ok: true } | { ok: false; code: "none" | "not_configured" };

/** Cancela la renovación automática: el plan sigue vigente hasta su vencimiento, solo se deja de cobrar. */
export const cancelMercadoPagoRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelRenewalResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, code: "not_configured" };
    const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
    const rows = (await (
      await rest(`mp_subscriptions?user_id=eq.${context.userId}&select=mp_preapproval_id`)
    ).json()) as Array<{ mp_preapproval_id: string | null }>;
    const id = rows[0]?.mp_preapproval_id;
    if (!id) return { ok: false, code: "none" };
    await mpFetch(cfg.token, `/preapproval/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    await rest(
      `mp_subscriptions?user_id=eq.${context.userId}&mp_preapproval_id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ mp_preapproval_id: null }),
      },
    );
    return { ok: true };
  });

export type StartPaymentResult =
  | { ok: true; url: string }
  | {
      ok: false;
      error:
        | "not_configured"
        | "unknown_plan"
        | "already_subscribed"
        | "downgrade_while_active"
        | "mp_error";
      current_plan?: string;
      ends_at?: string | null;
    };

const startInput = z.object({
  plan: z.string().max(40),
  returnTo: z.string().max(60).nullish(),
});

/**
 * Abre el pago único de UN mes de un plan (Checkout Pro: PSE, Nequi, tarjeta, efectivo). Misma regla que la Edge
 * Function `mp-create-subscription` en modo "once" (`checkoutDecision` + `preferenceRequest`), pero como acción de
 * servidor para que el pago con PSE salga con la app publicada.
 */
export const startPlanPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<StartPaymentResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, error: "not_configured" };
    const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
    const userId = context.userId;

    const [subs, roles] = await Promise.all([
      rest(
        `mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end,mp_preapproval_id`,
      ).then((r) => r.json() as Promise<SubscriptionRow[]>),
      rest(`user_roles?user_id=eq.${userId}&select=role`)
        .then((r) => r.json() as Promise<Array<{ role: string }>>)
        .catch(() => []),
    ]);
    const decision = checkoutDecision(subs[0] ?? null, data.plan, Date.now());
    if (!decision.ok) {
      return decision.error === "unknown_plan"
        ? { ok: false, error: "unknown_plan" }
        : {
            ok: false,
            error: decision.error,
            current_plan: decision.current,
            ends_at: decision.endsAt,
          };
    }

    const rawOrigin = getRequestHeader("origin") ?? "";
    const origin = /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(rawOrigin)
      ? rawOrigin
      : "https://humanix.lat";
    const claimEmail = typeof context.claims.email === "string" ? context.claims.email : "";
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claimEmail) ? claimEmail : null;

    const pref = await mpFetch<{ init_point?: string; sandbox_init_point?: string }>(
      cfg.token,
      "/checkout/preferences",
      {
        method: "POST",
        body: JSON.stringify(
          preferenceRequest({
            userId,
            plan: decision.plan,
            email,
            origin,
            returnPath: returnPathFor(
              roles.map((r) => r.role),
              data.returnTo,
            ),
            notificationUrl: `${cfg.supabaseUrl}/functions/v1/mp-webhook`,
          }),
        ),
      },
    ).catch(() => null);
    const url = pref?.init_point ?? pref?.sandbox_init_point;
    if (!url) return { ok: false, error: "mp_error" };

    // Marcar «pendiente» solo a quien no tiene un plan vigente: abrir un pago no puede quitar lo ya pagado.
    if (decision.writePending) {
      await rest("mp_subscriptions?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          user_id: userId,
          plan: decision.plan,
          amount: decision.amount,
          currency: "COP",
          status: "pending",
          mp_payer_email: email,
        }),
      }).catch(() => undefined);
    }
    return { ok: true, url };
  });
