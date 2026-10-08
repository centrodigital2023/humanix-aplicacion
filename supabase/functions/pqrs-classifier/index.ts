// pqrs-classifier — clasifica un ticket PQRS con IA (tema, prioridad, sentimiento, resumen).
// Solo el dueño del ticket o el staff. El texto del ticket se trata como dato no confiable y la
// prioridad nunca queda por debajo de la que fija la red de seguridad determinista.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import { detectSafetySignals } from "../_shared/pqrsRules.ts";
import { applySafetyFloor, classifyWithAi } from "../_shared/pqrsAi.ts";
import { logExecution } from "../_shared/execLog.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  try {
    const { ticket_id } = (await req.json().catch(() => ({}))) as { ticket_id?: string };
    if (!ticket_id || !UUID_RE.test(ticket_id)) return json({ error: "ticket_id inválido" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: ticket } = await admin
      .from("pqrs_tickets")
      .select("id, user_id, subject, description")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) return json({ error: "Ticket no encontrado" }, 404);

    const { data: staffRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .in("role", ["superadmin", "hr_staff", "evaluator"])
      .maybeSingle();
    const isOwner = !!ticket.user_id && ticket.user_id === auth.userId;
    if (!isOwner && !staffRow) return json({ error: "No autorizado" }, 403);

    const safety = detectSafetySignals(`${ticket.subject}\n${ticket.description}`);
    const out = await classifyWithAi(ticket.subject, ticket.description, {
      apiKey: Deno.env.get("LOVABLE_API_KEY"),
      model: Deno.env.get("PQRS_AI_MODEL"),
    });
    if (!out.ok) {
      const status = out.reason === "rate_limited" ? 429 : out.reason === "no_credits" ? 402 : 502;
      const message =
        out.reason === "rate_limited"
          ? "Demasiadas solicitudes"
          : out.reason === "no_credits"
            ? "Créditos IA agotados"
            : out.reason === "not_configured"
              ? "La IA no está configurada"
              : "La IA no respondió";
      await logExecution({
        functionName: "pqrs-classifier",
        triggerType: "frontend",
        status: "error",
        startedAt,
        errorCode: out.reason,
      });
      return json({ error: message, reason: out.reason }, status);
    }

    const c = applySafetyFloor(out.value, safety.level);
    await admin
      .from("pqrs_tickets")
      .update({
        ai_category: c.topic,
        ai_priority: c.priority,
        ai_sentiment: c.sentiment,
        ai_summary: c.summary,
        safety_level: safety.level,
        safety_categories: safety.categories,
      })
      .eq("id", ticket_id);

    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "pqrs-classifier", credits_used: 1 });
    await logExecution({
      functionName: "pqrs-classifier",
      triggerType: "frontend",
      status: "success",
      startedAt,
      metadata: { priority: c.priority, safety: safety.level },
    });

    // `category` se conserva en la respuesta por compatibilidad con clientes anteriores.
    return json({
      category: c.topic,
      topic: c.topic,
      priority: c.priority,
      sentiment: c.sentiment,
      summary: c.summary,
    });
  } catch (e) {
    console.error("pqrs-classifier error:", (e as Error).message);
    await logExecution({
      functionName: "pqrs-classifier",
      triggerType: "frontend",
      status: "error",
      startedAt,
      errorCode: "internal",
    });
    return json({ error: "Error interno. Inténtalo de nuevo." }, 500);
  }
});
