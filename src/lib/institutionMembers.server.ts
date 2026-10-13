// Lógica de servidor del personal de la institución: crear, editar, suspender, reiniciar contraseña y quitar.
//
// Vive aparte de `institutionMembers.functions.ts` por dos razones: no viaja al navegador y se puede probar con Vitest
// inyectando el cliente de base de datos (con la llave de servicio, que solo existe aquí).
//
// Quién puede: SOLO la cuenta de la institución (rol `institution` en `user_roles`). El personal no tiene roles, así que
// nunca puede administrar al equipo. Para CREAR además se exige el plan IPS Mejorado (`plan_key_for` → institution_monthly,
// que solo puede ejecutar el service role); editar, suspender, reiniciar y quitar siguen disponibles aunque el plan venza
// (siempre se puede cortar un acceso).
//
// Cómo se crea una persona: una cuenta propia de Supabase Auth con un correo sintético (`usuario@staff.humanix.lat`) ya
// confirmado y la marca `signup_kind = institution_staff` (la que reconocen `handle_new_user()` —no le da rol— y el
// disparador de `institution_members`), más su fila de pertenencia. Si la fila falla, la cuenta se borra (no quedan huérfanas).
//
// Qué NO hace: no guarda ni devuelve contraseñas, ni el correo sintético. La contraseña llega por HTTPS, se pasa a Supabase
// Auth y no se registra en ningún lado.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  MAX_STAFF_PER_INSTITUTION,
  createMemberSchema,
  normalizeUsername,
  passwordError,
  removeMemberSchema,
  resetPasswordSchema,
  staffEmail,
  updateMemberSchema,
  type MemberStatus,
} from "./institutionMembers";

export type Db = SupabaseClient;

export interface MembersDeps {
  admin: Db;
}

export type MemberErrorCode =
  | "invalid_input"
  | "not_institution"
  | "plan_required"
  | "limit_reached"
  | "username_taken"
  | "weak_password"
  | "not_found"
  | "account_rejected"
  | "rate_limited"
  | "failed";

/** Lo que el navegador necesita saber de una persona del equipo (nunca el correo sintético ni claves). */
export interface MemberView {
  id: string;
  username: string;
  displayName: string;
  jobTitle: string | null;
  modules: string[];
  status: MemberStatus;
}

export type MemberResult =
  | { ok: true; member?: MemberView }
  | { ok: false; code: MemberErrorCode; message: string; fields?: Record<string, string> };

export const MESSAGES: Record<MemberErrorCode, string> = {
  invalid_input: "Revisa los datos del formulario.",
  not_institution: "Solo la cuenta de la institución puede administrar al personal.",
  plan_required: "Agregar personal con acceso propio es parte del plan IPS Mejorado.",
  limit_reached: `Una institución puede tener hasta ${MAX_STAFF_PER_INSTITUTION} personas en su equipo.`,
  username_taken: "Ese usuario ya está en uso. Elige otro.",
  weak_password: "Elige una contraseña más segura.",
  not_found: "No encontramos a esa persona en tu equipo.",
  account_rejected: "No se pudo crear la cuenta con ese usuario. Prueba con otro.",
  rate_limited: "Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.",
  failed: "No se pudo completar la acción. Inténtalo de nuevo en unos minutos.",
};

function fail(
  code: MemberErrorCode,
  extra: { message?: string; fields?: Record<string, string> } = {},
): MemberResult {
  return { ok: false, code, message: extra.message ?? MESSAGES[code], fields: extra.fields };
}

/** Primer mensaje por campo del esquema Zod (para pintarlo junto al campo). */
function invalid(error: z.ZodError): MemberResult {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fail("invalid_input", { fields });
}

interface AuthLikeError {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

/** Traduce el error de Supabase Auth al crear la cuenta a un código estable. */
export function mapAuthCreateError(err: AuthLikeError): MemberErrorCode {
  const code = err.code ?? "";
  if (code === "email_exists" || code === "user_already_exists") return "username_taken";
  if (code === "weak_password") return "weak_password";
  if (code === "over_request_rate_limit" || err.status === 429) return "rate_limited";
  if (
    code === "email_address_invalid" ||
    code === "email_address_not_authorized" ||
    code === "validation_failed"
  ) {
    return "account_rejected";
  }
  if (/already (been )?registered|already exists/i.test(err.message ?? "")) return "username_taken";
  return "failed";
}

/** Traduce el error de la base de datos al insertar la pertenencia (por la pista `HINT` o el código SQL). */
export function mapMembershipError(err: {
  code?: string | null;
  hint?: string | null;
  message?: string | null;
}): MemberErrorCode {
  if (err.hint === "member_limit") return "limit_reached";
  if (err.code === "23505") return "username_taken";
  if (/Solo una institución/i.test(err.message ?? "")) return "not_institution";
  return "failed";
}

const VIEW_COLUMNS = "id, username, display_name, job_title, modules, status";

interface MemberRow {
  id: string;
  username: string;
  display_name: string;
  job_title: string | null;
  modules: string[] | null;
  status: string;
  member_user_id?: string;
}

function toView(row: MemberRow): MemberView {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    jobTitle: row.job_title,
    modules: row.modules ?? [],
    status: row.status === "suspended" ? "suspended" : "active",
  };
}

/** ¿La sesión es de una institución? (y, para crear, con el plan que incluye varios usuarios). */
async function assertInstitution(
  admin: Db,
  userId: string,
  opts: { requirePlan: boolean },
): Promise<MemberResult | null> {
  const roles = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "institution")
    .limit(1);
  if (roles.error) return fail("failed");
  if (!roles.data?.length) return fail("not_institution");
  if (opts.requirePlan) {
    const plan = await admin.rpc("plan_key_for", { p_user: userId });
    if (plan.error) return fail("failed");
    if (plan.data !== "institution_monthly") return fail("plan_required");
  }
  return null;
}

/** Busca a la persona SOLO si es del equipo de esta institución (así nadie toca cuentas ajenas). */
async function findOwnMember(
  admin: Db,
  institutionId: string,
  memberId: string,
): Promise<{ row: MemberRow & { member_user_id: string } } | { error: MemberResult }> {
  const found = await admin
    .from("institution_members")
    .select(`${VIEW_COLUMNS}, member_user_id`)
    .eq("id", memberId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (found.error) return { error: fail("failed") };
  if (!found.data) return { error: fail("not_found") };
  return { row: found.data as MemberRow & { member_user_id: string } };
}

// ─── Crear ─────────────────────────────────────────────────────────────────────

export async function handleCreateMember(
  raw: unknown,
  ctx: { userId: string },
  deps: MembersDeps,
): Promise<MemberResult> {
  const parsed = createMemberSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { displayName, jobTitle, password, modules } = parsed.data;
  const username = normalizeUsername(parsed.data.username);
  const { admin } = deps;

  const denied = await assertInstitution(admin, ctx.userId, { requirePlan: true });
  if (denied) return denied;

  const count = await admin
    .from("institution_members")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.userId);
  if (count.error) return fail("failed");
  if ((count.count ?? 0) >= MAX_STAFF_PER_INSTITUTION) return fail("limit_reached");

  const taken = await admin
    .from("institution_members")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (taken.error) return fail("failed");
  if (taken.data) return fail("username_taken", { fields: { username: MESSAGES.username_taken } });

  const created = await admin.auth.admin.createUser({
    email: staffEmail(username),
    password,
    email_confirm: true,
    user_metadata: { signup_kind: "institution_staff", full_name: displayName },
  });
  if (created.error || !created.data?.user) {
    const code = mapAuthCreateError(created.error ?? {});
    if (code === "failed" || code === "account_rejected") {
      // Solo el código y el estado: nunca el mensaje completo (podría repetir datos de la persona).
      console.error(
        "[institutionMembers] createUser:",
        created.error?.code ?? "sin_codigo",
        created.error?.status ?? "",
      );
    }
    const fields: Record<string, string> | undefined =
      code === "username_taken"
        ? { username: MESSAGES.username_taken }
        : code === "weak_password"
          ? { password: MESSAGES.weak_password }
          : undefined;
    return fail(code, { fields });
  }
  const memberUserId = created.data.user.id;

  const inserted = await admin
    .from("institution_members")
    .insert({
      institution_id: ctx.userId,
      member_user_id: memberUserId,
      username,
      display_name: displayName,
      job_title: jobTitle ? jobTitle : null,
      modules,
      status: "active",
      created_by: ctx.userId,
    })
    .select(VIEW_COLUMNS)
    .single();
  if (inserted.error || !inserted.data) {
    // La cuenta no queda huérfana: se borra (si esto fallara, queda en el registro del servidor para limpiarla).
    const rollback = await admin.auth.admin.deleteUser(memberUserId);
    if (rollback.error)
      console.error(
        "[institutionMembers] rollback deleteUser:",
        rollback.error.code ?? "sin_codigo",
      );
    const code = mapMembershipError(inserted.error ?? {});
    return fail(
      code,
      code === "username_taken" ? { fields: { username: MESSAGES.username_taken } } : {},
    );
  }

  // El disparador de registro ya crea el perfil; esto solo cubre el caso en que no lo hubiera hecho.
  const profile = await admin
    .from("profiles")
    .upsert(
      { user_id: memberUserId, full_name: displayName },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (profile.error)
    console.error("[institutionMembers] profiles upsert:", profile.error.code ?? "sin_codigo");

  return { ok: true, member: toView(inserted.data as MemberRow) };
}

// ─── Editar / suspender ────────────────────────────────────────────────────────

/** Suspender también bloquea el inicio de sesión (≈100 años); reactivar lo levanta. */
const BAN_FOREVER = "876000h";

export async function handleUpdateMember(
  raw: unknown,
  ctx: { userId: string },
  deps: MembersDeps,
): Promise<MemberResult> {
  const parsed = updateMemberSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { admin } = deps;

  const denied = await assertInstitution(admin, ctx.userId, { requirePlan: false });
  if (denied) return denied;

  const own = await findOwnMember(admin, ctx.userId, parsed.data.memberId);
  if ("error" in own) return own.error;

  const patch: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) patch.display_name = parsed.data.displayName;
  if (parsed.data.jobTitle !== undefined)
    patch.job_title = parsed.data.jobTitle ? parsed.data.jobTitle : null;
  if (parsed.data.modules !== undefined) patch.modules = parsed.data.modules;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;

  // Primero la base de datos: es lo que corta (o da) el acceso a los datos de inmediato.
  const updated = await admin
    .from("institution_members")
    .update(patch)
    .eq("id", own.row.id)
    .eq("institution_id", ctx.userId)
    .select(VIEW_COLUMNS)
    .maybeSingle();
  if (updated.error) return fail("failed");
  if (!updated.data) return fail("not_found");

  if (parsed.data.status !== undefined && parsed.data.status !== own.row.status) {
    const ban = await admin.auth.admin.updateUserById(own.row.member_user_id, {
      ban_duration: parsed.data.status === "suspended" ? BAN_FOREVER : "none",
    });
    if (ban.error) {
      console.error("[institutionMembers] ban sync:", ban.error.code ?? "sin_codigo");
      return fail("failed", {
        message:
          "Se guardó el cambio, pero no se pudo sincronizar el inicio de sesión. Inténtalo de nuevo.",
      });
    }
  }
  return { ok: true, member: toView(updated.data as MemberRow) };
}

// ─── Reiniciar contraseña ──────────────────────────────────────────────────────

export async function handleResetPassword(
  raw: unknown,
  ctx: { userId: string },
  deps: MembersDeps,
): Promise<MemberResult> {
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { admin } = deps;

  const denied = await assertInstitution(admin, ctx.userId, { requirePlan: false });
  if (denied) return denied;

  const own = await findOwnMember(admin, ctx.userId, parsed.data.memberId);
  if ("error" in own) return own.error;

  const weak = passwordError(parsed.data.password, own.row.username);
  if (weak) return fail("invalid_input", { message: weak, fields: { password: weak } });

  const res = await admin.auth.admin.updateUserById(own.row.member_user_id, {
    password: parsed.data.password,
  });
  if (res.error) {
    if (res.error.code === "same_password") {
      const message = "Elige una contraseña distinta de la actual.";
      return fail("invalid_input", { message, fields: { password: message } });
    }
    if (res.error.code === "weak_password") {
      return fail("weak_password", { fields: { password: MESSAGES.weak_password } });
    }
    console.error("[institutionMembers] reset password:", res.error.code ?? "sin_codigo");
    return fail("failed");
  }
  return { ok: true, member: toView(own.row) };
}

// ─── Quitar ────────────────────────────────────────────────────────────────────

export async function handleRemoveMember(
  raw: unknown,
  ctx: { userId: string },
  deps: MembersDeps,
): Promise<MemberResult> {
  const parsed = removeMemberSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { admin } = deps;

  const denied = await assertInstitution(admin, ctx.userId, { requirePlan: false });
  if (denied) return denied;

  const own = await findOwnMember(admin, ctx.userId, parsed.data.memberId);
  if ("error" in own) return own.error;

  // Se borra la cuenta; su fila de pertenencia y su perfil caen en cascada. La actividad ya registrada se conserva.
  const res = await admin.auth.admin.deleteUser(own.row.member_user_id);
  if (res.error && res.error.code !== "user_not_found") {
    console.error("[institutionMembers] deleteUser:", res.error.code ?? "sin_codigo");
    return fail("failed");
  }
  // Si la cuenta ya no existía, solo faltaba limpiar la fila.
  if (res.error) {
    const del = await admin
      .from("institution_members")
      .delete()
      .eq("id", own.row.id)
      .eq("institution_id", ctx.userId);
    if (del.error) return fail("failed");
  }
  return { ok: true };
}
