// Pronóstico de cobertura a 14 días: qué días van cubiertos y cuáles piden acción — lógica pura.
//
// Con los turnos que la institución ya publicó (cupos, cupos cubiertos, horario) arma el calendario de los próximos
// 14 días con las horas que faltan por cubrir y el riesgo de cada día, y mira los últimos dos meses para encontrar los
// horarios que se repiten sin cubrir («los sábados por la noche»). El riesgo de cada turno es el mismo del centro de
// cobertura (`assessShift`): este pronóstico no inventa otra regla, solo la pone en el calendario. No contacta a nadie ni
// cambia ninguna oferta.

import { assessShift, type CoverageRisk, type CoverageShiftInput } from "./institutionCoverage";
import {
  BOGOTA_OFFSET_MS,
  DAY_MS,
  HOUR_MS,
  bogotaDayIndex,
  bogotaWeekday,
  dayLabelEs,
  hoursEs,
  msOf,
  pctOf,
  plural,
  round1,
  startOfBogotaDay,
  weekdayNameEs,
} from "./intelShared";

/** Días hacia adelante que cubre el pronóstico. */
export const HORIZON_DAYS = 14;
/** Días hacia atrás que se miran para encontrar horarios que se repiten sin cubrir. */
export const HISTORY_DAYS = 56;
/** Turnos con cupos libres, en el mismo horario, desde los que se habla de un patrón. */
export const PATTERN_MIN_GAPS = 3;
/** Porcentaje mínimo de los turnos de ese horario que terminaron con cupos libres. */
export const PATTERN_MIN_SHARE = 50;
/** Semanas distintas mínimas en que ocurrió, para que no sea una sola mala semana. */
export const PATTERN_MIN_WEEKS = 3;
/** Cupos mínimos en el historial para hablar de su porcentaje sin cubrir. */
export const HISTORY_MIN_POSITIONS = 10;
/** Porcentaje del historial sin cubrir desde el que se avisa. */
export const HISTORY_GAP_ALERT_PCT = 20;
/** Cupos mínimos de una semana para opinar de su cobertura. */
export const WEEK_MIN_POSITIONS = 4;
/** Cobertura de los próximos 7 días por debajo de la cual se avisa. */
export const WEEK1_LOW_PCT = 70;
/** Cobertura de la segunda semana por debajo de la cual se menciona. */
export const WEEK2_LOW_PCT = 50;
/** Horas hacia adelante que se consideran «pronto». */
export const URGENT_HOURS = 48;

export type ShiftPart = "morning" | "afternoon" | "night";

export const PART_LABEL: Record<ShiftPart, string> = {
  morning: "por la mañana",
  afternoon: "por la tarde",
  night: "por la noche",
};

/** Franja de un turno por su hora de inicio en Colombia: noche de 19:00 a 06:59, mañana hasta las 12:59. */
export function shiftPart(startMs: number): ShiftPart {
  const hour = new Date(startMs + BOGOTA_OFFSET_MS).getUTCHours();
  if (hour >= 19 || hour < 7) return "night";
  return hour < 13 ? "morning" : "afternoon";
}

/** «los sábados», «los lunes»: los días que ya terminan en «s» no cambian. */
export function pluralWeekday(dow: number): string {
  const name = weekdayNameEs(dow);
  return `los ${/s$/.test(name) ? name : `${name}s`}`;
}

export type DayRisk = "none" | CoverageRisk;

const RISK_ORDER: Record<CoverageRisk, number> = {
  critical: 0,
  high: 1,
  watch: 2,
  ok: 3,
  covered: 4,
};

export interface ForecastDay {
  /** Medianoche de Colombia con la que empieza el día (ms UTC). */
  dayMs: number;
  label: string;
  isToday: boolean;
  shifts: number;
  positions: number;
  filled: number;
  open: number;
  openHours: number;
  totalHours: number;
  /** El peor riesgo entre los turnos con cupos libres; «covered» si todo está cubierto; «none» si no hay turnos. */
  risk: DayRisk;
}

export interface ForecastWeek {
  label: string;
  shifts: number;
  positions: number;
  filled: number;
  /** Porcentaje de cupos cubiertos (`null` sin cupos). */
  coveragePct: number | null;
  openHours: number;
}

export interface GapPattern {
  weekday: number;
  part: ShiftPart;
  /** «los sábados por la noche». */
  label: string;
  gapShifts: number;
  totalShifts: number;
  weeks: number;
}

export type ForecastSeverity = "warn" | "info" | "good";

export interface ForecastInsight {
  id: string;
  severity: ForecastSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface ForecastReport {
  hasData: boolean;
  days: ForecastDay[];
  weeks: ForecastWeek[];
  totals: {
    shifts: number;
    positions: number;
    filled: number;
    open: number;
    openHours: number;
    coveragePct: number | null;
  };
  /** Cupos libres que empiezan en menos de 48 h (o que ya empezaron). */
  next48: { shifts: number; openHours: number };
  history: { shifts: number; positions: number; unfilled: number; gapPct: number | null };
  pattern: GapPattern | null;
  insights: ForecastInsight[];
}

export interface ForecastInput {
  /** Un renglón por turno publicado (ofertas abiertas y cubiertas), con su agenda completa. */
  inputs: CoverageShiftInput[];
  now: number;
  horizonDays?: number;
  historyDays?: number;
}

const hoursOf = (i: CoverageShiftInput): number => {
  const h = (msOf(i.endsAt) - msOf(i.startsAt)) / HOUR_MS;
  return Number.isFinite(h) && h > 0 ? h : 0;
};

/** Identificador de la semana (lunes a domingo) de Colombia, para contar semanas distintas. */
const weekId = (t: number) => (bogotaDayIndex(t) - bogotaWeekday(t)) / 7;

export function buildForecast(input: ForecastInput): ForecastReport {
  const { now } = input;
  const horizon = input.horizonDays ?? HORIZON_DAYS;
  const historyDays = input.historyDays ?? HISTORY_DAYS;
  const todayStart = startOfBogotaDay(now);
  const horizonEnd = todayStart + horizon * DAY_MS;

  const days: ForecastDay[] = Array.from({ length: horizon }, (_, i) => {
    const dayMs = todayStart + i * DAY_MS;
    return {
      dayMs,
      label: dayLabelEs(dayMs + 12 * HOUR_MS),
      isToday: i === 0,
      shifts: 0,
      positions: 0,
      filled: 0,
      open: 0,
      openHours: 0,
      totalHours: 0,
      risk: "none",
    };
  });
  const worst = days.map<CoverageRisk | null>(() => null);
  let next48Shifts = 0;
  let next48Hours = 0;

  // ── Lo que viene ─────────────────────────────────────────────────────────────
  for (const shift of input.inputs) {
    const start = msOf(shift.startsAt);
    // Después del último día no entra. Un turno ya terminado o con fechas dañadas no lo evalúa `assessShift` (devuelve null).
    if (start >= horizonEnd) continue;
    const assessed = assessShift(shift, now);
    if (!assessed) continue;
    // Un turno que ya empezó (o que cruzó la medianoche) cuenta en el día de hoy.
    const index = Math.floor((Math.max(start, todayStart) - todayStart) / DAY_MS);
    const day = days[index];
    const hours = hoursOf(shift);
    day.shifts += 1;
    day.positions += shift.positions;
    day.filled += Math.min(shift.filled, shift.positions);
    day.open += assessed.open;
    day.openHours += assessed.open * hours;
    day.totalHours += shift.positions * hours;
    if (assessed.open > 0) {
      const current = worst[index];
      if (current === null || RISK_ORDER[assessed.risk] < RISK_ORDER[current]) {
        worst[index] = assessed.risk;
      }
      if (assessed.hoursToStart <= URGENT_HOURS) {
        next48Shifts += 1;
        next48Hours += assessed.open * hours;
      }
    }
  }
  days.forEach((d, i) => {
    d.openHours = round1(d.openHours);
    d.totalHours = round1(d.totalHours);
    d.risk = worst[i] ?? (d.shifts > 0 ? "covered" : "none");
  });

  // ── Semanas y totales ────────────────────────────────────────────────────────
  const weeks: ForecastWeek[] = [];
  for (let from = 0; from < horizon; from += 7) {
    const slice = days.slice(from, from + 7);
    const positions = slice.reduce((s, d) => s + d.positions, 0);
    const filled = slice.reduce((s, d) => s + d.filled, 0);
    weeks.push({
      label: from === 0 ? "Próximos 7 días" : `Días ${from + 1} al ${Math.min(horizon, from + 7)}`,
      shifts: slice.reduce((s, d) => s + d.shifts, 0),
      positions,
      filled,
      coveragePct: pctOf(filled, positions),
      openHours: round1(slice.reduce((s, d) => s + d.openHours, 0)),
    });
  }
  const positions = days.reduce((s, d) => s + d.positions, 0);
  const filled = days.reduce((s, d) => s + d.filled, 0);
  const totals = {
    shifts: days.reduce((s, d) => s + d.shifts, 0),
    positions,
    filled,
    open: positions - filled,
    openHours: round1(days.reduce((s, d) => s + d.openHours, 0)),
    coveragePct: pctOf(filled, positions),
  };

  // ── Lo que ya pasó: horarios que se repiten sin cubrir ───────────────────────
  const since = now - historyDays * DAY_MS;
  const groups = new Map<
    string,
    { weekday: number; part: ShiftPart; total: number; gaps: number; weeks: Set<number> }
  >();
  let historyShifts = 0;
  let historyPositions = 0;
  let historyUnfilled = 0;
  for (const shift of input.inputs) {
    const start = msOf(shift.startsAt);
    const end = msOf(shift.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end > now || start < since) continue;
    const unfilled = Math.max(0, shift.positions - shift.filled);
    historyShifts += 1;
    historyPositions += shift.positions;
    historyUnfilled += unfilled;
    const weekday = bogotaWeekday(start);
    const part = shiftPart(start);
    const key = `${weekday}-${part}`;
    const g = groups.get(key) ?? { weekday, part, total: 0, gaps: 0, weeks: new Set<number>() };
    g.total += 1;
    if (unfilled > 0) {
      g.gaps += 1;
      g.weeks.add(weekId(start));
    }
    groups.set(key, g);
  }
  const PART_ORDER: Record<ShiftPart, number> = { morning: 0, afternoon: 1, night: 2 };
  const best = [...groups.values()]
    .filter(
      (g) =>
        g.gaps >= PATTERN_MIN_GAPS &&
        (g.gaps / g.total) * 100 >= PATTERN_MIN_SHARE &&
        g.weeks.size >= PATTERN_MIN_WEEKS,
    )
    .sort(
      (a, b) => b.gaps - a.gaps || a.weekday - b.weekday || PART_ORDER[a.part] - PART_ORDER[b.part],
    )[0];
  const pattern: GapPattern | null = best
    ? {
        weekday: best.weekday,
        part: best.part,
        label: `${pluralWeekday(best.weekday)} ${PART_LABEL[best.part]}`,
        gapShifts: best.gaps,
        totalShifts: best.total,
        weeks: best.weeks.size,
      }
    : null;

  const report: ForecastReport = {
    hasData: totals.shifts > 0,
    days,
    weeks,
    totals,
    next48: { shifts: next48Shifts, openHours: round1(next48Hours) },
    history: {
      shifts: historyShifts,
      positions: historyPositions,
      unfilled: historyUnfilled,
      gapPct:
        historyPositions >= HISTORY_MIN_POSITIONS ? pctOf(historyUnfilled, historyPositions) : null,
    },
    pattern,
    insights: [],
  };
  report.insights = forecastInsights(report, horizon);
  return report;
}

/** Una frase para el encabezado. */
export function forecastHeadline(r: ForecastReport, horizon = HORIZON_DAYS): string {
  if (r.totals.shifts === 0) return `Sin turnos publicados para los próximos ${horizon} días.`;
  if (r.totals.open === 0) return `Los próximos ${horizon} días están cubiertos.`;
  return `Próximos ${horizon} días: ${r.totals.coveragePct ?? 0} % cubierto, ${hoursEs(r.totals.openHours)} h por cubrir.`;
}

const SEVERITY_ORDER: Record<ForecastSeverity, number> = { warn: 0, info: 1, good: 2 };

export function forecastInsights(r: ForecastReport, horizon = HORIZON_DAYS): ForecastInsight[] {
  const out: ForecastInsight[] = [];

  if (r.totals.shifts === 0) {
    out.push({
      id: "no_shifts",
      severity: "info",
      title: `No tienes turnos publicados para los próximos ${horizon} días`,
      detail:
        r.history.shifts > 0
          ? "Publicar con anticipación te da más margen para cubrirlos sin urgencias."
          : "Cuando publiques turnos, aquí verás qué días van cubiertos y cuáles necesitan acción.",
      action: "Publica tus próximos turnos desde Inicio.",
    });
  }

  if (r.next48.openHours > 0) {
    out.push({
      id: "urgent_open",
      severity: "warn",
      title: `${hoursEs(r.next48.openHours)} h sin cubrir en las próximas ${URGENT_HOURS} horas`,
      detail: `${plural(r.next48.shifts, "turno con cupos libres empieza", "turnos con cupos libres empiezan")} pronto.`,
      action:
        "En el centro de cobertura puedes invitar a tu equipo, subir el valor o marcarlos urgentes.",
    });
  }

  const [week1, week2] = r.weeks;
  if (
    week1 &&
    week1.positions >= WEEK_MIN_POSITIONS &&
    (week1.coveragePct ?? 100) < WEEK1_LOW_PCT
  ) {
    out.push({
      id: "week1_low",
      severity: "warn",
      title: `Los próximos 7 días van por el ${week1.coveragePct} % cubiertos`,
      detail: `Faltan ${hoursEs(week1.openHours)} h por cubrir en ${plural(week1.positions - week1.filled, "cupo", "cupos")}.`,
      action: "Invita a tu equipo de confianza y revisa el valor de los turnos que faltan.",
    });
  }
  if (
    week2 &&
    week2.positions >= WEEK_MIN_POSITIONS &&
    (week2.coveragePct ?? 100) < WEEK2_LOW_PCT
  ) {
    out.push({
      id: "week2_low",
      severity: "info",
      title: `La segunda semana va por el ${week2.coveragePct} % cubierta`,
      detail: `Faltan ${hoursEs(week2.openHours)} h por cubrir. Todavía hay tiempo para hacerlo sin urgencias.`,
      action: "Invita a tu equipo o publica de nuevo los turnos que no tienen postulantes.",
    });
  }

  if (r.pattern) {
    const p = r.pattern;
    const sentence = `${p.label.charAt(0).toUpperCase()}${p.label.slice(1)}`;
    out.push({
      id: "recurring_gap",
      severity: "warn",
      title: `${sentence} suelen quedar sin cubrir`,
      detail: `${p.gapShifts} de ${p.totalShifts} turnos de ese horario terminaron con cupos libres en las últimas ${Math.round(HISTORY_DAYS / 7)} semanas (${p.weeks} semanas distintas).`,
      action:
        "Publícalos con más anticipación, invita a tu equipo o revisa el valor de esos turnos.",
    });
  } else if (r.history.gapPct !== null && r.history.gapPct >= HISTORY_GAP_ALERT_PCT) {
    out.push({
      id: "history_gap",
      severity: "info",
      title: `El ${r.history.gapPct} % de los cupos de las últimas ${Math.round(HISTORY_DAYS / 7)} semanas terminó sin cubrir`,
      detail: `${plural(r.history.unfilled, "cupo quedó libre", "cupos quedaron libres")} de ${r.history.positions}.`,
      action: "Publicar antes o ajustar el valor suele subir la cobertura.",
    });
  }

  if (r.totals.shifts > 0 && r.totals.open === 0) {
    out.push({
      id: "all_covered",
      severity: "good",
      title: `Tus próximos ${horizon} días están cubiertos`,
      detail: `${plural(r.totals.shifts, "turno publicado", "turnos publicados")} y todos con su equipo completo.`,
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
