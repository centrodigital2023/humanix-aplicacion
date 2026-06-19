// Analiza un audio de valoración: transcribe + clasifica sentimiento con Gemini.
// Recibe { audio_base64, mime_type } y devuelve { transcript, sentiment, score, summary, alert }.
import { corsHeaders, requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { audio_base64, mime_type } = await req.json();
    if (!audio_base64) {
      return new Response(JSON.stringify({ error: "audio_base64 requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Tope defensivo: ~10 MB binario ≈ 14 MB en base64. Evita ataques DoS/costos IA.
    if (typeof audio_base64 !== "string" || audio_base64.length > 14_000_000) {
      return new Response(JSON.stringify({ error: "audio demasiado grande" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mt = (mime_type as string) || "audio/webm";
    const ALLOWED_AUDIO = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"];
    if (!ALLOWED_AUDIO.some((a) => mt.startsWith(a))) {
      return new Response(JSON.stringify({ error: "mime_type no permitido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const dataUrl = `data:${mt};base64,${audio_base64}`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
              "Eres un asistente que escucha valoraciones de servicios de cuidado en salud en Colombia. " +
              "Transcribe en español neutro y clasifica el sentimiento. Sé estricto: si hay quejas, " +
              "trato inadecuado, demoras graves, alertas de seguridad o incumplimientos, marca alert=true.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe este audio de valoración y devuelve el análisis estructurado.",
              },
              {
                type: "input_audio",
                input_audio: {
                  data: dataUrl,
                  format: mt.includes("mp4") ? "mp4" : mt.includes("webm") ? "webm" : "wav",
                },
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_rating_analysis",
              description: "Devuelve transcripción y análisis de sentimiento.",
              parameters: {
                type: "object",
                properties: {
                  transcript: { type: "string", description: "Transcripción literal en español." },
                  sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                  score: { type: "number", description: "Confianza 0..1 del sentimiento." },
                  summary: { type: "string", description: "Resumen en 1-2 frases." },
                  alert: {
                    type: "boolean",
                    description:
                      "true si hay riesgo, queja grave o señales que requieran revisión del superadmin.",
                  },
                },
                required: ["transcript", "sentiment", "score", "summary", "alert"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_rating_analysis" } },
      }),
    });

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return new Response(
          JSON.stringify({ error: "Demasiadas solicitudes. Intenta en un minuto." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (upstream.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos IA agotados." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await upstream.text();
      console.error("Gateway error:", upstream.status, t);
      return new Response(JSON.stringify({ error: "Error del servicio IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await upstream.json();
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    if (!parsed) throw new Error("Respuesta IA inválida");

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-rating-voice error:", e);
    return new Response(
      JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
