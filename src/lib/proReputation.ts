// Reputación del profesional en detalle (plan Pro) — lógica pura.
//
// Con las calificaciones que el propio profesional ya puede leer (las estrellas y las 4 dimensiones que dan quienes lo
// contratan) arma su promedio, la tendencia, qué dimensión es su fuerte y cuál conviene cuidar con un consejo concreto,
// lo que dicen de él (solo comentarios positivos y sin datos de contacto) y cuántas calificaciones de 5 estrellas le
// faltan para la siguiente meta. Es para acompañarlo, no para juzgarlo: nada de esto lo ven las familias ni las
// instituciones, y ningún dato inventa precisión (las dimensiones exigen un mínimo de calificaciones).
import { average as mean, plural, round1 } from "./intelShared";
import { hasContactInfo } from "./opportunities";
import { RATING_DIMENSIONS } from "./ratingDimensions";

export interface DimensionRow {
  booking_id?: string;
  created_at?: string | null;
  scores: Record<string, unknown> | null;
}

export interface StarRow {
  booking_id?: string;
  created_at?: string | null;
  stars: number | string | null;
  comment?: string | null;
  ai_alert?: boolean | null;
}

export interface ReputationProfile {
  verified?: boolean | null;
  rethusVerified?: boolean | null;
  /** 0-100. */
  profileCompletion?: number | null;
}

/** Calificaciones mínimas para mostrar un promedio por dimensión (la misma regla que la reputación pública). */
export const MIN_DIM_RATINGS = 3;
/** Calificaciones mínimas para hablar de tendencia (5 recientes + al menos 3 anteriores). */
export const MIN_RATINGS_FOR_TREND = 8;
/** Cuánto debe cambiar el promedio para llamarlo «subió» o «bajó». */
export const TREND_STEP = 0.2;
/** Por debajo de este promedio una dimensión recibe un consejo. */
export const TIP_BELOW = 4.5;
/** Metas de promedio que se proponen, de menor a mayor. */
export const GOALS = [4.5, 4.7, 4.8, 4.9] as const;
/** Más servicios que esto para una meta se vuelve poco motivador: no se muestra. */
export const MAX_SERVICES_TO_GOAL = 30;
/** Comentarios que se muestran. */
export const MAX_PRAISE = 3;
const PRAISE_MIN = 20;
const PRAISE_MAX = 240;

export type ReputationSeverity = "warn" | "info" | "good";

export interface ReputationInsight {
  id: string;
  severity: ReputationSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface DimensionStat {
  key: string;
  label: string;
  /** Promedio con un decimal; null con menos de 3 calificaciones. */
  average: number | null;
  count: number;
}

export interface ReputationReport {
  hasData: boolean;
  stars: {
    count: number;
    average: number | null;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    fiveStarShare: number | null;
    trend: {
      direction: "up" | "down" | "steady" | "unknown";
      recent: number | null;
      previous: number | null;
      delta: number | null;
    };
  };
  dimensions: DimensionStat[];
  strongest: DimensionStat | null;
  weakest: DimensionStat | null;
  praise: Array<{ text: string; stars: number; createdAt: string | null }>;
  tips: Array<{ key: string; label: string; average: number; tip: string }>;
  nextGoal: { target: number; needed: number; text: string } | null;
  levers: string[];
  insights: ReputationInsight[];
}

/** Consejos por dimensión: concretos, amables y sin promesas. */
export const DIMENSION_TIPS: Record<string, string> = {
  punctuality:
    "Sal con 15 minutos de margen y avisa por el chat si hay tráfico: usar «voy en camino» da tranquilidad a la familia.",
  treatment:
    "Preséntate por tu nombre, pregunta cómo prefiere que le llamen a la persona y cuéntale lo que vas a hacer antes de hacerlo.",
  compliance:
    "Registra el parte del turno (medicamentos, signos vitales, ánimo): lo que queda por escrito se ve como cumplimiento.",
  communication:
    "Al terminar, deja un resumen corto y avisa a tiempo de cualquier cambio: las familias valoran enterarse sin preguntar.",
};

const FAMILY_DIMENSIONS = RATING_DIMENSIONS.family;

function validStars(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function validScore(v: unknown): number | null {
  return validStars(v);
}

const timeOf = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Cuántas calificaciones de 5 estrellas (más) llevan el promedio `avg` de `n` calificaciones a `target`. */
export function fiveStarsNeeded(avg: number, n: number, target: number): number | null {
  if (!(n > 0) || !(target > avg)) return null;
  const k = Math.ceil((n * (target - avg)) / (5 - target) - 1e-9);
  return Number.isFinite(k) && k > 0 ? k : null;
}

function nextGoal(avg: number | null, n: number): ReputationReport["nextGoal"] {
  if (avg === null || n < MIN_DIM_RATINGS) return null;
  for (const target of GOALS) {
    if (target <= round1(avg) + 1e-9) continue;
    const needed = fiveStarsNeeded(avg, n, target);
    if (needed === null || needed > MAX_SERVICES_TO_GOAL) return null;
    return {
      target,
      needed,
      text: `Con ${plural(needed, "servicio más de 5 estrellas", "servicios más de 5 estrellas")} llegarías a ${String(target).replace(".", ",")}.`,
    };
  }
  return null;
}

export function buildReputationReport(args: {
  dimensions: DimensionRow[];
  stars: StarRow[];
  profile?: ReputationProfile | null;
}): ReputationReport {
  // ── Estrellas ──────────────────────────────────────────────────────────────
  const rated = args.stars
    .map((s) => ({ s, value: validStars(s.stars) }))
    .filter((x): x is { s: StarRow; value: number } => x.value !== null)
    .sort((a, b) => timeOf(b.s.created_at) - timeOf(a.s.created_at));
  const values = rated.map((x) => x.value);
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of values) distribution[v as 1 | 2 | 3 | 4 | 5] += 1;
  const avgStars = mean(values);

  let trend: ReputationReport["stars"]["trend"] = {
    direction: "unknown",
    recent: null,
    previous: null,
    delta: null,
  };
  if (values.length >= MIN_RATINGS_FOR_TREND) {
    const recent = mean(values.slice(0, 5))!;
    const previous = mean(values.slice(5, 10))!;
    const delta = round1(recent - previous);
    trend = {
      direction: delta >= TREND_STEP ? "up" : delta <= -TREND_STEP ? "down" : "steady",
      recent: round1(recent),
      previous: round1(previous),
      delta,
    };
  }

  // ── Dimensiones ────────────────────────────────────────────────────────────
  const dimensions: DimensionStat[] = FAMILY_DIMENSIONS.map(({ key, label }) => {
    const scores = args.dimensions
      .map((d) => validScore(d.scores?.[key]))
      .filter((v): v is number => v !== null);
    const avg = scores.length >= MIN_DIM_RATINGS ? mean(scores) : null;
    return { key, label, average: avg === null ? null : round1(avg), count: scores.length };
  });
  const withAvg = dimensions.filter((d) => d.average !== null);
  const strongest = withAvg.length
    ? withAvg.reduce((best, d) => ((d.average ?? 0) > (best.average ?? 0) ? d : best))
    : null;
  let weakest: DimensionStat | null = null;
  if (withAvg.length >= 2) {
    const low = withAvg.reduce((worst, d) => ((d.average ?? 5) < (worst.average ?? 5) ? d : worst));
    if ((low.average ?? 5) < TIP_BELOW && (strongest?.average ?? 0) - (low.average ?? 0) >= 0.2) {
      weakest = low;
    }
  } else if (withAvg.length === 1 && (withAvg[0].average ?? 5) < TIP_BELOW) {
    weakest = withAvg[0];
  }

  const tips = withAvg
    .filter((d) => (d.average ?? 5) < TIP_BELOW && DIMENSION_TIPS[d.key])
    .sort((a, b) => (a.average ?? 5) - (b.average ?? 5))
    .slice(0, 2)
    .map((d) => ({
      key: d.key,
      label: d.label,
      average: d.average as number,
      tip: DIMENSION_TIPS[d.key],
    }));

  // ── Lo que dicen de ti: solo positivo, sin datos de contacto y sin alertas ──
  const praise: ReputationReport["praise"] = [];
  for (const { s, value } of rated) {
    if (praise.length >= MAX_PRAISE) break;
    const text = (s.comment ?? "").trim().replace(/\s+/g, " ");
    if (value < 4 || s.ai_alert || text.length < PRAISE_MIN || hasContactInfo(text)) continue;
    praise.push({
      text: text.length > PRAISE_MAX ? `${text.slice(0, PRAISE_MAX - 1).trimEnd()}…` : text,
      stars: value,
      createdAt: s.created_at ?? null,
    });
  }

  // ── Palancas del perfil ────────────────────────────────────────────────────
  const levers: string[] = [];
  const p = args.profile ?? {};
  if (p.verified === false || p.rethusVerified === false)
    levers.push("Verifica tu identidad y tu RETHUS: un perfil verificado genera más confianza.");
  if (typeof p.profileCompletion === "number" && p.profileCompletion < 90)
    levers.push(
      `Completa tu perfil (llevas ${Math.round(p.profileCompletion)} %): foto, biografía y documentos ayudan a que te elijan.`,
    );

  const fiveShare =
    values.length >= MIN_DIM_RATINGS ? Math.round((distribution[5] / values.length) * 100) : null;
  const report: ReputationReport = {
    hasData: values.length > 0 || args.dimensions.length > 0,
    stars: {
      count: values.length,
      average: avgStars === null ? null : round1(avgStars),
      distribution,
      fiveStarShare: fiveShare,
      trend,
    },
    dimensions,
    strongest,
    weakest,
    praise,
    tips,
    nextGoal: nextGoal(avgStars, values.length),
    levers,
    insights: [],
  };
  report.insights = reputationInsights(report);
  return report;
}

const fmt = (n: number) => n.toFixed(1).replace(".", ",");

export function reputationInsights(r: ReputationReport): ReputationInsight[] {
  const out: ReputationInsight[] = [];
  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no tienes calificaciones",
        detail:
          "Después de cada servicio las familias pueden calificarte. Aquí verás tu promedio, tus fortalezas y cómo mejorar.",
      },
    ];
  }

  if (r.stars.count > 0 && r.stars.count < MIN_DIM_RATINGS) {
    out.push({
      id: "few_ratings",
      severity: "info",
      title: `Llevas ${plural(r.stars.count, "calificación", "calificaciones")}`,
      detail: `Con ${MIN_DIM_RATINGS} podemos mostrarte tu promedio por dimensión. Cada servicio bien documentado suma.`,
    });
  }

  const t = r.stars.trend;
  if (t.direction === "up" && t.delta !== null) {
    out.push({
      id: "trend_up",
      severity: "good",
      title: `Tus últimas calificaciones subieron ${fmt(Math.abs(t.delta))} puntos`,
      detail: `Las 5 más recientes promedian ${fmt(t.recent ?? 0)} frente a ${fmt(t.previous ?? 0)} de las anteriores. Lo que estás haciendo funciona.`,
    });
  } else if (t.direction === "down" && t.delta !== null) {
    out.push({
      id: "trend_down",
      severity: "info",
      title: `Tus últimas calificaciones bajaron ${fmt(Math.abs(t.delta))} puntos`,
      detail: `Las 5 más recientes promedian ${fmt(t.recent ?? 0)} frente a ${fmt(t.previous ?? 0)} de las anteriores. Un mal momento no define tu trayectoria.`,
      action: r.tips[0]?.tip,
    });
  }

  if (r.strongest && r.strongest.average !== null && r.strongest.average >= 4.5) {
    out.push({
      id: "strength",
      severity: "good",
      title: `Tu fortaleza es ${r.strongest.label.toLowerCase()}`,
      detail: `Las familias te dan ${fmt(r.strongest.average)} de 5 en esta dimensión (${plural(r.strongest.count, "calificación", "calificaciones")}).`,
    });
  }

  if (r.weakest && r.weakest.average !== null) {
    out.push({
      id: "improve",
      severity: "info",
      title: `Donde más puedes crecer: ${r.weakest.label.toLowerCase()}`,
      detail: `Promedias ${fmt(r.weakest.average)} de 5 en esta dimensión.`,
      action: DIMENSION_TIPS[r.weakest.key],
    });
  }

  if (r.stars.fiveStarShare !== null && r.stars.fiveStarShare >= 70) {
    out.push({
      id: "five_stars",
      severity: "good",
      title: `${r.stars.fiveStarShare} % de tus calificaciones son de 5 estrellas`,
      detail: `De ${plural(r.stars.count, "calificación", "calificaciones")}, ${r.stars.distribution[5]} son de 5. Gracias por cuidar así.`,
    });
  }

  if (r.nextGoal) {
    out.push({
      id: "goal",
      severity: "info",
      title: `Tu próxima meta: ${String(r.nextGoal.target).replace(".", ",")} de promedio`,
      detail: r.nextGoal.text,
    });
  }

  const order: Record<ReputationSeverity, number> = { warn: 0, info: 1, good: 2 };
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order[a.x.severity] - order[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
