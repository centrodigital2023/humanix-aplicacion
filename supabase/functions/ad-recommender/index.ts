// ad-recommender — sugiere copy publicitario, audiencia y score de un banner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "recommend_ad",
    description: "Recomienda copy y audiencia para un banner publicitario",
    parameters: {
      type: "object",
      properties: {
        title_suggestion: { type: "string" },
        description_suggestion: { type: "string" },
        cta_suggestion: { type: "string" },
        audience: { type: "string", enum: ["all", "family", "professional", "institution"] },
        ai_score: { type: "number", description: "0-100 calidad del banner" },
        recommendation: { type: "string", description: "Justificación ≤200 chars" },
      },
      required: [
        "title_suggestion",
        "description_suggestion",
        "cta_suggestion",
        "audience",
        "ai_score",
        "recommendation",
      ],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { title, description, cta_label, target_intent } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validar staff
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isStaff = (roles ?? []).some((r) =>
      ["superadmin", "hr_staff", "evaluator"].includes(r.role),
    );
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
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
              "Eres un copywriter senior de marketing digital para Humanix, plataforma de cuidadores de salud en Colombia. Genera copy persuasivo, claro y empático en español neutro colombiano. CTA ≤4 palabras.",
          },
          {
            role: "user",
            content: `Banner actual:\nTítulo: ${title || "(vacío)"}\nDescripción: ${description || "(vacía)"}\nCTA: ${cta_label || "(vacío)"}\nIntención: ${target_intent || "promoción general"}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "recommend_ad" } },
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
    if (!parsed) throw new Error("Sin recomendación");

    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "ad-recommender", credits_used: 1 });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ad-recommender error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
