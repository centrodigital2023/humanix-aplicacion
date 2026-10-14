// Monitoreo clínico en vivo de la institución — lógica pura (sin red, sin DOM; la hora entra como parámetro).
//
// El servidor calcula el NEWS2 y abre las alertas (migración 20261014100000): aquí se interpreta lo que llega por Realtime para pintar
// el tablero (estado de cada persona, cifras, columnas de triage), se valida el formulario de signos con una vista previa del puntaje
// que usa el MISMO arrastre de 12 horas que la base, y se cuentan los plazos de las alertas.
//
// «Triage» aquí es el semáforo del NEWS2 (guía del Royal College of Physicians), no inteligencia artificial: apoya la decisión, no la
// reemplaza.

import {
  ageYears,
  dayClockLabel,
  durationLabel,
  normalizeText,
  nowMs,
  timeAgo,
  type Clock,
} from "./instCare";
import type {
  AlertSeverity,
  Avpu,
  InstAlert,
  InstDevice,
  InstLive,
  InstObs,
  InstPatient,
  PatientModality,
  Tone,
} from "./instCareTypes";
import {
  BAND_INFO,
  TRIAGE_OF_BAND,
  news2,
  news2Applicable,
  scoreHr,
  scoreRr,
  scoreSbp,
  scoreSpo2,
  scoreTemp,
  type News2Band,
  type News2Result,
  type Spo2Scale,
  type Triage,
} from "./news2";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Un dispositivo cuenta «en línea» si habló en los últimos 10 minutos (igual que el servidor). */
export const ONLINE_WINDOW_MIN = 10;
/** El NEWS2 completa lo que no se midió con lo último conocido de las 12 horas anteriores (igual que el servidor). */
export const CARRY_WINDOW_HOURS = 12;

// ── Estado de cada persona en el tablero ─────────────────────────────────────────────────────────────────────────────

export type MonitorState = "critical" | "urgent" | "attention" | "stable" | "pending";

export const STATE_META: Record<
  MonitorState,
  { label: string; tone: Tone; triage: Triage | null }
> = {
  critical: { label: "Crítico", tone: "sos", triage: "rojo" },
  urgent: { label: "Urgente", tone: "warn", triage: "naranja" },
  attention: { label: "Atención", tone: "copper", triage: "amarillo" },
  stable: { label: "Estable", tone: "ok", triage: "verde" },
  pending: { label: "Sin puntaje", tone: "muted", triage: null },
};
export const STATE_ORDER: MonitorState[] = ["critical", "urgent", "attention", "stable", "pending"];

const SEVERITY_STATE: Record<AlertSeverity, MonitorState> = {
  critical: "critical",
  urgent: "urgent",
  warn: "attention",
};
const BAND_STATE: Record<News2Band, MonitorState> = {
  high: "critical",
  medium: "urgent",
  low_medium: "attention",
  low: "stable",
};
const STATE_RANK: Record<MonitorState, number> = {
  critical: 4,
  urgent: 3,
  attention: 2,
  stable: 1,
  pending: 0,
};

export interface MonitorStatus {
  state: MonitorState;
  band: News2Band | null;
  news2: number | null;
  online: boolean;
  lastSeenAt: string | null;
  lastSeenLabel: string;
  /** Hora en que toca el próximo control (null si aún no hay ninguno). */
  dueAt: string | null;
  overdue: boolean;
  /** Minutos para el próximo control; negativo si ya pasó. */
  dueInMin: number | null;
  dueLabel: string;
  openAlerts: number;
  unackedAlerts: number;
  topSeverity: AlertSeverity | null;
}

export function monitorStatus(
  live: InstLive | null | undefined,
  alerts: InstAlert[],
  now: Clock,
): MonitorStatus {
  const t = nowMs(now);
  const open = alerts.filter((a) => a.status !== "resolved");
  const top = open.reduce<AlertSeverity | null>((m, a) => {
    if (m === null) return a.severity;
    return STATE_RANK[SEVERITY_STATE[a.severity]] > STATE_RANK[SEVERITY_STATE[m]] ? a.severity : m;
  }, null);
  const band = live?.last_band ?? null;
  const fromBand = band ? BAND_STATE[band] : "pending";
  const fromAlert = top ? SEVERITY_STATE[top] : "pending";
  const state = STATE_RANK[fromAlert] > STATE_RANK[fromBand] ? fromAlert : fromBand;

  const lastDevice = live?.last_device_at ? Date.parse(live.last_device_at) : Number.NaN;
  const online = Number.isFinite(lastDevice) && t - lastDevice <= ONLINE_WINDOW_MIN * MIN;
  const due = live?.next_obs_due_at ? Date.parse(live.next_obs_due_at) : Number.NaN;
  const dueInMin = Number.isFinite(due) ? Math.round((due - t) / MIN) : null;
  const overdue = dueInMin !== null ? due < t : !live?.last_obs_at;
  const dueLabel =
    dueInMin === null
      ? "Primer control pendiente"
      : overdue
        ? `Control vencido ${durationLabel(t - due)}`
        : dueInMin <= 1
          ? "Control ahora"
          : `Próximo control en ${durationLabel(due - t)}`;
  return {
    state,
    band,
    news2: live?.last_news2 ?? null,
    online,
    lastSeenAt: live?.last_obs_at ?? null,
    lastSeenLabel: live?.last_obs_at ? timeAgo(live.last_obs_at, now) : "Sin controles",
    dueAt: live?.next_obs_due_at ?? null,
    overdue,
    dueInMin,
    dueLabel,
    openAlerts: open.length,
    unackedAlerts: open.filter((a) => a.status === "open").length,
    topSeverity: top,
  };
}

export const bandLabel = (b: News2Band | null | undefined): string =>
  b ? BAND_INFO[b].label : "Sin puntaje";
export const triageOf = (b: News2Band | null | undefined): Triage | null =>
  b ? TRIAGE_OF_BAND[b] : null;

/**
 * La banda del NEWS2 junto al estado, solo si dice algo distinto: «Crítico · Crítico» sobra, pero «Crítico · NEWS2 estable» sí informa
 * (lo sube una alerta, por ejemplo una posible caída, no el puntaje).
 */
export function bandNote(s: Pick<MonitorStatus, "state" | "band" | "news2">): string {
  if (!s.band || s.news2 === null) return "";
  const label = bandLabel(s.band);
  return label === STATE_META[s.state].label ? "" : `NEWS2 ${label.toLowerCase()}`;
}

// ── Cifras y columnas del tablero ────────────────────────────────────────────────────────────────────────────────────

export interface MonitorKpis {
  total: number;
  online: number;
  alerts: number;
  critical: number;
  overdue: number;
  unacked: number;
}

/** Total · En línea · Alertas · Críticos (más los controles vencidos y las alertas sin ver). Se recalcula con cada cambio en vivo. */
export function monitorKpis(
  patients: InstPatient[],
  live: Map<string, InstLive>,
  alerts: InstAlert[],
  now: Clock,
): MonitorKpis {
  const monitored = patients.filter((p) => p.monitoring && p.status === "active");
  const ids = new Set(monitored.map((p) => p.id));
  const byPatient = groupAlerts(alerts.filter((a) => ids.has(a.patient_id)));
  let online = 0;
  let critical = 0;
  let overdue = 0;
  for (const p of monitored) {
    const s = monitorStatus(live.get(p.id), byPatient.get(p.id) ?? [], now);
    if (s.online) online += 1;
    if (s.state === "critical") critical += 1;
    if (s.overdue) overdue += 1;
  }
  const open = alerts.filter((a) => ids.has(a.patient_id) && a.status !== "resolved");
  return {
    total: monitored.length,
    online,
    alerts: open.length,
    critical,
    overdue,
    unacked: open.filter((a) => a.status === "open").length,
  };
}

export function groupAlerts(alerts: InstAlert[]): Map<string, InstAlert[]> {
  const m = new Map<string, InstAlert[]>();
  for (const a of alerts) m.set(a.patient_id, [...(m.get(a.patient_id) ?? []), a]);
  return m;
}

export interface TriageEntry {
  patient: InstPatient;
  status: MonitorStatus;
}

export interface TriageColumn {
  state: MonitorState;
  label: string;
  tone: Tone;
  entries: TriageEntry[];
}

/** Las personas en monitoreo repartidas por estado, las más urgentes arriba de cada columna. */
export function triageColumns(
  patients: InstPatient[],
  live: Map<string, InstLive>,
  alerts: InstAlert[],
  now: Clock,
  opts: { q?: string; modality?: PatientModality | "all" } = {},
): TriageColumn[] {
  const byPatient = groupAlerts(alerts);
  const q = normalizeText(opts.q);
  const entries = patients
    .filter((p) => p.monitoring && p.status === "active")
    .filter((p) => !opts.modality || opts.modality === "all" || p.modality === opts.modality)
    .filter((p) => {
      if (!q) return true;
      const hay = normalizeText([p.full_name, p.room, p.document_number].filter(Boolean).join(" "));
      return q.split(/\s+/).every((w) => hay.includes(w));
    })
    .map((p) => ({
      patient: p,
      status: monitorStatus(live.get(p.id), byPatient.get(p.id) ?? [], now),
    }));
  return STATE_ORDER.map((state) => ({
    state,
    label: STATE_META[state].label,
    tone: STATE_META[state].tone,
    entries: entries
      .filter((e) => e.status.state === state)
      .sort(
        (a, b) =>
          (b.status.news2 ?? -1) - (a.status.news2 ?? -1) ||
          Number(b.status.overdue) - Number(a.status.overdue) ||
          a.patient.full_name.localeCompare(b.patient.full_name, "es", { sensitivity: "base" }),
      ),
  }));
}

/** Quiénes tienen el control vencido o por vencer pronto, el más atrasado primero (la «ronda» del turno). */
export function dueRound(
  patients: InstPatient[],
  live: Map<string, InstLive>,
  now: Clock,
  withinMin = 15,
): Array<{ patient: InstPatient; dueAt: string | null; minutes: number }> {
  const t = nowMs(now);
  const out: Array<{ patient: InstPatient; dueAt: string | null; minutes: number }> = [];
  for (const p of patients) {
    if (!p.monitoring || p.status !== "active") continue;
    const l = live.get(p.id);
    const due = l?.next_obs_due_at ? Date.parse(l.next_obs_due_at) : Number.NaN;
    if (!Number.isFinite(due)) {
      out.push({ patient: p, dueAt: null, minutes: Number.NEGATIVE_INFINITY });
      continue;
    }
    const minutes = Math.round((due - t) / MIN);
    if (minutes <= withinMin) out.push({ patient: p, dueAt: l?.next_obs_due_at ?? null, minutes });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

// ── Formulario de signos vitales ─────────────────────────────────────────────────────────────────────────────────────

export interface VitalsForm {
  hr: string;
  rr: string;
  spo2: string;
  sbp: string;
  dbp: string;
  temp: string;
  pain: string;
  avpu: Avpu | "";
  onO2: "yes" | "no" | "";
  fall: boolean;
  note: string;
}

export const EMPTY_VITALS_FORM: VitalsForm = {
  hr: "",
  rr: "",
  spo2: "",
  sbp: "",
  dbp: "",
  temp: "",
  pain: "",
  avpu: "",
  onO2: "",
  fall: false,
  note: "",
};

type NumKey = "hr" | "rr" | "spo2" | "sbp" | "dbp" | "temp" | "pain";

/** Mismos rangos que las restricciones de la base. */
export const VITAL_RANGE: Record<
  NumKey,
  { min: number; max: number; label: string; unit: string; decimals: number }
> = {
  hr: { min: 20, max: 300, label: "Pulso", unit: "por minuto", decimals: 0 },
  rr: { min: 4, max: 70, label: "Frecuencia respiratoria", unit: "por minuto", decimals: 0 },
  spo2: { min: 50, max: 100, label: "Saturación de oxígeno", unit: "%", decimals: 1 },
  sbp: { min: 40, max: 300, label: "Presión sistólica", unit: "mmHg", decimals: 0 },
  dbp: { min: 20, max: 200, label: "Presión diastólica", unit: "mmHg", decimals: 0 },
  temp: { min: 25, max: 45, label: "Temperatura", unit: "°C", decimals: 1 },
  pain: { min: 0, max: 10, label: "Dolor", unit: "de 0 a 10", decimals: 0 },
};

/** «36,8» o «36.8» → 36.8. Vacío → null. Cualquier otra cosa → «invalid». */
export function parseVitalNumber(raw: string | null | undefined): number | null | "invalid" {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!/^-?\d+([.,]\d+)?$/.test(s)) return "invalid";
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : "invalid";
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export interface VitalValues {
  hr: number | null;
  rr: number | null;
  spo2: number | null;
  sbp: number | null;
  dbp: number | null;
  temp_c: number | null;
  pain: number | null;
  avpu: Avpu | null;
  on_o2: boolean | null;
}

export interface VitalsCheck {
  ok: boolean;
  errors: Partial<Record<NumKey | "avpu" | "form", string>>;
  /** Valores raros pero posibles: se avisa, no se bloquea. */
  warnings: string[];
  values: VitalValues;
}

export function validateVitals(form: VitalsForm): VitalsCheck {
  const errors: VitalsCheck["errors"] = {};
  const warnings: string[] = [];
  const values: VitalValues = {
    hr: null,
    rr: null,
    spo2: null,
    sbp: null,
    dbp: null,
    temp_c: null,
    pain: null,
    avpu: form.avpu === "" ? null : form.avpu,
    on_o2: form.onO2 === "" ? null : form.onO2 === "yes",
  };
  for (const key of Object.keys(VITAL_RANGE) as NumKey[]) {
    const r = VITAL_RANGE[key];
    const parsed = parseVitalNumber(form[key]);
    if (parsed === null) continue;
    if (parsed === "invalid" || parsed < r.min || parsed > r.max) {
      errors[key] =
        `${r.label}: escribe un número entre ${String(r.min).replace(".", ",")} y ${r.max} (${r.unit}).`;
      continue;
    }
    values[key === "temp" ? "temp_c" : key] = round(parsed, r.decimals);
  }
  if (form.avpu !== "" && !["A", "C", "V", "P", "U"].includes(form.avpu)) {
    errors.avpu = "El estado de conciencia no es válido.";
  }
  // El oxígeno solo no es un control (igual que en la base): hace falta al menos una medida, la conciencia o una caída.
  const hasMeasure =
    values.hr !== null ||
    values.rr !== null ||
    values.spo2 !== null ||
    values.sbp !== null ||
    values.dbp !== null ||
    values.temp_c !== null ||
    values.pain !== null ||
    values.avpu !== null ||
    form.fall;
  if (!hasMeasure && Object.keys(errors).length === 0) errors.form = "Escribe al menos un valor.";

  if (values.hr !== null && (values.hr < 35 || values.hr > 180))
    warnings.push(`Pulso ${values.hr}: confirma que está bien medido.`);
  if (values.rr !== null && (values.rr < 6 || values.rr > 40))
    warnings.push(`Respiración ${values.rr}: confirma que está bien contada.`);
  if (values.spo2 !== null && values.spo2 < 80)
    warnings.push(
      `Saturación ${String(values.spo2).replace(".", ",")} %: confirma que el sensor está bien puesto.`,
    );
  if (values.sbp !== null && (values.sbp < 70 || values.sbp > 230))
    warnings.push(`Presión sistólica ${values.sbp}: confirma el valor.`);
  if (values.temp_c !== null && (values.temp_c < 34 || values.temp_c > 41))
    warnings.push(`Temperatura ${String(values.temp_c).replace(".", ",")} °C: confirma el valor.`);
  if (values.sbp !== null && values.dbp !== null && values.dbp >= values.sbp)
    warnings.push("La diastólica es igual o mayor que la sistólica: revisa los dos valores.");

  return { ok: Object.keys(errors).length === 0, errors, warnings, values };
}

/** Lo que se manda a `inst_vitals_record` (solo lo que se midió). */
export function vitalsPayload(form: VitalsForm, recordedAt?: string): Record<string, unknown> {
  const c = validateVitals(form);
  const v = c.values;
  const out: Record<string, unknown> = {};
  if (v.hr !== null) out.hr = v.hr;
  if (v.rr !== null) out.rr = v.rr;
  if (v.spo2 !== null) out.spo2 = v.spo2;
  if (v.on_o2 !== null) out.on_o2 = v.on_o2;
  if (v.sbp !== null) out.sbp = v.sbp;
  if (v.dbp !== null) out.dbp = v.dbp;
  if (v.temp_c !== null) out.temp_c = v.temp_c;
  if (v.avpu !== null) out.avpu = v.avpu;
  if (v.pain !== null) out.pain = v.pain;
  if (form.fall) out.fall = true;
  const note = form.note.trim();
  if (note) out.note = note.slice(0, 300);
  if (recordedAt) out.recorded_at = recordedAt;
  return out;
}

// ── Vista previa del NEWS2 (con el arrastre de 12 horas del servidor) ────────────────────────────────────────────────

type HistoryRow = Pick<
  InstObs,
  "recorded_at" | "rr" | "spo2" | "on_o2" | "sbp" | "hr" | "avpu" | "temp_c"
>;

export interface Preview {
  /** NEWS2 solo es para personas de 16 años o más. */
  applicable: boolean;
  result: News2Result | null;
  /** Parámetros que se completan con lo último conocido. */
  carried: Array<"rr" | "spo2" | "on_o2" | "sbp" | "hr" | "avpu" | "temp_c">;
  /** Parámetros que nadie ha medido en las últimas 12 h (suman 0 y marcan el puntaje como parcial). */
  missing: string[];
}

const PARAM_LABEL: Record<string, string> = {
  rr: "Frecuencia respiratoria",
  spo2: "Saturación",
  on_o2: "Oxígeno",
  sbp: "Presión sistólica",
  hr: "Pulso",
  avpu: "Conciencia",
  temp_c: "Temperatura",
};
export const paramLabel = (k: string): string => PARAM_LABEL[k] ?? k;

export function previewNews2(args: {
  values: VitalValues;
  scale: Spo2Scale;
  history: HistoryRow[];
  now: Clock;
  birthDate?: string | null;
}): Preview {
  const age = ageYears(args.birthDate, args.now);
  if (!news2Applicable(age)) return { applicable: false, result: null, carried: [], missing: [] };
  const at = nowMs(args.now);
  const from = at - CARRY_WINDOW_HOURS * HOUR;
  const recent = args.history
    .filter((h) => {
      const t = Date.parse(h.recorded_at);
      return Number.isFinite(t) && t <= at && t > from;
    })
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
  const lastOf = <K extends "rr" | "spo2" | "on_o2" | "sbp" | "hr" | "avpu" | "temp_c">(k: K) =>
    recent.find((h) => h[k] !== null && h[k] !== undefined)?.[k] ?? null;

  const carried: Preview["carried"] = [];
  const pick = <K extends "rr" | "spo2" | "on_o2" | "sbp" | "hr" | "avpu" | "temp_c">(
    now_: HistoryRow[K] | null,
    k: K,
  ) => {
    if (now_ !== null && now_ !== undefined) return now_;
    const prev = lastOf(k);
    if (prev !== null) carried.push(k);
    return prev;
  };
  const v = args.values;
  const merged = {
    rr: pick(v.rr, "rr"),
    spo2: pick(v.spo2, "spo2"),
    onO2: pick(v.on_o2, "on_o2"),
    sbp: pick(v.sbp, "sbp"),
    hr: pick(v.hr, "hr"),
    avpu: pick(v.avpu, "avpu"),
    tempC: pick(v.temp_c, "temp_c"),
  };
  const result = news2({ ...merged, spo2Scale: args.scale });
  const missing = result.parts
    .filter((p) => !p.measured)
    .map((p) => (p.key === "temp" ? "temp_c" : p.key === "o2" ? "on_o2" : p.key));
  return { applicable: true, result, carried, missing };
}

// ── Tendencia y gráficas ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  t: number;
  v: number;
}

type SeriesKey = "hr" | "rr" | "spo2" | "sbp" | "dbp" | "temp_c" | "news2";

export function seriesOf(
  obs: InstObs[],
  key: SeriesKey,
  windowHours: number,
  now: Clock,
): SeriesPoint[] {
  const from = nowMs(now) - windowHours * HOUR;
  return obs
    .map((o) => {
      const raw: unknown = o[key];
      return { t: Date.parse(o.recorded_at), v: typeof raw === "string" ? Number(raw) : raw };
    })
    .filter(
      (p): p is SeriesPoint =>
        Number.isFinite(p.t) && p.t >= from && typeof p.v === "number" && Number.isFinite(p.v),
    )
    .sort((a, b) => a.t - b.t);
}

export interface Spark {
  points: string;
  min: number;
  max: number;
  last: { x: number; y: number } | null;
}

/** Puntos para un `<polyline>`: x por tiempo (no por posición), y invertida; una serie plana queda a media altura. */
export function sparkline(points: SeriesPoint[], w: number, h: number, pad = 3): Spark {
  if (points.length === 0) return { points: "", min: 0, max: 0, last: null };
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? t0;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const spanT = Math.max(1, t1 - t0);
  const spanV = max - min;
  const xy = points.map((p) => {
    const x = points.length === 1 ? w / 2 : pad + ((p.t - t0) / spanT) * (w - 2 * pad);
    const y = spanV === 0 ? h / 2 : pad + (1 - (p.v - min) / spanV) * (h - 2 * pad);
    return { x: round(x, 1), y: round(y, 1) };
  });
  return {
    points: xy.map((p) => `${p.x},${p.y}`).join(" "),
    min,
    max,
    last: xy[xy.length - 1] ?? null,
  };
}

export interface Trend {
  direction: "up" | "down" | "flat" | "unknown";
  delta: number;
  label: string;
}

/**
 * ¿El NEWS2 sube o baja? Lo último pesa primero: si saltó respecto al control anterior no está «mejorando» aunque hace horas tuviera un
 * puntaje más alto (de 2 a 14 es un empeoramiento, no importa que a la mañana hubiera 19). Sin un salto reciente, compara el último puntaje
 * con el más antiguo de las últimas 6 horas.
 */
export function news2Trend(obs: InstObs[], now: Clock): Trend {
  const pts = seriesOf(
    obs.filter((o) => o.applicable),
    "news2",
    6,
    now,
  );
  if (pts.length < 2) return { direction: "unknown", delta: 0, label: "Sin tendencia todavía" };
  const first = pts[0]?.v ?? 0;
  const prev = pts[pts.length - 2]?.v ?? 0;
  const last = pts[pts.length - 1]?.v ?? 0;
  const jump = last - prev;
  const delta = last - first;
  if (jump >= 2 && jump >= delta)
    return {
      direction: "up",
      delta: jump,
      label: `Empeorando (+${jump} desde el control anterior)`,
    };
  if (delta >= 2) return { direction: "up", delta, label: `Empeorando (+${delta} en 6 h)` };
  if (delta <= -2) return { direction: "down", delta, label: `Mejorando (${delta} en 6 h)` };
  return { direction: "flat", delta, label: "Estable en las últimas horas" };
}

/** Color de un valor según los puntos que aporta al NEWS2 (0 verde · 1 cobre · 2 naranja · 3 rojo). */
export function vitalTone(
  key: "hr" | "rr" | "spo2" | "sbp" | "temp_c",
  value: number | null | undefined,
  opts: { scale?: Spo2Scale; onO2?: boolean } = {},
): Tone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "muted";
  const pts =
    key === "hr"
      ? scoreHr(value)
      : key === "rr"
        ? scoreRr(value)
        : key === "sbp"
          ? scoreSbp(value)
          : key === "temp_c"
            ? scoreTemp(value)
            : scoreSpo2(value, opts.scale ?? 1, opts.onO2 === true);
  return pts === 0 ? "ok" : pts === 1 ? "copper" : pts === 2 ? "warn" : "sos";
}

// ── Alertas: títulos, guía y plazos ──────────────────────────────────────────────────────────────────────────────────

export const ALERT_TITLE: Record<InstAlert["reason"], string> = {
  news2_high: "Riesgo clínico alto",
  news2_medium: "Riesgo clínico medio",
  news2_single: "Un parámetro en 3 puntos",
  deterioration: "Empeoramiento rápido",
  fall: "Posible caída",
};

export const SEVERITY_META: Record<AlertSeverity, { label: string; tone: Tone; slaMin: number }> = {
  critical: { label: "Crítica", tone: "sos", slaMin: 10 },
  urgent: { label: "Urgente", tone: "warn", slaMin: 30 },
  warn: { label: "Atención", tone: "copper", slaMin: 120 },
};

export function alertGuidance(a: Pick<InstAlert, "reason">): string {
  switch (a.reason) {
    case "news2_high":
      return BAND_INFO.high.guidance;
    case "news2_medium":
      return BAND_INFO.medium.guidance;
    case "news2_single":
      return BAND_INFO.low_medium.guidance;
    case "deterioration":
      return "El puntaje subió varios puntos en pocas horas. Revisa a la persona, repite los signos y valora si hay que avisar al médico.";
    case "fall":
      return "Verifica a la persona: ¿responde?, ¿tiene dolor?, ¿puede levantarse? Si se golpeó la cabeza o no responde, activa la emergencia.";
  }
}

export interface Sla {
  state: "ok" | "due_soon" | "overdue" | "seen" | "resolved";
  tone: Tone;
  /** Milisegundos para el vencimiento (negativo = ya venció). Solo para las que nadie ha visto. */
  remainingMs: number | null;
  /** Cuánto del plazo ya pasó, de 0 a 1. */
  elapsed: number;
  label: string;
}

export function alertSla(a: InstAlert, now: Clock): Sla {
  const t = nowMs(now);
  const opened = Date.parse(a.opened_at);
  const due = Date.parse(a.due_ack_at);
  const window = Math.max(MIN, due - opened);
  if (a.status === "resolved") {
    return {
      state: "resolved",
      tone: "muted",
      remainingMs: null,
      elapsed: 1,
      label: a.resolved_at ? `Resuelta ${timeAgo(a.resolved_at, now)}` : "Resuelta",
    };
  }
  if (a.status === "acknowledged" && a.acked_at) {
    const onTime = Date.parse(a.acked_at) <= due;
    return {
      state: "seen",
      tone: onTime ? "ok" : "copper",
      remainingMs: null,
      elapsed: 1,
      label: `Vista${a.acked_by_name ? ` por ${a.acked_by_name}` : ""} ${timeAgo(a.acked_at, now)}${onTime ? "" : " (fuera de plazo)"}`,
    };
  }
  const remainingMs = due - t;
  const elapsed = Math.max(0, Math.min(1, (t - opened) / window));
  if (remainingMs < 0) {
    return {
      state: "overdue",
      tone: "sos",
      remainingMs,
      elapsed: 1,
      label: `Sin atender: venció hace ${durationLabel(-remainingMs)}`,
    };
  }
  const soon = remainingMs <= Math.max(2 * MIN, window * 0.25);
  return {
    state: soon ? "due_soon" : "ok",
    tone: soon ? "warn" : SEVERITY_META[a.severity].tone,
    remainingMs,
    elapsed,
    label: `Quedan ${durationLabel(remainingMs)} para verla`,
  };
}

/** Sin ver primero (la más grave y la que vence antes), luego las vistas, al final las resueltas. */
export function sortAlerts(alerts: InstAlert[]): InstAlert[] {
  const group = (a: InstAlert) => (a.status === "open" ? 0 : a.status === "acknowledged" ? 1 : 2);
  const sev = (a: InstAlert) => (a.severity === "critical" ? 0 : a.severity === "urgent" ? 1 : 2);
  return [...alerts].sort(
    (a, b) =>
      group(a) - group(b) ||
      (group(a) === 0
        ? sev(a) - sev(b) || Date.parse(a.due_ack_at) - Date.parse(b.due_ack_at)
        : 0) ||
      Date.parse(b.opened_at) - Date.parse(a.opened_at),
  );
}

/**
 * Cuántos milisegundos faltan para el primer vencimiento de una alerta urgente o crítica sin ver ni escalar. La pantalla programa
 * un aviso a esa hora exacta para pedir el escalamiento (el servidor además lo revisa cada minuto).
 */
export function nextEscalationInMs(alerts: InstAlert[], now: Clock): number | null {
  const t = nowMs(now);
  let best: number | null = null;
  for (const a of alerts) {
    if (a.status !== "open" || a.escalated_at || a.severity === "warn") continue;
    const ms = Date.parse(a.due_ack_at) - t;
    if (best === null || ms < best) best = ms;
  }
  return best === null ? null : Math.max(0, best);
}

// ── Dispositivos ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type DeviceHealth = "online" | "quiet" | "offline" | "never" | "revoked";

export function deviceHealth(
  d: Pick<InstDevice, "status" | "last_ingest_at">,
  now: Clock,
): { state: DeviceHealth; tone: Tone; label: string } {
  if (d.status === "revoked") return { state: "revoked", tone: "muted", label: "Revocado" };
  if (!d.last_ingest_at)
    return { state: "never", tone: "warn", label: "Esperando la primera lectura" };
  const age = nowMs(now) - Date.parse(d.last_ingest_at);
  if (age <= ONLINE_WINDOW_MIN * MIN) return { state: "online", tone: "ok", label: "En línea" };
  if (age <= HOUR)
    return {
      state: "quiet",
      tone: "copper",
      label: `Sin datos ${timeAgo(d.last_ingest_at, now).replace("hace ", "desde hace ")}`,
    };
  return { state: "offline", tone: "sos", label: `Sin conexión ${timeAgo(d.last_ingest_at, now)}` };
}

/** Ejemplos para quien integra el dispositivo. Los marcadores van entre <…>: la llave pública del proyecto no se imprime aquí. */
export function deviceSnippets(code: string, apiUrl: string): { curl: string; json: string } {
  const url = `${apiUrl.replace(/\/+$/, "")}/rest/v1/rpc/inst_device_ingest`;
  const body = JSON.stringify(
    { p_code: code, p_reading: { hr: 72, spo2: 97, rr: 16, sbp: 118, dbp: 76, temp_c: 36.7 } },
    null,
    2,
  );
  return {
    json: body,
    curl: [
      `curl -X POST '${url}' \\`,
      `  -H 'apikey: <LLAVE_PÚBLICA_DEL_PROYECTO>' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '${JSON.stringify({ p_code: code, p_reading: { hr: 72, spo2: 97 } })}'`,
    ].join("\n"),
  };
}

export const DEVICE_RULES = [
  "El código se muestra una sola vez: guárdalo en el dispositivo.",
  "Se guarda como máximo una lectura por minuto (una caída siempre pasa).",
  "Valores imposibles se descartan; los demás de la lectura se conservan.",
  "Las lecturas crudas se conservan 30 días; los controles manuales y las alertas, siempre.",
];

/** Para la tarjeta de un paciente: la hora del último control en palabras. */
export function lastControlLabel(
  live: Pick<InstLive, "last_obs_at"> | null | undefined,
  now: Clock,
): string {
  return live?.last_obs_at ? dayClockLabel(live.last_obs_at, now) : "Sin controles";
}
