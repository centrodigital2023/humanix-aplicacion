// Celebrar lo que importa — lógica pura (sin red, sin DOM; la hora entra como parámetro).
//
// Un tablero de cuidado no es un juego, pero tampoco tiene por qué ser frío: el equipo que atiende a tiempo, cierra casos y registra con
// cuidado merece que se note. Aquí se decide QUÉ celebrar (hitos reales, calculados con las cifras del servidor), la racha de alertas
// urgentes atendidas a tiempo, el resumen de impacto de la semana (para compartir, sin datos de ningún paciente) y la «brújula» del día.
//
// Reglas de honestidad:
//  · Nada se inventa: cada hito sale de un número que el servidor ya calculó; lo que vale cero no se presenta como logro.
//  · La racha mide el tiempo hasta VER una alerta urgente (el plazo de acuse), no un resultado clínico.
//  · Los hitos se recuerdan en el navegador (qué ya se celebró). En un navegador nuevo se marcan como vistos SIN fiesta: no se celebra dos veces
//    lo que ya pasó. Nada de esto toca la base de datos.

import { decimalEs, nowMs, type CareOverview, type Clock } from "./instCare";
import type { Tone } from "./instCareTypes";

// ── Utilidades ────────────────────────────────────────────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** «a, b y c». */
function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** «45 s», «2 min 10 s», «12 min», «1 h 5 min». */
export function ackLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0)
    return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 10) {
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m} min ${r} s`;
  }
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h} h` : `${h} h ${rm} min`;
}

// ── Hitos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MilestoneGroup = "start" | "growth" | "quality" | "streak";
export type MilestoneIcon =
  | "user-plus"
  | "users"
  | "folder"
  | "activity"
  | "watch"
  | "check"
  | "star"
  | "heart"
  | "flame"
  | "trophy";

export interface Milestone {
  key: string;
  group: MilestoneGroup;
  icon: MilestoneIcon;
  tone: Tone;
  title: string;
  /** La frase de la celebración. */
  message: string;
  /** Cuál manda cuando se desbloquean varios a la vez (mayor = más importante). */
  weight: number;
  /** Los grandes llevan confeti (siempre que la persona no haya pedido menos movimiento). */
  big: boolean;
}

export interface MilestoneContext {
  overview: CareOverview;
  /** Verdades de «alguna vez» que el resumen de 7 días no puede saber: si no se pasan, se deducen del resumen. */
  hasControl?: boolean;
  hasDevice?: boolean;
}

export interface MilestoneProgress {
  current: number;
  target: number;
}

interface MilestoneDef extends Milestone {
  done: (c: MilestoneContext) => boolean;
  progress?: (c: MilestoneContext) => MilestoneProgress;
}

const casesTotal = (o: CareOverview) =>
  o.cases.active + o.cases.pending + o.cases.completed + o.cases.cancelled;

const patientsMilestone = (
  n: number,
  title: string,
  message: string,
  weight: number,
  big: boolean,
): MilestoneDef => ({
  key: `patients_${n}`,
  group: "growth",
  icon: "users",
  tone: "trust",
  title,
  message,
  weight,
  big,
  done: (c) => c.overview.patients.total >= n,
  progress: (c) => ({ current: Math.min(c.overview.patients.total, n), target: n }),
});

const streakMilestone = (
  n: number,
  title: string,
  weight: number,
  icon: MilestoneIcon,
  big: boolean,
): MilestoneDef => ({
  key: `streak_${n}`,
  group: "streak",
  icon,
  tone: "copper",
  title,
  message: `${n} alertas urgentes seguidas atendidas a tiempo. Así se cuida.`,
  weight,
  big,
  done: (c) => c.overview.ontimeStreak >= n,
  progress: (c) => ({ current: Math.min(c.overview.ontimeStreak, n), target: n }),
});

/** En el orden en que se muestran. */
const DEFS: MilestoneDef[] = [
  {
    key: "first_patient",
    group: "start",
    icon: "user-plus",
    tone: "trust",
    title: "Primer paciente",
    message: "Tu primer paciente ya está en Humanix. Desde aquí todo el cuidado queda coordinado.",
    weight: 90,
    big: true,
    done: (c) => c.overview.patients.total >= 1,
  },
  {
    key: "first_case",
    group: "start",
    icon: "folder",
    tone: "copper",
    title: "Primer caso",
    message: "Abriste tu primer caso: el servicio, la persona y el seguimiento, en un solo lugar.",
    weight: 80,
    big: false,
    done: (c) => casesTotal(c.overview) >= 1,
  },
  {
    key: "first_monitored",
    group: "start",
    icon: "activity",
    tone: "biosensor",
    title: "Monitoreo encendido",
    message: "Tu primer paciente en monitoreo: el NEWS2 vigila contigo.",
    weight: 70,
    big: false,
    done: (c) => c.overview.patients.monitored >= 1 || c.overview.monitoring.total >= 1,
  },
  {
    key: "first_control",
    group: "start",
    icon: "heart",
    tone: "ok",
    title: "Primer control de signos",
    message: "Primer control registrado. Desde aquí el puntaje y las alertas salen solos.",
    weight: 60,
    big: false,
    done: (c) =>
      c.hasControl ?? c.overview.impact.manualControls + c.overview.impact.deviceReadings > 0,
  },
  {
    key: "first_device",
    group: "start",
    icon: "watch",
    tone: "fuchsia",
    title: "Signos que llegan solos",
    message: "Conectaste un dispositivo: los signos llegan aunque nadie esté mirando la pantalla.",
    weight: 85,
    big: false,
    done: (c) => c.hasDevice ?? c.overview.usage.devices > 0,
  },
  patientsMilestone(5, "Cinco pacientes", "Cinco pacientes cuidados desde Humanix.", 50, false),
  patientsMilestone(
    25,
    "Veinticinco pacientes",
    "Veinticinco pacientes: tu equipo ya tiene ritmo.",
    55,
    false,
  ),
  patientsMilestone(
    100,
    "Cien pacientes",
    "Cien pacientes registrados. Cuidar a tanta gente se nota.",
    75,
    true,
  ),
  {
    key: "first_completed",
    group: "quality",
    icon: "check",
    tone: "ok",
    title: "Primer caso cerrado",
    message: "Cerraste un caso: cuidado completado. Eso es lo que importa.",
    weight: 95,
    big: true,
    done: (c) => c.overview.cases.completed >= 1,
  },
  {
    key: "first_rating",
    group: "quality",
    icon: "star",
    tone: "warn",
    title: "Primera valoración",
    message: "La primera valoración de una familia ya está registrada.",
    weight: 92,
    big: true,
    done: (c) => c.overview.cases.rated >= 1,
  },
  {
    key: "happy_families",
    group: "quality",
    icon: "heart",
    tone: "fuchsia",
    title: "Familias satisfechas",
    message: "Cinco valoraciones o más y un promedio de 4,5 o superior: las familias lo notan.",
    weight: 88,
    big: true,
    done: (c) =>
      c.overview.cases.rated >= 5 &&
      c.overview.cases.avgSatisfaction !== null &&
      c.overview.cases.avgSatisfaction >= 4.5,
    progress: (c) => ({ current: Math.min(c.overview.cases.rated, 5), target: 5 }),
  },
  streakMilestone(3, "Racha de 3", 40, "flame", false),
  streakMilestone(5, "Racha de 5", 45, "flame", false),
  streakMilestone(10, "Racha de 10", 65, "flame", true),
  streakMilestone(25, "Racha de 25", 72, "trophy", true),
  streakMilestone(50, "Racha de 50", 78, "trophy", true),
  streakMilestone(100, "Racha de 100", 98, "trophy", true),
];

const PUBLIC = (d: MilestoneDef): Milestone => ({
  key: d.key,
  group: d.group,
  icon: d.icon,
  tone: d.tone,
  title: d.title,
  message: d.message,
  weight: d.weight,
  big: d.big,
});

export const MILESTONES: Milestone[] = DEFS.map(PUBLIC);
export const MILESTONE_KEYS: string[] = DEFS.map((d) => d.key);

export interface MilestoneState extends Milestone {
  earned: boolean;
  progress: MilestoneProgress | null;
}

/** Todos los hitos con su estado. `sticky` son los que ya se celebraron: se quedan ganados aunque la cifra baje (p. ej. una racha que se rompe). */
export function milestoneStates(
  ctx: MilestoneContext,
  sticky: ReadonlySet<string> | null = null,
): MilestoneState[] {
  return DEFS.map((d) => ({
    ...PUBLIC(d),
    earned: d.done(ctx) || (sticky?.has(d.key) ?? false),
    progress: d.progress ? d.progress(ctx) : null,
  }));
}

export interface UnlockResult {
  /** Recién desbloqueados, el más importante primero. */
  fresh: Milestone[];
  /** Lo que hay que guardar como «ya visto». */
  seen: string[];
  /** Primera vez en este navegador: se marca todo lo ganado como visto, sin fiesta. */
  baseline: boolean;
}

/**
 * Compara lo ganado con lo ya celebrado. `seen === null` (no hay nada guardado) es la primera visita al navegador: se parte de lo que ya
 * se tiene sin celebrar. Una institución nueva parte de cero hitos, así que su primer paciente sí se celebra.
 */
export function newlyUnlocked(
  ctx: MilestoneContext,
  seen: ReadonlySet<string> | null,
): UnlockResult {
  const earned = DEFS.filter((d) => d.done(ctx));
  const earnedKeys = earned.map((d) => d.key);
  if (seen === null) return { fresh: [], seen: earnedKeys, baseline: true };
  const fresh = earned
    .filter((d) => !seen.has(d.key))
    .sort((a, b) => b.weight - a.weight)
    .map(PUBLIC);
  const union = new Set([...seen].filter((k) => MILESTONE_KEYS.includes(k)));
  for (const k of earnedKeys) union.add(k);
  return { fresh, seen: MILESTONE_KEYS.filter((k) => union.has(k)), baseline: false };
}

export interface CelebrationPlan {
  headline: Milestone;
  /** Cuántos más se desbloquearon a la vez. */
  more: number;
  confetti: boolean;
}

export function celebrationPlan(fresh: Milestone[]): CelebrationPlan | null {
  const [headline] = [...fresh].sort((a, b) => b.weight - a.weight);
  if (!headline) return null;
  return { headline, more: fresh.length - 1, confetti: fresh.some((m) => m.big) };
}

export interface NextGoal {
  milestone: Milestone;
  current: number;
  target: number;
  remaining: number;
  pct: number;
}

/**
 * El logro más cercano que aún no se tiene (para dar una meta a la vista). Solo entre los que se miden con un número y en los que ya hay
 * algo de avance: a quien empieza lo guía la lista de primeros pasos, no una meta lejana.
 */
export function nextGoal(
  ctx: MilestoneContext,
  sticky: ReadonlySet<string> | null = null,
): NextGoal | null {
  let best: NextGoal | null = null;
  for (const s of milestoneStates(ctx, sticky)) {
    if (s.earned || !s.progress || s.progress.target <= 0) continue;
    const { current, target } = s.progress;
    if (current <= 0 || current >= target) continue;
    const pct = Math.round((current / target) * 100);
    const cand: NextGoal = { milestone: s, current, target, remaining: target - current, pct };
    if (!best || cand.pct > best.pct || (cand.pct === best.pct && cand.target < best.target))
      best = cand;
  }
  return best;
}

// ── Qué ya se celebró (se guarda en el navegador) ────────────────────────────────────────────────────────────────────

export const seenStorageKey = (userId: string): string => `hx:inst-care:milestones:${userId}`;

/** `null` si no hay nada guardado o está dañado (se trata como «primera visita»). */
export function parseSeen(raw: string | null | undefined): Set<string> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    return new Set(
      v.filter((k): k is string => typeof k === "string" && MILESTONE_KEYS.includes(k)),
    );
  } catch {
    return null;
  }
}

export function serializeSeen(keys: Iterable<string>): string {
  const set = new Set(keys);
  return JSON.stringify(MILESTONE_KEYS.filter((k) => set.has(k)));
}

// ── Racha de alertas urgentes atendidas a tiempo ─────────────────────────────────────────────────────────────────────

export const STREAK_STEPS = [3, 5, 10, 25, 50, 100] as const;

export interface StreakInfo {
  count: number;
  /** El siguiente escalón de la racha, o `null` si ya pasó el último. */
  next: number | null;
  toNext: number;
  /** Avance hacia el siguiente escalón, 0–100. */
  pct: number;
  headline: string;
  hint: string;
  tone: Tone;
  hot: boolean;
}

export const STREAK_HINT =
  "Cuenta las alertas urgentes y críticas atendidas dentro del plazo, de la más reciente hacia atrás, hasta la primera que se pasó.";

export function streakInfo(o: CareOverview): StreakInfo {
  const count = Math.max(0, Math.floor(Number.isFinite(o.ontimeStreak) ? o.ontimeStreak : 0));
  const next = STREAK_STEPS.find((s) => s > count) ?? null;
  const prev = [...STREAK_STEPS].reverse().find((s) => s <= count) ?? 0;
  const pct = next === null ? 100 : Math.round(((count - prev) / (next - prev)) * 100);
  const late = o.alerts.overdue > 0;
  const headline =
    count > 0
      ? count === 1
        ? "1 alerta urgente atendida a tiempo"
        : `${count} alertas urgentes seguidas atendidas a tiempo`
      : late
        ? "Racha en pausa: hay alertas pasadas de plazo"
        : "Aún sin racha";
  const hint =
    count > 0
      ? late
        ? `${plural(o.alerts.overdue, "alerta pasada de plazo", "alertas pasadas de plazo")}: atiéndela para no perder la racha.`
        : next === null
          ? "Superaste todos los escalones. Sigue así."
          : `Te faltan ${next - count} para el escalón de ${next}.`
      : late
        ? "Atiende las alertas pendientes para empezar de nuevo."
        : "Atiende a tiempo la próxima alerta urgente y empieza una.";
  return {
    count,
    next,
    toNext: next === null ? 0 : next - count,
    pct,
    headline,
    hint,
    tone: late ? "warn" : count >= 3 ? "copper" : "muted",
    hot: count >= 3,
  };
}

// ── Impacto de la semana (para el equipo, la dirección y, si quieren, para compartir) ───────────────────────────────

export interface ImpactLine {
  key: "controls" | "alerts" | "response" | "tasks" | "notes" | "cases";
  label: string;
  value: string;
  sub?: string;
}

export interface ImpactSummary {
  empty: boolean;
  lines: ImpactLine[];
  /** Una frase con lo más importante, p. ej. «2 casos cerrados, 5 alertas y 42 controles de signos». */
  headline: string;
  /** Porcentaje atendido a tiempo, solo con 5 alertas o más (con menos, un porcentaje engaña). */
  onTimePct: number | null;
}

export const MIN_ALERTS_FOR_PCT = 5;

export function impactSummary(o: CareOverview): ImpactSummary {
  const i = o.impact;
  const controls = i.manualControls + i.deviceReadings;
  const lines: ImpactLine[] = [];
  const phrases: Array<[number, string]> = [];

  if (controls > 0)
    lines.push({
      key: "controls",
      label: controls === 1 ? "control de signos" : "controles de signos",
      value: String(controls),
      ...(i.deviceReadings > 0
        ? { sub: `${i.manualControls} manuales · ${i.deviceReadings} de dispositivos` }
        : {}),
    });
  if (i.alerts > 0)
    lines.push({
      key: "alerts",
      label: "alertas atendidas a tiempo",
      value: `${i.alertsOnTime}/${i.alerts}`,
    });
  const ack = ackLabel(i.medianAckSeconds);
  if (ack) lines.push({ key: "response", label: "tiempo típico en ver una alerta", value: ack });
  if (i.tasksDone > 0)
    lines.push({
      key: "tasks",
      label: i.tasksDone === 1 ? "tarea cumplida" : "tareas cumplidas",
      value: String(i.tasksDone),
    });
  if (i.notes > 0)
    lines.push({
      key: "notes",
      label: i.notes === 1 ? "nota firmada" : "notas firmadas",
      value: String(i.notes),
    });
  if (i.casesCompleted > 0)
    lines.push({
      key: "cases",
      label: i.casesCompleted === 1 ? "caso cerrado" : "casos cerrados",
      value: String(i.casesCompleted),
    });

  if (i.casesCompleted > 0)
    phrases.push([i.casesCompleted, plural(i.casesCompleted, "caso cerrado", "casos cerrados")]);
  if (i.alerts > 0) phrases.push([i.alerts, plural(i.alerts, "alerta", "alertas")]);
  if (controls > 0)
    phrases.push([controls, plural(controls, "control de signos", "controles de signos")]);
  if (i.tasksDone > 0)
    phrases.push([i.tasksDone, plural(i.tasksDone, "tarea cumplida", "tareas cumplidas")]);
  if (i.notes > 0) phrases.push([i.notes, plural(i.notes, "nota firmada", "notas firmadas")]);

  return {
    empty: lines.length === 0,
    lines,
    headline: joinEs(phrases.slice(0, 3).map(([, text]) => text)),
    onTimePct:
      i.alerts >= MIN_ALERTS_FOR_PCT ? Math.round((i.alertsOnTime / i.alerts) * 100) : null,
  };
}

/** Texto para compartir (WhatsApp, LinkedIn…). Solo cifras: ningún nombre, documento ni dato de un paciente. Vacío si no hubo actividad. */
export function impactShareText(
  o: CareOverview,
  opts: { institution?: string | null; url?: string } = {},
): string {
  const s = impactSummary(o);
  if (s.empty) return "";
  const i = o.impact;
  const controls = i.manualControls + i.deviceReadings;
  const name = opts.institution?.trim();
  const out: string[] = [
    name ? `Esta semana en ${name}, con Humanix:` : "Esta semana, con Humanix:",
  ];
  if (controls > 0)
    out.push(
      `• ${plural(controls, "control de signos", "controles de signos")}${i.deviceReadings > 0 ? ` (${i.deviceReadings} llegaron solos desde dispositivos)` : ""}`,
    );
  if (i.alerts > 0) {
    out.push(
      `• ${plural(i.alerts, "alerta", "alertas")}, ${i.alertsOnTime} atendidas a tiempo${s.onTimePct !== null ? ` (${s.onTimePct} %)` : ""}`,
    );
  }
  const ack = ackLabel(i.medianAckSeconds);
  if (ack) out.push(`• Tiempo típico en ver una alerta: ${ack}`);
  const doing = [
    i.tasksDone > 0 ? plural(i.tasksDone, "tarea cumplida", "tareas cumplidas") : "",
    i.notes > 0 ? plural(i.notes, "nota firmada", "notas firmadas") : "",
  ].filter(Boolean);
  if (doing.length) out.push(`• ${doing.join(" · ")}`);
  if (i.casesCompleted > 0)
    out.push(`• ${plural(i.casesCompleted, "caso cerrado", "casos cerrados")}`);
  out.push("");
  // La valoración es de todos los casos, no de la semana: va aparte para no mezclar ventanas de tiempo.
  if (o.cases.avgSatisfaction !== null && o.cases.rated >= 3)
    out.push(
      `En total, las familias nos valoran con ${decimalEs(o.cases.avgSatisfaction)} de 5 (${o.cases.rated} casos valorados).`,
    );
  out.push(`Cuidado coordinado, a tiempo y con trazabilidad. ${opts.url ?? "https://humanix.lat"}`);
  return out.join("\n");
}

// ── La brújula del día ────────────────────────────────────────────────────────────────────────────────────────────────

const BOGOTA_OFFSET_MS = -5 * 3_600_000;

export function greetingFor(now: Clock, name?: string | null): string {
  const hour = new Date(nowMs(now) + BOGOTA_OFFSET_MS).getUTCHours();
  const salute =
    hour >= 5 && hour < 12
      ? "Buenos días"
      : hour >= 12 && hour < 19
        ? "Buenas tardes"
        : "Buenas noches";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${salute}, ${first}` : salute;
}

export type FocusTarget = "alerts" | "monitoring" | "tasks";

export interface FocusItem {
  key: "alerts" | "monitoring_overdue" | "tasks_overdue" | "high_risk";
  label: string;
  /** Aclaración opcional, p. ej. «1 pasada de plazo». */
  detail?: string;
  count: number;
  tone: Tone;
  target: FocusTarget;
}

export interface Compass {
  greeting: string;
  headline: string;
  sub: string;
  tone: Tone;
  items: FocusItem[];
  /** Hay pacientes y nada vencido ni sin ver. Habla del trabajo al día, no de la salud de nadie. */
  allClear: boolean;
}

export function careCompass(o: CareOverview, now: Clock, name?: string | null): Compass {
  const greeting = greetingFor(now, name);
  if (o.patients.open === 0) {
    // Quien ya dio de alta a todos no está «empezando»: se reconoce el cierre y se deja la puerta abierta.
    const returning = o.patients.discharged > 0;
    return {
      greeting,
      headline: returning
        ? "Todos tus pacientes tienen alta"
        : "Tu tablero está listo para el primer paciente",
      sub: returning
        ? "Buen cierre. Cuando llegue el siguiente, regístralo y todo se arma a su alrededor."
        : "Registra a alguien y todo lo demás —casos, notas, monitoreo— se arma a su alrededor.",
      tone: returning ? "ok" : "trust",
      items: [],
      allClear: false,
    };
  }
  const items: FocusItem[] = [];
  if (o.alerts.unacked > 0)
    items.push({
      key: "alerts",
      label: o.alerts.unacked === 1 ? "alerta sin ver" : "alertas sin ver",
      ...(o.alerts.overdue > 0
        ? {
            detail: `${o.alerts.overdue} ${o.alerts.overdue === 1 ? "pasada" : "pasadas"} de plazo`,
          }
        : {}),
      count: o.alerts.unacked,
      tone: o.alerts.critical > 0 || o.alerts.overdue > 0 ? "sos" : "warn",
      target: "alerts",
    });
  if (o.monitoring.overdue > 0)
    items.push({
      key: "monitoring_overdue",
      label:
        o.monitoring.overdue === 1 ? "control de signos vencido" : "controles de signos vencidos",
      count: o.monitoring.overdue,
      tone: "warn",
      target: "monitoring",
    });
  if (o.tasks.overdue > 0)
    items.push({
      key: "tasks_overdue",
      label: o.tasks.overdue === 1 ? "tarea vencida" : "tareas vencidas",
      count: o.tasks.overdue,
      tone: "warn",
      target: "tasks",
    });
  if (o.monitoring.highRisk > 0)
    items.push({
      key: "high_risk",
      label:
        o.monitoring.highRisk === 1
          ? "paciente con riesgo urgente o crítico"
          : "pacientes con riesgo urgente o crítico",
      count: o.monitoring.highRisk,
      tone: "copper",
      target: "monitoring",
    });
  if (items.length === 0)
    return {
      greeting,
      headline: "Todo al día",
      sub: "Sin alertas por ver, controles ni tareas vencidas. Buen trabajo, equipo.",
      tone: "ok",
      items,
      allClear: true,
    };
  const top = items.slice(0, 2).map((i) => `${i.count} ${i.label}`);
  return {
    greeting,
    headline: joinEs(top),
    sub:
      o.alerts.critical > 0 || o.alerts.overdue > 0
        ? "Empieza por las alertas: son lo más urgente."
        : "Esto es lo que hoy pide tu atención.",
    tone: o.alerts.critical > 0 || o.alerts.overdue > 0 ? "sos" : "warn",
    items,
    allClear: false,
  };
}
