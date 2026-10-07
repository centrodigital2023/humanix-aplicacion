// Crea preferencia de MercadoPago para comprar un paquete de créditos IA.
// El usuario elige un pack del catálogo y se genera un checkout MP.
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const MP_BASE = "https://api.mercadopago.com";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN no configurado");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const packId = typeof body.pack_id === "string" ? body.pack_id.slice(0, 40) : null;
    if (!packId) {
      return new Response(JSON.stringify({ error: "pack_id requerido" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const emailRaw = typeof body.email === "string" ? body.email.trim().slice(0, 120) : "";
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)
      ? emailRaw : "comprador@humanix.lat";

    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = /^https:\/\/([a-z0-9-]+\.)?humanix\.lat$/i.test(rawOrigin)
      ? rawOrigin : "https://humanix.lat";

    const supabase = createClient(SUPABASE_URL, SRK);

    // Leer el paquete del catálogo
    const { data: pack, error: packErr } = await supabase
      .from("ai_credit_packs_catalog")
      .select("id, name, credits, price_cop, bonus_pct, validity_days, active")
      .eq("id", packId)
      .eq("active", true)
      .single();

    if (packErr || !pack) {
      return new Response(JSON.stringify({ error: "Paquete no disponible" }), {
        status: 404, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const totalCredits = Math.round(pack.credits * (1 + (pack.bonus_pct ?? 0) / 100));
    const userId = auth.userId;

    const prefBody = {
      items: [
        {
          id: `credits_${packId}`,
          title: `Humanix IA · ${pack.name} (${totalCredits} créditos)`,
          quantity: 1,
          unit_price: pack.price_cop,
          currency_id: "COP",
        },
      ],
      payer: { email },
      back_urls: {
        success: `${origin}/pago/exito?tipo=creditos&pack=${packId}&creditos=${totalCredits}`,
        failure: `${origin}/pago/fallo?tipo=creditos&pack=${packId}`,
        pending: `${origin}/pago/exito?tipo=creditos&pack=${packId}&estado=pending`,
      },
      auto_return: "approved",
      external_reference: `credits:${userId}:${packId}`,
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      statement_descriptor: "HUMANIX IA",
      metadata: {
        type: "credits",
        user_id: userId,
        pack_id: packId,
        credits: totalCredits,
        validity_days: pack.validity_days ?? 90,
      },
    };

    const r = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(prefBody),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("MP credits preference error:", r.status, t);
      return new Response(JSON.stringify({ error: "Error al crear el pago. Inténtalo de nuevo." }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const pref = await r.json();

    return new Response(
      JSON.stringify({
        init_point: pref.init_point,
        sandbox_init_point: pref.sandbox_init_point,
        preference_id: pref.id,
        pack,
        total_credits: totalCredits,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mp-create-credits-checkout:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
