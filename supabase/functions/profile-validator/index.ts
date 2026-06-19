// Profile Validator — calcula Trust Score y genera resumen + sugerencias
// del perfil profesional usando tool calling.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "evaluate_profile",
    description:
      "Evalúa un perfil profesional de salud y devuelve resumen, fortalezas, sugerencias y Trust Score 0-100.",
    parameters: {
      type: "object",
      properties: {
        ai_summary: {
          type: "string",
          description: "Resumen profesional de 2-3 frases en primera persona.",
        },
        ai_strengths: {
          type: "array",
          items: { type: "string" },
          description: "3-5 fortalezas concretas y verificables.",
        },
        ai_suggestions: {
          type: "array",
          items: { type: "string" },
          description: "3-5 acciones para mejorar el perfil y subir el Trust Score.",
        },
        trust_score: {
          type: "number",
          description:
            "0-100. Considera: RETHUS verificado (+25), años de experiencia, certificaciones, claridad del perfil, ciudades, idiomas.",
        },
      },
      required: ["ai_summary", "ai_strengths", "ai_suggestions", "trust_score"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { profile } = await req.json();
    if (!profile || typeof profile !== "object") {
      return new Response(JSON.stringify({ error: "profile requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Eres un evaluador imparcial de perfiles de profesionales de salud en Colombia. " +
              "Evalúa con base en datos reales del perfil, no inventes. " +
              "Da feedback constructivo y específico para Colombia (RETHUS, mercado COP, ciudades).",
          },
          {
            role: "user",
            content:
              "Evalúa este perfil JSON y completa la herramienta:\n```json\n" +
              JSON.stringify(profile, null, 2) +
              "\n```",
          },
        ],
        tools: [TOOL],
        tool_choice: {
          type: "function",
          function: { name: "evaluate_profile" },
        },
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429 || resp.status === 402) {
        return new Response(
          JSON.stringify({
            error: resp.status === 429 ? "Demasiadas solicitudes." : "Créditos IA agotados.",
          }),
          { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await resp.text();
      console.error("Gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "Error IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(
        JSON.stringify({
          evaluation: {
            ai_summary: "Perfil registrado correctamente.",
            ai_strengths: [],
            ai_suggestions: ["Completa más campos para mejorar tu evaluación."],
            trust_score: 30,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const evaluation = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ evaluation }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("profile-validator error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
