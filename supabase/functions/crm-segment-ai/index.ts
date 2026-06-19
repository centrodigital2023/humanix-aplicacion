// crm-segment-ai — segmenta un contacto CRM (segmento, lead score, sentimiento, resumen).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, requireUser } from "../_shared/auth.ts";

const TOOL = {
  type: "function",
  function: {
    name: "segment_contact",
    description: "Segmenta un contacto CRM y calcula su lead score",
    parameters: {
      type: "object",
      properties: {
        segment: {
          type: "string",
          description: "hot_lead|warm_lead|cold_lead|customer|churn_risk|partner|other",
        },
        lead_score: { type: "number", description: "0-100" },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
        summary: { type: "string", description: "≤180 chars" },
        recommended_action: { type: "string", description: "Próxima acción ≤80 chars" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["segment", "lead_score", "sentiment", "summary", "recommended_action", "tags"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { contact_id } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId);
    const isStaff = (roles ?? []).some((r) =>
      ["superadmin", "hr_staff", "evaluator"].includes(r.role),
    );
    if (!isStaff) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: contact } = await admin
      .from("crm_contacts")
      .select("*")
      .eq("id", contact_id)
      .maybeSingle();
    if (!contact) {
      return new Response(JSON.stringify({ error: "Contacto no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: interactions } = await admin
      .from("crm_interactions")
      .select("type,subject,body,created_at,direction")
      .eq("contact_id", contact_id)
      .order("created_at", { ascending: false })
      .limit(20);

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
              "Eres analista CRM senior. Segmenta contactos y prioriza leads para una plataforma de salud en Colombia.",
          },
          {
            role: "user",
            content: `CONTACTO:\n${JSON.stringify(
              {
                nombre: contact.full_name,
                email: contact.email,
                phone: contact.phone,
                city: contact.city,
                source: contact.source,
                tags: contact.tags,
                notes: contact.notes,
                last_contacted_at: contact.last_contacted_at,
              },
              null,
              2,
            )}\n\nINTERACCIONES (${interactions?.length ?? 0}):\n${JSON.stringify(interactions ?? [], null, 2)}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "segment_contact" } },
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
    if (!parsed) throw new Error("Sin segmentación");

    await admin
      .from("crm_contacts")
      .update({
        segment: parsed.segment,
        lead_score: parsed.lead_score,
        ai_sentiment: parsed.sentiment,
        ai_summary: parsed.summary,
        tags: parsed.tags,
      })
      .eq("id", contact_id);

    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "crm-segment-ai", credits_used: 1 });

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("crm-segment-ai error:", e);
    return new Response(JSON.stringify({ error: "Error interno. Inténtalo de nuevo." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
