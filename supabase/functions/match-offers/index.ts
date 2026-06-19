// Match Offers — recomienda 3-5 ofertas que mejor encajan con el perfil del profesional.
// Recibe { profile, offers } y devuelve { matches: [{offer_id, score, reason}] }.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "rank_offers",
    description: "Devuelve las 3-5 mejores ofertas para el profesional, con puntaje 0-100 y razón.",
    parameters: {
      type: "object",
      properties: {
        matches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              offer_id: { type: "string" },
              score: { type: "number", description: "0-100" },
              reason: { type: "string", description: "1 frase explicando por qué encaja." },
            },
            required: ["offer_id", "score", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["matches"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  try {
    const { profile, offers } = await req.json();
    if (!profile || !Array.isArray(offers)) {
      return new Response(JSON.stringify({ error: "profile y offers requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (offers.length === 0) {
      return new Response(JSON.stringify({ matches: [] }), {
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
              "Eres un matcher de ofertas de salud en Colombia. Considera especialidad, ciudad, " +
              "modalidad, tarifa vs tarifas del profesional, requisitos y RETHUS. " +
              "Devuelve solo ofertas relevantes (mínimo 60/100). Máximo 5.",
          },
          {
            role: "user",
            content:
              "PERFIL:\n```json\n" +
              JSON.stringify(profile, null, 2) +
              "\n```\n\n" +
              "OFERTAS:\n```json\n" +
              JSON.stringify(offers, null, 2) +
              "\n```",
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "rank_offers" } },
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
      return new Response(JSON.stringify({ matches: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ matches: parsed.matches ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("match-offers error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
