// Directorio de usuarios del superadmin: todas las cuentas registradas (profesionales, familias, EPS/IPS y equipo),
// con su tipo y su estado. La fuente es la función `admin_list_users()` (parte de auth.users, así que no se pierde
// ninguna cuenta aunque le falte perfil o rol). Si la migración aún no está aplicada se arma con profiles + user_roles.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminUserKind =
  "professional" | "family" | "institution" | "institution_staff" | "team";

export type AdminUserRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  city: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean | null;
  has_profile: boolean;
  roles: string[];
  signup_role: string | null;
  is_institution_staff: boolean | null;
  staff_institution: string | null;
  pro_specialty: string | null;
  pro_published: boolean | null;
  pro_verified: boolean | null;
  pro_blocked: boolean | null;
  pro_verification: string | null;
  institution_name: string | null;
  institution_type: string | null;
  institution_verified: boolean | null;
  pending_documents: number | null;
};

export type AdminUserStatus = { label: string; tone: "ok" | "warn" | "bad" | "muted" };

export type AdminUser = AdminUserRow & {
  kind: AdminUserKind;
  /** Rol principal para mostrar (superadmin, professional…), o null si la cuenta no tiene ninguno. */
  role: string | null;
  status: AdminUserStatus;
  /** Faltan datos básicos: sin perfil, sin rol o sin la ficha de su tipo. */
  incomplete: boolean;
};

export const KIND_LABEL: Record<AdminUserKind, string> = {
  professional: "Profesional",
  family: "Familia",
  institution: "EPS / IPS",
  institution_staff: "Equipo EPS/IPS",
  team: "Equipo Humanix",
};

export const ROLE_LABEL: Record<string, string> = {
  superadmin: "Superadmin",
  hr_staff: "Talento humano",
  evaluator: "Evaluador",
  institution: "EPS / IPS",
  professional: "Profesional",
  family: "Familia",
};

const TEAM_ROLES = ["superadmin", "hr_staff", "evaluator"];
// Si una cuenta tiene varios roles, el que se muestra es el de más arriba.
const ROLE_PRIORITY = [
  "superadmin",
  "hr_staff",
  "evaluator",
  "institution",
  "professional",
  "family",
];

export function primaryRole(roles: string[]): string | null {
  for (const r of ROLE_PRIORITY) if (roles.includes(r)) return r;
  return roles[0] ?? null;
}

export function classifyUser(row: AdminUserRow): AdminUserKind {
  const roles = row.roles ?? [];
  if (roles.some((r) => TEAM_ROLES.includes(r))) return "team";
  if (roles.includes("institution")) return "institution";
  if (roles.includes("professional")) return "professional";
  if (roles.includes("family")) return "family";
  // Sin rol: el personal de una EPS/IPS nunca tiene rol; el resto se deduce de lo que eligió al registrarse.
  if (row.is_institution_staff) return "institution_staff";
  if (row.institution_name) return "institution";
  if (row.pro_specialty !== null || row.pro_published !== null) return "professional";
  if (row.signup_role === "institution") return "institution";
  if (row.signup_role === "professional") return "professional";
  return "family";
}

export function userStatus(row: AdminUserRow, kind: AdminUserKind): AdminUserStatus {
  if (!row.has_profile) return { label: "Sin perfil", tone: "bad" };
  if (kind !== "institution_staff" && (row.roles ?? []).length === 0)
    return { label: "Sin rol", tone: "bad" };
  const pending = row.pending_documents ?? 0;
  if (kind === "professional") {
    if (row.pro_blocked) return { label: "Bloqueado", tone: "bad" };
    if (row.pro_published === null) return { label: "Sin hoja de vida", tone: "warn" };
    if (pending > 0) return { label: `${pending} doc. por revisar`, tone: "warn" };
    if (!row.pro_published) return { label: "En revisión", tone: "warn" };
    return { label: row.pro_verified ? "Verificado" : "Publicado", tone: "ok" };
  }
  if (kind === "institution") {
    if (!row.institution_name) return { label: "Sin datos de la institución", tone: "warn" };
    if (pending > 0) return { label: `${pending} doc. por revisar`, tone: "warn" };
    return row.institution_verified
      ? { label: "Verificada", tone: "ok" }
      : { label: "Sin verificar", tone: "warn" };
  }
  if (kind === "institution_staff")
    return { label: row.staff_institution ?? "Personal de institución", tone: "muted" };
  if (kind === "team") return { label: "Acceso interno", tone: "muted" };
  return { label: "Activa", tone: "ok" };
}

export function toAdminUser(row: AdminUserRow): AdminUser {
  const roles = row.roles ?? [];
  const kind = classifyUser(row);
  const status = userStatus(row, kind);
  return {
    ...row,
    roles,
    kind,
    role: primaryRole(roles),
    status,
    incomplete: status.tone === "bad",
  };
}

export type KindFilter = "all" | AdminUserKind | "incomplete";

export function countByKind(users: AdminUser[]): Record<KindFilter, number> {
  const out: Record<KindFilter, number> = {
    all: users.length,
    professional: 0,
    family: 0,
    institution: 0,
    institution_staff: 0,
    team: 0,
    incomplete: 0,
  };
  for (const u of users) {
    out[u.kind] += 1;
    if (u.incomplete) out.incomplete += 1;
  }
  return out;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterUsers(users: AdminUser[], kind: KindFilter, query: string): AdminUser[] {
  const q = fold(query.trim());
  return users.filter((u) => {
    if (kind === "incomplete" ? !u.incomplete : kind !== "all" && u.kind !== kind) return false;
    if (!q) return true;
    const hay = [
      u.full_name,
      u.email,
      u.city,
      u.phone,
      u.institution_name,
      u.staff_institution,
      u.pro_specialty,
    ]
      .filter(Boolean)
      .join(" ");
    return fold(hay).includes(q);
  });
}

/** Trae todas las cuentas. Usa `admin_list_users()`; si no existe todavía, arma la lista con las tablas públicas. */
export async function fetchAdminUsers(client: SupabaseClient): Promise<AdminUser[]> {
  const { data, error } = await client.rpc("admin_list_users");
  if (!error && Array.isArray(data)) return (data as AdminUserRow[]).map(toAdminUser);
  return (await fetchFallback(client)).map(toAdminUser);
}

async function fetchFallback(client: SupabaseClient): Promise<AdminUserRow[]> {
  const [profiles, roles, pros, insts, members] = await Promise.all([
    client
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, phone, city, created_at")
      .order("created_at", { ascending: false })
      .range(0, 9999),
    client.from("user_roles").select("user_id, role").range(0, 9999),
    client
      .from("professional_profiles")
      .select("user_id, specialty, published, verified, blocked, verification_status")
      .range(0, 9999),
    client
      .from("institution_profiles")
      .select("user_id, institution_name, institution_type, verified, city")
      .range(0, 9999),
    client.from("institution_members").select("member_user_id, institution_id").range(0, 9999),
  ]);
  const rolesBy = new Map<string, string[]>();
  for (const r of (roles.data ?? []) as { user_id: string; role: string }[]) {
    rolesBy.set(r.user_id, [...(rolesBy.get(r.user_id) ?? []), r.role]);
  }
  type Pro = {
    user_id: string;
    specialty: string | null;
    published: boolean | null;
    verified: boolean | null;
    blocked: boolean | null;
    verification_status: string | null;
  };
  type Inst = {
    user_id: string;
    institution_name: string | null;
    institution_type: string | null;
    verified: boolean | null;
    city: string | null;
  };
  const proBy = new Map(((pros.data ?? []) as Pro[]).map((p) => [p.user_id, p]));
  const instBy = new Map(((insts.data ?? []) as Inst[]).map((i) => [i.user_id, i]));
  const memberBy = new Map(
    ((members.data ?? []) as { member_user_id: string; institution_id: string }[]).map((m) => [
      m.member_user_id,
      m.institution_id,
    ]),
  );
  type Profile = {
    user_id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
    phone: string | null;
    city: string | null;
    created_at: string;
  };
  return ((profiles.data ?? []) as Profile[]).map((p) => {
    const pro = proBy.get(p.user_id);
    const inst = instBy.get(p.user_id);
    const memberOf = memberBy.get(p.user_id);
    return {
      user_id: p.user_id,
      email: p.email,
      full_name: p.full_name || null,
      avatar_url: p.avatar_url,
      phone: p.phone || null,
      city: p.city || inst?.city || null,
      created_at: p.created_at,
      last_sign_in_at: null,
      email_confirmed: null,
      has_profile: true,
      roles: rolesBy.get(p.user_id) ?? [],
      signup_role: null,
      is_institution_staff: memberOf !== undefined,
      staff_institution: memberOf ? (instBy.get(memberOf)?.institution_name ?? null) : null,
      pro_specialty: pro?.specialty ?? null,
      pro_published: pro ? Boolean(pro.published) : null,
      pro_verified: pro?.verified ?? null,
      pro_blocked: pro?.blocked ?? null,
      pro_verification: pro?.verification_status ?? null,
      institution_name: inst?.institution_name ?? null,
      institution_type: inst?.institution_type ?? null,
      institution_verified: inst?.verified ?? null,
      pending_documents: null,
    };
  });
}
