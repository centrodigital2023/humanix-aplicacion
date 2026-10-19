// Webhook de Mercado Pago: recibe notificaciones de pago y actualiza la suscripción.
// MP envía POST con { type, data: { id } }. Sin verify_jwt (es público).
// Verifica la firma HMAC `x-signature` de Mercado Pago para evitar payloads falsificados.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

import { logExecution } from "../_shared/execLog.ts";
import { isPaymentTopic } from "../_shared/planBilling.ts";
import { makeRest, processMercadoPagoPayment } from "../_shared/mpPayment.ts";

const MP_BASE = "https://api.mercadopago.com";

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
    const topic = url.searchParams.get("type") ?? url.searchParams.get("topic");
    let paymentId = url.searchParams.get("data.id") ?? url.searchParams.get("id");

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      paymentId = paymentId ?? body?.data?.id ?? body?.resource;
    }
    // Solo los avisos de pagos: un `merchant_order` trae el id de una orden, no de un pago, y consultarlo como pago
    // daba 404 → 502 → Mercado Pago reintentaba sin fin.
    if (!paymentId || !isPaymentTopic(topic)) {
      return new Response("ok", { status: 200 });
    }
    executionId = String(paymentId);

    // Sin claves no se puede procesar: queda en el registro (antes fallaba en silencio) y Mercado Pago reintenta.
    if (!MP_TOKEN || !MP_WEBHOOK_SECRET) {
      const missing = !MP_TOKEN ? "missing_access_token" : "missing_webhook_secret";
      console.error(`mp-webhook: ${missing}`);
      await logExecution({
        functionName: "mp-webhook", triggerType: "webhook", status: "error",
        startedAt, executionId, errorCode: missing,
      });
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
    const pr = await fetch(`${MP_BASE}/v1/payments/${encodeURIComponent(String(paymentId))}`, {
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

    // La misma lógica que la confirmación al volver del checkout (ver _shared/mpPayment.ts).
    const outcome = await processMercadoPagoPayment(payment, {
      rest: makeRest(SUPABASE_URL, SRK),
      now: Date.now,
      source: "webhook",
      topic,
    });
    await logExecution({
      functionName: "mp-webhook", triggerType: "webhook",
      status: outcome.result === "rejected" ? "rejected"
        : outcome.result === "already_applied" ? "duplicate" : "success",
      startedAt, executionId,
      errorCode: outcome.result === "rejected" ? outcome.error : undefined,
      metadata: { status: String(payment.status ?? ""), result: outcome.result },
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
