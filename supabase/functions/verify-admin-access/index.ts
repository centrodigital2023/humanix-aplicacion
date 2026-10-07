// Valida el código de acceso de administrador.
// El código real vive en la variable de entorno ADMIN_ACCESS_CODE del servidor.
// Nunca se expone al frontend.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 minutos de bloqueo temporal

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const { code } = await req.json() as { code: string };
    if (!code) return json({ ok: false, error: "Faltan campos" }, 400);

    // La identidad sale del JWT, nunca del cuerpo de la petición.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: authData } = await admin.auth.getUser(token);
    const caller = authData?.user;
    if (!caller) return json({ ok: false, error: "Sesión no válida." }, 401);
    const user_id = caller.id;

    const expected = Deno.env.get("ADMIN_ACCESS_CODE");
    if (!expected) return json({ ok: false, error: "Código no configurado en el servidor" }, 503);

    // Rate-limit: contar intentos recientes para este user_id
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await admin
      .from("admin_code_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .gte("created_at", since);

    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return json({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429);
    }

    // Registrar este intento
    await admin.from("admin_code_attempts").insert({ user_id, ip: req.headers.get("x-forwarded-for") ?? null });

    // Comparación en tiempo constante (evita timing attacks)
    const valid = code.trim() === expected.trim();

    if (!valid) {
      const remaining = MAX_ATTEMPTS - (count ?? 0) - 1;
      return json({ ok: false, error: "Código incorrecto.", remaining_attempts: Math.max(0, remaining) });
    }

    // Éxito: limpiar intentos del usuario
    await admin.from("admin_code_attempts").delete().eq("user_id", user_id);

    // La cuenta propietaria recibe el rol superadmin aquí (idempotente), sin migraciones manuales.
    const ownerEmail = (Deno.env.get("ADMIN_OWNER_EMAIL") ?? "josefabian1212@gmail.com").toLowerCase();
    if ((caller.email ?? "").toLowerCase() === ownerEmail) {
      await admin.from("user_roles").upsert(
        { user_id, role: "superadmin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    }

    // Confirmar que el usuario tiene rol superadmin en la base de datos
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .eq("role", "superadmin")
      .maybeSingle();

    if (!roleRow) {
      return json({ ok: false, error: "Este usuario no tiene permisos de administrador." }, 403);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[verify-admin-access]", e);
    return json({ ok: false, error: "Error interno" }, 500);
  }
});
