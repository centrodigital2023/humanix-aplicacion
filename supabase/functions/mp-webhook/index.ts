// Webhook de Mercado Pago: recibe notificaciones de pago y actualiza la suscripción.
// MP envía POST con { type, data: { id } }. Sin verify_jwt (es público).
// Verifica la firma HMAC `x-signature` de Mercado Pago para evitar payloads falsificados.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { logExecution } from "../_shared/execLog.ts";

const MP_BASE = "https://api.mercadopago.com";

// Acredita créditos IA via Supabase RPC (service role)
async function grantCredits(
  supabaseUrl: string,
  srk: string,
  userId: string,
  packId: string | null,
  credits: number,
  priceCop: number,
  mpPaymentId: string,
  preferenceId: string | null,
  validityDays: number,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/grant_ai_credits`, {
    method: "POST",
    headers: {
      apikey: srk,
      Authorization: `Bearer ${srk}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_pack_id: packId,
      p_credits: credits,
      p_price_cop: priceCop,
      p_mp_payment_id: mpPaymentId,
      p_mp_preference_id: preferenceId,
      p_validity_days: validityDays,
    }),
  });
  // 409 = ya acreditado (índice único por mp_payment_id): idempotente.
  if (!res.ok && res.status !== 409) throw new Error(`grant_ai_credits ${res.status}`);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// El usuario sale de datos que fijó NUESTRO servidor al crear la preferencia
// (metadata.user_id o external_reference), nunca del navegador.
function resolveUserId(payment: Record<string, any>): string | null {
  const ref = String(payment.external_reference ?? "");
  const fromRef = ref.startsWith("credits:") ? ref.split(":")[1] : ref;
  const candidate = String(payment.metadata?.user_id ?? fromRef ?? "");
  return UUID_RE.test(candidate) ? candidate : null;
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
    if (!MP_TOKEN) return new Response("config", { status: 500 });

    const rest = async (path: string, init: RequestInit & { allowConflict?: boolean } = {}) => {
      const { allowConflict, ...rest } = init;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...rest,
        headers: {
          apikey: SRK,
          Authorization: `Bearer ${SRK}`,
          "Content-Type": "application/json",
          ...(rest.headers ?? {}),
        },
      });
      if (!res.ok && !(allowConflict && res.status === 409)) {
        throw new Error(`rest ${path.split("?")[0]} ${res.status}`);
      }
      return res;
    };

    const url = new URL(req.url);
    const topic = url.searchParams.get("type") ?? url.searchParams.get("topic");
    let paymentId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      paymentId = paymentId ?? body?.data?.id ?? body?.resource;
    }
    if (!paymentId || !(topic === "payment" || topic === "merchant_order" || !topic)) {
      return new Response("ok", { status: 200 });
    }
    executionId = String(paymentId);

    if (!MP_WEBHOOK_SECRET) {
      console.error("mp-webhook: MERCADOPAGO_WEBHOOK_SECRET no configurado");
      return new Response("config", { status: 500 });
    }
    const validSig = await verifyMpSignature(req, String(paymentId), MP_WEBHOOK_SECRET);
    if (!validSig) {
      console.warn("mp-webhook: firma inválida");
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "rejected",
        startedAt, executionId, errorCode: "invalid_signature",
      });
      return new Response("invalid signature", { status: 401 });
    }

    // Consulta directa a Mercado Pago: nunca se confía en el cuerpo del webhook.
    const pr = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!pr.ok) {
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "error",
        startedAt, executionId, errorCode: `mp_fetch_${pr.status}`,
      });
      // 5xx para que Mercado Pago reintente.
      return new Response("retry", { status: 502 });
    }
    const payment = await pr.json();
    const status = String(payment.status ?? "pending");
    const eventId = `${payment.id}:${status}`;

    // Idempotencia: un mismo (pago, estado) se procesa una sola vez.
    const existing = await (await rest(
      `payment_webhook_events?provider=eq.mercadopago&external_event_id=eq.${encodeURIComponent(eventId)}&select=processed`,
    )).json();
    if (existing?.[0]?.processed) {
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "duplicate",
        startedAt, executionId, metadata: { status },
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
    if (!existing?.length) {
      await rest("payment_webhook_events", {
        method: "POST",
        allowConflict: true,
        body: JSON.stringify({
          provider: "mercadopago",
          external_event_id: eventId,
          event_type: topic ?? "payment",
          signature_valid: true,
          payload_hash: await sha256Hex(JSON.stringify(payment)),
        }),
      });
    }

    const userId = resolveUserId(payment);
    const extRef = String(payment.external_reference ?? "");
    const isCredits = extRef.startsWith("credits:") || payment.metadata?.type === "credits";
    const meta = payment.metadata ?? {};
    const amount = Math.round(Number(payment.transaction_amount ?? 0));
    const currency = String(payment.currency_id ?? "COP");

    if (!userId) {
      await rest(`payment_webhook_events?provider=eq.mercadopago&external_event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        body: JSON.stringify({ processed: true, processed_at: new Date().toISOString(), error_code: "unknown_user" }),
      });
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "rejected",
        startedAt, executionId, errorCode: "unknown_user",
      });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    await rest("mp_payments", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        user_id: userId,
        mp_payment_id: String(payment.id),
        amount,
        currency,
        status,
        description: payment.description ?? null,
        raw_payload: payment,
        paid_at: status === "approved" ? new Date().toISOString() : null,
      }),
    });

    const notify = (row: Record<string, unknown>) =>
      rest("notifications", { method: "POST", body: JSON.stringify({ user_id: userId, ...row }) });

    if (status === "approved") {
      if (currency !== "COP" || amount <= 0) throw new Error("invalid_amount_or_currency");

      if (isCredits) {
        const credits = Number(meta.credits ?? 0);
        if (credits > 0) {
          await grantCredits(
            SUPABASE_URL, SRK, userId, meta.pack_id ?? null, credits, amount,
            String(payment.id), payment.preference_id ?? null, Number(meta.validity_days ?? 90),
          );
        }
        await notify({
          type: "credits_purchased",
          title: "✅ Créditos IA acreditados",
          body: `Se acreditaron ${credits} créditos IA en tu cuenta. ¡Empieza a usarlos!`,
          link: "/dashboard",
        });
      } else {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        await rest(`mp_subscriptions?user_id=eq.${userId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "active",
            current_period_end: periodEnd.toISOString(),
            next_payment_at: periodEnd.toISOString(),
            cancel_at_period_end: false,
          }),
        });
        await notify({
          type: "payment_approved",
          title: "✅ Suscripción Humanix activa",
          body: "Tu suscripción mensual fue aprobada. ¡Ya puedes usar todas las funciones premium!",
          link: "/dashboard",
        });
      }
    } else if (status === "rejected" || status === "cancelled") {
      if (!isCredits) {
        await rest(`mp_subscriptions?user_id=eq.${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
      }
      await notify({
        type: `payment_${status}`,
        title: status === "rejected" ? "❌ Pago rechazado" : "Pago cancelado",
        body: status === "rejected"
          ? "No pudimos procesar tu pago con Mercado Pago. Puedes reintentar desde /planes."
          : "Tu pago fue cancelado.",
        link: "/planes",
      });
    }

    await rest(`payment_webhook_events?provider=eq.mercadopago&external_event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({ processed: true, processed_at: new Date().toISOString(), error_code: null }),
    });
    await logExecution({
      functionName: "mp-webhook", triggerType: "webhook", status: "success",
      startedAt, executionId, metadata: { status, kind: isCredits ? "credits" : "plan" },
    });
    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("mp-webhook:", e instanceof Error ? e.message : "error");
    await logExecution({
      functionName: "mp-webhook", triggerType: "webhook", status: "error",
      startedAt, executionId, errorCode: e instanceof Error ? e.message.slice(0, 80) : "unknown",
    });
    // 500 => Mercado Pago reintenta; el evento sigue sin marcarse como procesado.
    return new Response("error", { status: 500 });
  }
});
