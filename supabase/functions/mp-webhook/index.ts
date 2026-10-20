// Webhook de Mercado Pago: recibe notificaciones de pagos y de suscripciones y actualiza el plan.
// MP envía POST con { type, data: { id } }. Sin verify_jwt (es público).
// Avisos que se atienden (configurarlos en el panel de Mercado Pago → Webhooks):
//  - `payment`: pagos únicos (créditos IA, preferencias antiguas) y, si traen su suscripción, cobros mensuales.
//  - `subscription_authorized_payment`: cada cobro mensual de una suscripción.
//  - `subscription_preapproval`: la suscripción se autoriza, pausa o cancela.
// Verifica la firma HMAC `x-signature` de Mercado Pago para evitar payloads falsificados.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { logExecution, type ExecStatus } from "../_shared/execLog.ts";
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
} from "../_shared/planBilling.ts";
import {
  isCreditsPayment,
  makeRest,
  processMercadoPagoPayment,
  type MpPayment,
} from "../_shared/mpPayment.ts";

const MP_BASE = "https://api.mercadopago.com";

class MpFetchError extends Error {
  constructor(readonly status: number) {
    super(`mp_fetch_${status}`);
  }
}

// Verifica la firma del webhook de Mercado Pago.
// Formato de header: `x-signature: ts=TIMESTAMP,v1=HASH`
// Manifest firmado: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
async function verifyMpSignature(
  req: Request,
  dataId: string | null,
  secret: string,
): Promise<boolean> {
  const sigHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
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

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // timing-safe compare
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  let executionId: string | undefined;

  try {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    const MP_WEBHOOK_SECRET = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const url = new URL(req.url);
    let topic = url.searchParams.get("type") ?? url.searchParams.get("topic");
    let dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      dataId = dataId ?? body?.data?.id ?? body?.resource;
      topic = topic ?? (typeof body?.type === "string" ? body.type : null);
    }
    // Solo pagos y suscripciones: un `merchant_order` trae el id de una orden, no de un pago, y consultarlo como pago
    // daba 404 → 502 → Mercado Pago reintentaba sin fin.
    const known =
      isPaymentTopic(topic) || topic === SUBSCRIPTION_PAYMENT_TOPIC || topic === PREAPPROVAL_TOPIC;
    if (!dataId || !known) {
      return new Response("ok", { status: 200 });
    }
    executionId = String(dataId);
    const log = (status: ExecStatus, extra: { errorCode?: string; metadata?: Record<string, unknown> } = {}) =>
      logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status,
        startedAt, executionId, ...extra,
      });

    // Sin claves no se puede procesar: queda en el registro (antes fallaba en silencio) y Mercado Pago reintenta.
    if (!MP_TOKEN || !MP_WEBHOOK_SECRET) {
      const missing = !MP_TOKEN ? "missing_access_token" : "missing_webhook_secret";
      console.error(`mp-webhook: ${missing}`);
      await log("error", { errorCode: missing });
      return new Response("config", { status: 500 });
    }
    const validSig = await verifyMpSignature(req, String(dataId), MP_WEBHOOK_SECRET);
    if (!validSig) {
      console.warn("mp-webhook: firma inválida");
      await log("rejected", { errorCode: "invalid_signature" });
      return new Response("invalid signature", { status: 401 });
    }

    // Consultas directas a Mercado Pago: nunca se confía en el cuerpo del webhook. `null` = no existe (404).
    const mpGet = async <T,>(path: string): Promise<T | null> => {
      const r = await fetch(`${MP_BASE}${path}`, { headers: { Authorization: `Bearer ${MP_TOKEN}` } });
      if (r.status === 404) return null;
      if (!r.ok) throw new MpFetchError(r.status);
      return (await r.json()) as T;
    };
    const rest = makeRest(SUPABASE_URL, SRK);
    const cancelPreapproval = async (id: string) => {
      const r = await fetch(`${MP_BASE}/preapproval/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!r.ok) throw new Error(`mp_cancel_${r.status}`);
    };

    // ── Cambio de estado de una suscripción ──────────────────────────────────
    if (topic === PREAPPROVAL_TOPIC) {
      const pre = await mpGet<MpPreapproval>(`/preapproval/${encodeURIComponent(String(dataId))}`);
      const ref = parsePreapprovalReference(pre?.external_reference);
      if (!pre || !ref || typeof pre.id !== "string") {
        await log("rejected", { errorCode: "unknown_preapproval" });
        return new Response("ok", { status: 200 });
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
      await log("success", { metadata: { topic, status, changed: Boolean(patch) } });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    // ── Un pago (único o cobro de una suscripción) ───────────────────────────
    let payment: MpPayment | null = null;
    let preapprovalId: string | null = null;
    if (topic === SUBSCRIPTION_PAYMENT_TOPIC) {
      const ap = await mpGet<{ preapproval_id?: unknown; payment?: { id?: unknown } | null }>(
        `/authorized_payments/${encodeURIComponent(String(dataId))}`,
      );
      const payId = ap?.payment?.id;
      preapprovalId = typeof ap?.preapproval_id === "string" ? ap.preapproval_id : null;
      if (!payId || !preapprovalId) {
        // Cobro programado que aún no se intenta: llegará otro aviso cuando haya pago.
        await log("success", { metadata: { topic, result: "scheduled" } });
        return new Response("ok", { status: 200 });
      }
      payment = await mpGet<MpPayment>(`/v1/payments/${encodeURIComponent(String(payId))}`);
    } else {
      payment = await mpGet<MpPayment>(`/v1/payments/${encodeURIComponent(String(dataId))}`);
      if (payment && !isCreditsPayment(payment) && !paidPlanOf(payment)) {
        preapprovalId = preapprovalIdOfPayment(payment);
        if (!preapprovalId) {
          // Sin plan ni suscripción: lo aplica el aviso `subscription_authorized_payment` si es un cobro mensual.
          await log("success", { metadata: { topic, result: "deferred" } });
          return new Response("ok", { status: 200 });
        }
      }
    }
    if (!payment) {
      await log("error", { errorCode: "mp_fetch_404" });
      return new Response("retry", { status: 502 });
    }
    if (preapprovalId) {
      const pre = await mpGet<MpPreapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`);
      const enriched = pre ? withSubscriptionMetadata(payment, pre) : null;
      if (!enriched) {
        await log("rejected", { errorCode: "unknown_preapproval" });
        return new Response("ok", { status: 200 });
      }
      payment = enriched;
    }

    // La misma lógica que la confirmación al volver del checkout (ver _shared/mpPayment.ts).
    const outcome = await processMercadoPagoPayment(payment, {
      rest,
      now: Date.now,
      source: "webhook",
      topic,
      cancelPreapproval,
    });
    await log(
      outcome.result === "rejected" ? "rejected"
        : outcome.result === "already_applied" ? "duplicate" : "success",
      {
        errorCode: outcome.result === "rejected" ? outcome.error : undefined,
        metadata: { status: String(payment.status ?? ""), result: outcome.result, topic },
      },
    );
    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    if (e instanceof MpFetchError) {
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "error",
        startedAt, executionId, errorCode: `mp_fetch_${e.status}`,
      });
      // 5xx para que Mercado Pago reintente.
      return new Response("retry", { status: 502 });
    }
    console.error("mp-webhook:", e instanceof Error ? e.message : "error");
    await logExecution({
      functionName: "mp-webhook", triggerType: "webhook", status: "error",
      startedAt, executionId, errorCode: e instanceof Error ? e.message.slice(0, 80) : "unknown",
    });
    // 500 => Mercado Pago reintenta; el evento sigue sin marcarse como procesado.
    return new Response("error", { status: 500 });
  }
});
