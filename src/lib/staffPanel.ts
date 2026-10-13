// Personal de la institución — lo que la pantalla necesita decidir (puro, sin red).
//
// La base de datos entrega `my_staff_context()` (una fila con la institución, los módulos, el estado y si el plan sigue vigente) y la
// institución lee su lista de personal. Aquí se traducen esas filas a objetos de pantalla, se decide qué puede hacer una persona hoy
// (módulos, suspensión, plan en pausa) y se redactan los avisos. Las reglas de verdad viven en la base de datos; esto solo evita
// mostrar botones que el servidor rechazaría.
import type { CoverageRawOffer } from "./institutionCoverage";
import {
  STAFF_MODULES,
  isStaffModule,
  normalizeModules,
  type MemberStatus,
  type StaffModuleKey,
} from "./institutionMembers";

/** Fila tal como la devuelve `my_staff_context()`. */
export interface StaffContextRow {
  member_id: string;
  institution_id: string;
  institution_name: string | null;
  institution_city: string | null;
  username: string;
  display_name: string;
  job_title: string | null;
  modules: string[] | null;
  status: string;
  plan_active: boolean | null;
}

export interface StaffContext {
  memberId: string;
  institutionId: string;
  institutionName: string;
  institutionCity: string | null;
  username: string;
  displayName: string;
  jobTitle: string | null;
  modules: StaffModuleKey[];
  status: MemberStatus;
  planActive: boolean;
}

function isRow(value: unknown): value is StaffContextRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.member_id === "string" &&
    typeof v.institution_id === "string" &&
    typeof v.username === "string" &&
    typeof v.display_name === "string" &&
    typeof v.status === "string"
  );
}

/** Normaliza la respuesta del RPC (una fila, una lista de filas o nada). Devuelve `null` si la persona no es del equipo. */
export function parseStaffContext(raw: unknown): StaffContext | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!isRow(row)) return null;
  return {
    memberId: row.member_id,
    institutionId: row.institution_id,
    institutionName: row.institution_name?.trim() || "Tu institución",
    institutionCity: row.institution_city?.trim() || null,
    username: row.username,
    displayName: row.display_name,
    jobTitle: row.job_title?.trim() || null,
    modules: normalizeModules(row.modules),
    status: row.status === "suspended" ? "suspended" : "active",
    planActive: row.plan_active === true,
  };
}

export type StaffGate =
  | { state: "ready"; tabs: StaffModuleKey[] }
  | { state: "suspended"; message: string }
  | { state: "paused"; message: string }
  | { state: "empty"; message: string };

/** Qué puede hacer hoy la persona del equipo (y, si nada, por qué). */
export function staffGate(ctx: StaffContext | null): StaffGate {
  if (!ctx) {
    return { state: "suspended", message: "Esta cuenta ya no forma parte de un equipo." };
  }
  if (ctx.status === "suspended") {
    return {
      state: "suspended",
      message: `Tu acceso está suspendido. Habla con quien administra el equipo de ${ctx.institutionName}.`,
    };
  }
  if (!ctx.planActive) {
    return {
      state: "paused",
      message: `El acceso del equipo está en pausa porque ${ctx.institutionName} no tiene activo el plan IPS Mejorado. Avísale a quien administra la cuenta.`,
    };
  }
  if (!ctx.modules.length) {
    return {
      state: "empty",
      message: `Aún no tienes módulos asignados. Pide a quien administra el equipo de ${ctx.institutionName} que te dé acceso.`,
    };
  }
  return { state: "ready", tabs: ctx.modules };
}

/** Pestaña inicial: la primera que la persona tiene, en el orden del catálogo. */
export function defaultStaffTab(tabs: readonly StaffModuleKey[]): StaffModuleKey | null {
  return STAFF_MODULES.find((m) => tabs.includes(m.key))?.key ?? null;
}

/** ¿La pestaña pedida es válida para esta persona? Si no, la inicial. */
export function resolveStaffTab(
  wanted: string | null | undefined,
  tabs: readonly StaffModuleKey[],
): StaffModuleKey | null {
  return isStaffModule(wanted) && tabs.includes(wanted) ? wanted : defaultStaffTab(tabs);
}

// ─── Lista de personal (lo que ve la institución) ──────────────────────────────

/** Fila de `institution_members` tal como la lee la institución. */
export interface MemberRow {
  id: string;
  member_user_id: string;
  username: string;
  display_name: string;
  job_title: string | null;
  modules: string[] | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  username: string;
  displayName: string;
  jobTitle: string | null;
  modules: StaffModuleKey[];
  status: MemberStatus;
  lastSeenAt: string | null;
  createdAt: string;
}

export function toTeamMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    jobTitle: row.job_title?.trim() || null,
    modules: normalizeModules(row.modules),
    status: row.status === "suspended" ? "suspended" : "active",
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

/** «Aún no ha entrado», «Hace 5 min», «Hace 3 h», «Hace 2 d» o la fecha. */
export function lastSeenLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Aún no ha entrado";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Aún no ha entrado";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(t));
}

/** ¿Entró en los últimos 15 minutos? (punto verde en la lista) */
export function isRecentlyActive(
  iso: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= 15 * 60_000 && now >= t - 60_000;
}

/** Fila de `institution_member_actions` y su texto para la lista de actividad. */
export interface ActionRow {
  id: number;
  member_user_id: string;
  member_name: string | null;
  action: string;
  target_table: string;
  created_at: string;
}

export interface ActivityItem {
  id: number;
  who: string;
  action: string;
  at: string;
}

export function toActivityItem(row: ActionRow, describe: (action: string) => string): ActivityItem {
  return {
    id: row.id,
    who: row.member_name?.trim() || "Alguien del equipo",
    action: describe(row.action),
    at: row.created_at,
  };
}

// ─── Ofertas de la institución (módulo «ofertas») ──────────────────────────────

export interface StaffOfferSummary {
  id: string;
  title: string;
  city: string;
  amount: number;
  modality: string;
  urgent: boolean;
  /** «open» = recibiendo postulaciones; «filled» = todos los cupos cubiertos. */
  status: "open" | "filled";
  positions: number;
  filled: number;
  /** Inicio del próximo turno que aún no empieza (o `null`). */
  nextShiftAt: string | null;
}

/** Resume cada oferta: cupos cubiertos y próximo turno. Primero lo abierto y urgente, luego lo más próximo; lo cubierto al final. */
export function summarizeStaffOffers(
  offers: readonly CoverageRawOffer[],
  now: number = Date.now(),
): StaffOfferSummary[] {
  const list = offers.map((o): StaffOfferSummary => {
    const shifts = (o.job_offer_shifts ?? []).filter((s) => s.status !== "cancelled");
    const positions = shifts.reduce((n, s) => n + Math.max(0, s.positions), 0);
    const filled = shifts.reduce(
      (n, s) => n + Math.min(Math.max(0, s.filled), Math.max(0, s.positions)),
      0,
    );
    const upcoming = shifts
      .map((s) => Date.parse(s.starts_at))
      .filter((t) => Number.isFinite(t) && t > now)
      .sort((a, b) => a - b)[0];
    return {
      id: o.id,
      title: o.title,
      city: o.city,
      amount: o.amount,
      modality: o.modality,
      urgent: o.is_urgent === true,
      status: o.status === "filled" || (positions > 0 && filled >= positions) ? "filled" : "open",
      positions,
      filled,
      nextShiftAt: upcoming === undefined ? null : new Date(upcoming).toISOString(),
    };
  });
  const rank = (o: StaffOfferSummary) => (o.status === "open" ? 0 : 1);
  return list.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.urgent) - Number(a.urgent) ||
      (a.nextShiftAt ?? "9999").localeCompare(b.nextShiftAt ?? "9999") ||
      a.title.localeCompare(b.title, "es"),
  );
}
