// Crea preferencia de Mercado Pago para suscripción mensual del profesional a Humanix.
// Devuelve init_point para redirigir al checkout.
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const MP_BASE = "https://api.mercadopago.com";

const PRICE_BY_PLAN: Record<string, number> = {
  essential_monthly: 9000,
  pro_monthly: 29000,
  institution_monthly: 99000,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN no configurado");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const requestedPlan = typeof body.plan === "string" ? body.plan : "pro_monthly";
    const plan = requestedPlan in PRICE_BY_PLAN ? requestedPlan : "pro_monthly";
    const amount = PRICE_BY_PLAN[plan];
    const userId = auth.userId;
    // Validación ligera del email: solo se usa como "payer hint" para MP.
    const emailRaw = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)
      ? emailRaw
      : "comprador@humanix.lat";

    // Anti open-redirect: solo se aceptan orígenes de humanix.lat. Si el
    // header Origin viene de otro dominio, forzamos el canónico.
    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(rawOrigin)
      ? rawOrigin
      : "https://humanix.lat";

    const title =
      plan === "essential_monthly"
        ? "Humanix Esencial · Suscripción mensual"
        : "Humanix Pro · Suscripción mensual profesional";

    // Preferencia simple (no recurrente). Para recurrente se usa /preapproval, pero esto cobra mensualmente con redirección.
    const prefBody = {
      items: [
        {
          id: plan,
          title,
          quantity: 1,
          unit_price: amount,
          currency_id: "COP",
        },
      ],
      payer: { email },
      back_urls: {
        success: `${origin}/dashboard/profesional?mp=success`,
        failure: `${origin}/dashboard/profesional?mp=failure`,
        pending: `${origin}/dashboard/profesional?mp=pending`,
      },
      auto_return: "approved",
      external_reference: userId,
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "HUMANIX",
      metadata: { user_id: userId, plan },
    };

    const r = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(prefBody),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("MP preference error:", r.status, t);
      return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const pref = await r.json();

    // Guardar/actualizar suscripción
    await fetch(`${SUPABASE_URL}/rest/v1/mp_subscriptions?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        plan,
        amount,
        currency: "COP",
        status: "pending",
        mp_payer_email: email,
      }),
    });

    return new Response(
      JSON.stringify({
        init_point: pref.init_point,
        sandbox_init_point: pref.sandbox_init_point,
        preference_id: pref.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mp-create-subscription:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
