// pqrs-intake — canal público para radicar y consultar PQRS.
//   action "create": valida, limita frecuencia, radica, calcula el plazo y clasifica con IA.
//   action "status": consulta por radicado + correo (sin exponer datos personales).
// Verify JWT desactivado: es un formulario público. Defensas: validación estricta, campo trampa,
// límites por IP y por contacto (solo hashes) y escritura únicamente con service role.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";
import {
  detectSafetySignals,
  isValidRadicado,
  legalDueAt,
  validateIntake,
  type SafetySignals,
} from "../_shared/pqrsRules.ts";
import { applySafetyFloor, classifyWithAi } from "../_shared/pqrsAi.ts";
import { logExecution } from "../_shared/execLog.ts";

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

const MAX_BODY_CHARS = 20_000;
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

async function overLimit(
  admin: SupabaseClient,
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

async function notifyStaff(admin: SupabaseClient, radicado: string, safety: SafetySignals) {
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

async function postProcess(
  admin: SupabaseClient,
  ticket: { id: string; radicado: string },
  input: { subject: string; description: string },
  safety: SafetySignals,
) {
  let urgent = safety.level === "critical";
  const out = await classifyWithAi(input.subject, input.description);
  if (out.ok) {
    const c = applySafetyFloor(out.value, safety.level);
    urgent = urgent || c.priority === "urgent";
    await admin
      .from("pqrs_tickets")
      .update({
        ai_category: c.topic,
        ai_priority: c.priority,
        ai_sentiment: c.sentiment,
        ai_summary: c.summary,
      })
      .eq("id", ticket.id);
  }
  if (urgent) await notifyStaff(admin, ticket.radicado, safety);
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const startedAt = Date.now();
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_CHARS) return json({ ok: false, error: "too_large" }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !srk) return json({ ok: false, error: "server_config" }, 500);
  const admin = createClient(url, srk, { auth: { persistSession: false } });

  const action = (raw as { action?: string } | null)?.action === "status" ? "status" : "create";
  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const ipHash = await sha256Hex(`${srk}:ip:${ip}`);

  try {
    // ── Consulta de estado ────────────────────────────────────────────────
    if (action === "status") {
      const b = raw as { radicado?: unknown; email?: unknown };
      const radicado = typeof b.radicado === "string" ? b.radicado.trim().toUpperCase() : "";
      const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
      if (!isValidRadicado(radicado) || !EMAIL_RE.test(email))
        return json({ ok: false, error: "validation" }, 422);
      if (await overLimit(admin, "ip_hash", ipHash, "status", 20))
        return json({ ok: false, error: "rate_limited" }, 429);
      await admin.from("pqrs_intake_attempts").insert({ ip_hash: ipHash, action: "status" });

      const { data } = await admin
        .from("pqrs_tickets")
        .select("radicado,status,type,created_at,due_at,resolved_at,resolution,contact_email")
        .eq("radicado", radicado)
        .maybeSingle();
      // Comparación exacta en código (nunca ILIKE con datos del usuario: «%» sería un comodín).
      if (!data || (data.contact_email ?? "").toLowerCase() !== email)
        return json({ ok: true, found: false });
      const closed = data.status === "resolved" || data.status === "closed";
      return json({
        ok: true,
        found: true,
        radicado: data.radicado,
        status: data.status,
        type: data.type,
        created_at: data.created_at,
        due_at: data.due_at,
        resolved_at: data.resolved_at,
        resolution: closed ? data.resolution : null,
      });
    }

    // ── Radicación ────────────────────────────────────────────────────────
    const v = validateIntake(raw);
    if (!v.ok) return json({ ok: false, error: "validation", fields: v.errors }, 422);

    if (v.honeypot) {
      await admin.from("pqrs_intake_attempts").insert({ ip_hash: ipHash, action: "create" });
      return json({ ok: true, accepted: true }, 202); // los bots creen que funcionó
    }

    const contactHash = await sha256Hex(`${srk}:contact:${v.value.email}`);
    if (
      (await overLimit(admin, "ip_hash", ipHash, "create", 5)) ||
      (await overLimit(admin, "contact_hash", contactHash, "create", 3))
    ) {
      await logExecution({
        functionName: "pqrs-intake",
        triggerType: "frontend",
        status: "rejected",
        startedAt,
        errorCode: "rate_limited",
      });
      return json({ ok: false, error: "rate_limited" }, 429);
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

    // Si quien escribe tiene sesión, se vincula su cuenta; con la llave anónima simplemente no hay usuario.
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const { data } = await admin.auth.getUser(authHeader.slice(7));
      userId = data?.user?.id ?? null;
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
      console.error("[pqrs-intake] insert failed:", error?.code);
      await logExecution({
        functionName: "pqrs-intake",
        triggerType: "frontend",
        status: "error",
        startedAt,
        errorCode: error?.code ?? "insert_failed",
      });
      return json({ ok: false, error: "server" }, 500);
    }

    // La clasificación con IA no debe retrasar la respuesta ni hacer fallar la radicación.
    const background = postProcess(admin, ticket, v.value, safety).catch((e) =>
      console.error("[pqrs-intake] postProcess:", (e as Error).message),
    );
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil)
      EdgeRuntime.waitUntil(background);
    else await background;

    await logExecution({
      functionName: "pqrs-intake",
      triggerType: "frontend",
      status: "success",
      startedAt,
      metadata: { type: v.value.type, safety: safety.level, authenticated: Boolean(userId) },
    });
    return json(
      {
        ok: true,
        radicado: ticket.radicado,
        due_at: ticket.due_at,
        received_at: ticket.created_at,
        emergency_notice: safety.categories.some((c) => EMERGENCY_CATEGORIES.has(c)),
      },
      201,
    );
  } catch (e) {
    console.error("[pqrs-intake]", (e as Error).message);
    await logExecution({
      functionName: "pqrs-intake",
      triggerType: "frontend",
      status: "error",
      startedAt,
      errorCode: "internal",
    });
    return json({ ok: false, error: "server" }, 500);
  }
});
