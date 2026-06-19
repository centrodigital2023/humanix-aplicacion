// Rate Suggester — sugiere tarifas en COP (hora/turno/mes) y una bio profesional
// para profesionales de la salud en Colombia, basado en su perfil.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "suggest_rates_and_bio",
    description:
      "Devuelve tarifas sugeridas y una bio profesional para un profesional de salud colombiano.",
    parameters: {
      type: "object",
      properties: {
        hourly_rate: { type: "number", description: "Tarifa por hora COP (mediana de mercado)" },
        shift_rate: { type: "number", description: "Tarifa por turno 12h COP" },
        monthly_rate: { type: "number", description: "Tarifa mensual COP" },
        rate_rationale: {
          type: "string",
          description: "Explicación breve (1-2 frases) de cómo se calcularon las tarifas.",
        },
        bio: {
          type: "string",
          description:
            "Bio profesional de 2-3 frases en español neutro, primera persona, cálida y específica.",
        },
      },
      required: ["hourly_rate", "shift_rate", "monthly_rate", "bio"],
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
    if (!profile) {
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
              "Eres un asesor de mercado laboral en salud para Colombia (2025). " +
              "Sugiere tarifas competitivas en COP en múltiplos de mil. Referencias orientativas: " +
              "auxiliar enfermería 18-25k/h, enfermera profesional 25-40k/h, especialistas y UCI 40-60k/h. " +
              "Turno 12h ≈ hora x 10. Mes (160h) ≈ hora x 130. Ajusta por años de experiencia, " +
              "RETHUS verificado, ciudades grandes (Bogotá/Medellín/Cali sube ~10%) y certificaciones (BLS/ACLS suman). " +
              "La bio debe ser cálida, en primera persona, sin emojis, y mencionar especialidad y experiencia.",
          },
          {
            role: "user",
            content: "Perfil JSON:\n```json\n" + JSON.stringify(profile, null, 2) + "\n```",
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "suggest_rates_and_bio" } },
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
      return new Response(JSON.stringify({ suggestion: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const suggestion = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("rate-suggester error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
