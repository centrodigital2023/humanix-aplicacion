// Trayectoria del profesional: horas, familias que vuelven, racha, gracias y sellos — lógica pura.
//
// Las cifras las calcula el servidor (`my_career_stats` / `professional_public_stats`, migración
// 20261010100000_care_loop.sql) a partir de servicios COMPLETADOS en la plataforma; nada se autodeclara.
// Aquí se normaliza la respuesta, se calcula la racha semanal, el nivel y los sellos, y se arma el texto para
// compartir. La versión pública no trae identidades ni cifras internas.

import { kudosRowsFromMap, type KudosSummaryRow } from "./kudos";

const DAY_MS = 86_400_000;
const BOGOTA_OFFSET_MS = -5 * 3_600_000;

export interface CareerStats {
  completedServices: number;
  hoursTotal: number;
  /** Solo en la versión privada. */
  clientsTotal: number | null;
  repeatClients: number;
  firstServiceAt: string | null;
  lastServiceAt: string | null;
  /** Lunes (hora de Colombia) de las semanas con al menos un servicio completado, «2026-10-05». */
  weekStarts: string[];
  ratedServices: number;
  avgStars: number;
  kudosTotal: number;
  kudosByKind: Record<string, number>;
  loggedServices: number;
  /** Solo en la versión privada. */
  alertsReported: number | null;
}

const toNum = (v: unknown, d = 0): number => {
  if (v === null || v === undefined || v === "") return d;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
const toIsoOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Respuesta JSON del servidor → estadísticas tipadas (tolera nulos y números como texto). */
export function parseCareerStats(raw: unknown): CareerStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kinds: Record<string, number> = {};
  if (r.kudos_by_kind && typeof r.kudos_by_kind === "object") {
    for (const [k, v] of Object.entries(r.kudos_by_kind as Record<string, unknown>))
      kinds[k] = toNum(v);
  }
  return {
    completedServices: toNum(r.completed_services),
    hoursTotal: toNum(r.hours_total),
    clientsTotal: r.clients_total === undefined ? null : toNum(r.clients_total),
    repeatClients: toNum(r.repeat_clients),
    firstServiceAt: toIsoOrNull(r.first_service_at),
    lastServiceAt: toIsoOrNull(r.last_service_at),
    weekStarts: Array.isArray(r.week_starts)
      ? (r.week_starts as unknown[]).filter((w): w is string => typeof w === "string")
      : [],
    ratedServices: toNum(r.rated_services),
    avgStars: toNum(r.avg_stars),
    kudosTotal: toNum(r.kudos_total),
    kudosByKind: kinds,
    loggedServices: toNum(r.logged_services),
    alertsReported: r.alerts_reported === undefined ? null : toNum(r.alerts_reported),
  };
}

export function emptyCareerStats(): CareerStats {
  return parseCareerStats({})!;
}

// ─── Racha semanal ───────────────────────────────────────────────────────────

/** Lunes de la semana (hora de Colombia) de un instante, «YYYY-MM-DD». */
export function weekStartOf(instant: Date | number | string): string {
  const t = new Date(instant).getTime() + BOGOTA_OFFSET_MS;
  const d = new Date(t);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(t - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

const shiftWeeks = (week: string, n: number): string =>
  new Date(new Date(`${week}T00:00:00Z`).getTime() + n * 7 * DAY_MS).toISOString().slice(0, 10);

/**
 * Semanas seguidas con al menos un servicio. La racha no se pierde mientras la semana en curso siga abierta:
 * si esta semana aún no hay servicio, cuenta desde la anterior.
 */
export function streakWeeks(
  weekStarts: string[],
  now: Date | number | string = Date.now(),
): number {
  const set = new Set(weekStarts);
  const current = weekStartOf(now);
  let cursor = set.has(current) ? current : shiftWeeks(current, -1);
  if (!set.has(cursor)) return 0;
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = shiftWeeks(cursor, -1);
  }
  return n;
}

// ─── Nivel ───────────────────────────────────────────────────────────────────

export interface CareerLevel {
  level: number;
  label: string;
  /** Servicios completados desde los que empieza este nivel. */
  from: number;
  next: { level: number; label: string; at: number } | null;
  /** 0..1 dentro del nivel actual. */
  progress: number;
  remaining: number;
}

const LEVELS: ReadonlyArray<{ level: number; label: string; from: number }> = [
  { level: 1, label: "Primeros pasos", from: 0 },
  { level: 2, label: "Cuidador/a de confianza", from: 5 },
  { level: 3, label: "Referente", from: 20 },
  { level: 4, label: "Maestro/a del cuidado", from: 50 },
  { level: 5, label: "Leyenda Humanix", from: 150 },
];

export function careerLevel(completedServices: number): CareerLevel {
  const n = Math.max(0, Math.floor(completedServices));
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (n >= LEVELS[i].from) idx = i;
  const cur = LEVELS[idx];
  const nxt = LEVELS[idx + 1] ?? null;
  return {
    level: cur.level,
    label: cur.label,
    from: cur.from,
    next: nxt ? { level: nxt.level, label: nxt.label, at: nxt.from } : null,
    progress: nxt ? Math.min(1, (n - cur.from) / (nxt.from - cur.from)) : 1,
    remaining: nxt ? nxt.from - n : 0,
  };
}

// ─── Sellos ──────────────────────────────────────────────────────────────────

export type BadgeIcon =
  | "Medal"
  | "Clock"
  | "Heart"
  | "HeartHandshake"
  | "ClipboardCheck"
  | "Flame"
  | "Star";
export type BadgeTone = "copper" | "biosensor" | "ok" | "trust" | "fuchsia-neural";

export interface Badge {
  id: string;
  title: string;
  description: string;
  icon: BadgeIcon;
  tone: BadgeTone;
  /** Tiers alcanzados (0 = aún sin ganar). */
  tier: number;
  maxTier: number;
  earned: boolean;
  /** Valor actual y meta del siguiente tier (o del último si ya está al máximo). */
  current: number;
  target: number;
  /** 0..1 hacia la meta. */
  progress: number;
}

const TIER_NAMES = ["", "Bronce", "Plata", "Oro", "Diamante"] as const;
export const tierName = (tier: number): string => TIER_NAMES[Math.min(Math.max(tier, 0), 4)] ?? "";

interface BadgeSpec {
  id: string;
  title: string;
  description: string;
  icon: BadgeIcon;
  tone: BadgeTone;
  targets: readonly number[];
  value: (s: CareerStats, streak: number) => number;
  /** Unidad en plural y en singular, para frases como «Te falta 1 servicio». */
  unit: string;
  unitOne: string;
}

const SPECS: readonly BadgeSpec[] = [
  {
    id: "constancia",
    title: "Constancia",
    description: "Servicios completados en Humanix",
    icon: "Medal",
    tone: "copper",
    targets: [5, 25, 100, 250],
    value: (s) => s.completedServices,
    unit: "servicios",
    unitOne: "servicio",
  },
  {
    id: "horas",
    title: "Horas de cuidado",
    description: "Tiempo acompañando a pacientes",
    icon: "Clock",
    tone: "biosensor",
    targets: [50, 200, 600, 1500],
    value: (s) => Math.floor(s.hoursTotal),
    unit: "horas",
    unitOne: "hora",
  },
  {
    id: "vuelven",
    title: "Familias que vuelven",
    description: "Familias o instituciones que te contrataron más de una vez",
    icon: "Heart",
    tone: "fuchsia-neural",
    targets: [1, 3, 8, 20],
    value: (s) => s.repeatClients,
    unit: "clientes",
    unitOne: "cliente",
  },
  {
    id: "corazon",
    title: "Corazón Humanix",
    description: "Gracias recibidos de familias e instituciones",
    icon: "HeartHandshake",
    tone: "ok",
    targets: [1, 5, 20, 50],
    value: (s) => s.kudosTotal,
    unit: "gracias",
    unitOne: "gracia",
  },
  {
    id: "bitacora",
    title: "Bitácora impecable",
    description: "Servicios con parte del turno escrito",
    icon: "ClipboardCheck",
    tone: "trust",
    targets: [3, 15, 50, 120],
    value: (s) => s.loggedServices,
    unit: "servicios",
    unitOne: "servicio",
  },
  {
    id: "racha",
    title: "Racha de cuidado",
    description: "Semanas seguidas con servicios",
    icon: "Flame",
    tone: "copper",
    targets: [2, 4, 8, 16],
    value: (_s, streak) => streak,
    unit: "semanas",
    unitOne: "semana",
  },
  {
    id: "excelencia",
    title: "Excelencia",
    description: "Calificaciones con promedio de 4,7 o más",
    icon: "Star",
    tone: "biosensor",
    targets: [5, 15, 40, 100],
    value: (s) => (s.avgStars >= 4.7 ? s.ratedServices : 0),
    unit: "calificaciones",
    unitOne: "calificación",
  },
];

export function computeBadges(
  stats: CareerStats,
  now: Date | number | string = Date.now(),
): Badge[] {
  const streak = streakWeeks(stats.weekStarts, now);
  return SPECS.map((spec) => {
    const current = spec.value(stats, streak);
    const tier = spec.targets.filter((t) => current >= t).length;
    const maxTier = spec.targets.length;
    const target = spec.targets[Math.min(tier, maxTier - 1)];
    const progress = tier >= maxTier ? 1 : Math.min(1, current / target);
    return {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      icon: spec.icon,
      tone: spec.tone,
      tier,
      maxTier,
      earned: tier > 0,
      current,
      target,
      progress,
    };
  });
}

/** El sello que está más cerca del siguiente nivel (para motivar). */
export function nextBadge(
  badges: Badge[],
): { badge: Badge; missing: number; unit: string; unitOne: string } | null {
  const open = badges.filter((b) => b.tier < b.maxTier && b.current > 0);
  if (!open.length) {
    const first = badges.find((b) => b.tier === 0);
    if (!first) return null;
    const spec = SPECS.find((s) => s.id === first.id)!;
    return {
      badge: first,
      missing: Math.max(1, first.target - first.current),
      unit: spec.unit,
      unitOne: spec.unitOne,
    };
  }
  const best = [...open].sort((a, b) => b.progress - a.progress || a.target - b.target)[0];
  const spec = SPECS.find((s) => s.id === best.id)!;
  return {
    badge: best,
    missing: Math.max(1, best.target - best.current),
    unit: spec.unit,
    unitOne: spec.unitOne,
  };
}

/** «Te falta 1 servicio para «Constancia · Plata»». */
export function nextBadgeHint(badges: Badge[]): string | null {
  const nb = nextBadge(badges);
  if (!nb) return null;
  const { badge, missing, unit, unitOne } = nb;
  const noun = missing === 1 ? unitOne : unit;
  return `Te ${missing === 1 ? "falta" : "faltan"} ${missing} ${noun} para «${badge.title} · ${tierName(badge.tier + 1)}»`;
}

// ─── Perfil público y compartir ──────────────────────────────────────────────

/** Datos que muestra el perfil público: solo agregados, sin identidades. */
export function publicHighlights(
  stats: CareerStats,
  now: Date | number | string = Date.now(),
): string[] {
  const out: string[] = [];
  if (stats.completedServices > 0)
    out.push(
      `${stats.completedServices} ${stats.completedServices === 1 ? "servicio completado" : "servicios completados"}`,
    );
  if (stats.hoursTotal >= 1) out.push(`${Math.floor(stats.hoursTotal)} horas de cuidado`);
  if (stats.repeatClients > 0)
    out.push(
      `${stats.repeatClients} ${stats.repeatClients === 1 ? "cliente volvió" : "clientes volvieron"} a contratar`,
    );
  const streak = streakWeeks(stats.weekStarts, now);
  if (streak >= 2) out.push(`Racha de ${streak} semanas`);
  if (stats.loggedServices >= 3) out.push(`Parte del turno en ${stats.loggedServices} servicios`);
  return out.slice(0, 5);
}

export function gratitudeRows(stats: CareerStats): KudosSummaryRow[] {
  return kudosRowsFromMap(stats.kudosByKind);
}

/** Texto para que el profesional comparta su trayectoria (enlace al perfil público verificable). */
export function careerShareText(stats: CareerStats, url: string): string {
  const bits: string[] = [];
  if (stats.completedServices > 0)
    bits.push(
      `${stats.completedServices} ${stats.completedServices === 1 ? "servicio" : "servicios"}`,
    );
  if (stats.hoursTotal >= 1) bits.push(`${Math.floor(stats.hoursTotal)} horas de cuidado`);
  const head = bits.length ? `Llevo ${bits.join(" y ")} cuidando con Humanix` : "Cuido con Humanix";
  const tail =
    stats.repeatClients > 0
      ? ` · ${stats.repeatClients} ${stats.repeatClients === 1 ? "cliente volvió" : "clientes volvieron"} a contratarme`
      : "";
  return `${head}${tail} 💛 Mira mi perfil verificado: ${url}`;
}

/** Proporción de servicios con parte escrito (0..1). */
export function documentationRatio(stats: CareerStats): number {
  return stats.completedServices > 0
    ? Math.min(1, stats.loggedServices / stats.completedServices)
    : 0;
}
