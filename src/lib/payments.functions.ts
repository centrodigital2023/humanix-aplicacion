// Pagos de planes con Mercado Pago (acciones de servidor): pagar dentro de Humanix (/pagar), confirmar el pago o la
// suscripción cuando la persona vuelve del banco o de Mercado Pago, y cancelar la renovación automática.
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
  PLAN_PRICE_COP,
  PLAN_TITLE,
  PLAN_TITLE_ONCE,
  brickPaymentRequest,
  brickPaymentView,
  cardSubscriptionRequest,
  checkoutDecision,
  findSubscriptionPlan,
  isCardToken,
  isEmail,
  preferenceRequest,
  returnPathFor,
  subscriptionPlanRequest,
  type BrickPaymentView,
  type MpPreapproval,
  type MpSubscriptionPlan,
  type PaidPlan,
  type SubscriptionRow,
} from "./planBilling";
import { clientIp } from "./clientIp";
import {
  makeRest,
  processMercadoPagoPayment,
  type MpPayment,
  type RestFn,
} from "../../supabase/functions/_shared/mpPayment";

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

/** Avisos de Mercado Pago: ruta de servidor de la propia app (`src/routes/api/mercadopago/webhook.ts`). */
export const MP_WEBHOOK_URL = "https://humanix.lat/api/mercadopago/webhook";

/**
 * Public Key de producción de Mercado Pago. Es pública por diseño (solo dibuja los formularios y convierte la tarjeta
 * en un token); si se configura `MERCADOPAGO_PUBLIC_KEY`, manda esa.
 */
const MP_PUBLIC_KEY_DEFAULT = "APP_USR-cab576f2-9677-4e92-aaf0-01aeb8b017b6";

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
 * Respaldo de /pagar: abre el pago único de UN mes en la página de Mercado Pago (Checkout Pro: PSE, Nequi, tarjeta,
 * efectivo) cuando los formularios de Mercado Pago no cargan dentro de Humanix. Misma regla de cobro
 * (`checkoutDecision` + `preferenceRequest`).
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
            notificationUrl: MP_WEBHOOK_URL,
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

// ─── Pago dentro de Humanix (/pagar) ──────────────────────────────────────────

type PlanCheck =
  | {
      ok: true;
      plan: PaidPlan;
      amount: number;
      writePending: boolean;
      current: SubscriptionRow | null;
    }
  | {
      ok: false;
      error: "unknown_plan" | "already_subscribed" | "downgrade_while_active";
      current_plan?: string;
      ends_at?: string | null;
    };

async function checkPlan(rest: RestFn, userId: string, plan: unknown): Promise<PlanCheck> {
  const subs = (await (
    await rest(
      `mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end,mp_preapproval_id`,
    )
  ).json()) as SubscriptionRow[];
  const decision = checkoutDecision(subs[0] ?? null, plan, Date.now());
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
  return {
    ok: true,
    plan: decision.plan,
    amount: decision.amount,
    writePending: decision.writePending,
    current: subs[0] ?? null,
  };
}

function siteOrigin(): string {
  const raw = getRequestHeader("origin") ?? "";
  return /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(raw) ? raw : "https://humanix.lat";
}

function accountEmail(claims: Record<string, unknown>): string | null {
  return isEmail(claims.email) ? claims.email : null;
}

async function markPending(rest: RestFn, userId: string, plan: PaidPlan, email: string | null) {
  await rest("mp_subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      plan,
      amount: PLAN_PRICE_COP[plan],
      currency: "COP",
      status: "pending",
      mp_payer_email: email,
    }),
  }).catch(() => undefined);
}

export type PaySetupResult =
  | {
      ok: true;
      publicKey: string;
      plan: PaidPlan;
      amount: number;
      title: string;
      titleRecurring: string;
      email: string | null;
      /** Ya tiene este plan vigente: pagar suma un mes desde el vencimiento. */
      renew: boolean;
    }
  | {
      ok: false;
      error: "not_configured" | "unknown_plan" | "already_subscribed" | "downgrade_while_active";
      current_plan?: string;
      ends_at?: string | null;
    };

const setupInput = z.object({ plan: z.string().max(40) });

/** Lo que /pagar necesita para dibujar los formularios: precio del servidor, Public Key y si el plan se puede pagar. */
export const getPlanPaymentSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => setupInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<PaySetupResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, error: "not_configured" };
    const check = await checkPlan(
      makeRest(cfg.supabaseUrl, cfg.serviceKey),
      context.userId,
      data.plan,
    );
    if (!check.ok) return check;
    return {
      ok: true,
      publicKey: process.env.MERCADOPAGO_PUBLIC_KEY || MP_PUBLIC_KEY_DEFAULT,
      plan: check.plan,
      amount: check.amount,
      title: PLAN_TITLE_ONCE[check.plan],
      titleRecurring: PLAN_TITLE[check.plan],
      email: accountEmail(context.claims),
      renew: !check.writePending && check.current?.plan === check.plan,
    };
  });

export type InAppPayResult =
  | ({ ok: true } & BrickPaymentView & { state: "active" | "pending" | "failed" })
  | {
      ok: false;
      error:
        | "not_configured"
        | "unknown_plan"
        | "already_subscribed"
        | "downgrade_while_active"
        | "invalid_form"
        | "mp_error";
      message?: string;
    };

const payInput = z.object({
  plan: z.string().max(40),
  returnTo: z.string().max(60).nullish(),
  attemptId: z.string().uuid(),
  form: z.record(z.string(), z.unknown()),
});

/**
 * Paga UN mes desde el Payment Brick: tarjeta (se aprueba al instante), PSE (Bancolombia, Nequi y los demás bancos:
 * devuelve la página del banco) o efectivo (devuelve el código). El pago se registra y, si ya está aprobado, se aplica
 * con la misma lógica del webhook (`processMercadoPagoPayment`).
 */
export const payPlanInApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => payInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<InAppPayResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, error: "not_configured" };
    const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
    const userId = context.userId;
    const check = await checkPlan(rest, userId, data.plan);
    if (!check.ok) return { ok: false, error: check.error };

    const roles = await rest(`user_roles?user_id=eq.${userId}&select=role`)
      .then((r) => r.json() as Promise<Array<{ role: string }>>)
      .catch(() => []);
    const from = encodeURIComponent(
      returnPathFor(
        roles.map((r) => r.role),
        data.returnTo,
      ),
    );
    const email = accountEmail(context.claims);
    const built = brickPaymentRequest({
      form: data.form,
      userId,
      plan: check.plan,
      accountEmail: email,
      ip: clientIp((name) => getRequestHeader(name)),
      callbackUrl: `${siteOrigin()}/pago/exito?tipo=plan&plan=${check.plan}&from=${from}`,
      notificationUrl: MP_WEBHOOK_URL,
    });
    if (!built.ok) return { ok: false, error: built.error };

    const r = await fetch(`${MP_BASE}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        // El mismo intento nunca cobra dos veces (doble clic, reintento de red).
        "X-Idempotency-Key": data.attemptId,
      },
      body: JSON.stringify(built.body),
    }).catch(() => null);
    const payment = (await r?.json().catch(() => null)) as
      | (MpPayment & { message?: string })
      | null;
    if (!r || !r.ok || !payment?.id) {
      console.error("payPlanInApp: mp", r?.status ?? "network", payment?.message ?? "");
      return { ok: false, error: "mp_error", message: payment?.message };
    }

    if (check.writePending && payment.status !== "approved") {
      await markPending(rest, userId, check.plan, email);
    }
    // Registrar y, si ya está aprobado, activar el plan (idempotente con el aviso del webhook).
    const outcome = await processMercadoPagoPayment(payment, {
      rest,
      now: Date.now,
      source: "return",
    }).catch((e) => {
      console.error("payPlanInApp: apply", e instanceof Error ? e.message : e);
      return null;
    });
    const state =
      outcome?.result === "activated" || outcome?.result === "already_applied"
        ? "active"
        : payment.status === "rejected" || payment.status === "cancelled"
          ? "failed"
          : "pending";
    return { ok: true, state, ...brickPaymentView(payment, built.method) };
  });

async function subscriptionPlanId(token: string, plan: PaidPlan): Promise<string> {
  const found = await mpFetch<{ results?: MpSubscriptionPlan[] }>(
    token,
    `/preapproval_plan/search?status=active&limit=100&q=${encodeURIComponent(PLAN_TITLE[plan])}`,
  ).catch(() => null);
  const existing = findSubscriptionPlan(found?.results, plan);
  if (existing) return existing;
  const created = await mpFetch<{ id?: string }>(token, "/preapproval_plan", {
    method: "POST",
    body: JSON.stringify(subscriptionPlanRequest(plan, "https://humanix.lat/pago/exito")),
  });
  if (!created?.id) throw new Error("mp_plan_missing");
  return created.id;
}

export type InAppSubscribeResult =
  | { ok: true; preapprovalId: string; status: string }
  | {
      ok: false;
      error:
        | "not_configured"
        | "unknown_plan"
        | "already_subscribed"
        | "downgrade_while_active"
        | "invalid_form"
        | "mp_error";
      message?: string;
    };

const subscribeInput = z.object({
  plan: z.string().max(40),
  cardToken: z.string().max(128),
  email: z.string().max(254).nullish(),
});

/**
 * Cobro automático mensual con tarjeta, dentro de Humanix: suscripción con plan asociado (un `preapproval_plan` por
 * plan de Humanix, creado la primera vez) y el token de la tarjeta del Card Payment Brick. Nace autorizada; el primer
 * cobro llega por el webhook o al confirmar en /pago/exito.
 */
export const subscribePlanInApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => subscribeInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<InAppSubscribeResult> => {
    const cfg = serverConfig();
    if (!cfg) return { ok: false, error: "not_configured" };
    if (!isCardToken(data.cardToken)) return { ok: false, error: "invalid_form" };
    const rest = makeRest(cfg.supabaseUrl, cfg.serviceKey);
    const userId = context.userId;
    const check = await checkPlan(rest, userId, data.plan);
    if (!check.ok) return { ok: false, error: check.error };
    const email = isEmail(data.email) ? data.email : accountEmail(context.claims);
    if (!email) return { ok: false, error: "invalid_form" };

    let planId: string;
    try {
      planId = await subscriptionPlanId(cfg.token, check.plan);
    } catch (e) {
      console.error("subscribePlanInApp: plan", e instanceof Error ? e.message : e);
      return { ok: false, error: "mp_error" };
    }
    const r = await fetch(`${MP_BASE}/preapproval`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(
        cardSubscriptionRequest({
          subscriptionPlanId: planId,
          userId,
          plan: check.plan,
          email,
          cardTokenId: data.cardToken,
          backUrl: `${siteOrigin()}/pago/exito`,
        }),
      ),
    }).catch(() => null);
    const pre = (await r?.json().catch(() => null)) as {
      id?: string;
      status?: string;
      message?: string;
    } | null;
    if (!r || !r.ok || !pre?.id) {
      console.error("subscribePlanInApp: mp", r?.status ?? "network", pre?.message ?? "");
      return { ok: false, error: "mp_error", message: pre?.message };
    }
    if (check.writePending) await markPending(rest, userId, check.plan, email);
    return { ok: true, preapprovalId: pre.id, status: String(pre.status ?? "") };
  });
