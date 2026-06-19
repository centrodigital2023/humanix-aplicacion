// Humanix Assistant — chat IA con streaming (SSE) usando Lovable AI Gateway.
// Acepta { messages, persona } y devuelve un stream OpenAI-compat.

import { corsHeaders, requireUser } from "../_shared/auth.ts";

// Simple in-memory IP rate limiter (per edge function instance).
// Protege de abuso anónimo que dispararía costos del Lovable AI gateway.
const HITS = new Map<string, { count: number; ts: number }>();
const WINDOW_MS = 60_000; // 1 min
const MAX_HITS = 12;      // 12 mensajes / min / IP

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.ts > WINDOW_MS) {
    HITS.set(ip, { count: 1, ts: now });
    return false;
  }
  rec.count += 1;
  if (rec.count > MAX_HITS) return true;
  return false;
}

const SYSTEM_BY_PERSONA: Record<string, string> = {
  professional:
    "Eres Humanix Assistant, un coach IA para profesionales de la salud en Colombia (enfermeros, auxiliares, cuidadores). " +
    "Hablas en español neutro, cálido y directo. Ayudas a: 1) preparar entrevistas con familias e IPS, " +
    "2) resumir historiales clínicos en 5 puntos accionables (sin inventar datos), " +
    "3) sugerir cómo presentar experiencia y certificaciones para subir el Trust Score, " +
    "4) explicar trámites RETHUS y buenas prácticas de seguridad. " +
    "Responde en Markdown, máximo 5 viñetas o 250 palabras salvo que pidan explícitamente más detalle.",
  family:
    "Eres Humanix Assistant para familias colombianas que buscan cuidado en casa. " +
    "Recomienda perfiles según necesidades (adulto mayor, postoperatorio, pediátrico), " +
    "explica modalidades (hora/jornada/mes) y aclara dudas sobre verificación RETHUS y seguridad. " +
    "Responde en español, cálido, en Markdown corto.",
  institution:
    "Eres Humanix Assistant para clínicas e IPS. Ayudas a redactar ofertas de turno claras, " +
    "calcular tarifas competitivas en COP y filtrar requisitos legales (RETHUS, cursos vigentes). " +
    "Responde en español, profesional, en Markdown corto.",
  default:
    "Eres Humanix Assistant, asistente IA del marketplace de talento humano en salud de Colombia. " +
    "Responde en español, cálido y conciso. Markdown.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Require authenticated Supabase user — evita abuso anónimo del gateway IA.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  // Rate limit por user_id (estable y no spoofable como x-forwarded-for).
  if (rateLimited(auth.userId)) {
    return new Response(
      JSON.stringify({ error: "Demasiadas solicitudes. Intenta en un minuto." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { messages, persona } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Límite defensivo: evita payloads gigantes que disparen tokens.
    const totalChars = messages.reduce(
      (n: number, m: { content?: string }) => n + (m.content?.length ?? 0),
      0,
    );
    if (messages.length > 30 || totalChars > 12_000) {
      return new Response(
        JSON.stringify({ error: "Conversación demasiado larga. Reinicia el chat." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const system = SYSTEM_BY_PERSONA[persona as string] ?? SYSTEM_BY_PERSONA.default;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return new Response(
          JSON.stringify({ error: "Demasiadas solicitudes. Intenta en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (upstream.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos IA agotados. Recarga en Configuración." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await upstream.text();
      console.error("Gateway error:", upstream.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(upstream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("humanix-assistant error:", e);
    return new Response(
      JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
