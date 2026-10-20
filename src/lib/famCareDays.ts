// Los días de cuidado: de las anotaciones de la familia a la racha amable, la constelación y los hitos. Puro.
//
// Un «día» es una fecha de Colombia (UTC-5, sin horario de verano), no de quien mira. Varias personas pueden anotar el
// mismo día (la familia y el círculo): el día se une en un solo resumen. La racha perdona: un día de descanso por
// semana no la rompe (Duolingo mostró que dar un poco de holgura motiva más que una regla rígida), porque cuidar a
// alguien no siempre deja tiempo de abrir la aplicación.
import { DAY_MS, bogotaYmd } from "./intelShared";
import {
  FAM_MOODS,
  ITEM_KEYS,
  SIGNAL_KEYS,
  type FamMood,
  type ItemKey,
  type SignalKey,
} from "./famCareTypes";

export type DayKey = string;

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(s: unknown): s is DayKey {
  if (typeof s !== "string") return false;
  const m = KEY.exec(s);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return keyFromIndex(Math.round(t / DAY_MS)) === s;
}

/** Fecha de Colombia (AAAA-MM-DD) de un instante. */
export function dayKeyOf(t: number): DayKey {
  const { y, m, d } = bogotaYmd(t);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Días desde 1970-01-01 de una fecha (sin horas: la fecha es la misma en cualquier zona). */
export function dayIndex(key: DayKey): number {
  const m = KEY.exec(key);
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function keyFromIndex(i: number): DayKey {
  const d = new Date(i * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: DayKey, n: number): DayKey {
  return keyFromIndex(dayIndex(key) + n);
}

/** Días de `a` a `b` (positivo si `b` es posterior). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return dayIndex(b) - dayIndex(a);
}

// ── Anotaciones ──────────────────────────────────────────────────────────────

export interface CheckinRow {
  id: string;
  recipient_id: string;
  author_id: string;
  day: string;
  mood: number | null;
  items: readonly string[] | null;
  signals: readonly string[] | null;
  note: string | null;
  created_at: string;
}

export interface DaySummary {
  day: DayKey;
  /** Ánimo de la última anotación del día. */
  mood: FamMood | null;
  /** Lo que alguien marcó como hecho ese día (unión de todos). */
  items: ItemKey[];
  /** Lo que alguien marcó como preocupación ese día (unión de todos). */
  signals: SignalKey[];
  /** Quiénes anotaron (ids, sin repetir, en el orden en que llegaron). */
  authors: string[];
  notes: Array<{ author: string; text: string }>;
  entries: number;
  lastAt: string;
}

const ITEM_SET: ReadonlySet<string> = new Set(ITEM_KEYS);
const SIGNAL_SET: ReadonlySet<string> = new Set(SIGNAL_KEYS);

function moodOf(v: unknown): FamMood | null {
  return typeof v === "number" && (FAM_MOODS as readonly number[]).includes(v)
    ? (v as FamMood)
    : null;
}

/** Une las anotaciones de cada día. Descarta claves desconocidas (una versión nueva de la base no rompe la pantalla). */
export function mergeDays(rows: readonly CheckinRow[]): Map<DayKey, DaySummary> {
  const byDay = new Map<DayKey, CheckinRow[]>();
  for (const r of rows) {
    if (!isDayKey(r.day)) continue;
    const list = byDay.get(r.day);
    if (list) list.push(r);
    else byDay.set(r.day, [r]);
  }
  const out = new Map<DayKey, DaySummary>();
  for (const [day, list] of byDay) {
    // Orden estable: por hora de creación y, si empatan, por autor y por id.
    const sorted = [...list].sort(
      (a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) ||
        a.author_id.localeCompare(b.author_id) ||
        a.id.localeCompare(b.id),
    );
    const items = new Set<ItemKey>();
    const signals = new Set<SignalKey>();
    const authors: string[] = [];
    const notes: Array<{ author: string; text: string }> = [];
    let mood: FamMood | null = null;
    for (const r of sorted) {
      for (const k of r.items ?? []) if (ITEM_SET.has(k)) items.add(k as ItemKey);
      for (const k of r.signals ?? []) if (SIGNAL_SET.has(k)) signals.add(k as SignalKey);
      if (!authors.includes(r.author_id)) authors.push(r.author_id);
      const m = moodOf(r.mood);
      if (m !== null) mood = m;
      const text = typeof r.note === "string" ? r.note.trim() : "";
      if (text) notes.push({ author: r.author_id, text });
    }
    out.set(day, {
      day,
      mood,
      items: ITEM_KEYS.filter((k) => items.has(k)),
      signals: SIGNAL_KEYS.filter((k) => signals.has(k)),
      authors,
      notes,
      entries: sorted.length,
      lastAt: String(sorted[sorted.length - 1].created_at),
    });
  }
  return out;
}

// ── La racha amable ──────────────────────────────────────────────────────────

/** Entre dos días de descanso deben pasar al menos tantos días: un descanso por semana. */
export const REST_SPACING_DAYS = 7;

export interface Streak {
  /** Días con anotación dentro de la racha vigente (los de descanso no suman). */
  count: number;
  /** Días de descanso que la racha ya perdonó. */
  rests: number;
  /** La racha sigue viva: se anotó hoy, o ayer (y hoy todavía se puede). */
  alive: boolean;
  /** Hoy aún no hay anotación: anotar hoy la mantiene. */
  pendingToday: boolean;
  litToday: boolean;
  /** Último día con anotación hasta hoy. */
  lastLit: DayKey | null;
  /** Fechas de los días de descanso de la racha vigente. */
  restDays: DayKey[];
}

interface Run {
  count: number;
  restIdx: number[];
}

/** La racha que termina en `endIdx` (que debe tener anotación), caminando hacia atrás. */
function runEndingAt(lit: (i: number) => boolean, endIdx: number, restIdx: number[] = []): Run {
  let count = 1;
  const rests = [...restIdx];
  let i = endIdx;
  for (;;) {
    const prev = i - 1;
    if (lit(prev)) {
      count += 1;
      i = prev;
      continue;
    }
    const spaced = rests.length === 0 || rests[rests.length - 1] - prev >= REST_SPACING_DAYS;
    if (lit(prev - 1) && spaced) {
      rests.push(prev);
      count += 1;
      i = prev - 1;
      continue;
    }
    return { count, restIdx: rests };
  }
}

export function computeStreak(lit: ReadonlySet<DayKey>, today: DayKey): Streak {
  const t = dayIndex(today);
  const has = (i: number) => lit.has(keyFromIndex(i));
  const litSorted = [...lit]
    .filter(isDayKey)
    .filter((k) => dayIndex(k) <= t)
    .sort();
  const lastLit = litSorted.length ? litSorted[litSorted.length - 1] : null;
  const litToday = has(t);

  let run: Run | null = null;
  let pendingToday = false;
  if (litToday) {
    run = runEndingAt(has, t);
  } else if (has(t - 1)) {
    run = runEndingAt(has, t - 1);
    pendingToday = true;
  } else if (has(t - 2)) {
    // Ayer fue el descanso de la semana; hoy todavía se puede anotar.
    run = runEndingAt(has, t - 2, [t - 1]);
    pendingToday = true;
  }
  if (!run) {
    return {
      count: 0,
      rests: 0,
      alive: false,
      pendingToday: false,
      litToday,
      lastLit,
      restDays: [],
    };
  }
  return {
    count: run.count,
    rests: run.restIdx.length,
    alive: true,
    pendingToday,
    litToday,
    lastLit,
    restDays: run.restIdx.map(keyFromIndex).sort(),
  };
}

/** La racha más larga de la historia (con las mismas reglas de descanso). */
export function bestStreak(lit: ReadonlySet<DayKey>): number {
  const has = (i: number) => lit.has(keyFromIndex(i));
  let best = 0;
  for (const k of lit) {
    if (!isDayKey(k)) continue;
    best = Math.max(best, runEndingAt(has, dayIndex(k)).count);
  }
  return best;
}

// ── La constelación ──────────────────────────────────────────────────────────

export type StarState = "lit" | "rest" | "dark" | "today";

export interface StarCell {
  day: DayKey;
  state: StarState;
  mood: FamMood | null;
  /** Cuántas personas anotaron ese día. */
  people: number;
  /** El día tuvo alguna señal de urgencia o emergencia (el detalle se ve en la ruta, no se comparte). */
  flagged: boolean;
}

export const CONSTELLATION_DAYS = 30;

/**
 * Los últimos `days` días hasta hoy, de más antiguo a más reciente. Los días anteriores a que empezara la ruta
 * (`startedOn`) no se dibujan. `urgent` dice qué señales cuentan como bandera: las de nivel urgente o de emergencia.
 */
export function buildCells(
  summaries: ReadonlyMap<DayKey, DaySummary>,
  today: DayKey,
  opts: {
    days?: number;
    startedOn?: DayKey | null;
    urgentSignals?: ReadonlySet<SignalKey>;
  } = {},
): StarCell[] {
  const n = Math.max(1, Math.floor(opts.days ?? CONSTELLATION_DAYS));
  const t = dayIndex(today);
  const lit = new Set(summaries.keys());
  const streak = computeStreak(lit, today);
  const restSet = new Set(streak.restDays);
  const first = opts.startedOn && isDayKey(opts.startedOn) ? dayIndex(opts.startedOn) : -Infinity;
  const urgent = opts.urgentSignals ?? new Set<SignalKey>();
  const cells: StarCell[] = [];
  for (let i = t - n + 1; i <= t; i++) {
    if (i < first) continue;
    const day = keyFromIndex(i);
    const s = summaries.get(day);
    if (s) {
      cells.push({
        day,
        state: "lit",
        mood: s.mood,
        people: s.authors.length,
        flagged: s.signals.some((k) => urgent.has(k)),
      });
    } else if (i === t) {
      cells.push({ day, state: "today", mood: null, people: 0, flagged: false });
    } else if (restSet.has(day)) {
      cells.push({ day, state: "rest", mood: null, people: 0, flagged: false });
    } else {
      cells.push({ day, state: "dark", mood: null, people: 0, flagged: false });
    }
  }
  return cells;
}

/** Cuántos de los últimos `n` días (hasta hoy) tienen anotación. */
export function litInLast(lit: ReadonlySet<DayKey>, today: DayKey, n: number): number {
  const t = dayIndex(today);
  let c = 0;
  for (let i = t - n + 1; i <= t; i++) if (lit.has(keyFromIndex(i))) c += 1;
  return c;
}

// ── Hitos ────────────────────────────────────────────────────────────────────

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  /** Día en que se alcanzó (si se conoce). */
  day: DayKey | null;
}

/** Días con anotación (en total) que se celebran. */
export const DAY_MILESTONES: ReadonlyArray<{ n: number; title: string; detail: string }> = [
  { n: 1, title: "Primer día de cuidado", detail: "Se encendió la primera estrella." },
  { n: 3, title: "Tres días de cuidado", detail: "Empieza a hacerse costumbre." },
  { n: 7, title: "Una semana de cuidado", detail: "Siete días con registro: ya es costumbre." },
  { n: 14, title: "Dos semanas de cuidado", detail: "Constancia que se nota." },
  { n: 30, title: "Un mes de cuidado", detail: "Una constelación hecha de cariño." },
  { n: 60, title: "Dos meses de cuidado", detail: "Dos meses acompañando, día a día." },
  { n: 100, title: "Cien días de cuidado", detail: "Cien estrellas encendidas." },
  { n: 180, title: "Medio año de cuidado", detail: "Seis meses de presencia." },
  { n: 365, title: "Un año de cuidado", detail: "Un año entero cuidando. Gracias." },
];

/** Los hitos ya alcanzados, del más reciente al más antiguo (el día es el de la anotación que lo completó). */
export function achievedMilestones(
  summaries: ReadonlyMap<DayKey, DaySummary>,
  today: DayKey,
): Milestone[] {
  const days = [...summaries.keys()].filter(isDayKey).sort();
  const out: Milestone[] = [];
  for (const m of DAY_MILESTONES) {
    if (days.length >= m.n)
      out.push({ id: `days-${m.n}`, title: m.title, detail: m.detail, day: days[m.n - 1] });
  }
  // Cuidado en equipo: el primer día en que anotaron al menos dos personas distintas.
  const team = days.find((d) => (summaries.get(d)?.authors.length ?? 0) >= 2);
  if (team) {
    out.push({
      id: "team-2",
      title: "Cuidado en equipo",
      detail: "Ese día dos personas registraron cómo estaba. Cuidar entre todos pesa menos.",
      day: team,
    });
  }
  // Semana completa: los últimos siete días, todos con anotación.
  const lit = new Set(days);
  if (litInLast(lit, today, 7) === 7) {
    out.push({
      id: "week-full",
      title: "Semana completa",
      detail: "Siete de siete: ningún día se quedó sin atención.",
      day: today,
    });
  }
  return out.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || a.id.localeCompare(b.id));
}

/** El hito más reciente que todavía no se ha celebrado (según los ya vistos en este navegador). */
export function nextUnseen(
  milestones: readonly Milestone[],
  seen: ReadonlySet<string>,
): Milestone | null {
  return milestones.find((m) => !seen.has(m.id)) ?? null;
}

/** El siguiente hito de días por alcanzar y cuántos faltan. */
export function nextDayMilestone(
  litCount: number,
): { n: number; title: string; remaining: number } | null {
  const m = DAY_MILESTONES.find((x) => x.n > litCount);
  return m ? { n: m.n, title: m.title, remaining: m.n - litCount } : null;
}
