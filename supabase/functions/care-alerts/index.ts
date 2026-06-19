// Webhook para care_logs: envía alerta WhatsApp a la familia si hay incidente.
// Se invoca via Supabase Database Webhooks (pg_net) en INSERT sobre care_logs WHERE is_alert = true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const WA_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

async function sendWa(phone: string, body: string) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn("[care-alerts] WhatsApp not configured");
    return;
  }
  const clean = phone.replace(/\D/g, "");
  const to = clean.startsWith("57") ? clean : `57${clean}`;
  const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
  if (!res.ok) console.error("[care-alerts] WA error:", await res.text());
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("INTERNAL_WEBHOOK_SECRET") ?? "";
  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!expected || !provided || !timingSafeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Payload viene de Supabase Database Webhook
    const payload = await req.json();
    const log = payload.record ?? payload;

    if (!log?.is_alert && log?.event_type !== "incident") {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener datos del turno
    const { data: booking } = await supabase
      .from("service_bookings")
      .select("client_id, professional_id")
      .eq("id", log.booking_id)
      .single();

    if (!booking) {
      return new Response(JSON.stringify({ error: "booking not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Obtener teléfono de la familia y nombre del profesional
    const [{ data: famProfile }, { data: proProfile }] = await Promise.all([
      supabase.from("profiles").select("phone, full_name").eq("user_id", booking.client_id).single(),
      supabase.from("profiles").select("full_name").eq("user_id", booking.professional_id).single(),
    ]);

    if (famProfile?.phone) {
      await sendWa(
        famProfile.phone,
        `⚠️ HUMANIX ALERTA\n\n${proProfile?.full_name ?? "El profesional"} reportó:\n"${log.description}"\n\nVer bitácora en vivo: https://humanix.lat/turno/${log.booking_id}`,
      );
    }

    // Marcar como notificado
    await supabase.from("care_logs")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", log.id);

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[care-alerts]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
