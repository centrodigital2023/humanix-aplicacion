// Avisos (webhooks) de Mercado Pago, atendidos por la propia app en `/api/mercadopago/webhook`
// (`src/routes/api/mercadopago/webhook.ts`): sale con Publicar, sin Edge Functions.
//
// Avisos que se atienden (configurarlos en el panel de Mercado Pago → Webhooks):
//  - `payment`: pagos de un mes (tarjeta, PSE, efectivo) y, si traen su suscripción, cobros mensuales.
//  - `subscription_authorized_payment`: cada cobro mensual de una suscripción.
//  - `subscription_preapproval`: la suscripción se autoriza, pausa o cancela.
//
// Nunca se confía en el cuerpo del aviso: se verifica la firma `x-signature` y el pago o la suscripción se consulta en
// Mercado Pago. La activación es la misma de siempre (`processMercadoPagoPayment`), idempotente. Probado en
// `mpWebhook.test.ts`.
import {
  PREAPPROVAL_TOPIC,
  SUBSCRIPTION_PAYMENT_TOPIC,
  isPaymentTopic,
  paidPlanOf,
  parsePreapprovalReference,
  preapprovalIdOfPayment,
  subscriptionAfterPreapprovalStatus,
  withSubscriptionMetadata,
  type MpPreapproval,
  type SubscriptionRow,
} from "./planBilling";
import {
  isCreditsPayment,
  makeRest,
  processMercadoPagoPayment,
  type MpPayment,
  type RestFn,
} from "../../supabase/functions/_shared/mpPayment";

const MP_BASE = "https://api.mercadopago.com";

export interface WebhookEnv {
  token?: string;
  secret?: string;
  supabaseUrl?: string;
  serviceKey?: string;
}

class MpFetchError extends Error {
  constructor(readonly status: number) {
    super(`mp_fetch_${status}`);
  }
}

/**
 * Firma de Mercado Pago. Encabezado `x-signature: ts=…,v1=…`; se firma
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con HMAC-SHA256 y la clave secreta del webhook.
 */
export async function verifyMpSignature(
  headers: Headers,
  dataId: string | null,
  secret: string,
): Promise<boolean> {
  const sigHeader = headers.get("x-signature");
  const requestId = headers.get("x-request-id");
  if (!sigHeader || !requestId || !dataId) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=");
      return [k, rest.join("=")];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  // Mercado Pago pide el id en minúsculas cuando es alfanumérico.
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

const text = (body: string, status: number) => new Response(body, { status });

async function logRun(
  rest: RestFn | null,
  startedAt: number,
  status: "success" | "error" | "rejected" | "duplicate",
  executionId: string | undefined,
  extra: { errorCode?: string; metadata?: Record<string, unknown> } = {},
) {
  if (!rest) return;
  await rest("function_execution_logs", {
    method: "POST",
    body: JSON.stringify({
      function_name: "mp-webhook",
      trigger_type: "webhook",
      status,
      execution_id: executionId ?? null,
      duration_ms: Date.now() - startedAt,
      error_code: extra.errorCode ?? null,
      metadata: extra.metadata ?? {},
    }),
  }).catch(() => undefined);
}

export async function handleMercadoPagoWebhook(req: Request, env: WebhookEnv): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(req.url);
  let topic = url.searchParams.get("type") ?? url.searchParams.get("topic");
  let dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const body = (await req.json().catch(() => ({}))) as {
    type?: unknown;
    data?: { id?: unknown };
    resource?: unknown;
  };
  dataId = dataId ?? (body?.data?.id != null ? String(body.data.id) : null);
  topic = topic ?? (typeof body?.type === "string" ? body.type : null);

  // Solo pagos y suscripciones: un `merchant_order` trae el id de una orden, no de un pago.
  const known =
    isPaymentTopic(topic) || topic === SUBSCRIPTION_PAYMENT_TOPIC || topic === PREAPPROVAL_TOPIC;
  if (!dataId || !known) return text("ok", 200);
  const executionId = String(dataId);

  const rest = env.supabaseUrl && env.serviceKey ? makeRest(env.supabaseUrl, env.serviceKey) : null;
  if (!env.token || !env.secret || !rest) {
    const missing = !env.token
      ? "missing_access_token"
      : !env.secret
        ? "missing_webhook_secret"
        : "missing_supabase";
    console.error(`mp-webhook: ${missing}`);
    await logRun(rest, startedAt, "error", executionId, { errorCode: missing });
    // 500: Mercado Pago reintenta cuando las claves estén puestas.
    return text("config", 500);
  }
  if (!(await verifyMpSignature(req.headers, executionId, env.secret))) {
    console.warn("mp-webhook: firma inválida");
    await logRun(rest, startedAt, "rejected", executionId, { errorCode: "invalid_signature" });
    return text("invalid signature", 401);
  }

  const token = env.token;
  const mpGet = async <T>(path: string): Promise<T | null> => {
    const r = await fetch(`${MP_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new MpFetchError(r.status);
    return (await r.json()) as T;
  };
  const cancelPreapproval = async (id: string) => {
    const r = await fetch(`${MP_BASE}/preapproval/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (!r.ok) throw new Error(`mp_cancel_${r.status}`);
  };

  try {
    // ── Cambio de estado de una suscripción ──────────────────────────────────
    if (topic === PREAPPROVAL_TOPIC) {
      const pre = await mpGet<MpPreapproval>(`/preapproval/${encodeURIComponent(executionId)}`);
      const ref = parsePreapprovalReference(pre?.external_reference);
      if (!pre || !ref || typeof pre.id !== "string") {
        await logRun(rest, startedAt, "rejected", executionId, {
          errorCode: "unknown_preapproval",
        });
        return text("ok", 200);
      }
      const status = String(pre.status ?? "");
      const rows = (await (
        await rest(
          `mp_subscriptions?user_id=eq.${ref.userId}&select=plan,status,current_period_end,mp_preapproval_id`,
        )
      ).json()) as SubscriptionRow[];
      const patch = subscriptionAfterPreapprovalStatus(
        rows[0] ?? null,
        { id: pre.id, status, plan: ref.plan },
        Date.now(),
      );
      if (patch && rows[0]) {
        await rest(`mp_subscriptions?user_id=eq.${ref.userId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        if (patch.mp_preapproval_id === null) {
          await rest("notifications", {
            method: "POST",
            body: JSON.stringify({
              user_id: ref.userId,
              type: "subscription_cancelled",
              title: "Tu plan ya no se renovará solo",
              body: "Conservas tus beneficios hasta el vencimiento. Puedes volver a suscribirte desde /planes.",
              link: "/planes",
            }),
          }).catch(() => undefined);
        }
      }
      await logRun(rest, startedAt, "success", executionId, {
        metadata: { topic, status, changed: Boolean(patch) },
      });
      return text("ok", 200);
    }

    // ── Un pago (de un mes o cobro de una suscripción) ───────────────────────
    let payment: MpPayment | null = null;
    let preapprovalId: string | null = null;
    if (topic === SUBSCRIPTION_PAYMENT_TOPIC) {
      const ap = await mpGet<{ preapproval_id?: unknown; payment?: { id?: unknown } | null }>(
        `/authorized_payments/${encodeURIComponent(executionId)}`,
      );
      const payId = ap?.payment?.id;
      preapprovalId = typeof ap?.preapproval_id === "string" ? ap.preapproval_id : null;
      if (!payId || !preapprovalId) {
        // Cobro programado que aún no se intenta: llegará otro aviso cuando haya pago.
        await logRun(rest, startedAt, "success", executionId, {
          metadata: { topic, result: "scheduled" },
        });
        return text("ok", 200);
      }
      payment = await mpGet<MpPayment>(`/v1/payments/${encodeURIComponent(String(payId))}`);
    } else {
      payment = await mpGet<MpPayment>(`/v1/payments/${encodeURIComponent(executionId)}`);
      if (payment && !isCreditsPayment(payment) && !paidPlanOf(payment)) {
        preapprovalId = preapprovalIdOfPayment(payment);
        if (!preapprovalId) {
          // Sin plan ni suscripción: lo aplica el aviso `subscription_authorized_payment` si es un cobro mensual.
          await logRun(rest, startedAt, "success", executionId, {
            metadata: { topic, result: "deferred" },
          });
          return text("ok", 200);
        }
      }
    }
    if (!payment) {
      await logRun(rest, startedAt, "error", executionId, { errorCode: "mp_fetch_404" });
      return text("retry", 502);
    }
    if (preapprovalId) {
      const pre = await mpGet<MpPreapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`);
      const enriched = pre ? withSubscriptionMetadata(payment, pre) : null;
      if (!enriched) {
        await logRun(rest, startedAt, "rejected", executionId, {
          errorCode: "unknown_preapproval",
        });
        return text("ok", 200);
      }
      payment = enriched;
    }

    const outcome = await processMercadoPagoPayment(payment, {
      rest,
      now: Date.now,
      source: "webhook",
      topic,
      cancelPreapproval,
    });
    await logRun(
      rest,
      startedAt,
      outcome.result === "rejected"
        ? "rejected"
        : outcome.result === "already_applied"
          ? "duplicate"
          : "success",
      executionId,
      {
        errorCode: outcome.result === "rejected" ? outcome.error : undefined,
        metadata: { status: String(payment.status ?? ""), result: outcome.result, topic },
      },
    );
    return text("ok", 200);
  } catch (e) {
    const code =
      e instanceof MpFetchError
        ? `mp_fetch_${e.status}`
        : e instanceof Error
          ? e.message.slice(0, 80)
          : "unknown";
    console.error("mp-webhook:", code);
    await logRun(rest, startedAt, "error", executionId, { errorCode: code });
    // 5xx: Mercado Pago reintenta; el evento sigue sin marcarse como procesado.
    return text("retry", e instanceof MpFetchError ? 502 : 500);
  }
}
