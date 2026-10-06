// delete-account — self-service hard delete.
// El usuario autenticado llama esta función para eliminarse completamente.
// Usa service role para borrar TODOS sus datos y la cuenta auth.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 1) Verificar sesión del solicitante
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const userId = auth.userId;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Service role no configurado" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const summary: Record<string, unknown> = { user_id: userId };

  // ── 2) Storage: archivos del usuario ────────────────────────────────────

  const buckets: [string, string][] = [
    ["professional-docs", userId],
    ["family-docs",        userId],
    ["institution-docs",   userId],
    ["avatars",            userId],
  ];

  for (const [bucket, prefix] of buckets) {
    try {
      const { data: files } = await admin.storage.from(bucket).list(prefix, { limit: 200 });
      if (files && files.length > 0) {
        const paths = files.map((f) => `${prefix}/${f.name}`);
        const { error } = await admin.storage.from(bucket).remove(paths);
        summary[`storage_${bucket}`] = error ? `error: ${error.message}` : `${paths.length} eliminados`;
      }
    } catch (e) {
      summary[`storage_${bucket}_error`] = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 3) Tablas de dominio — orden importa para FKs ──────────────────────
  // Mensajes
  const domainTables: string[] = [
    "notifications",
    "messages",
    "ratings",
    "care_feed_entries",
    "family_needs",
    "service_bookings",
    "applications",
    "job_offers",
    "profile_embeddings",
    "mp_subscriptions",
    "professional_documents",
    "professional_references",
    "professional_profiles",
    "family_documents",
    "family_profiles",
    "institution_profiles",
    "user_roles",
  ];

  for (const table of domainTables) {
    try {
      // Tablas con columna user_id
      const colUser = [
        "notifications", "messages", "ratings", "care_feed_entries",
        "family_needs", "profile_embeddings", "mp_subscriptions",
        "professional_documents", "professional_references", "professional_profiles",
        "family_documents", "family_profiles", "institution_profiles", "user_roles",
      ];
      // Tablas con posted_by / client_id / professional_id
      if (table === "job_offers") {
        const { error } = await admin.from(table as never).delete().eq("posted_by", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      } else if (table === "applications") {
        await admin.from(table as never).delete().eq("professional_id", userId);
        const { error } = await admin.from(table as never).delete().eq("posted_by", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      } else if (table === "service_bookings") {
        await admin.from(table as never).delete().eq("professional_id", userId);
        const { error } = await admin.from(table as never).delete().eq("client_id", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      } else if (table === "messages") {
        const { error } = await admin.from(table as never).delete().eq("sender_id", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      } else if (table === "ratings") {
        await admin.from(table as never).delete().eq("rated_by", userId);
        const { error } = await admin.from(table as never).delete().eq("rated_user_id", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      } else if (colUser.includes(table)) {
        const { error } = await admin.from(table as never).delete().eq("user_id", userId);
        summary[table] = error ? `error: ${error.message}` : "ok";
      }
    } catch (e) {
      summary[`${table}_error`] = e instanceof Error ? e.message : String(e);
    }
  }

  // ── 4) Perfil público ────────────────────────────────────────────────────
  try {
    await admin.from("profiles").delete().eq("user_id", userId);
    summary["profiles"] = "ok";
  } catch (e) {
    summary["profiles_error"] = e instanceof Error ? e.message : String(e);
  }

  // ── 5) Audit log (best-effort, antes de borrar auth) ────────────────────
  try {
    await admin.rpc("log_audit", {
      _action: "user.self_deleted",
      _resource_type: "auth_user",
      _resource_id: userId,
      _severity: "warn",
      _meta: summary,
    });
  } catch { /* ignore */ }

  // ── 6) Borrar cuenta auth (hard delete, irreversible) ───────────────────
  const { error: authErr } = await admin.auth.admin.deleteUser(userId);
  if (authErr) {
    // No es bloqueante — los datos ya están borrados; sólo reportamos.
    summary["auth_error"] = authErr.message;
    return new Response(
      JSON.stringify({ ok: false, error: authErr.message, summary }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  summary["auth_user_deleted"] = true;

  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
