// embed-profile — genera y guarda el embedding del perfil profesional autenticado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";
import { embedText } from "../_shared/embed.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: pro } = await supabase
      .from("professional_profiles")
      .select(
        "specialty,sub_specialties,years_experience,bio,service_cities,languages,certifications,work_experience,ai_summary,ai_strengths,hourly_rate,shift_rate,monthly_rate",
      )
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!pro) {
      return new Response(JSON.stringify({ error: "Perfil profesional no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const text = [
      `Especialidad: ${pro.specialty ?? ""}`,
      `Subespecialidades: ${(pro.sub_specialties ?? []).join(", ")}`,
      `Años: ${pro.years_experience ?? 0}`,
      `Ciudades: ${(pro.service_cities ?? []).join(", ")}`,
      `Idiomas: ${(pro.languages ?? []).join(", ")}`,
      `Bio: ${pro.bio ?? ""}`,
      `Resumen IA: ${pro.ai_summary ?? ""}`,
      `Fortalezas: ${(pro.ai_strengths ?? []).join(", ")}`,
      `Experiencia: ${JSON.stringify(pro.work_experience ?? []).slice(0, 2000)}`,
      `Certificaciones: ${JSON.stringify(pro.certifications ?? []).slice(0, 1000)}`,
      `Tarifas: hora ${pro.hourly_rate ?? "?"} / turno ${pro.shift_rate ?? "?"} / mes ${pro.monthly_rate ?? "?"}`,
    ].join("\n");

    const embedding = embedText(text);
    const { error } = await supabase.from("profile_embeddings").upsert({
      user_id: auth.userId,
      embedding,
      source_text: text.slice(0, 4000),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;

    await supabase.from("ai_credits_ledger").insert({
      user_id: auth.userId,
      feature: "embed-profile",
      credits_used: 1,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("embed-profile error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
