// «Mis números»: glucosa, presión, peso, temperatura, oxígeno, pulso y dolor que la familia mide en casa. Puro.
//
// La familia anota lo que mide y, si quiere, las METAS que le dio su médico (cada persona tiene las suyas: una persona con
// EPOC no tiene la saturación de otra). Sin metas, solo se avisa lo que cualquier guía general trata como fuera de rango
// (los mismos límites de `careLog.vitalFlags`, de adultos en reposo) y una glucosa por debajo de 70 mg/dL, que es el valor
// de alerta que usa la Asociación Americana de Diabetes. Medir en casa ayuda más cuando alguien lo mira con la familia: en
// 36 ensayos, medirse solo bajó la presión sistólica unos 3 mmHg y con apoyo clínico hasta 6 (Tucker, 2017); por eso el
// resumen para el médico va junto a los números. Nunca diagnostica ni cambia una dosis.
import { vitalFlags } from "./careLog";
import {
  MEASURE_KINDS,
  MEASURE_META,
  TARGET_BOUNDS,
  TARGET_KEYS,
  type FamKind,
  type MeasureKind,
  type TargetKey,
  type Targets,
} from "./famCareTypes";
import { DAY_MS, average, msOf, num, numOrNull } from "./intelShared";

export interface MeasureRow {
  id: string;
  recipient_id: string;
  author_id: string;
  kind: MeasureKind | string;
  /** PostgREST devuelve `numeric` como texto: se aceptan ambos. */
  v1: number | string;
  v2: number | string | null;
  measured_at: string;
  note: string | null;
}

export function isMeasureKind(k: unknown): k is MeasureKind {
  return typeof k === "string" && (MEASURE_KINDS as readonly string[]).includes(k);
}

// ── Validar y mostrar ────────────────────────────────────────────────────────

export type ValidMeasure =
  | { ok: true; v1: number; v2: number | null }
  | { ok: false; error: string };

const roundTo = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Acepta «7,2» y «7.2»; vacío o texto raro no es un número. */
export function parseNumberEs(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function validateMeasure(
  kind: MeasureKind,
  rawV1: string | number | null | undefined,
  rawV2?: string | number | null,
): ValidMeasure {
  const meta = MEASURE_META[kind];
  const v1 = parseNumberEs(rawV1);
  if (v1 === null) return { ok: false, error: `Escribe el valor de ${meta.label.toLowerCase()}.` };
  if (v1 < meta.min || v1 > meta.max)
    return {
      ok: false,
      error: `${meta.label}: el valor debe estar entre ${meta.min} y ${meta.max} ${meta.unit}.`,
    };
  if (kind === "bp") {
    const v2 = parseNumberEs(rawV2);
    if (v2 === null) return { ok: false, error: "Escribe también la presión baja (diastólica)." };
    if (v2 < (meta.min2 ?? 0) || v2 > (meta.max2 ?? 999))
      return {
        ok: false,
        error: `La presión baja debe estar entre ${meta.min2} y ${meta.max2} mmHg.`,
      };
    if (v1 <= v2) return { ok: false, error: "La presión alta debe ser mayor que la baja." };
    return { ok: true, v1: Math.round(v1), v2: Math.round(v2) };
  }
  return { ok: true, v1: roundTo(v1, meta.decimals), v2: null };
}

const nf = (n: number, decimals: number) =>
  n.toFixed(decimals).replace(".", ",").replace(/,0$/, "");

export function formatMeasure(
  kind: MeasureKind,
  v1: number | string,
  v2?: number | string | null,
): string {
  const meta = MEASURE_META[kind];
  const a = num(v1, NaN);
  if (!Number.isFinite(a)) return "";
  if (kind === "bp") {
    const b = numOrNull(v2);
    return `${Math.round(a)}/${b === null ? "?" : Math.round(b)} ${meta.unit}`;
  }
  const text = meta.decimals ? nf(a, meta.decimals) : String(Math.round(a));
  return kind === "pain" ? `${text}${meta.unit}` : `${text} ${meta.unit}`;
}

// ── Metas ────────────────────────────────────────────────────────────────────

/** Limpia las metas: solo claves conocidas, números dentro de los límites y mínimo no mayor que máximo. */
export function normalizeTargets(raw: unknown): Targets {
  const out: Targets = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const n = numOrNull(src[key]);
    if (n === null) continue;
    const [lo, hi] = TARGET_BOUNDS[key];
    if (n < lo || n > hi) continue;
    out[key] = n;
  }
  const pairs: Array<[TargetKey, TargetKey]> = [
    ["glucose_min", "glucose_max"],
    ["sys_min", "sys_max"],
    ["dia_min", "dia_max"],
    ["weight_min", "weight_max"],
    ["hr_min", "hr_max"],
  ];
  for (const [a, b] of pairs) {
    const lo = out[a];
    const hi = out[b];
    if (lo !== undefined && hi !== undefined && lo > hi) {
      delete out[a];
      delete out[b];
    }
  }
  return out;
}

export type TargetState = "in" | "above" | "below" | "none";

/** ¿La lectura está dentro de la meta que anotó la familia? `none` si no hay meta que aplique. */
export function targetState(
  kind: MeasureKind,
  v1: number,
  v2: number | null,
  targets: Targets,
): TargetState {
  const check = (v: number, min?: number, max?: number): TargetState | null => {
    if (min === undefined && max === undefined) return null;
    if (min !== undefined && v < min) return "below";
    if (max !== undefined && v > max) return "above";
    return "in";
  };
  switch (kind) {
    case "glucose":
      return check(v1, targets.glucose_min, targets.glucose_max) ?? "none";
    case "weight":
      return check(v1, targets.weight_min, targets.weight_max) ?? "none";
    case "temp":
      return check(v1, undefined, targets.temp_max) ?? "none";
    case "spo2":
      return check(v1, targets.spo2_min, undefined) ?? "none";
    case "hr":
      return check(v1, targets.hr_min, targets.hr_max) ?? "none";
    case "bp": {
      const sys = check(v1, targets.sys_min, targets.sys_max);
      const dia = v2 === null ? null : check(v2, targets.dia_min, targets.dia_max);
      if (sys === null && dia === null) return "none";
      const states = [sys, dia].filter((x): x is TargetState => x !== null);
      return states.find((s) => s !== "in") ?? "in";
    }
    default:
      return "none";
  }
}

// ── Informe de un número ─────────────────────────────────────────────────────

export interface Reading {
  id: string;
  at: number;
  v1: number;
  v2: number | null;
  note: string | null;
  author: string;
  state: TargetState;
}

export type MeasureConcernLevel = "urgent" | "watch";

export interface MeasureConcern {
  level: MeasureConcernLevel;
  title: string;
  detail: string;
}

export interface NumbersReport {
  kind: MeasureKind;
  /** Lecturas del tipo, de la más reciente a la más antigua. */
  readings: Reading[];
  last: Reading | null;
  /** Lecturas de los últimos 7 días. */
  count7: number;
  /** Porcentaje de las lecturas de los últimos 7 días dentro de la meta (solo las que tienen meta); `null` si ninguna. */
  inRangePct: number | null;
  trend: "up" | "down" | "flat" | null;
  concern: MeasureConcern | null;
  /** ¿La familia ya anotó alguna meta para este número? */
  hasTarget: boolean;
}

/** Cambio mínimo entre las últimas 3 lecturas y las 3 anteriores para hablar de tendencia. */
export const TREND_DELTA: Record<MeasureKind, number> = {
  glucose: 15,
  bp: 8,
  weight: 1,
  temp: 0.4,
  spo2: 2,
  hr: 8,
  pain: 2,
};

/** Glucosa que las guías de la ADA tratan como baja. */
export const LOW_GLUCOSE = 70;

const HAS_TARGET: Record<MeasureKind, readonly TargetKey[]> = {
  glucose: ["glucose_min", "glucose_max"],
  bp: ["sys_min", "sys_max", "dia_min", "dia_max"],
  weight: ["weight_min", "weight_max"],
  temp: ["temp_max"],
  spo2: ["spo2_min"],
  hr: ["hr_min", "hr_max"],
  pain: [],
};

export function toReadings(
  rows: readonly MeasureRow[],
  kind: MeasureKind,
  targets: Targets,
): Reading[] {
  return rows
    .filter((r) => r.kind === kind)
    .map((r) => {
      const v1 = num(r.v1, NaN);
      return {
        id: r.id,
        at: msOf(r.measured_at),
        v1,
        v2: numOrNull(r.v2),
        note: r.note,
        author: r.author_id,
        state: Number.isFinite(v1)
          ? targetState(kind, v1, numOrNull(r.v2), targets)
          : ("none" as TargetState),
      };
    })
    .filter((r) => Number.isFinite(r.v1) && Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

function generalConcern(
  kind: MeasureKind,
  last: Reading,
  recipientKind: FamKind,
): MeasureConcern | null {
  const adult = recipientKind !== "child";
  const flags = (() => {
    switch (kind) {
      case "temp":
        return vitalFlags({ temperature: last.v1 });
      case "spo2":
        return vitalFlags({ oxygen: last.v1 });
      case "bp":
        return adult ? vitalFlags({ systolic: last.v1, diastolic: last.v2 ?? undefined }) : [];
      case "hr":
        return adult ? vitalFlags({ heartRate: last.v1 }) : [];
      default:
        return [];
    }
  })();
  if (flags.length) {
    const alert = flags.find((f) => f.level === "alert");
    const f = alert ?? flags[0];
    return alert
      ? {
          level: "urgent",
          title: "Fuera del rango general",
          detail: `${f.message} Conviene que lo valore un médico hoy. Los rangos son generales para adultos en reposo: cada persona puede tener otras metas.`,
        }
      : {
          level: "watch",
          title: "A vigilar",
          detail: `${f.message} Anótalo y coméntalo con su médico. Los rangos son generales: cada persona puede tener otras metas.`,
        };
  }
  if (kind === "glucose" && last.v1 < LOW_GLUCOSE) {
    return {
      level: "urgent",
      title: "Glucosa baja",
      detail: `Una glucosa por debajo de ${LOW_GLUCOSE} mg/dL es baja. Sigue las indicaciones de su médico para estos casos y, si está confundido, sudoroso o decaído, busca ayuda médica ya.`,
    };
  }
  if (kind === "pain" && last.v1 >= 7) {
    return {
      level: "watch",
      title: "Dolor intenso",
      detail: "Si el dolor no cede con lo que indicó su médico, consulta.",
    };
  }
  return null;
}

export function buildNumbers(input: {
  rows: readonly MeasureRow[];
  kind: MeasureKind;
  targets: Targets;
  recipientKind: FamKind;
  now: number;
}): NumbersReport {
  const { kind, targets, now } = input;
  const readings = toReadings(input.rows, kind, targets);
  const last = readings[0] ?? null;
  const since = now - 7 * DAY_MS;
  const week = readings.filter((r) => r.at >= since && r.at <= now + DAY_MS);
  const withTarget = week.filter((r) => r.state !== "none");
  const inRangePct = withTarget.length
    ? Math.round((withTarget.filter((r) => r.state === "in").length / withTarget.length) * 100)
    : null;

  // Tendencia: promedio de las 3 últimas contra el de las 3 anteriores (hace falta al menos 4 lecturas).
  let trend: NumbersReport["trend"] = null;
  if (readings.length >= 4) {
    const recent = average(readings.slice(0, 3).map((r) => r.v1)) as number;
    const before = average(readings.slice(3, 6).map((r) => r.v1)) as number;
    const delta = recent - before;
    trend = Math.abs(delta) < TREND_DELTA[kind] ? "flat" : delta > 0 ? "up" : "down";
  }

  const hasTarget = HAS_TARGET[kind].some((k) => targets[k] !== undefined);
  let concern: MeasureConcern | null = null;
  if (last) {
    if (hasTarget) {
      const lastThree = readings.slice(0, 3);
      const out = lastThree.filter((r) => r.state === "above" || r.state === "below").length;
      if (lastThree.length >= 3 && out >= 2) {
        concern = {
          level: "watch",
          title: "Fuera de tu meta",
          detail: `${out} de las últimas 3 lecturas están fuera de la meta que anotaste. Conviene comentarlo con su médico.`,
        };
      }
    }
    // Las alertas generales (y la glucosa baja) cuentan aunque haya meta: la meta no las apaga.
    const general = generalConcern(kind, last, input.recipientKind);
    if (general && (!concern || general.level === "urgent")) concern = general;
  }

  return { kind, readings, last, count7: week.length, inRangePct, trend, concern, hasTarget };
}

/** Los tipos de número que la familia ya usa (con al menos una lectura), en el orden del vocabulario. */
export function usedKinds(rows: readonly MeasureRow[]): MeasureKind[] {
  const seen = new Set(rows.map((r) => r.kind));
  return MEASURE_KINDS.filter((k) => seen.has(k));
}

export const NUMBERS_DISCLAIMER =
  "Las metas las pone su médico y cada persona tiene las suyas. Estos números no son un diagnóstico: llévalos a la consulta.";
