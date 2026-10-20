// Aplica la recompensa al referidor cuando el referido se suscribe (grant_referral_reward, solo service_role).
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

    // Toda la regla vive en la base (20261020150000_referrals_security.sql): exige plan de pago vigente del referido
    // en mp_subscriptions, suma el mes a quien refiere, avisa y es idempotente.
    const { data: result, error } = await supabase.rpc("grant_referral_reward", {
      p_referred_id: referred_id,
    });
    if (error) throw error;

    const status = result === "no_referral" ? 404 : result === "not_subscribed" ? 409 : 200;
    return new Response(JSON.stringify({ success: status === 200, result }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[apply-referral-reward]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
