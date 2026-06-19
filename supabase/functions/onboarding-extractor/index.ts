// Onboarding Extractor — extrae datos estructurados del perfil profesional
// a partir de texto libre, usando tool calling.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "save_professional_profile",
    description:
      "Extrae y normaliza los campos del perfil de un profesional de la salud en Colombia.",
    parameters: {
      type: "object",
      properties: {
        specialty: {
          type: "string",
          description:
            "Especialidad principal: 'Enfermería general', 'Cuidado adulto mayor', 'Cuidado pediátrico', 'UCI', 'Heridas y curaciones', 'Rehabilitación domiciliaria', etc.",
        },
        sub_specialties: {
          type: "array",
          items: { type: "string" },
          description: "Sub-áreas o experiencia específica",
        },
        years_experience: { type: "number" },
        rethus_number: {
          type: "string",
          description: "Número RETHUS si fue mencionado, vacío si no",
        },
        hourly_rate: {
          type: "number",
          description: "Tarifa por hora en COP, ej. 25000",
        },
        shift_rate: {
          type: "number",
          description: "Tarifa por turno (12h) en COP, ej. 220000",
        },
        monthly_rate: {
          type: "number",
          description: "Tarifa mensual en COP",
        },
        service_cities: {
          type: "array",
          items: { type: "string" },
          description: "Ciudades donde puede trabajar",
        },
        languages: { type: "array", items: { type: "string" } },
        certifications: {
          type: "array",
          items: { type: "string" },
          description: "Certificaciones o cursos relevantes (BLS, ACLS, etc.)",
        },
      },
      required: ["specialty"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "text requerido" }), {
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
              "Eres un asistente que estructura información de profesionales de la salud en Colombia. " +
              "Extrae los campos solicitados a partir del texto del usuario. " +
              "Si una tarifa se da en miles ('25 mil'), conviértela a número. " +
              "Si no se menciona algo, omítelo. NO inventes datos.",
          },
          { role: "user", content: text },
        ],
        tools: [TOOL],
        tool_choice: {
          type: "function",
          function: { name: "save_professional_profile" },
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
      return new Response(JSON.stringify({ error: "Error del servicio IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      return new Response(JSON.stringify({ profile: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const profile = JSON.parse(call.function.arguments || "{}");
    return new Response(JSON.stringify({ profile }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("onboarding-extractor error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
