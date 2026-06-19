// pqrs-classifier — clasifica tickets PQRS con Gemini (categoría, prioridad, sentimiento, resumen).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "classify_pqrs",
    description: "Clasifica un ticket PQRS",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "queja|reclamo|peticion|sugerencia|denuncia|consulta",
        },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative", "very_negative"] },
        summary: { type: "string", description: "Resumen ≤120 chars" },
      },
      required: ["category", "priority", "sentiment", "summary"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { ticket_id } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ticket } = await admin
      .from("pqrs_tickets")
      .select("*")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) {
      return new Response(JSON.stringify({ error: "Ticket no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Autorización: solo el dueño del ticket o staff puede clasificar.
    const { data: staffRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .in("role", ["superadmin", "hr_staff", "evaluator"])
      .maybeSingle();
    const isStaff = !!staffRow;
    const isOwner = ticket.user_id && ticket.user_id === auth.userId;
    if (!isOwner && !isStaff) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Eres un clasificador de PQRS para una plataforma de salud en Colombia. Identifica intención, urgencia y sentimiento.",
          },
          {
            role: "user",
            content: `Asunto: ${ticket.subject}\n\nDescripción: ${ticket.description}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "classify_pqrs" } },
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
      throw new Error("AI error");
    }

    const data = await aiResp.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = call ? JSON.parse(call.function.arguments || "{}") : null;
    if (!parsed) throw new Error("Sin clasificación");

    await admin
      .from("pqrs_tickets")
      .update({
        ai_category: parsed.category,
        ai_priority: parsed.priority,
        ai_sentiment: parsed.sentiment,
        ai_summary: parsed.summary,
      })
      .eq("id", ticket_id);

    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "pqrs-classifier", credits_used: 1 });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pqrs-classifier error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
