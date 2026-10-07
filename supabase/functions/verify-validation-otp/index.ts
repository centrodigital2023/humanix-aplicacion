// Verifica el OTP ingresado. Máx 5 intentos. Devuelve el promo_code si es correcto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const { otp_id, code } = await req.json() as { otp_id: string; code: string };
    if (!otp_id || !code) return json({ error: "Faltan campos" }, 400);

    const { data: otp, error: fetchErr } = await admin
      .from("validation_otps")
      .select("id, code, expires_at, verified_at, attempts, response_id")
      .eq("id", otp_id)
      .maybeSingle();

    if (fetchErr || !otp) return json({ valid: false, error: "Código no encontrado" }, 404);
    if (otp.verified_at) return json({ valid: false, error: "Este código ya fue usado" }, 409);
    if (new Date(otp.expires_at) < new Date()) return json({ valid: false, error: "Código expirado. Solicita uno nuevo." }, 410);
    if (otp.attempts >= 5) return json({ valid: false, error: "Demasiados intentos. Solicita un nuevo código." }, 429);

    // Incrementar intentos (siempre, incluso si falla — evita fuerza bruta)
    await admin
      .from("validation_otps")
      .update({ attempts: otp.attempts + 1 })
      .eq("id", otp_id);

    if (otp.code !== code.trim()) {
      const remaining = 4 - otp.attempts;
      return json({ valid: false, error: "Código incorrecto.", remaining_attempts: Math.max(0, remaining) });
    }

    // Marcar como verificado
    await admin
      .from("validation_otps")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", otp_id);

    // Obtener el promo_code de la respuesta de encuesta
    let promo_code: string | null = null;
    if (otp.response_id) {
      const { data: resp } = await admin
        .from("validation_responses")
        .select("promo_code, total_score")
        .eq("id", otp.response_id)
        .maybeSingle();
      promo_code = resp?.promo_code ?? null;
    }

    return json({ valid: true, promo_code });
  } catch (e) {
    console.error("[verify-validation-otp]", e);
    return json({ error: "Error interno" }, 500);
  }
});
