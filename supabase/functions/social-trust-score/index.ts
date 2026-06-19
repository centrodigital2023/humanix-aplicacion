// social-trust-score — calcula el Social Trust Score de un profesional combinando IA + heurística.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "score_trust",
    description: "Calcula Social Trust Score de un profesional",
    parameters: {
      type: "object",
      properties: {
        score: { type: "number", description: "0-100" },
        breakdown: {
          type: "object",
          properties: {
            documentos: { type: "number" },
            referencias: { type: "number" },
            calificaciones: { type: "number" },
            consistencia: { type: "number" },
            actividad: { type: "number" },
          },
          required: ["documentos", "referencias", "calificaciones", "consistencia", "actividad"],
          additionalProperties: false,
        },
        strengths: { type: "array", items: { type: "string" } },
        weaknesses: { type: "array", items: { type: "string" } },
        recommendation: { type: "string" },
      },
      required: ["score", "breakdown", "strengths", "weaknesses", "recommendation"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { user_id } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isStaff = (roles ?? []).some((r) =>
      ["superadmin", "hr_staff", "evaluator"].includes(r.role),
    );
    if (!isStaff && user_id !== auth.userId) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: pro }, { data: docs }, { data: refs }, { data: ratings }] = await Promise.all([
      admin.from("professional_profiles").select("*").eq("user_id", user_id).maybeSingle(),
      admin
        .from("professional_documents")
        .select("doc_type,status,ai_score")
        .eq("user_id", user_id),
      admin.from("professional_references").select("*").eq("user_id", user_id),
      admin.from("service_ratings").select("stars,ai_sentiment,ai_alert").eq("rated_id", user_id),
    ]);

    if (!pro) {
      return new Response(JSON.stringify({ error: "Profesional no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Eres analista de confianza para una plataforma de salud. Calculas un Social Trust Score (0-100) sopesando: documentos verificados, referencias, calificaciones reales, consistencia del perfil y actividad reciente. Sé estricto pero justo.",
          },
          {
            role: "user",
            content: `PERFIL:\n${JSON.stringify(
              {
                especialidad: pro.specialty,
                años: pro.years_experience,
                rethus: pro.rethus_verified,
                verified: pro.verified,
                ai_preapproved: pro.ai_preapproved,
                total_jobs: pro.total_jobs,
                avg_rating: pro.avg_rating,
                bio_len: (pro.bio ?? "").length,
              },
              null,
              2,
            )}\n\nDOCS (${docs?.length ?? 0}):\n${JSON.stringify(docs ?? [])}\n\nREFS (${refs?.length ?? 0}):\n${JSON.stringify(refs ?? [])}\n\nRATINGS (${ratings?.length ?? 0}):\n${JSON.stringify(ratings ?? [])}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "score_trust" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429 || aiResp.status === 402) {
        return new Response(
          JSON.stringify({
            error: aiResp.status === 429 ? "Demasiadas solicitudes" : "Créditos IA agotados",
          }),
          {
            status: aiResp.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      throw new Error("AI error");
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = call ? JSON.parse(call.function.arguments || "{}") : null;
    if (!parsed) throw new Error("Sin score");

    await admin
      .from("professional_profiles")
      .update({
        social_trust_score: Math.round(parsed.score),
        social_trust_breakdown: {
          ...parsed.breakdown,
          strengths: parsed.strengths,
          weaknesses: parsed.weaknesses,
          recommendation: parsed.recommendation,
        },
        social_trust_updated_at: new Date().toISOString(),
      })
      .eq("user_id", user_id);

    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "social-trust-score", credits_used: 2 });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("social-trust-score error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
