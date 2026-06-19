// chat-copilot — sugerencias de respuesta para el chat 1:1.
// Recibe { conversation_id, role_hint } y devuelve { suggestions: string[] }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "reply_suggestions",
    description: "Devuelve 3 respuestas breves, cordiales y útiles que el usuario podría enviar.",
    parameters: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: ["suggestions"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) throw new Error("conversation_id requerido");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: conv } = await admin
      .from("conversations")
      .select("id, poster_id, professional_id")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) throw new Error("Conversación no encontrada");
    if (conv.poster_id !== auth.userId && conv.professional_id !== auth.userId) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const role =
      auth.userId === conv.professional_id ? "profesional de salud" : "familia/IPS contratante";

    // Consumir 1 crédito IA antes de invocar el modelo: valida el cupo mensual
    // según el plan del usuario y registra el gasto de forma atómica.
    const { error: creditsErr } = await admin.rpc("consume_ai_credits", {
      p_user_id: auth.userId,
      p_feature: "chat-copilot",
      p_amount: 1,
    });
    if (creditsErr) {
      if (creditsErr.message?.includes("ai_credits_exhausted")) {
        return new Response(
          JSON.stringify({ error: "Créditos IA agotados para este mes. Mejora tu plan para obtener más." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw creditsErr;
    }

    const { data: msgs } = await admin
      .from("messages")
      .select("sender_id,content,created_at,is_ai_suggestion")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const conversation = (msgs ?? [])
      .filter((m) => !m.is_ai_suggestion)
      .map((m) => `${m.sender_id === auth.userId ? "YO" : "OTRA PARTE"}: ${m.content}`)
      .join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              `Eres un copiloto de comunicación para Humanix (cuidado humano en Colombia). ` +
              `Sugiere 3 respuestas breves (máx 25 palabras cada una), cálidas, profesionales y accionables que el usuario actual (${role}) podría enviar. ` +
              `Evita prometer cosas que no se han dicho. Español neutro colombiano.`,
          },
          {
            role: "user",
            content: `Conversación hasta ahora:\n${conversation || "(vacía)"}\n\nDame 3 respuestas para enviar yo.`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "reply_suggestions" } },
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
      throw new Error("Error IA");
    }
    const aiData = await aiResp.json();
    const call = aiData.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = call ? JSON.parse(call.function.arguments || "{}") : { suggestions: [] };

    return new Response(JSON.stringify({ suggestions: parsed.suggestions ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-copilot error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
