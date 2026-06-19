// Asistente IA para el onboarding familiar.
// Recibe un texto libre o JSON parcial y devuelve campos estructurados:
// fullName, idNumber, phone, city, defaultAddress, emergencyName,
// emergencyPhone, patientName, patientRelation, patientAge, careHints[].
// También sugiere un "siguiente paso inteligente" según el contexto.
// verify_jwt=true en config.toml + validación de usuario adentro como
// defensa en profundidad.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { requireUser, buildCorsHeaders } from "../_shared/auth.ts";

const SYSTEM = `Eres el asistente de onboarding de Humanix Colombia.
Recibes texto libre y/o un JSON parcial con datos de una familia que necesita
contratar un cuidador o profesional de la salud.

Devuelve SIEMPRE el resultado llamando a la función "fill_family_profile".
Reglas:
- Normaliza nombres a Capitalización (ej: "maria garcia" -> "María García").
- Cédula: solo dígitos, sin puntos.
- Teléfono Colombia: 10 dígitos, sin prefijo país, sin espacios.
- Ciudad: usa el nombre oficial colombiano más cercano (Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga, Pereira, Manizales, etc.).
- Edad del paciente: número entero entre 0 y 120.
- careHints: 2 a 5 frases CORTAS (max 60 chars) con tips o señales útiles deducidas del texto (ej: "Paciente requiere movilidad asistida", "Buscar enfermero/a con experiencia en adulto mayor").
- nextStepHint: una frase de menos de 100 chars con la siguiente acción recomendada para la familia.
- patientSummary: un párrafo MUY breve (MÁXIMO 200 chars, idealmente 160) que describa al paciente con la estructura: "<Nombre>, <edad> · <diagnóstico>. Necesita <necesidad>. Recomendado: <1 recomendación>." Si faltan datos, omite naturalmente. NUNCA superes 200 caracteres.
- Si un campo no se puede inferir, devuélvelo como string vacío "" (no null).
`;

const TOOL = {
  type: "function",
  function: {
    name: "fill_family_profile",
    description: "Devuelve campos estructurados del perfil familiar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        fullName: { type: "string" },
        idNumber: { type: "string" },
        phone: { type: "string" },
        city: { type: "string" },
        defaultAddress: { type: "string" },
        emergencyName: { type: "string" },
        emergencyPhone: { type: "string" },
        patientName: { type: "string" },
        patientRelation: { type: "string" },
        patientAge: { type: "integer", minimum: 0, maximum: 120 },
        careHints: { type: "array", items: { type: "string" }, maxItems: 5 },
        patientSummary: {
          type: "string",
          description:
            "Resumen muy breve del paciente (máx 240 chars): nombre, edad, diagnóstico, necesidad, recomendación.",
        },
        suggestedSpecialty: {
          type: "string",
          description:
            "Especialidad sugerida del profesional ideal (ej: Auxiliar de enfermería, Enfermería, Cuidado adulto mayor, Cuidado infantil).",
        },
        suggestedHourlyRateCop: {
          type: "integer",
          description:
            "Tarifa por hora estimada en COP para Colombia (rango realista 10000 a 60000).",
        },
        nextStepHint: { type: "string" },
      },
      required: ["fullName", "phone", "city", "careHints", "nextStepHint"],
    },
  },
};

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { freeText = "", partial = {} } = await req.json().catch(() => ({}));
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY no configurado");

    const userMsg = `Texto libre del usuario:
"""${freeText || "(vacío)"}"""

Datos parciales ya capturados:
${JSON.stringify(partial, null, 2)}

Completa lo que puedas inferir con alta confianza y deja en "" lo que no.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "fill_family_profile" } },
      }),
    });

    if (resp.status === 429) {
      return new Response(
        JSON.stringify({ error: "Demasiadas solicitudes, intenta en un minuto." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "Sin créditos en Lovable AI." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      throw new Error(`AI gateway error ${resp.status}`);
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};

    return new Response(JSON.stringify({ ok: true, data: args }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("family-onboarding-ai error:", e);
    return new Response(
      JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
