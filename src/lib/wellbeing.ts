// Informe de bienestar (plan de pago) — lógica pura.
//
// Con los partes que los profesionales ya registran en cada turno, resume cómo ha estado la persona cuidada: ánimo,
// signos vitales frente a rangos generales, alertas, medicamentos registrados y continuidad del equipo. Todo es
// determinista y se calcula en el navegador con datos que la familia ya puede leer: nada se envía a una IA ni a
// terceros, y no se inventa nada. NO diagnostica: señala lo que merece conversarse con el médico tratante, igual que
// los rangos de `careLog` (adultos en reposo; cada paciente puede tener metas distintas).

import {
  CARE_MOODS,
  MOOD_META,
  VITALS_DISCLAIMER,
  VITAL_LIMITS,
  isCareMood,
  isManualEvent,
  vitalFlags,
  type CareMood,
  type VitalKey,
  type Vitals,
} from "./careLog";
import {
  DAY_MS,
  HOUR_MS,
  average,
  dateEs,
  dayLabelEs,
  msOf,
  num,
  numOrNull,
  pctOf,
  plural,
  round1,
} from "./familyIntelShared";

// ─── Entradas ──────────────────────────────────────────────────────────────────

export interface WellbeingBooking {
  id: string;
  status: string;
  scheduled_at: string;
  duration_hours: number | string | null;
  professional_id: string;
  professional_name?: string | null;
}

export interface WellbeingLog {
  id: string;
  booking_id: string;
  event_type: string;
  description?: string | null;
  mood?: string | null;
  vital_systolic: number | string | null;
  vital_diastolic: number | string | null;
  vital_heart_rate: number | string | null;
  vital_temperature: number | string | null;
  vital_oxygen: number | string | null;
  is_alert: boolean;
  alert_reason?: string | null;
  system_generated?: boolean | null;
  created_at: string;
}

export const WELLBEING_WINDOWS = [7, 30, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;
/** Servicios con ánimo registrado para hablar de tendencia. */
export const MIN_MOODS_FOR_TREND = 4;
/** Lecturas de un signo vital para hablar de tendencia. */
export const MIN_READINGS_FOR_TREND = 4;
/** Lecturas que se guardan por signo para dibujar su evolución. */
export const SERIES_MAX = 24;
/** Servicios con parte para hablar de huecos de medicamentos. */
export const MIN_REPORTED_FOR_MEDS = 3;

// ─── Salidas ───────────────────────────────────────────────────────────────────

export type Trend = "up" | "down" | "flat" | "unknown";
export type MoodTrend = "better" | "worse" | "stable" | "unknown";
export type VitalGroup = "bp" | "heartRate" | "temperature" | "oxygen";
export type ReadingLevel = "ok" | "watch" | "alert";
export type HighlightSeverity = "alert" | "watch" | "ok" | "info";
export type Confidence = "low" | "medium" | "high";
export type ContinuityLevel = "high" | "medium" | "low" | "unknown";

export interface VitalSummary {
  key: VitalGroup;
  label: string;
  unit: string;
  readings: number;
  avg: number | null;
  /** Diastólica promedio (solo presión arterial). */
  avg2: number | null;
  min: number | null;
  max: number | null;
  /** Cifra principal de cada lectura, de la más antigua a la más reciente (hasta las últimas 24), para el gráfico. */
  series: number[];
  last: { at: string; value: number; value2: number | null; level: ReadingLevel } | null;
  /** La lectura más reciente que quedó fuera de rango (aunque después hayan salido bien). */
  lastAlert: { at: string; value: number; value2: number | null } | null;
  watch: number;
  alert: number;
  trend: Trend;
  /** La tendencia va en la dirección que preocupa (presión, pulso o temperatura al alza; oxígeno a la baja). */
  concerning: boolean;
}

export interface AlertEntry {
  at: string;
  bookingId: string;
  kind: "alert" | "incident";
  reason: string;
}

export interface Highlight {
  id: string;
  severity: HighlightSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface WellbeingReport {
  period: { fromMs: number; toMs: number; days: number };
  services: {
    count: number;
    completed: number;
    inProgress: number;
    hours: number;
    /** Terminados con al menos un registro del profesional. */
    reportedCompleted: number;
    reportedPct: number | null;
  };
  moods: {
    withMood: number;
    counts: Record<CareMood, number>;
    positive: number;
    positivePct: number | null;
    negativePct: number | null;
    trend: MoodTrend;
    byService: Array<{ bookingId: string; at: string; mood: CareMood }>;
  };
  vitals: VitalSummary[];
  vitalReadings: number;
  medication: {
    withReport: number;
    withRecords: number;
    withoutRecords: number;
    totalEvents: number;
    gap: boolean;
  };
  alerts: { total: number; last7d: number; recent: AlertEntry[] };
  continuity: {
    professionals: number;
    topId: string | null;
    topName: string | null;
    topSharePct: number | null;
    level: ContinuityLevel;
  };
  confidence: Confidence;
  highlights: Highlight[];
  disclaimer: string;
}

// ─── Constantes del cálculo ────────────────────────────────────────────────────

const POSITIVE: readonly CareMood[] = ["happy", "calm"];
const NEGATIVE: readonly CareMood[] = ["tired", "sad", "pain", "agitated"];
const MOOD_SCORE: Record<CareMood, number> = {
  happy: 2,
  calm: 1,
  tired: -1,
  sad: -1.5,
  agitated: -1.5,
  pain: -2,
};

interface GroupDef {
  key: VitalGroup;
  label: string;
  unit: string;
  flagKey: VitalKey;
  main: keyof Vitals;
  second?: keyof Vitals;
  /** Cambio (mitad reciente − mitad antigua) a partir del cual se habla de tendencia. */
  threshold: number;
  /** Dirección que preocupa. */
  worse: "up" | "down";
  decimals: number;
}

const GROUPS: GroupDef[] = [
  {
    key: "bp",
    label: "Presión arterial",
    unit: "mmHg",
    flagKey: "systolic",
    main: "systolic",
    second: "diastolic",
    threshold: 8,
    worse: "up",
    decimals: 0,
  },
  {
    key: "heartRate",
    label: "Frecuencia cardíaca",
    unit: "lpm",
    flagKey: "heartRate",
    main: "heartRate",
    threshold: 8,
    worse: "up",
    decimals: 0,
  },
  {
    key: "temperature",
    label: "Temperatura",
    unit: "°C",
    flagKey: "temperature",
    main: "temperature",
    threshold: 0.4,
    worse: "up",
    decimals: 1,
  },
  {
    key: "oxygen",
    label: "Saturación de oxígeno",
    unit: "%",
    flagKey: "oxygen",
    main: "oxygen",
    threshold: 2,
    worse: "down",
    decimals: 0,
  },
];

const IN_WINDOW_STATUS = ["completed", "in_progress"];

const clampDays = (d: number | undefined) =>
  Number.isFinite(d) ? Math.min(365, Math.max(1, Math.round(d as number))) : DEFAULT_WINDOW_DAYS;

const roundTo = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

/** Valor de un signo vital dentro de los límites de la base de datos; lo demás se descarta. */
function vital(raw: number | string | null, key: VitalKey): number | null {
  const n = numOrNull(raw);
  if (n === null) return null;
  const { min, max } = VITAL_LIMITS[key];
  return n >= min && n <= max ? n : null;
}

function vitalsOfLog(l: WellbeingLog): Vitals {
  return {
    systolic: vital(l.vital_systolic, "systolic"),
    diastolic: vital(l.vital_diastolic, "diastolic"),
    heartRate: vital(l.vital_heart_rate, "heartRate"),
    temperature: vital(l.vital_temperature, "temperature"),
    oxygen: vital(l.vital_oxygen, "oxygen"),
  };
}

const sentence = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// ─── Cálculo ───────────────────────────────────────────────────────────────────

interface Reading {
  at: number;
  iso: string;
  value: number;
  value2: number | null;
  level: ReadingLevel;
}

function summarizeGroup(def: GroupDef, readings: Reading[]): VitalSummary {
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const n = sorted.length;
  const values = sorted.map((r) => r.value);
  const values2 = sorted.map((r) => r.value2).filter((v): v is number => v !== null);
  const last = sorted[n - 1];
  const lastAlert = [...sorted].reverse().find((r) => r.level === "alert");

  let trend: Trend = "unknown";
  if (n >= MIN_READINGS_FOR_TREND) {
    const half = Math.floor(n / 2);
    const delta =
      (average(values.slice(n - half)) as number) - (average(values.slice(0, half)) as number);
    trend = delta >= def.threshold ? "up" : delta <= -def.threshold ? "down" : "flat";
  }
  return {
    key: def.key,
    label: def.label,
    unit: def.unit,
    readings: n,
    avg: n ? roundTo(average(values) as number, def.decimals) : null,
    avg2: values2.length ? Math.round(average(values2) as number) : null,
    min: n ? Math.min(...values) : null,
    max: n ? Math.max(...values) : null,
    series: values.slice(-SERIES_MAX),
    last: last ? { at: last.iso, value: last.value, value2: last.value2, level: last.level } : null,
    lastAlert: lastAlert
      ? { at: lastAlert.iso, value: lastAlert.value, value2: lastAlert.value2 }
      : null,
    watch: sorted.filter((r) => r.level === "watch").length,
    alert: sorted.filter((r) => r.level === "alert").length,
    trend,
    concerning: trend !== "unknown" && trend !== "flat" && trend === def.worse,
  };
}

export function buildWellbeingReport(args: {
  bookings: WellbeingBooking[];
  logs: WellbeingLog[];
  now?: number;
  windowDays?: number;
  /** El servidor devolvió el tope de filas: puede haber más registros de los que se ven. */
  logsTruncated?: boolean;
}): WellbeingReport {
  const now = args.now ?? Date.now();
  const days = clampDays(args.windowDays);
  const from = now - days * DAY_MS;

  const bookings = args.bookings.filter((b) => {
    const t = msOf(b.scheduled_at);
    return (
      IN_WINDOW_STATUS.includes(b.status) &&
      Number.isFinite(t) &&
      t >= from &&
      t <= now + 12 * HOUR_MS
    );
  });
  const ids = new Set(bookings.map((b) => b.id));

  const logsBy = new Map<string, WellbeingLog[]>();
  for (const l of args.logs) {
    if (!ids.has(l.booking_id) || !Number.isFinite(msOf(l.created_at))) continue;
    const list = logsBy.get(l.booking_id);
    if (list) list.push(l);
    else logsBy.set(l.booking_id, [l]);
  }
  const manualOf = (bookingId: string) =>
    (logsBy.get(bookingId) ?? []).filter((l) => !l.system_generated && isManualEvent(l.event_type));
  const allManual = bookings.flatMap((b) => manualOf(b.id));

  // ── Servicios ──────────────────────────────────────────────────────────────
  const completed = bookings.filter((b) => b.status === "completed");
  const reportedCompleted = completed.filter((b) => manualOf(b.id).length > 0).length;
  const hours = round1(bookings.reduce((n, b) => n + Math.max(0, num(b.duration_hours)), 0));

  // ── Ánimo: el último registrado de cada servicio ───────────────────────────
  const byService: WellbeingReport["moods"]["byService"] = [];
  for (const b of bookings) {
    const withMood = (logsBy.get(b.id) ?? [])
      .filter((l) => isCareMood(l.mood))
      .sort((a, c) => msOf(c.created_at) - msOf(a.created_at) || c.id.localeCompare(a.id));
    if (withMood[0])
      byService.push({
        bookingId: b.id,
        at: withMood[0].created_at,
        mood: withMood[0].mood as CareMood,
      });
  }
  byService.sort((a, b) => msOf(a.at) - msOf(b.at) || a.bookingId.localeCompare(b.bookingId));
  const counts = Object.fromEntries(CARE_MOODS.map((m) => [m, 0])) as Record<CareMood, number>;
  for (const m of byService) counts[m.mood] += 1;
  const withMood = byService.length;
  const positive = POSITIVE.reduce((n, m) => n + counts[m], 0);
  const negative = NEGATIVE.reduce((n, m) => n + counts[m], 0);
  let moodTrend: MoodTrend = "unknown";
  if (withMood >= MIN_MOODS_FOR_TREND) {
    const scores = byService.map((m) => MOOD_SCORE[m.mood]);
    const half = Math.floor(withMood / 2);
    const delta =
      (average(scores.slice(withMood - half)) as number) -
      (average(scores.slice(0, half)) as number);
    moodTrend = delta >= 0.5 ? "better" : delta <= -0.5 ? "worse" : "stable";
  }

  // ── Signos vitales ─────────────────────────────────────────────────────────
  const readingsBy = new Map<VitalGroup, Reading[]>(GROUPS.map((g) => [g.key, []]));
  for (const l of allManual) {
    const v = vitalsOfLog(l);
    const flags = vitalFlags(v);
    const at = msOf(l.created_at);
    for (const g of GROUPS) {
      const main = v[g.main];
      // Cada signo se resume por su cifra principal (en la presión, la sistólica; la diastólica la acompaña).
      if (typeof main !== "number") continue;
      const second = g.second ? v[g.second] : null;
      const mine = flags.filter((f) => f.key === g.flagKey);
      const level: ReadingLevel = mine.some((f) => f.level === "alert")
        ? "alert"
        : mine.length
          ? "watch"
          : "ok";
      readingsBy.get(g.key)?.push({
        at,
        iso: l.created_at,
        value: main,
        value2: typeof second === "number" ? second : null,
        level,
      });
    }
  }
  const vitals = GROUPS.map((g) => summarizeGroup(g, readingsBy.get(g.key) ?? [])).filter(
    (s) => s.readings > 0,
  );
  const vitalReadings = vitals.reduce((n, s) => n + s.readings, 0);

  // ── Medicamentos ───────────────────────────────────────────────────────────
  const withReportIds = bookings.filter((b) => manualOf(b.id).length > 0);
  const medCounts = withReportIds.map(
    (b) => manualOf(b.id).filter((l) => l.event_type === "medication").length,
  );
  const withRecords = medCounts.filter((n) => n > 0).length;
  const withoutRecords = withReportIds.length - withRecords;
  const medication = {
    withReport: withReportIds.length,
    withRecords,
    withoutRecords,
    totalEvents: medCounts.reduce((a, b) => a + b, 0),
    gap:
      withReportIds.length >= MIN_REPORTED_FOR_MEDS &&
      withRecords / withReportIds.length >= 0.6 &&
      withoutRecords >= 1,
  };

  // ── Alertas e incidentes ───────────────────────────────────────────────────
  const alertEntries: AlertEntry[] = allManual
    .filter((l) => l.is_alert || l.event_type === "incident")
    .map((l): AlertEntry => {
      const kind = l.event_type === "incident" ? "incident" : "alert";
      return {
        at: l.created_at,
        bookingId: l.booking_id,
        kind,
        reason: sentence(
          l.alert_reason?.trim() ||
            l.description?.trim() ||
            (kind === "incident" ? "Incidente registrado" : "Alerta registrada"),
        ),
      };
    })
    .sort((a, b) => msOf(b.at) - msOf(a.at) || a.bookingId.localeCompare(b.bookingId));
  const last7d = alertEntries.filter((a) => msOf(a.at) >= now - 7 * DAY_MS).length;

  // ── Continuidad del equipo ─────────────────────────────────────────────────
  const hoursBy = new Map<string, { hours: number; count: number; name: string | null }>();
  for (const b of bookings) {
    const cur = hoursBy.get(b.professional_id) ?? {
      hours: 0,
      count: 0,
      name: b.professional_name ?? null,
    };
    cur.hours += Math.max(0, num(b.duration_hours));
    cur.count += 1;
    cur.name = cur.name ?? b.professional_name ?? null;
    hoursBy.set(b.professional_id, cur);
  }
  const ranked = [...hoursBy.entries()].sort(
    (a, b) => b[1].hours - a[1].hours || b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );
  const totalHours = [...hoursBy.values()].reduce((n, v) => n + v.hours, 0);
  const top = ranked[0];
  const topShare = top
    ? totalHours > 0
      ? pctOf(top[1].hours, totalHours)
      : pctOf(top[1].count, bookings.length)
    : null;
  const continuityLevel: ContinuityLevel =
    bookings.length < 2 || topShare === null
      ? "unknown"
      : topShare >= 70
        ? "high"
        : topShare >= 40
          ? "medium"
          : "low";

  const confidence: Confidence =
    bookings.length < 3 || vitalReadings + withMood < 4
      ? "low"
      : bookings.length >= 8 && vitalReadings >= 12
        ? "high"
        : "medium";

  const report: WellbeingReport = {
    period: { fromMs: from, toMs: now, days },
    services: {
      count: bookings.length,
      completed: completed.length,
      inProgress: bookings.length - completed.length,
      hours,
      reportedCompleted,
      reportedPct: pctOf(reportedCompleted, completed.length),
    },
    moods: {
      withMood,
      counts,
      positive,
      positivePct: pctOf(positive, withMood),
      negativePct: pctOf(negative, withMood),
      trend: moodTrend,
      byService,
    },
    vitals,
    vitalReadings,
    medication,
    alerts: { total: alertEntries.length, last7d, recent: alertEntries.slice(0, 3) },
    continuity: {
      professionals: hoursBy.size,
      topId: top ? top[0] : null,
      topName: top ? top[1].name : null,
      topSharePct: topShare,
      level: continuityLevel,
    },
    confidence,
    highlights: [],
    disclaimer: VITALS_DISCLAIMER,
  };
  report.highlights = buildHighlights(report, now, args.logsTruncated === true);
  return report;
}

// ─── Frases ────────────────────────────────────────────────────────────────────

const unitText = (s: VitalSummary, v: number, v2: number | null) =>
  s.key === "bp" ? `${v}${v2 !== null ? `/${v2}` : ""} ${s.unit}` : `${v} ${s.unit}`;

/** «128/82 mmHg», «72 lpm». */
export function averageText(s: VitalSummary): string {
  return s.avg === null ? "—" : unitText(s, s.avg, s.avg2);
}

const TREND_TEXT: Record<Exclude<Trend, "unknown">, string> = {
  up: "con tendencia al alza",
  down: "con tendencia a la baja",
  flat: "estable",
};

const ORDER: Record<HighlightSeverity, number> = { alert: 0, watch: 1, ok: 2, info: 3 };

function buildHighlights(r: WellbeingReport, now: number, truncated: boolean): Highlight[] {
  const out: Highlight[] = [];
  const add = (h: Highlight) => out.push(h);

  if (r.services.count === 0) {
    return [
      {
        id: "no_services",
        severity: "info",
        title: "Aún no hay servicios en este periodo",
        detail:
          "Cuando termine un servicio con parte del turno, aquí verás cómo ha estado el ánimo, los signos vitales y las alertas.",
      },
    ];
  }

  // Alertas de la última semana
  if (r.alerts.last7d > 0) {
    const latest = r.alerts.recent[0];
    add({
      id: "alerts_recent",
      severity: "alert",
      title: `Hubo ${r.alerts.last7d} ${r.alerts.last7d === 1 ? "alerta o incidente" : "alertas o incidentes"} en los últimos 7 días`,
      detail: `La más reciente: «${latest.reason}» (${dayLabelEs(msOf(latest.at))}).`,
      action: "Abre el parte de ese servicio y coméntalo con el profesional y con el médico.",
    });
  }

  // Signos vitales fuera de rango esta semana
  const weekAgo = now - 7 * DAY_MS;
  const recentAlerts = vitalsRecent(r, weekAgo);
  if (recentAlerts.length) {
    const first = recentAlerts[0];
    add({
      id: "vitals_alert_recent",
      severity: "alert",
      title:
        recentAlerts.length === 1
          ? "Un signo vital quedó fuera de rango esta semana"
          : `${recentAlerts.length} signos vitales quedaron fuera de rango esta semana`,
      detail: `${first.message}, el ${dayLabelEs(msOf(first.at))}.`,
      action: "Confírmalo con el médico tratante. Es una referencia general, no un diagnóstico.",
    });
  }

  // Signos vitales a vigilar o con tendencia que preocupa
  for (const s of r.vitals) {
    const flagged = s.watch + s.alert;
    if (flagged >= 2) {
      add({
        id: `vitals_${s.key}`,
        severity: "watch",
        title: `${s.label} a vigilar: ${flagged} de ${s.readings} lecturas fuera de lo esperado`,
        detail:
          `Promedio ${averageText(s)}` +
          (s.trend !== "unknown" ? `, ${TREND_TEXT[s.trend]}` : "") +
          ". Referencia general para adultos en reposo.",
        action: "Llévalo a tu próxima consulta: el médico define las metas de cada paciente.",
      });
    } else if (s.concerning) {
      add({
        id: `vitals_${s.key}`,
        severity: "watch",
        title: `${s.label}: ${s.trend === "up" ? "tendencia al alza" : "tendencia a la baja"}`,
        detail: `Promedio ${averageText(s)} en ${plural(s.readings, "lectura", "lecturas")}. Aún dentro de lo esperado, pero el cambio merece comentarse.`,
        action: "Menciónalo en tu próxima consulta.",
      });
    }
  }

  // Ánimo
  const m = r.moods;
  if (m.trend === "worse") {
    add({
      id: "mood_worse",
      severity: "watch",
      title: "El ánimo ha ido bajando en los últimos servicios",
      detail: `Tranquilo o contento en ${m.positive} de ${m.withMood} servicios (${m.positivePct ?? 0} %).`,
      action: "Pregunta al equipo qué cambió y coméntalo con el médico.",
    });
  }
  const lastFive = m.byService.slice(-5);
  const painful = lastFive.filter((x) => x.mood === "pain").length;
  if (painful >= 2) {
    add({
      id: "mood_pain",
      severity: "watch",
      title: `Se registró dolor en ${painful} de los últimos ${lastFive.length} servicios`,
      detail: "Cuando el dolor se repite conviene que lo valore el médico tratante.",
      action: "Anota cuándo aparece y llévalo a la consulta.",
    });
  }

  // Medicamentos
  if (r.medication.gap) {
    add({
      id: "meds_gap",
      severity: "watch",
      title: `${plural(r.medication.withoutRecords, "servicio", "servicios")} sin registro de medicamentos`,
      detail: `En ${r.medication.withRecords} de ${r.medication.withReport} servicios con parte sí aparece. Que no se registre no significa que no se haya dado: pregúntaselo al profesional.`,
    });
  }

  // Servicios sin parte
  const unreported = r.services.completed - r.services.reportedCompleted;
  if (unreported > 0) {
    const share = r.services.reportedPct === null ? 0 : 100 - r.services.reportedPct;
    add({
      id: "no_report",
      severity: share >= 40 ? "watch" : "info",
      title: `${plural(unreported, "servicio terminado", "servicios terminados")} sin parte registrado`,
      detail: "El parte es tu forma de saber cómo estuvo el turno aunque no estés en casa.",
      action: "Pide al profesional que lo registre antes de cerrar el turno.",
    });
  }

  // Lo bueno
  if (m.withMood >= 3 && (m.positivePct ?? 0) >= 70) {
    add({
      id: "mood_ok",
      severity: "ok",
      title: `Buen ánimo en la mayoría de los servicios (${m.positivePct} %)`,
      detail: `Tranquilo o contento en ${m.positive} de ${m.withMood} servicios con ánimo registrado.`,
    });
  }
  if (r.vitalReadings >= 4 && r.vitals.every((s) => s.watch + s.alert === 0)) {
    add({
      id: "vitals_ok",
      severity: "ok",
      title: `Signos vitales dentro de lo esperado en ${r.vitalReadings} lecturas`,
      detail:
        "Según rangos generales para adultos en reposo; el médico define las metas de cada persona.",
    });
  }
  if (r.continuity.level === "high") {
    add({
      id: "continuity_high",
      severity: "ok",
      title: `Misma persona en el ${r.continuity.topSharePct} % de las horas`,
      detail: "Tener a quien ya conoce al paciente ayuda a notar cambios a tiempo.",
    });
  } else if (r.continuity.level === "low" && r.services.count >= 3) {
    add({
      id: "continuity_low",
      severity: "info",
      title: `${r.continuity.professionals} profesionales distintos atendieron en este periodo`,
      detail:
        "Cambiar mucho de persona dificulta notar cambios. Un equipo de confianza ayuda a tener continuidad.",
    });
  }

  // Cuánto creerle
  if (r.services.count < 3) {
    add({
      id: "small_sample",
      severity: "info",
      title: "Aún hay pocos servicios en este periodo",
      detail:
        "Las tendencias todavía no son confiables: se vuelven útiles con más turnos registrados.",
    });
  }
  if (truncated) {
    add({
      id: "truncated",
      severity: "info",
      title: "Hay más registros de los que se muestran",
      detail: "El informe usa los más recientes. Elige un periodo más corto para verlos todos.",
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => ORDER[a.x.severity] - ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}

/** Lecturas fuera de rango desde `since` (una por signo, la más reciente primero), con su mensaje. */
function vitalsRecent(r: WellbeingReport, since: number): Array<{ at: string; message: string }> {
  const out: Array<{ at: string; message: string }> = [];
  for (const s of r.vitals) {
    const l = s.lastAlert;
    if (l && msOf(l.at) >= since) {
      out.push({
        at: l.at,
        message: `${s.label} fuera de rango: ${unitText(s, l.value, l.value2)}`,
      });
    }
  }
  return out.sort((a, b) => msOf(b.at) - msOf(a.at));
}

// ─── Resumen para el médico ────────────────────────────────────────────────────

const moodWord = (m: CareMood) => MOOD_META[m].label.replace(/\/a$/, "").toLowerCase();

/**
 * Texto para llevar a la consulta (se copia o se imprime; lo comparte la familia, no la plataforma). Usa solo cifras
 * del informe: sin nombres de profesionales, direcciones ni valores de pago.
 */
export function doctorSummary(r: WellbeingReport): string {
  const lines: string[] = [
    `Resumen de cuidado en casa · ${dateEs(r.period.fromMs)} – ${dateEs(r.period.toMs)} (${plural(r.period.days, "día", "días")})`,
    "Armado por la familia con los partes que registró cada profesional en Humanix. Información de apoyo: no es un diagnóstico.",
    "",
  ];

  if (r.services.count === 0) {
    lines.push("• No hubo servicios con parte en este periodo.");
    return lines.join("\n");
  }

  lines.push(
    `• Servicios: ${r.services.count} (${r.services.hours} h contratadas); terminados con parte registrado: ${r.services.reportedCompleted} de ${r.services.completed}.`,
  );

  const m = r.moods;
  if (m.withMood > 0) {
    const parts = CARE_MOODS.filter((k) => m.counts[k] > 0).map(
      (k) => `${moodWord(k)} ${m.counts[k]}`,
    );
    const trend =
      m.trend === "better"
        ? "; tendencia a mejorar"
        : m.trend === "worse"
          ? "; tendencia a empeorar"
          : m.trend === "stable"
            ? "; sin cambios claros"
            : "";
    lines.push(
      `• Ánimo al terminar cada servicio (${m.withMood}): ${parts.join(", ")}. Tranquilo o contento en ${m.positivePct} %${trend}.`,
    );
  } else {
    lines.push("• Ánimo: sin registros en este periodo.");
  }

  if (r.vitals.length) {
    for (const s of r.vitals) {
      const bits = [`${plural(s.readings, "lectura", "lecturas")}`, `promedio ${averageText(s)}`];
      if (s.last)
        bits.push(
          `última ${unitText(s, s.last.value, s.last.value2)} (${dayLabelEs(msOf(s.last.at))})`,
        );
      if (s.watch + s.alert > 0) {
        bits.push(`${s.watch} a vigilar y ${s.alert} fuera de rango`);
      }
      if (s.trend !== "unknown") bits.push(TREND_TEXT[s.trend]);
      lines.push(`• ${s.label}: ${bits.join("; ")}.`);
    }
  } else {
    lines.push("• Signos vitales: sin lecturas en este periodo.");
  }

  if (r.alerts.total > 0) {
    const last = r.alerts.recent[0];
    lines.push(
      `• Alertas e incidentes: ${r.alerts.total}. Más reciente: «${last.reason}» (${dayLabelEs(msOf(last.at))}).`,
    );
  } else {
    lines.push("• Alertas e incidentes: ninguno.");
  }

  lines.push(
    r.medication.withReport > 0
      ? `• Medicamentos: ${plural(r.medication.totalEvents, "registro", "registros")} en ${r.medication.withRecords} de ${r.medication.withReport} servicios con parte (lo que no aparece no prueba que no se haya dado).`
      : "• Medicamentos: sin partes en este periodo.",
  );

  if (r.continuity.level !== "unknown") {
    lines.push(
      `• Continuidad: ${plural(r.continuity.professionals, "profesional", "profesionales")}; el principal cubrió el ${r.continuity.topSharePct} % de las horas.`,
    );
  }

  lines.push("", `Referencias para «a vigilar»: ${r.disclaimer}`);
  return lines.join("\n");
}
