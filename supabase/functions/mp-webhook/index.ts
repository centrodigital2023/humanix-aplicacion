// Webhook de Mercado Pago: recibe notificaciones de pago y actualiza la suscripción.
// MP envía POST con { type, data: { id } }. Sin verify_jwt (es público).
// Verifica la firma HMAC `x-signature` de Mercado Pago para evitar payloads falsificados.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  try {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    const MP_WEBHOOK_SECRET = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!MP_TOKEN) return new Response("config", { status: 500 });

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

    // Verificar firma HMAC. Si el secreto no está configurado, rechazar para
    // evitar payloads falsificados que disparen cambios de suscripción.
    if (!MP_WEBHOOK_SECRET) {
      console.error("mp-webhook: MERCADOPAGO_WEBHOOK_SECRET no configurado");
      return new Response("config", { status: 500 });
    }
    const validSig = await verifyMpSignature(req, String(paymentId), MP_WEBHOOK_SECRET);
    if (!validSig) {
      console.warn("mp-webhook: firma inválida");
      return new Response("invalid signature", { status: 401 });
    }

    // Buscar el pago real
    const pr = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!pr.ok) {
      console.warn("MP fetch payment error", pr.status);
      return new Response("ok", { status: 200 });
    }
    const payment = await pr.json();
    const userId = payment.external_reference || payment.metadata?.user_id;
    const status = String(payment.status ?? "pending");

    // Insertar pago
    await fetch(`${SUPABASE_URL}/rest/v1/mp_payments`, {
      method: "POST",
      headers: {
        apikey: SRK,
        Authorization: `Bearer ${SRK}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        mp_payment_id: String(payment.id),
        amount: Math.round(Number(payment.transaction_amount ?? 0)),
        currency: payment.currency_id ?? "COP",
        status,
        description: payment.description ?? null,
        raw_payload: payment,
        paid_at: status === "approved" ? new Date().toISOString() : null,
      }),
    });

    // Actualizar suscripción según estado
    if (status === "approved" && userId) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await fetch(`${SUPABASE_URL}/rest/v1/mp_subscriptions?user_id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          apikey: SRK,
          Authorization: `Bearer ${SRK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "active",
          current_period_end: periodEnd.toISOString(),
          next_payment_at: periodEnd.toISOString(),
          cancel_at_period_end: false,
        }),
      });

      // Notificación in-app
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: {
          apikey: SRK,
          Authorization: `Bearer ${SRK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          type: "payment_approved",
          title: "✅ Suscripción Humanix activa",
          body: "Tu suscripción mensual fue aprobada. ¡Ya puedes usar todas las funciones premium!",
          link: "/dashboard",
        }),
      });
    } else if ((status === "rejected" || status === "cancelled") && userId) {
      await fetch(`${SUPABASE_URL}/rest/v1/mp_subscriptions?user_id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          apikey: SRK,
          Authorization: `Bearer ${SRK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
        method: "POST",
        headers: {
          apikey: SRK,
          Authorization: `Bearer ${SRK}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          type: `payment_${status}`,
          title: status === "rejected" ? "❌ Pago rechazado" : "Suscripción cancelada",
          body:
            status === "rejected"
              ? "No pudimos procesar tu pago con Mercado Pago. Puedes reintentar desde /planes."
              : "Tu suscripción fue cancelada. Puedes reactivarla cuando quieras.",
          link: "/planes",
        }),
      });
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error("mp-webhook:", e);
    return new Response("ok", { status: 200 });
  }
});
