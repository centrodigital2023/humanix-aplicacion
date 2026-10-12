// Utilidades comunes de las funciones inteligentes del panel de familia (puras, sin base de datos).
//
// Las usan `wellbeing`, `careBudget`, `coverageRadar`, `applicantRanking` y `familyBrief`. Todo se calcula en el
// navegador con datos que la familia ya puede leer; nada de esto se envía a terceros ni a ninguna IA.

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
