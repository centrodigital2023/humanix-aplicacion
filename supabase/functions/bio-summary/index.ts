// Bio Summary — genera (o regenera) la bio profesional y un resumen IA listo
// para publicar, con tono cálido y específico para salud en Colombia.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "save_bio_summary",
    description: "Genera bio profesional (publicable) y resumen IA detallado a partir del perfil.",
    parameters: {
      type: "object",
      properties: {
        bio: {
          type: "string",
          description:
            "Bio en primera persona, 2-3 frases (máx 350 caracteres), cálida, sin emojis, en español.",
        },
        ai_summary: {
          type: "string",
          description:
            "Resumen interno detallado en markdown (máx 600 caracteres) con perfil + fortalezas, dirigido a familias e IPS.",
        },
        ai_strengths: {
          type: "array",
          items: { type: "string" },
          description: "3-5 fortalezas concretas y verificables.",
        },
      },
      required: ["bio", "ai_summary", "ai_strengths"],
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
              "Eres copywriter especializado en perfiles de profesionales de la salud en Colombia. " +
              "Escribes bio cálida, humana y precisa, sin exagerar. NO inventes certificaciones, RETHUS o años. " +
              "Usa solo datos del JSON. Habla en primera persona. Tono cercano para familias.",
          },
          {
            role: "user",
            content:
              "Genera bio y resumen para este perfil:\n```json\n" +
              JSON.stringify(profile, null, 2) +
              "\n```",
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "save_bio_summary" } },
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
      return new Response(JSON.stringify({ result: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bio-summary error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
