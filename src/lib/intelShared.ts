// Utilidades comunes de las funciones inteligentes de los paneles de familia, profesional e institución (puras, sin base
// de datos).
//
// Las usan los motores de `src/lib` (bienestar, presupuesto, cobertura, ingresos, calidad…). Todo se calcula en el
// navegador con datos que la persona ya puede leer; nada de esto se envía a terceros ni a ninguna IA.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** Colombia no tiene horario de verano: UTC-5 todo el año. */
export const BOGOTA_OFFSET_MS = -5 * HOUR_MS;

/** Solo números y texto numérico son datos: `[]`, `true` o `"  "` no son un 0 escondido. */
function toFinite(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Número seguro: acepta texto numérico (PostgREST devuelve `numeric` como texto) y descarta lo que no es finito. */
export function num(v: unknown, fallback = 0): number {
  return toFinite(v) ?? fallback;
}

export function numOrNull(v: unknown): number | null {
  return toFinite(v);
}

/** Milisegundos de una fecha ISO; `NaN` si falta o está dañada. */
export function msOf(iso: string | null | undefined): number {
  return iso ? new Date(iso).getTime() : NaN;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Parte una lista en grupos de a lo sumo `size` (para pedir muchos ids sin pasarse del largo de la dirección). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/** «70,7»: las horas con coma decimal, como se escriben en Colombia, con a lo sumo dos decimales («72», no «72,00»). */
export function hoursEs(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** «a, b y c»: une frases con comas y una «y» antes de la última. */
export function joinEs(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Porcentaje entero; `null` si no hay con qué dividir. */
export function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function average(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Año, mes (1–12) y día de un instante en hora de Colombia. */
export function bogotaYmd(t: number): { y: number; m: number; d: number } {
  const d = new Date(t + BOGOTA_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** «2026-10» del mes de Colombia al que pertenece el instante. */
export function bogotaMonthKey(t: number): string {
  const { y, m } = bogotaYmd(t);
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Clave del mes anterior: «2026-01» → «2025-12». */
export function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** «oct 2026». */
export function monthLabelEs(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? "?"} ${y}`;
}

/** «mié 14 oct», en hora de Colombia y sin depender del ICU del equipo. */
export function dayLabelEs(t: number): string {
  const d = new Date(t + BOGOTA_OFFSET_MS);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** «14 oct 2026», en hora de Colombia. */
export function dateEs(t: number): string {
  const { y, m, d } = bogotaYmd(t);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** «15:00», en hora de Colombia. */
export function timeLabelEs(t: number): string {
  const d = new Date(t + BOGOTA_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Día calendario de Colombia como número entero (para comparar «hoy», «mañana»). */
export function bogotaDayIndex(t: number): number {
  return Math.floor((t + BOGOTA_OFFSET_MS) / DAY_MS);
}

/**
 * Cuenta regresiva corta: «en 25 min», «en 3 h», «en 2 días», «ya venció».
 * Nunca devuelve negativos ni «NaN».
 */
export function countdownEs(targetMs: number, now: number): string {
  if (!Number.isFinite(targetMs)) return "";
  const diff = targetMs - now;
  if (diff <= 0) return "ya venció";
  const min = Math.ceil(diff / 60_000);
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  // Cuando queda poco, los minutos importan: «en 1 h 30 min»; más lejos, solo las horas.
  if (h < 3) return `en ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
  if (h < 48) return `en ${h} h`;
  return `en ${Math.floor(h / 24)} días`;
}

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Día de la semana de Colombia con el lunes en 0 y el domingo en 6 (la semana laboral empieza el lunes). */
export function bogotaWeekday(t: number): number {
  return (new Date(t + BOGOTA_OFFSET_MS).getUTCDay() + 6) % 7;
}

/** «lunes», «martes»… para un día de la semana de 0 (lunes) a 6 (domingo). */
export function weekdayNameEs(dow: number): string {
  return WEEKDAY_NAMES[((Math.trunc(dow) % 7) + 7) % 7];
}

/** Medianoche (hora de Colombia) con la que empieza el día del instante, en milisegundos UTC. */
export function startOfBogotaDay(t: number): number {
  return bogotaDayIndex(t) * DAY_MS - BOGOTA_OFFSET_MS;
}

/**
 * Parte un intervalo en los días de Colombia que toca. Un turno de noche (19:00 → 07:00) devuelve dos tramos.
 * Devuelve una lista vacía si el intervalo no es válido o no tiene duración.
 */
export function splitByBogotaDay(
  start: number,
  end: number,
): Array<{ day: number; startMs: number; endMs: number; hours: number }> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const out: Array<{ day: number; startMs: number; endMs: number; hours: number }> = [];
  let cursor = start;
  while (cursor < end) {
    const dayStart = startOfBogotaDay(cursor);
    const next = Math.min(end, dayStart + DAY_MS);
    out.push({
      day: bogotaDayIndex(cursor),
      startMs: cursor,
      endMs: next,
      hours: (next - cursor) / HOUR_MS,
    });
    cursor = next;
  }
  return out;
}

/** «domingo 18 de octubre», en hora de Colombia (para frases corridas donde «dom 18 oct» suena a abreviatura). */
export function longDayLabelEs(t: number): string {
  const { m, d } = bogotaYmd(t);
  return `${weekdayNameEs(bogotaWeekday(t))} ${d} de ${MONTH_NAMES[m - 1]}`;
}

/** «hoy a las 15:00», «mañana a las 08:00», «jue 15 oct a las 08:00». */
export function whenEs(t: number, now: number): string {
  const days = bogotaDayIndex(t) - bogotaDayIndex(now);
  const hour = timeLabelEs(t);
  if (days <= 0) return `hoy a las ${hour}`;
  if (days === 1) return `mañana a las ${hour}`;
  return `${dayLabelEs(t)} a las ${hour}`;
}

/** «hace 3 h», «hace 2 días»: edad de algo que ya pasó. */
export function ageEs(t: number, now: number): string {
  const h = Math.max(0, Math.floor((now - t) / HOUR_MS));
  if (h < 1) return "hace menos de una hora";
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

// ─── Periodos de informe ─────────────────────────────────────────────────────

/** Periodos que ofrecen los informes de la institución: dos ventanas móviles y el mes anterior completo. */
export type PeriodKey = "30d" | "90d" | "last_month";

export interface Period {
  key: PeriodKey;
  /** Inicio, incluido (ms UTC). */
  from: number;
  /** Fin, excluido (ms UTC). */
  to: number;
  label: string;
}

/** Medianoche de Colombia con la que empieza un mes («2026-10»), en ms UTC. */
export function monthStartMs(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, 1) - BOGOTA_OFFSET_MS;
}

/** Periodo pedido, visto desde `now`. El mes anterior se corta en los límites del calendario de Colombia. */
export function resolvePeriod(key: PeriodKey, now: number): Period {
  if (key === "last_month") {
    const current = bogotaMonthKey(now);
    const previous = prevMonthKey(current);
    return {
      key,
      from: monthStartMs(previous),
      to: monthStartMs(current),
      label: `Mes pasado (${monthLabelEs(previous)})`,
    };
  }
  const days = key === "90d" ? 90 : 30;
  return { key, from: now - days * DAY_MS, to: now, label: `Últimos ${days} días` };
}

/** El periodo inmediatamente anterior y de la misma duración (o el mes completo anterior), para comparar. */
export function previousPeriod(p: Period): Period {
  if (p.key === "last_month") {
    const previous = prevMonthKey(bogotaMonthKey(p.from));
    return {
      key: p.key,
      from: monthStartMs(previous),
      to: p.from,
      label: `Mes anterior (${monthLabelEs(previous)})`,
    };
  }
  const length = p.to - p.from;
  return {
    key: p.key,
    from: p.from - length,
    to: p.from,
    label: `Los ${Math.round(length / DAY_MS)} días anteriores`,
  };
}

const lowerFirst = (t: string) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;

/** «los últimos 30 días», «el mes pasado (sep 2026)»: el periodo dentro de una frase corrida. */
export function periodPhrase(p: Period): string {
  return `${p.key === "last_month" ? "el" : "los"} ${lowerFirst(p.label)}`;
}

/** ¿El instante cae dentro del periodo? El inicio cuenta; el fin no. Un instante dañado nunca cuenta. */
export function inPeriod(t: number, p: Period): boolean {
  // NaN e infinitos hacen falsa la comparación: un instante dañado nunca cae dentro.
  return t >= p.from && t < p.to;
}
