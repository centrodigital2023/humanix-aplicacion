// Atajo anticipatorio: si la familia contrató 3+ veces al mismo profesional el mismo día de la semana y a una hora
// parecida, proponemos repetirlo en un toque. Puro y en hora de Bogotá (UTC-5, sin horario de verano).

export interface RoutineBooking {
  status: string;
  scheduled_at: string;
  professional_id: string;
  duration_hours?: number | null;
}

export interface CareRoutine {
  professionalId: string;
  weekday: number; // 0 = domingo
  hour: number; // 0-23 hora de Bogotá
  times: number;
  durationHours: number | null;
  nextAt: string; // ISO de la próxima ocurrencia
  hasUpcoming: boolean; // ya hay un servicio reservado para esa fecha
}

export const ROUTINE_MIN_TIMES = 3;
const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;
export const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function local(ms: number) {
  const d = new Date(ms - BOGOTA_OFFSET_MS);
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() };
}

/** La rutina más repetida (o null si ninguna llega a 3 veces). */
export function detectRoutine(bookings: RoutineBooking[], now: number): CareRoutine | null {
  const groups = new Map<string, { b: RoutineBooking[]; weekday: number; hour: number }>();
  for (const b of bookings) {
    if (b.status !== "completed" || !b.professional_id) continue;
    const ms = Date.parse(b.scheduled_at);
    if (!Number.isFinite(ms)) continue;
    const { weekday, hour } = local(ms);
    const key = `${b.professional_id}|${weekday}|${hour}`;
    const g = groups.get(key) ?? { b: [], weekday, hour };
    g.b.push(b);
    groups.set(key, g);
  }
  let best: { b: RoutineBooking[]; weekday: number; hour: number } | null = null;
  for (const g of groups.values()) if (!best || g.b.length > best.b.length) best = g;
  if (!best || best.b.length < ROUTINE_MIN_TIMES) return null;

  const proId = best.b[0].professional_id;
  const durations = best.b.map((b) => b.duration_hours).filter((d): d is number => !!d && d > 0);
  const nowLocal = new Date(now - BOGOTA_OFFSET_MS);
  const todayStart = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate());
  let delta = (best.weekday - nowLocal.getUTCDay() + 7) % 7;
  let next = todayStart + delta * DAY_MS + best.hour * 3_600_000 + BOGOTA_OFFSET_MS;
  if (next <= now) {
    delta += 7;
    next += 7 * DAY_MS;
  }
  const hasUpcoming = bookings.some(
    (b) =>
      b.professional_id === proId &&
      !["cancelled", "completed", "rejected"].includes(b.status) &&
      Math.abs(Date.parse(b.scheduled_at) - next) < 12 * 3_600_000,
  );
  return {
    professionalId: proId,
    weekday: best.weekday,
    hour: best.hour,
    times: best.b.length,
    durationHours: durations.length ? Math.round(median(durations)) : null,
    nextAt: new Date(next).toISOString(),
    hasUpcoming,
  };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function routineLabel(r: CareRoutine): string {
  const h = r.hour % 12 === 0 ? 12 : r.hour % 12;
  return `los ${WEEKDAYS[r.weekday]} a las ${h} ${r.hour < 12 ? "a. m." : "p. m."}`;
}
