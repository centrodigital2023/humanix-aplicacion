// bootstrap-superadmin — asigna el rol superadmin al usuario autenticado.
// Protegido por SUPERADMIN_BOOTSTRAP_SECRET en el env de Supabase.
// Solo funciona si NO existe ningún superadmin (evita escalada de privilegios).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders, requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 1) Verificar sesión
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  // 2) Verificar secreto de bootstrap
  const body = await req.json().catch(() => ({}));
  const secret = Deno.env.get("SUPERADMIN_BOOTSTRAP_SECRET");
  if (!secret || body.secret !== secret) {
    return new Response(JSON.stringify({ error: "Secreto inválido" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // 3) Verificar que no exista ningún superadmin aún
  const { count } = await admin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "superadmin");

  if ((count ?? 0) > 0) {
    // Ya existe superadmin — solo el propio superadmin puede agregar más desde el panel
    return new Response(
      JSON.stringify({
        error: "Ya existe un superadmin. Usa el panel de invitaciones para agregar más.",
      }),
      { status: 409, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // 4) Asignar rol superadmin
  const { error } = await admin.from("user_roles").upsert(
    { user_id: userId, role: "superadmin" },
    { onConflict: "user_id,role" },
  );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, message: "Rol superadmin asignado. Recarga la página." }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
