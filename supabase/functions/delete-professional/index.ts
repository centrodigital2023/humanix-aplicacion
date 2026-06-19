// Delete Professional — staff-only hard delete.
// Removes storage files, all related rows, and the auth user (email login).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Service role no configurado" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Check caller is staff (superadmin / hr_staff / evaluator)
  const { data: rolesData, error: rolesErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId);
  if (rolesErr) {
    return new Response(JSON.stringify({ error: rolesErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const staffRoles = new Set(["superadmin", "hr_staff", "evaluator"]);
  const isStaff = (rolesData ?? []).some((r: { role: string }) => staffRoles.has(r.role));
  if (!isStaff) {
    return new Response(JSON.stringify({ error: "Solo staff puede eliminar perfiles" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: { user_id?: string; wipe_account?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const targetId = body.user_id;
  const wipeAccount = !!body.wipe_account;
  if (!targetId) {
    return new Response(JSON.stringify({ error: "Falta user_id" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (targetId === auth.userId) {
    return new Response(JSON.stringify({ error: "No puedes eliminarte a ti mismo" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const summary: Record<string, unknown> = {};

  // 1) Remove storage files in professional-docs/<user_id>/
  try {
    const { data: files } = await admin.storage
      .from("professional-docs")
      .list(targetId, { limit: 1000 });
    if (files && files.length) {
      const paths = files.map((f) => `${targetId}/${f.name}`);
      await admin.storage.from("professional-docs").remove(paths);
      summary.storage_removed = paths.length;
    }
  } catch (e) {
    summary.storage_error = e instanceof Error ? e.message : String(e);
  }

  // 2) Remove avatar (best effort)
  try {
    const { data: avatars } = await admin.storage
      .from("avatars")
      .list(targetId, { limit: 50 });
    if (avatars && avatars.length) {
      await admin.storage
        .from("avatars")
        .remove(avatars.map((f) => `${targetId}/${f.name}`));
    }
  } catch {
    /* ignore */
  }

  // 3) Delete domain rows. Order matters for FKs.
  const tables = [
    "professional_documents",
    "professional_references",
    "profile_embeddings",
    "professional_profiles",
  ];
  for (const t of tables) {
    const { error } = await admin.from(t).delete().eq("user_id", targetId);
    if (error) summary[`${t}_error`] = error.message;
  }

  // 4) Remove professional role (always); other roles only if wiping
  if (wipeAccount) {
    await admin.from("user_roles").delete().eq("user_id", targetId);
  } else {
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", targetId)
      .eq("role", "professional");
  }

  // 5) Optionally remove the auth user (and cascade-deletes profiles row)
  if (wipeAccount) {
    try {
      await admin.from("profiles").delete().eq("user_id", targetId);
    } catch {
      /* ignore */
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
    if (delErr) {
      summary.auth_delete_error = delErr.message;
      return new Response(
        JSON.stringify({ ok: false, error: delErr.message, summary }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    summary.auth_user_deleted = true;
  }

  // 6) Audit log (best effort)
  try {
    await admin.rpc("log_audit", {
      _action: wipeAccount ? "pro.account_wiped" : "pro.profile_deleted",
      _resource_type: "professional_profile",
      _resource_id: targetId,
      _severity: "warn",
      _meta: summary,
    });
  } catch {
    /* ignore */
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});