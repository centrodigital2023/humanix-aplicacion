// Lógica de servidor de PQRS (radicación pública, consulta de estado y borrador con IA).
// Vive aparte de `pqrs.functions.ts` por dos razones: no viaja al navegador y se puede probar con
// Vitest inyectando el cliente de base de datos, los encabezados y la configuración de IA.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clientIp } from "./clientIp";
import {
  detectSafetySignals,
  isValidRadicado,
  legalDueAt,
  validateIntake,
  type SafetySignals,
} from "./pqrsRules";
import {
  applySafetyFloor,
  classifyWithAi,
  draftReplyWithAi,
  type AiConfig,
  type ReplyDraft,
} from "./pqrsAi";

// Columnas y tablas de PQRS más nuevas que los tipos generados: se usa el cliente sin tipar.
export type Db = SupabaseClient;

export interface PqrsDeps {
  admin: Db;
  /** Lee un encabezado de la petición actual (minúsculas). */
  header: (name: string) => string | undefined;
  /** Sal para los hashes de IP y contacto (nunca se guarda la IP ni el correo en claro). */
  salt: string | undefined;
  ai: AiConfig;
}

const MAX_BODY_CHARS = 20_000;
const HOURLY_DRAFT_LIMIT = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMERGENCY_CATEGORIES = new Set([
  "medical_emergency",
  "physical_harm",
  "self_harm",
  "harassment",
]);

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Registro de ejecución para observabilidad. Nunca rompe la acción principal. */
async function logExec(
  admin: Db,
  entry: {
    fn: string;
    status: "success" | "error" | "rejected" | "blocked";
    startedAt: number;
    executionId?: string;
    errorCode?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("function_execution_logs").insert({
      function_name: entry.fn,
      trigger_type: "frontend",
      status: entry.status,
      execution_id: entry.executionId ?? null,
      duration_ms: Date.now() - entry.startedAt,
      error_code: entry.errorCode ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch {
    /* el registro nunca debe romper la acción */
  }
}

async function overLimit(
  admin: Db,
  column: "ip_hash" | "contact_hash",
  hash: string,
  action: string,
  limit: number,
): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("pqrs_intake_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, hash)
    .eq("action", action)
    .gte("created_at", since);
  return (count ?? 0) >= limit;
}

async function notifyStaff(admin: Db, radicado: string, safety: SafetySignals): Promise<void> {
  const { data: staff } = await admin
    .from("user_roles")
    .select("user_id")
    .in("role", ["superadmin", "hr_staff"])
    .limit(20);
  const ids = [...new Set((staff ?? []).map((r: { user_id: string }) => r.user_id))];
  if (!ids.length) return;
  await admin.from("notifications").insert(
    ids.map((user_id) => ({
      user_id,
      type: "pqrs_critical",
      title: `PQRS prioritario ${radicado}`,
      body: safety.categories.length
        ? `Señales detectadas: ${safety.categories.join(", ")}. Revisa la cola de PQRS.`
        : "Prioridad urgente según la clasificación. Revisa la cola de PQRS.",
      link: "/superadmin/marketplace",
    })),
  );
}

// ─── Radicar ─────────────────────────────────────────────────────────────────

export type SubmitPqrsResult =
  | {
      ok: true;
      accepted: false;
      radicado: string;
      due_at: string;
      received_at: string;
      emergency_notice: boolean;
    }
  | { ok: true; accepted: true }
  | { ok: false; error: "validation" | "rate_limited" | "too_large" | "server"; fields?: string[] };

export async function handleSubmit(data: unknown, deps: PqrsDeps): Promise<SubmitPqrsResult> {
  const startedAt = Date.now();
  if (JSON.stringify(data ?? null).length > MAX_BODY_CHARS)
    return { ok: false, error: "too_large" };

  const v = validateIntake(data);
  if (!v.ok) return { ok: false, error: "validation", fields: v.errors };

  const { admin, header, salt } = deps;
  if (!salt) {
    console.error("[submitPqrs] falta SUPABASE_SERVICE_ROLE_KEY");
    return { ok: false, error: "server" };
  }
  const ipHash = await sha256Hex(`${salt}:ip:${clientIp(header)}`);

  try {
    if (v.honeypot) {
      await admin.from("pqrs_intake_attempts").insert({ ip_hash: ipHash, action: "create" });
      return { ok: true, accepted: true }; // los bots creen que funcionó
    }

    const contactHash = await sha256Hex(`${salt}:contact:${v.value.email}`);
    if (
      (await overLimit(admin, "ip_hash", ipHash, "create", 5)) ||
      (await overLimit(admin, "contact_hash", contactHash, "create", 3))
    ) {
      await logExec(admin, {
        fn: "pqrs-intake",
        status: "rejected",
        startedAt,
        errorCode: "rate_limited",
      });
      return { ok: false, error: "rate_limited" };
    }
    await admin
      .from("pqrs_intake_attempts")
      .insert({ ip_hash: ipHash, contact_hash: contactHash, action: "create" });
    if (Math.random() < 0.02) {
      await admin
        .from("pqrs_intake_attempts")
        .delete()
        .lt("created_at", new Date(Date.now() - 48 * 3_600_000).toISOString());
    }

    // Si quien escribe tiene sesión, se vincula su cuenta; sin sesión simplemente no hay usuario.
    let userId: string | null = null;
    const authHeader = header("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const { data: u } = await admin.auth.getUser(authHeader.slice(7));
      userId = u?.user?.id ?? null;
    }

    const safety = detectSafetySignals(`${v.value.subject}\n${v.value.description}`);
    const dueAt = legalDueAt(Date.now(), v.value.type);

    const { data: ticket, error } = await admin
      .from("pqrs_tickets")
      .insert({
        user_id: userId,
        contact_email: v.value.email,
        contact_phone: v.value.phone,
        contact_name: v.value.name,
        type: v.value.type,
        subject: v.value.subject,
        description: v.value.description,
        status: "open",
        channel: "web",
        due_at: dueAt.toISOString(),
        safety_level: safety.level,
        safety_categories: safety.categories,
        consent_data_processing: true,
        ai_priority:
          safety.level === "critical" ? "urgent" : safety.level === "review" ? "high" : null,
      })
      .select("id, radicado, due_at, created_at")
      .single();

    if (error || !ticket) {
      console.error("[submitPqrs] insert falló:", error?.code);
      await logExec(admin, {
        fn: "pqrs-intake",
        status: "error",
        startedAt,
        errorCode: error?.code ?? "insert_failed",
      });
      return { ok: false, error: "server" };
    }

    // Lo crítico se avisa de inmediato, sin esperar a la IA.
    let notified = false;
    if (safety.level === "critical") {
      await notifyStaff(admin, ticket.radicado, safety).catch(() => undefined);
      notified = true;
    }

    // La clasificación con IA es un extra: con tiempo límite corto y sin hacer fallar la radicación.
    try {
      const out = await classifyWithAi(v.value.subject, v.value.description, deps.ai, 6_000);
      if (out.ok) {
        const c = applySafetyFloor(out.value, safety.level);
        await admin
          .from("pqrs_tickets")
          .update({
            ai_category: c.topic,
            ai_priority: c.priority,
            ai_sentiment: c.sentiment,
            ai_summary: c.summary,
          })
          .eq("id", ticket.id);
        if (c.priority === "urgent" && !notified) {
          await notifyStaff(admin, ticket.radicado, safety).catch(() => undefined);
        }
      }
    } catch (e) {
      console.error("[submitPqrs] clasificación:", (e as Error).message);
    }

    await logExec(admin, {
      fn: "pqrs-intake",
      status: "success",
      startedAt,
      metadata: { type: v.value.type, safety: safety.level, authenticated: Boolean(userId) },
    });
    return {
      ok: true,
      accepted: false,
      radicado: ticket.radicado,
      due_at: ticket.due_at,
      received_at: ticket.created_at,
      emergency_notice: safety.categories.some((c) => EMERGENCY_CATEGORIES.has(c)),
    };
  } catch (e) {
    console.error("[submitPqrs]", (e as Error).message);
    await logExec(admin, { fn: "pqrs-intake", status: "error", startedAt, errorCode: "internal" });
    return { ok: false, error: "server" };
  }
}

// ─── Consultar estado ────────────────────────────────────────────────────────

export type PqrsStatusResult =
  | { ok: true; found: false }
  | {
      ok: true;
      found: true;
      radicado: string;
      status: string;
      type: string;
      created_at: string;
      due_at: string | null;
      resolved_at: string | null;
      resolution: string | null;
    }
  | { ok: false; error: "validation" | "rate_limited" | "server" };

const statusInput = z.object({ radicado: z.string().max(40), email: z.string().max(254) });

export async function handleStatus(data: unknown, deps: PqrsDeps): Promise<PqrsStatusResult> {
  const parsed = statusInput.safeParse(data);
  const radicado = parsed.success ? parsed.data.radicado.trim().toUpperCase() : "";
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
  if (!isValidRadicado(radicado) || !EMAIL_RE.test(email))
    return { ok: false, error: "validation" };

  const { admin, header, salt } = deps;
  if (!salt) return { ok: false, error: "server" };
  const ipHash = await sha256Hex(`${salt}:ip:${clientIp(header)}`);

  try {
    if (await overLimit(admin, "ip_hash", ipHash, "status", 20))
      return { ok: false, error: "rate_limited" };
    await admin.from("pqrs_intake_attempts").insert({ ip_hash: ipHash, action: "status" });

    const { data: row } = await admin
      .from("pqrs_tickets")
      .select("radicado,status,type,created_at,due_at,resolved_at,resolution,contact_email")
      .eq("radicado", radicado)
      .maybeSingle();
    // Comparación exacta en código (nunca ILIKE con datos del usuario: «%» sería un comodín).
    if (!row || (row.contact_email ?? "").toLowerCase() !== email)
      return { ok: true, found: false };
    const closed = row.status === "resolved" || row.status === "closed";
    return {
      ok: true,
      found: true,
      radicado: row.radicado,
      status: row.status,
      type: row.type,
      created_at: row.created_at,
      due_at: row.due_at,
      resolved_at: row.resolved_at,
      resolution: closed ? row.resolution : null,
    };
  } catch (e) {
    console.error("[lookupPqrsStatus]", (e as Error).message);
    return { ok: false, error: "server" };
  }
}

// ─── Borrador de respuesta (solo staff) ──────────────────────────────────────

export type DraftReplyError =
  | "invalid"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "no_credits"
  | "not_configured"
  | "timeout"
  | "ai_failed"
  | "server";

export type DraftReplyResult =
  | { ok: true; draft: ReplyDraft }
  | { ok: false; error: DraftReplyError; message: string };

const MESSAGES: Record<DraftReplyError, string> = {
  invalid: "ticket_id inválido",
  forbidden: "No autorizado",
  not_found: "Ticket no encontrado",
  rate_limited: "Límite de borradores por hora alcanzado",
  no_credits: "Créditos IA agotados",
  not_configured: "La IA no está configurada",
  timeout: "La IA no respondió a tiempo",
  ai_failed: "La IA no respondió",
  server: "Error interno. Inténtalo de nuevo.",
};
const fail = (error: DraftReplyError): DraftReplyResult => ({
  ok: false,
  error,
  message: MESSAGES[error],
});

export async function handleDraft(
  data: unknown,
  userId: string,
  deps: Pick<PqrsDeps, "admin" | "ai">,
): Promise<DraftReplyResult> {
  const startedAt = Date.now();
  const parsed = z.object({ ticket_id: z.string().uuid() }).safeParse(data);
  if (!parsed.success) return fail("invalid");
  const { admin } = deps;

  try {
    const { data: isStaff } = await admin.rpc("is_staff", { _user_id: userId });
    if (isStaff !== true) return fail("forbidden");

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await admin
      .from("ai_credits_ledger")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("feature", "pqrs-assistant")
      .gte("created_at", since);
    if ((count ?? 0) >= HOURLY_DRAFT_LIMIT) return fail("rate_limited");

    const { data: ticket } = await admin
      .from("pqrs_tickets")
      .select("id, radicado, subject, description, type, due_at, ai_summary")
      .eq("id", parsed.data.ticket_id)
      .maybeSingle();
    if (!ticket) return fail("not_found");

    const out = await draftReplyWithAi(ticket, deps.ai);
    if (!out.ok) {
      await logExec(admin, {
        fn: "pqrs-assistant",
        status: "error",
        startedAt,
        executionId: userId,
        errorCode: out.reason,
      });
      return fail(
        out.reason === "rate_limited"
          ? "rate_limited"
          : out.reason === "no_credits"
            ? "no_credits"
            : out.reason === "not_configured"
              ? "not_configured"
              : out.reason === "timeout"
                ? "timeout"
                : "ai_failed",
      );
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
      .insert({ user_id: userId, feature: "pqrs-assistant", credits_used: 1 });
    await logExec(admin, {
      fn: "pqrs-assistant",
      status: out.value.flagged ? "blocked" : "success",
      startedAt,
      executionId: userId,
      metadata: { escalate: out.value.escalate },
    });
    return { ok: true, draft: out.value };
  } catch (e) {
    console.error("[draftPqrsReply]", (e as Error).message);
    await logExec(admin, {
      fn: "pqrs-assistant",
      status: "error",
      startedAt,
      executionId: userId,
      errorCode: "internal",
    });
    return fail("server");
  }
}
