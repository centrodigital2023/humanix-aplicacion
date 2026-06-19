// Trust Verdict — inspector de seguridad IA.
// Recibe un snapshot del perfil (datos no sensibles) y retorna un veredicto
// corto de confianza en español para mostrar dentro de la tarjeta de perfil
// antes de confirmar un turno.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "emit_trust_verdict",
    description:
      "Emite un veredicto de confianza breve para un perfil de la plataforma Humanix (familia o profesional) usado en la agenda.",
    parameters: {
      type: "object",
      properties: {
        confidence: {
          type: "string",
          enum: ["alta", "media", "baja"],
          description: "Nivel global de confianza según los datos disponibles.",
        },
        score: {
          type: "number",
          description: "0-100 agregado del perfil para esta contratación.",
        },
        reasons: {
          type: "array",
          items: { type: "string" },
          description:
            "2-3 razones concretas que sustentan el veredicto (documentos aprobados, estrellas, RETHUS, etc.).",
        },
        caution: {
          type: "string",
          description:
            "Una línea con precaución o faltante más relevante, si existe. Vacío si todo OK.",
        },
        summary: {
          type: "string",
          description:
            "Resumen en 1-2 frases, español neutro, dirigido al otro usuario antes de confirmar el turno.",
        },
      },
      required: ["confidence", "score", "reasons", "summary"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { snapshot } = await req.json();
    if (!snapshot || typeof snapshot !== "object") {
      return new Response(JSON.stringify({ error: "snapshot requerido" }), {
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
              "Eres el 'Inspector de Seguridad' de Humanix. Evalúas perfiles de cuidadores " +
              "y familias antes de confirmar un turno de cuidado en casa en Colombia. " +
              "Sé directo y útil. No inventes datos. Basas el veredicto solo en el snapshot provisto: " +
              "documentos aprobados por IA, RETHUS, estrellas promedio, servicios completados, " +
              "dirección declarada y cantidad de documentos pendientes. " +
              "Si falta información crítica (RETHUS, cédula, estrellas) baja la confianza.",
          },
          {
            role: "user",
            content:
              "Evalúa el siguiente perfil y entrega el veredicto:\n```json\n" +
              JSON.stringify(snapshot, null, 2) +
              "\n```",
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "emit_trust_verdict" } },
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
      console.error("trust-verdict gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "Error IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ result: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("trust-verdict error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
