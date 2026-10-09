// Turnos de una oferta: de lo que escribe la institución (fecha y horas de Colombia) a instantes exactos.
//
// Colombia no tiene horario de verano (UTC-5 todo el año), así que la conversión es un desplazamiento fijo.
// Un turno de noche (19:00 → 07:00) termina al día siguiente. Las reglas espejan `publish_institution_offer`
// (SQL): entre 1 y 60 turnos, máximo 24 h cada uno, empezar a más tardar 1 h en el pasado y de 1 a 50
// profesionales por turno. Lo que decide es el servidor; esto da el error claro antes de enviar.

import { perShiftTotal, type OfferModality } from "./institutionNegotiation";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BOGOTA_OFFSET = -5 * HOUR;

export const MAX_SHIFTS_PER_OFFER = 60;
export const MAX_POSITIONS_PER_SHIFT = 50;
/** Tolerancia del servidor para turnos que ya empezaron. */
const PAST_TOLERANCE = HOUR;
/** Un año hacia adelante evita errores de digitación del año. */
const HORIZON = 366 * DAY;

export interface ShiftDraft {
  /** YYYY-MM-DD (fecha en Colombia). */
  date: string;
  /** HH:MM (hora de Colombia). */
  start: string;
  end: string;
  positions: number;
}

export interface BuiltShift {
  starts_at: string;
  ends_at: string;
  positions: number;
  hours: number;
  overnight: boolean;
}

export type ShiftError = "bad_date" | "bad_time" | "same_time" | "past" | "too_far" | "positions";

export const SHIFT_ERROR_COPY: Record<ShiftError, string> = {
  bad_date: "Elige una fecha válida.",
  bad_time: "Indica la hora de inicio y de fin.",
  same_time: "La hora de inicio y de fin no pueden ser iguales.",
  past: "El turno ya empezó hace más de una hora: elige una fecha futura.",
  too_far: "La fecha está a más de un año: revisa el año.",
  positions: `Cada turno admite entre 1 y ${MAX_POSITIONS_PER_SHIFT} profesionales.`,
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Descarta fechas inexistentes como 2026-02-30.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d)
    return null;
  return { y, m, d };
}

function parseTime(time: string): { h: number; min: number } | null {
  const match = TIME_RE.exec(time);
  return match ? { h: Number(match[1]), min: Number(match[2]) } : null;
}

export function buildShift(
  draft: ShiftDraft,
  now = Date.now(),
): { ok: true; shift: BuiltShift } | { ok: false; reason: ShiftError } {
  const date = parseDate(draft.date);
  if (!date) return { ok: false, reason: "bad_date" };
  const start = parseTime(draft.start);
  const end = parseTime(draft.end);
  if (!start || !end) return { ok: false, reason: "bad_time" };
  if (
    !Number.isInteger(draft.positions) ||
    draft.positions < 1 ||
    draft.positions > MAX_POSITIONS_PER_SHIFT
  ) {
    return { ok: false, reason: "positions" };
  }

  const startMs = Date.UTC(date.y, date.m - 1, date.d, start.h, start.min) - BOGOTA_OFFSET;
  let endMs = Date.UTC(date.y, date.m - 1, date.d, end.h, end.min) - BOGOTA_OFFSET;
  if (endMs === startMs) return { ok: false, reason: "same_time" };
  const overnight = endMs < startMs;
  if (overnight) endMs += DAY;

  if (startMs < now - PAST_TOLERANCE) return { ok: false, reason: "past" };
  if (startMs > now + HORIZON) return { ok: false, reason: "too_far" };

  return {
    ok: true,
    shift: {
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      positions: draft.positions,
      hours: Math.round(((endMs - startMs) / HOUR) * 100) / 100,
      overnight,
    },
  };
}

// ─── Patrones repetidos ──────────────────────────────────────────────────────

export interface ShiftPattern {
  from: string;
  to: string;
  /** 0 = domingo … 6 = sábado. */
  weekdays: number[];
  start: string;
  end: string;
  positions: number;
}

export const WEEKDAY_LABEL = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/** Un turno por cada día elegido entre dos fechas (máximo 60 y un rango de 120 días). */
export function expandPattern(pattern: ShiftPattern, max = MAX_SHIFTS_PER_OFFER): ShiftDraft[] {
  const from = parseDate(pattern.from);
  const to = parseDate(pattern.to);
  if (!from || !to || pattern.weekdays.length === 0) return [];
  const startDay = Date.UTC(from.y, from.m - 1, from.d);
  const endDay = Date.UTC(to.y, to.m - 1, to.d);
  if (endDay < startDay || endDay - startDay > 120 * DAY) return [];

  const days = new Set(pattern.weekdays);
  const out: ShiftDraft[] = [];
  for (let t = startDay; t <= endDay && out.length < max; t += DAY) {
    const day = new Date(t);
    if (!days.has(day.getUTCDay())) continue;
    out.push({
      date: day.toISOString().slice(0, 10),
      start: pattern.start,
      end: pattern.end,
      positions: pattern.positions,
    });
  }
  return out;
}

// ─── Revisión del lote ───────────────────────────────────────────────────────

/** Índices de los turnos repetidos (mismo día, hora de inicio y de fin) a partir del segundo. */
export function findDuplicateShifts(drafts: ShiftDraft[]): number[] {
  const seen = new Set<string>();
  const dup: number[] = [];
  drafts.forEach((d, i) => {
    const key = `${d.date}|${d.start}|${d.end}`;
    if (seen.has(key)) dup.push(i);
    else seen.add(key);
  });
  return dup;
}

export interface ShiftBatch {
  shifts: BuiltShift[];
  /** Posición (en el lote original) y motivo de cada turno inválido. */
  errors: Array<{ index: number; reason: ShiftError }>;
  duplicates: number[];
  totalHours: number;
  totalPositions: number;
  firstStart: string | null;
}

export function buildShiftBatch(drafts: ShiftDraft[], now = Date.now()): ShiftBatch {
  const shifts: BuiltShift[] = [];
  const errors: ShiftBatch["errors"] = [];
  drafts.forEach((draft, index) => {
    const built = buildShift(draft, now);
    if (built.ok) shifts.push(built.shift);
    else errors.push({ index, reason: built.reason });
  });
  shifts.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return {
    shifts,
    errors,
    duplicates: findDuplicateShifts(drafts),
    totalHours: Math.round(shifts.reduce((sum, s) => sum + s.hours * s.positions, 0) * 100) / 100,
    totalPositions: shifts.reduce((sum, s) => sum + s.positions, 0),
    firstStart: shifts[0]?.starts_at ?? null,
  };
}

/** Presupuesto estimado: cada cupo cuesta lo que se pagaría por esa reserva (hora, turno o parte del mes). */
export function estimateBudget(
  modality: OfferModality,
  amount: number,
  shifts: BuiltShift[],
): number {
  if (!Number.isFinite(amount) || amount <= 0 || shifts.length === 0) return 0;
  return shifts.reduce(
    (sum, s) => sum + s.positions * perShiftTotal(modality, amount, s.hours, shifts.length),
    0,
  );
}

export const MAX_REQUIREMENTS = 10;
export const MAX_REQUIREMENT_LENGTH = 120;

/** Texto libre (una línea o separado por comas) → lista limpia y sin repetidos. El formulario valida cantidad y largo. */
export function parseRequirements(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
