// «Mi semana» (plan Pro): una combinación de turnos compatibles que encaja en la agenda del profesional — lógica pura.
//
// De los turnos que el hub de oportunidades ya puntuó, propone cuáles tomar en los próximos 7 días: los que mejor
// encajan y más dejan, sin cruzarse con lo que ya tiene confirmado, con margen entre servicios, sin pasar de un tope de
// horas por día y por semana y protegiendo al menos un día libre. Es determinista y explicable: cada turno dice por qué
// entró y cada descarte dice por qué quedó fuera. No postula ni contacta a nadie: la persona decide y se postula desde el
// hub. Es una sugerencia, no la «mejor» combinación posible.
import {
  DAY_MS,
  HOUR_MS,
  bogotaDayIndex,
  longDayLabelEs,
  msOf,
  plural,
  splitByBogotaDay,
  startOfBogotaDay,
} from "./intelShared";
import { estimatedTotal, type RankedShift } from "./opportunities";
import { formatCOP } from "./pricing";

export interface PlanBusy {
  start: string;
  end: string;
}

export const PLAN_HORIZON_DAYS = 7;
/** Horas máximas de servicio en un mismo día (hora de Colombia). */
export const MAX_HOURS_PER_DAY = 12;
/** Horas máximas en los 7 días (lo ya confirmado más lo que se proponga). */
export const MAX_HOURS_PER_WEEK = 48;
/** Días libres que se protegen dentro de los 7. */
export const MIN_REST_DAYS = 1;
/** Margen entre un servicio y el siguiente (desplazamiento y descanso). */
export const BUFFER_MINUTES = 60;
/** Puntaje mínimo de compatibilidad para entrar al plan («Buena» o mejor). */
export const MIN_PLAN_SCORE = 60;
/** Turnos que se proponen como máximo. */
export const MAX_PLAN_SHIFTS = 8;
/** Horas de servicio para que un día deje de contar como libre. */
export const FREE_DAY_MAX_HOURS = 1;

export type SkipReason = "overlap" | "day_cap" | "week_cap" | "rest" | "limit" | "no_rate";

export const SKIP_TEXT: Record<SkipReason, string> = {
  overlap: "se cruza o no deja margen con otro servicio",
  day_cap: "pasaría el tope de horas de ese día",
  week_cap: "pasaría el tope de horas de la semana",
  rest: "te dejaría sin un día libre",
  limit: "ya hay suficientes turnos en el plan",
  no_rate: "no muestra tarifa: pídela antes de aceptar",
};

export interface PlannedShift {
  key: string;
  familyName: string;
  city: string | null;
  startsAt: string;
  endsAt: string;
  hours: number;
  rate: number | null;
  total: number | null;
  score: number;
  label: string;
  reasons: string[];
}

export interface SkippedShift {
  key: string;
  familyName: string;
  startsAt: string;
  hours: number;
  total: number | null;
  reason: SkipReason;
  text: string;
}

export interface PlanDay {
  /** Medianoche de Colombia de ese día. */
  dayMs: number;
  label: string;
  bookedHours: number;
  plannedHours: number;
  isFree: boolean;
  isToday: boolean;
}

export type PlanSeverity = "good" | "info";

export interface PlanInsight {
  id: string;
  severity: PlanSeverity;
  title: string;
  detail: string;
}

export interface WeekPlan {
  chosen: PlannedShift[];
  skipped: SkippedShift[];
  excluded: { conflicts: number; lowFit: number; outside: number };
  totals: { shifts: number; hours: number; earnings: number };
  booked: { hours: number };
  after: { weeklyHours: number; freeDays: number };
  days: PlanDay[];
  insights: PlanInsight[];
}

export interface PlanOptions {
  now?: number;
  horizonDays?: number;
  maxHoursPerDay?: number;
  maxHoursPerWeek?: number;
  minRestDays?: number;
  bufferMinutes?: number;
  minScore?: number;
  maxShifts?: number;
}

interface Block {
  start: number;
  end: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildWeekPlan(args: {
  ranked: RankedShift[];
  busy: PlanBusy[];
  options?: PlanOptions;
}): WeekPlan {
  const o = args.options ?? {};
  const now = o.now ?? Date.now();
  const horizon = Math.max(1, Math.floor(o.horizonDays ?? PLAN_HORIZON_DAYS));
  const maxDay = o.maxHoursPerDay ?? MAX_HOURS_PER_DAY;
  const maxWeek = o.maxHoursPerWeek ?? MAX_HOURS_PER_WEEK;
  const minRest = o.minRestDays ?? MIN_REST_DAYS;
  const buffer = (o.bufferMinutes ?? BUFFER_MINUTES) * 60_000;
  const minScore = o.minScore ?? MIN_PLAN_SCORE;
  const maxShifts = o.maxShifts ?? MAX_PLAN_SHIFTS;

  const today = bogotaDayIndex(now);
  const horizonStart = now;
  const horizonEnd = startOfBogotaDay(now) + horizon * DAY_MS;

  // ── Lo que ya está acordado, recortado al horizonte ────────────────────────
  const busy: Block[] = [];
  for (const b of args.busy) {
    const start = msOf(b.start);
    const end = msOf(b.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) busy.push({ start, end });
  }

  // Horas ocupadas por día de Colombia (lo acordado + lo que se vaya eligiendo).
  const hoursByDay = new Map<number, number>();
  const addHours = (block: Block, sign: 1 | -1 = 1) => {
    for (const part of splitByBogotaDay(block.start, block.end)) {
      if (part.day < today || part.day >= today + horizon) continue;
      hoursByDay.set(part.day, (hoursByDay.get(part.day) ?? 0) + sign * part.hours);
    }
  };
  for (const b of busy) addHours(b);
  const bookedHours = round1([...hoursByDay.values()].reduce((a, b) => a + b, 0));
  const bookedByDay = new Map(hoursByDay);

  const freeDaysNow = () => {
    let free = 0;
    for (let d = today; d < today + horizon; d++)
      if ((hoursByDay.get(d) ?? 0) <= FREE_DAY_MAX_HOURS) free += 1;
    return free;
  };
  const freeBefore = freeDaysNow();
  const mustKeepFree = Math.min(minRest, freeBefore);

  // ── Candidatos ─────────────────────────────────────────────────────────────
  const excluded = { conflicts: 0, lowFit: 0, outside: 0 };
  type Cand = { r: RankedShift; start: number; end: number; total: number | null; value: number };
  const candidates: Cand[] = [];
  const noRate: Cand[] = [];
  for (const r of args.ranked) {
    const start = msOf(r.shift.starts_at);
    const end = msOf(r.shift.ends_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || r.shift.hours <= 0)
      continue;
    if (start < horizonStart || start >= horizonEnd) {
      excluded.outside += 1;
      continue;
    }
    if (r.match.conflict) {
      excluded.conflicts += 1;
      continue;
    }
    if (r.match.score < minScore) {
      excluded.lowFit += 1;
      continue;
    }
    const total = estimatedTotal(r.shift.rate_avg, r.shift.hours);
    const cand: Cand = { r, start, end, total, value: (total ?? 0) * (r.match.score / 100) };
    (total === null ? noRate : candidates).push(cand);
  }
  // Lo que más deja y mejor encaja, primero; a igualdad, el que ocurre antes.
  candidates.sort(
    (a, b) =>
      b.value - a.value ||
      b.r.match.score - a.r.match.score ||
      a.start - b.start ||
      a.r.shift.key.localeCompare(b.r.shift.key),
  );

  // ── Elección ───────────────────────────────────────────────────────────────
  const chosen: Cand[] = [];
  const skipped: SkippedShift[] = [];
  const occupied: Block[] = [...busy];
  const skip = (c: Cand, reason: SkipReason) =>
    skipped.push({
      key: c.r.shift.key,
      familyName: c.r.shift.display_name,
      startsAt: c.r.shift.starts_at,
      hours: c.r.shift.hours,
      total: c.total,
      reason,
      text: SKIP_TEXT[reason],
    });

  for (const c of candidates) {
    if (chosen.length >= maxShifts) {
      skip(c, "limit");
      continue;
    }
    if (occupied.some((b) => c.start < b.end + buffer && b.start - buffer < c.end)) {
      skip(c, "overlap");
      continue;
    }
    const parts = splitByBogotaDay(c.start, c.end);
    if (parts.some((p) => (hoursByDay.get(p.day) ?? 0) + p.hours > maxDay + 1e-9)) {
      skip(c, "day_cap");
      continue;
    }
    const weekHours = [...hoursByDay.values()].reduce((a, b) => a + b, 0);
    const inHorizon = parts
      .filter((p) => p.day >= today && p.day < today + horizon)
      .reduce((n, p) => n + p.hours, 0);
    if (weekHours + inHorizon > maxWeek + 1e-9) {
      skip(c, "week_cap");
      continue;
    }
    addHours({ start: c.start, end: c.end });
    if (freeDaysNow() < mustKeepFree) {
      addHours({ start: c.start, end: c.end }, -1);
      skip(c, "rest");
      continue;
    }
    chosen.push(c);
    occupied.push({ start: c.start, end: c.end });
  }
  for (const c of noRate) skip(c, "no_rate");

  chosen.sort((a, b) => a.start - b.start);
  const planned: PlannedShift[] = chosen.map((c) => ({
    key: c.r.shift.key,
    familyName: c.r.shift.display_name,
    city: c.r.shift.city,
    startsAt: c.r.shift.starts_at,
    endsAt: c.r.shift.ends_at,
    hours: c.r.shift.hours,
    rate: c.r.shift.rate_avg,
    total: c.total,
    score: c.r.match.score,
    label: c.r.match.label,
    reasons: c.r.match.reasons.slice(0, 3),
  }));

  // ── Días ───────────────────────────────────────────────────────────────────
  const days: PlanDay[] = Array.from({ length: horizon }, (_, k) => {
    const day = today + k;
    const dayMs = startOfBogotaDay(now) + k * DAY_MS;
    const total = hoursByDay.get(day) ?? 0;
    const booked = bookedByDay.get(day) ?? 0;
    return {
      dayMs,
      label: longDayLabelEs(dayMs + 12 * HOUR_MS),
      bookedHours: round1(booked),
      plannedHours: round1(Math.max(0, total - booked)),
      isFree: total <= FREE_DAY_MAX_HOURS,
      isToday: k === 0,
    };
  });

  const earnings = planned.reduce((n, p) => n + (p.total ?? 0), 0);
  const hours = round1(planned.reduce((n, p) => n + p.hours, 0));
  const plan: WeekPlan = {
    chosen: planned,
    skipped: skipped.sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 12),
    excluded,
    totals: { shifts: planned.length, hours, earnings },
    booked: { hours: bookedHours },
    after: {
      weeklyHours: round1([...hoursByDay.values()].reduce((a, b) => a + b, 0)),
      freeDays: freeDaysNow(),
    },
    days,
    insights: [],
  };
  plan.insights = planInsights(plan, skipped);
  return plan;
}

export function planInsights(
  plan: WeekPlan,
  allSkipped: SkippedShift[] = plan.skipped,
): PlanInsight[] {
  const out: PlanInsight[] = [];
  const free = plan.days.filter((d) => d.isFree).map((d) => d.label);

  if (plan.chosen.length > 0) {
    out.push({
      id: "plan_ready",
      severity: "good",
      title: `${plural(plan.chosen.length, "turno compatible", "turnos compatibles")} para tu semana`,
      detail:
        `Suman ${plan.totals.hours} h y unos ${formatCOP(plan.totals.earnings)} según la tarifa publicada.` +
        (free.length ? ` Te dejan libre: ${free.slice(0, 3).join(", ")}.` : ""),
    });
  } else {
    out.push({
      id: "no_candidates",
      severity: "info",
      title: "Hoy no hay turnos que encajen con tu agenda",
      detail:
        "Cuando aparezcan turnos compatibles y sin cruces con tus servicios, te los proponemos aquí. Activa las alertas de oportunidades para enterarte primero.",
    });
  }

  const count = (r: SkipReason) => allSkipped.filter((s) => s.reason === r).length;
  const rest = count("rest");
  if (rest > 0) {
    out.push({
      id: "rest_protected",
      severity: "info",
      title: `Dejamos fuera ${plural(rest, "turno", "turnos")} para que conserves un día libre`,
      detail: "Descansar un día completo a la semana también es parte de cuidar bien.",
    });
  }
  const caps = count("day_cap") + count("week_cap");
  if (caps > 0) {
    out.push({
      id: "caps",
      severity: "info",
      title: `${plural(caps, "turno quedó", "turnos quedaron")} fuera por el tope de horas`,
      detail: `El plan no pasa de ${MAX_HOURS_PER_DAY} h por día ni de ${MAX_HOURS_PER_WEEK} h en la semana, contando lo que ya tienes confirmado.`,
    });
  }
  const noRate = count("no_rate");
  if (noRate > 0) {
    out.push({
      id: "no_rate",
      severity: "info",
      title: `${plural(noRate, "turno no muestra", "turnos no muestran")} tarifa`,
      detail:
        "No los incluimos en el plan porque no podemos calcular lo que dejan. Pregunta el valor antes de aceptar.",
    });
  }
  return out;
}
