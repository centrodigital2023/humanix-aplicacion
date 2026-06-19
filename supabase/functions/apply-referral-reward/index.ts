// Aplica la recompensa al referidor cuando el referido se suscribe.
// Llamada desde mp-webhook o manualmente por superadmin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Allow two call paths:
  //  1. Service-to-service (e.g. mp-webhook) presenting X-Internal-Secret.
  //  2. Authenticated superadmin via Bearer token.
  const internalSecret = Deno.env.get("INTERNAL_WEBHOOK_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const isInternalCall =
    internalSecret.length > 0 &&
    providedSecret.length > 0 &&
    timingSafeEqual(providedSecret, internalSecret);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!isInternalCall) {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .eq("role", "superadmin")
      .maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const { referred_id } = await req.json();
    if (!referred_id) {
      return new Response(JSON.stringify({ error: "referred_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Actualizar referido a 'subscribed'
    const { data: referral, error: refErr } = await supabase
      .from("referrals")
      .select("id, referrer_id, status")
      .eq("referred_id", referred_id)
      .in("status", ["registered", "pending"])
      .maybeSingle();

    if (refErr || !referral) {
      return new Response(JSON.stringify({ error: "no referral found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("referrals")
      .update({ status: "subscribed" })
      .eq("id", referral.id);

    // Extender suscripción del referidor 1 mes
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, ends_at")
      .eq("user_id", referral.referrer_id)
      .maybeSingle();

    if (sub) {
      const currentEnd = new Date(sub.ends_at ?? new Date());
      const newEnd = new Date(currentEnd);
      newEnd.setMonth(newEnd.getMonth() + 1);

      await supabase.from("subscriptions")
        .update({ ends_at: newEnd.toISOString() })
        .eq("id", sub.id);
    }

    // Marcar como recompensado
    await supabase.from("referrals")
      .update({ status: "rewarded", reward_applied_at: new Date().toISOString() })
      .eq("id", referral.id);

    // Notificación in-app al referidor
    await supabase.from("notifications").insert({
      user_id: referral.referrer_id,
      type: "referral_reward",
      title: "¡Recompensa de referido!",
      body: "Tu colega se suscribió a Humanix. Tienes 1 mes del Plan Esencial gratis activado.",
      is_read: false,
    }).throwOnError().catch(() => null); // tabla opcional

    return new Response(JSON.stringify({ success: true, referral_id: referral.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[apply-referral-reward]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
