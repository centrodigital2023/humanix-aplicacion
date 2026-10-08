// pqrs-assistant — borrador de respuesta asistido por IA para el equipo (solo staff).
// La IA propone; una persona revisa, edita y envía. El borrador queda guardado en el ticket para
// medir cuántos se aceptan tal cual y cuántos se editan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";
import { draftReplyWithAi } from "../_shared/pqrsAi.ts";
import { logExecution } from "../_shared/execLog.ts";

const HOURLY_LIMIT = 30;
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

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", auth.userId)
      .in("role", ["superadmin", "hr_staff", "evaluator"])
      .maybeSingle();
    if (!roleRow) return json({ error: "No autorizado" }, 403);

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin
      .from("function_execution_logs")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "pqrs-assistant")
      .eq("execution_id", auth.userId)
      .eq("status", "success")
      .gte("created_at", since);
    if ((count ?? 0) >= HOURLY_LIMIT)
      return json({ error: "Límite de borradores por hora alcanzado" }, 429);

    const { data: ticket } = await admin
      .from("pqrs_tickets")
      .select("id, radicado, subject, description, type, due_at, ai_summary")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) return json({ error: "Ticket no encontrado" }, 404);

    const out = await draftReplyWithAi(ticket);
    if (!out.ok) {
      const status = out.reason === "rate_limited" ? 429 : out.reason === "no_credits" ? 402 : 502;
      const message =
        out.reason === "rate_limited"
          ? "Demasiadas solicitudes a la IA"
          : out.reason === "no_credits"
            ? "Créditos IA agotados"
            : out.reason === "not_configured"
              ? "La IA no está configurada"
              : "La IA no respondió";
      await logExecution({
        functionName: "pqrs-assistant",
        triggerType: "frontend",
        status: "error",
        startedAt,
        executionId: auth.userId,
        errorCode: out.reason,
      });
      return json({ error: message, reason: out.reason }, status);
    }

    // Solo se guarda el borrador si pasó la barrera de seguridad.
    if (!out.value.flagged) {
      await admin
        .from("pqrs_tickets")
        .update({ ai_reply_draft: out.value.body, reply_draft_edited: null })
        .eq("id", ticket.id);
    }
    await admin
      .from("ai_credits_ledger")
      .insert({ user_id: auth.userId, feature: "pqrs-assistant", credits_used: 1 });
    await logExecution({
      functionName: "pqrs-assistant",
      triggerType: "frontend",
      status: out.value.flagged ? "blocked" : "success",
      startedAt,
      executionId: auth.userId,
      metadata: { escalate: out.value.escalate },
    });
    return json({ draft: out.value });
  } catch (e) {
    console.error("[pqrs-assistant]", (e as Error).message);
    await logExecution({
      functionName: "pqrs-assistant",
      triggerType: "frontend",
      status: "error",
      startedAt,
      executionId: auth.userId,
      errorCode: "internal",
    });
    return json({ error: "Error interno. Inténtalo de nuevo." }, 500);
  }
});
