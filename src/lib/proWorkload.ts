// Carga de trabajo y descanso del profesional («cuida a quien cuida») — lógica pura.
//
// Con las reservas del propio profesional mira cuántas horas lleva, cuántos días seguidos, cuántos turnos de noche y
// cuántas veces descansó menos de 8 h entre un turno y el siguiente, y propone un día libre. Es orientación de bienestar:
// no es asesoría laboral ni médica, no bloquea ni cancela nada y nunca se muestra a las familias ni a las instituciones.
// Los umbrales son prudentes y están a la vista como constantes.
import {
  DAY_MS,
  HOUR_MS,
  bogotaDayIndex,
  bogotaWeekday,
  dayLabelEs,
  longDayLabelEs,
  msOf,
  num,
  plural,
  splitByBogotaDay,
  startOfBogotaDay,
} from "./intelShared";

export interface WorkBooking {
  id: string;
  status: string;
  scheduled_at: string;
  duration_hours?: number | string | null;
}

/** Servicios que cuentan como trabajo (hecho o acordado). Una solicitud pendiente o cancelada no pesa. */
export const WORK_STATUS = ["completed", "confirmed", "in_route", "in_progress"] as const;

/**
 * Referencia de jornada semanal: 42 h es el máximo ordinario de un empleado en Colombia desde el 15 de julio de 2026
 * (Ley 2101 de 2021). Quien trabaja como independiente no tiene tope legal; se usa solo como punto de comparación.
 */
export const REFERENCE_WEEKLY_HOURS = 42;
/** Horas en 7 días a partir de las cuales se avisa («atención» y «alto»). */
export const WATCH_WEEK_HOURS = 48;
export const HIGH_WEEK_HOURS = 60;
/** Días seguidos con servicios a partir de los cuales se avisa. */
export const WATCH_RUN_DAYS = 5;
export const HIGH_RUN_DAYS = 7;
/** Horas mínimas de descanso entre un turno y el siguiente. */
export const MIN_REST_BETWEEN_SHIFTS_H = 8;
/** Descansos cortos en 14 días a partir de los cuales se avisa. */
export const WATCH_QUICK_TURNAROUNDS = 2;
export const HIGH_QUICK_TURNAROUNDS = 4;
/** Turnos de noche en 7 días a partir de los cuales se avisa. */
export const WATCH_NIGHTS_7D = 4;
/** Un turno cuenta como «de noche» si pasa al menos estas horas entre las 19:00 y las 07:00. */
export const NIGHT_MIN_HOURS = 4;
/** Horas mínimas en un día para que cuente como día trabajado. */
export const WORKED_DAY_MIN_HOURS = 1;
/** Semanas que se muestran (la actual incluida). */
export const WORKLOAD_WEEKS = 5;

export type WorkloadLevel = "ok" | "watch" | "high";
export type WorkloadSeverity = "warn" | "info" | "good";

export interface WorkloadInsight {
  id: string;
  severity: WorkloadSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface WorkloadWeek {
  /** Lunes (00:00 hora de Colombia) con el que empieza la semana. */
  startMs: number;
  /** «12 oct». */
  label: string;
  hours: number;
  services: number;
  isCurrent: boolean;
}

export interface WorkloadReport {
  hasData: boolean;
  level: WorkloadLevel;
  weeks: WorkloadWeek[];
  last7Hours: number;
  next7Hours: number;
  run: {
    /** Días seguidos con servicios que incluyen hoy (los ya hechos y los programados). 0 si hoy no hay servicios. */
    length: number;
    /** Cuántos de esos días son programados (aún por venir). */
    plannedDays: number;
  };
  restDays14: number;
  nightShifts7: number;
  /** Descansos de menos de 8 h entre turnos, en los últimos 14 días y los próximos 7. */
  quickTurnarounds: number;
  overlapsAhead: number;
  longestShiftHours: number;
  /** El primer día sin servicios de hoy en adelante (7 días). */
  nextRestDay: { dayMs: number; label: string; isToday: boolean } | null;
  insights: WorkloadInsight[];
}

interface Interval {
  start: number;
  end: number;
  hours: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Horas que un intervalo pasa dentro de [from, to). */
function overlapHours(i: Interval, from: number, to: number): number {
  const a = Math.max(i.start, from);
  const b = Math.min(i.end, to);
  return b > a ? (b - a) / HOUR_MS : 0;
}

function nightHours(i: Interval): number {
  let total = 0;
  for (const part of splitByBogotaDay(i.start, i.end)) {
    const dayStart = startOfBogotaDay(part.startMs);
    total += overlapHours(
      { start: part.startMs, end: part.endMs, hours: part.hours },
      dayStart,
      dayStart + 7 * HOUR_MS,
    );
    total += overlapHours(
      { start: part.startMs, end: part.endMs, hours: part.hours },
      dayStart + 19 * HOUR_MS,
      dayStart + DAY_MS,
    );
  }
  return total;
}

function intervalsOf(bookings: WorkBooking[]): Interval[] {
  const out: Interval[] = [];
  for (const b of bookings) {
    if (!(WORK_STATUS as readonly string[]).includes(b.status)) continue;
    const start = msOf(b.scheduled_at);
    const hours = Math.min(24, num(b.duration_hours));
    if (!Number.isFinite(start) || hours <= 0) continue;
    out.push({ start, end: start + hours * HOUR_MS, hours });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** «12 oct» a partir del lunes de la semana. */
function weekLabel(startMs: number): string {
  return dayLabelEs(startMs).split(" ").slice(1).join(" ");
}

export function buildWorkloadReport(args: {
  bookings: WorkBooking[];
  now?: number;
}): WorkloadReport {
  const now = args.now ?? Date.now();
  const all = intervalsOf(args.bookings);
  // Ventana de análisis: 28 días atrás y 14 adelante; lo que cae fuera no cambia el cuadro de hoy.
  const from = now - 28 * DAY_MS;
  const to = now + 14 * DAY_MS;
  const items = all.filter((i) => i.end > from && i.start < to);

  const hoursByDay = new Map<number, number>();
  for (const i of items) {
    for (const part of splitByBogotaDay(i.start, i.end)) {
      hoursByDay.set(part.day, (hoursByDay.get(part.day) ?? 0) + part.hours);
    }
  }
  const worked = (day: number) => (hoursByDay.get(day) ?? 0) >= WORKED_DAY_MIN_HOURS;
  const today = bogotaDayIndex(now);

  // ── Semanas (lunes a domingo) ──────────────────────────────────────────────
  const thisMonday = startOfBogotaDay(now) - bogotaWeekday(now) * DAY_MS;
  const weeks: WorkloadWeek[] = Array.from({ length: WORKLOAD_WEEKS }, (_, k) => {
    const startMs = thisMonday - (WORKLOAD_WEEKS - 1 - k) * 7 * DAY_MS;
    const endMs = startMs + 7 * DAY_MS;
    const inside = items.filter((i) => i.end > startMs && i.start < endMs);
    return {
      startMs,
      label: weekLabel(startMs),
      hours: round1(inside.reduce((n, i) => n + overlapHours(i, startMs, endMs), 0)),
      services: inside.filter((i) => i.start >= startMs && i.start < endMs).length,
      isCurrent: k === WORKLOAD_WEEKS - 1,
    };
  });

  const last7Hours = round1(items.reduce((n, i) => n + overlapHours(i, now - 7 * DAY_MS, now), 0));
  const next7Hours = round1(items.reduce((n, i) => n + overlapHours(i, now, now + 7 * DAY_MS), 0));

  // ── Días seguidos que incluyen hoy ─────────────────────────────────────────
  let back = 0;
  while (worked(today - back)) back += 1;
  let forward = 0;
  while (worked(today + 1 + forward)) forward += 1;
  const runLength = worked(today) ? back + forward : 0;
  const plannedDays = worked(today) ? forward + (hasPlannedHoursToday(items, now) ? 1 : 0) : 0;

  // ── Descansos y turnos de noche ────────────────────────────────────────────
  let restDays14 = 0;
  for (let d = today - 14; d < today; d++) if (!worked(d)) restDays14 += 1;

  const started = items.filter((i) => i.start <= now);
  const nightShifts7 = started.filter(
    (i) => i.start > now - 7 * DAY_MS && nightHours(i) >= NIGHT_MIN_HOURS,
  ).length;

  // Se compara cada servicio con el que termina más tarde de los anteriores (uno largo puede contener a otro corto).
  let quickTurnarounds = 0;
  let overlapsAhead = 0;
  let maxEnd = items.length ? items[0].end : 0;
  for (let k = 1; k < items.length; k++) {
    const b = items[k];
    const gapH = (b.start - maxEnd) / HOUR_MS;
    if (gapH < 0) {
      if (b.start > now) overlapsAhead += 1;
    } else if (
      gapH < MIN_REST_BETWEEN_SHIFTS_H &&
      b.start >= now - 14 * DAY_MS &&
      b.start <= now + 7 * DAY_MS
    ) {
      quickTurnarounds += 1;
    }
    maxEnd = Math.max(maxEnd, b.end);
  }

  const longestShiftHours = round1(items.reduce((m, i) => Math.max(m, i.hours), 0));

  // ── Próximo día sin servicios (hoy incluido) ───────────────────────────────
  let nextRestDay: WorkloadReport["nextRestDay"] = null;
  for (let d = today; d < today + 7; d++) {
    if (!worked(d)) {
      const dayMs = startOfBogotaDay(now) + (d - today) * DAY_MS;
      nextRestDay = { dayMs, label: longDayLabelEs(dayMs + 12 * HOUR_MS), isToday: d === today };
      break;
    }
  }

  // ── Nivel ──────────────────────────────────────────────────────────────────
  let level: WorkloadLevel = "ok";
  if (
    runLength >= WATCH_RUN_DAYS ||
    last7Hours > WATCH_WEEK_HOURS ||
    next7Hours > HIGH_WEEK_HOURS ||
    quickTurnarounds >= WATCH_QUICK_TURNAROUNDS ||
    nightShifts7 >= WATCH_NIGHTS_7D
  )
    level = "watch";
  if (
    runLength >= HIGH_RUN_DAYS ||
    last7Hours > HIGH_WEEK_HOURS ||
    quickTurnarounds >= HIGH_QUICK_TURNAROUNDS
  )
    level = "high";

  const report: WorkloadReport = {
    hasData: items.length > 0,
    level,
    weeks,
    last7Hours,
    next7Hours,
    run: { length: runLength, plannedDays },
    restDays14,
    nightShifts7,
    quickTurnarounds,
    overlapsAhead,
    longestShiftHours,
    nextRestDay,
    insights: [],
  };
  report.insights = workloadInsights(report);
  return report;
}

/** ¿Queda hoy algún servicio por empezar o en curso? (para contar «hoy» como programado). */
function hasPlannedHoursToday(items: Interval[], now: number): boolean {
  const dayStart = startOfBogotaDay(now);
  return items.some((i) => i.end > now && i.start < dayStart + DAY_MS);
}

export function workloadInsights(r: WorkloadReport): WorkloadInsight[] {
  const out: WorkloadInsight[] = [];
  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "No hay servicios recientes ni programados para medir tu carga",
        detail:
          "Cuando tengas servicios hechos o programados verás aquí tus horas por semana y cuándo conviene descansar.",
      },
    ];
  }

  const rest = r.nextRestDay;
  const restAction = rest
    ? rest.isToday
      ? "Hoy no tienes servicios: aprovecha para descansar."
      : `El ${rest.label} no tienes servicios: puede ser tu día de descanso.`
    : "No tienes un día libre en los próximos 7 días; si puedes, deja uno sin turnos.";

  if (r.run.length >= WATCH_RUN_DAYS) {
    out.push({
      id: "run_long",
      severity: r.run.length >= HIGH_RUN_DAYS ? "warn" : "info",
      title:
        r.run.plannedDays > 0 && r.run.plannedDays >= r.run.length - 1
          ? `Tienes ${r.run.length} días seguidos con servicios programados`
          : `Llevas ${r.run.length} días seguidos con servicios`,
      detail:
        "Un día completo sin turnos cada semana ayuda a cuidar con la misma energía del primer día.",
      action: restAction,
    });
  }

  if (r.last7Hours > WATCH_WEEK_HOURS) {
    out.push({
      id: "hours_week",
      severity: r.last7Hours > HIGH_WEEK_HOURS ? "warn" : "info",
      title: `Trabajaste ${r.last7Hours} h en los últimos 7 días`,
      detail: `Como referencia, un empleado en Colombia no pasa de ${REFERENCE_WEEKLY_HOURS} h por semana. Es una guía de bienestar, no una norma para ti como independiente.`,
    });
  }

  if (r.next7Hours > HIGH_WEEK_HOURS) {
    out.push({
      id: "week_ahead",
      severity: "info",
      title: `Tienes ${r.next7Hours} h programadas para los próximos 7 días`,
      detail:
        "Es una semana muy cargada. Antes de aceptar más turnos, mira si te deja un día libre.",
      action: restAction,
    });
  }

  if (r.quickTurnarounds >= WATCH_QUICK_TURNAROUNDS) {
    out.push({
      id: "quick_turnarounds",
      severity: r.quickTurnarounds >= HIGH_QUICK_TURNAROUNDS ? "warn" : "info",
      title: `${plural(r.quickTurnarounds, "descanso", "descansos")} de menos de ${MIN_REST_BETWEEN_SHIFTS_H} h entre turnos`,
      detail:
        "Cuenta los últimos 14 días y los próximos 7. Dormir bien entre turnos protege tu salud y la de la persona que cuidas.",
    });
  }

  if (r.nightShifts7 >= WATCH_NIGHTS_7D) {
    out.push({
      id: "nights",
      severity: "info",
      title: `${plural(r.nightShifts7, "turno de noche", "turnos de noche")} en los últimos 7 días`,
      detail: "Después de varias noches seguidas el cuerpo pide un día para recuperar el sueño.",
    });
  }

  if (r.overlapsAhead > 0) {
    out.push({
      id: "overlap",
      severity: "warn",
      title: `${plural(r.overlapsAhead, "servicio se cruza", "servicios se cruzan")} con otro en tu agenda`,
      detail:
        "No podrás cumplir los dos. Revisa tu agenda y avisa a la familia o a la institución con tiempo.",
    });
  }

  if (r.longestShiftHours >= 16 && r.level === "ok") {
    out.push({
      id: "long_shift",
      severity: "info",
      title: `Tienes turnos de ${r.longestShiftHours} h`,
      detail: "Después de un turno largo, deja un descanso completo antes del siguiente.",
    });
  }

  if (r.level === "ok" && r.restDays14 >= 3) {
    const avg = round1(
      r.weeks.slice(0, -1).reduce((n, w) => n + w.hours, 0) / Math.max(1, r.weeks.length - 1),
    );
    out.push({
      id: "balanced",
      severity: "good",
      title: `Buen equilibrio: descansaste ${r.restDays14} de los últimos 14 días`,
      detail: `Tu promedio de las semanas anteriores es de ${avg} h por semana. Así se cuida a quien cuida.`,
    });
  }

  const order: Record<WorkloadSeverity, number> = { warn: 0, info: 1, good: 2 };
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order[a.x.severity] - order[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
