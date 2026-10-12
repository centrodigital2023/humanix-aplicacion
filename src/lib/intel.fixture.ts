// Datos de prueba comunes a las funciones inteligentes de los tres paneles (no es una prueba: no se carga en la app).
import type { RawBooking } from "./moneyFlow";

/** Reserva de prueba: las de dinero más quién contrató y cuándo se canceló. */
export type FixtureBooking = RawBooking & {
  client_id?: string | null;
  cancelled_at?: string | null;
};

/** Miércoles 14 de octubre de 2026, 10:00 en Colombia (15:00 UTC). */
export const NOW = Date.parse("2026-10-14T15:00:00Z");
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
/** Instante a partir de una hora escrita en Colombia («2026-10-14T08:00:00»). */
export const bogota = (local: string) => Date.parse(`${local}-05:00`);

// Generador pseudoaleatorio con semilla: la prueba es repetible.
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let seq = 0;
export const nextId = (p: string) => `${p}${++seq}`;

/** Una reserva terminada hace 3 días de 6 h a $25.000/h ($150.000, sin comisión). */
export const raw = (over: Partial<FixtureBooking> = {}): FixtureBooking => ({
  id: nextId("b"),
  status: "completed",
  scheduled_at: iso(-3 * DAY),
  completed_at: iso(-3 * DAY + 6 * HOUR),
  duration_hours: 6,
  hourly_rate: 25_000,
  total_amount: 150_000,
  professional_payout: 150_000,
  platform_fee_amount: 0,
  ...over,
});

/** Reserva terminada hace `daysAgo` días, empezando a las 08:00 de Colombia de ese día. */
export const doneOn = (daysAgo: number, over: Partial<FixtureBooking> = {}): FixtureBooking => {
  const start = bogota("2026-10-14T08:00:00") - daysAgo * DAY;
  return raw({
    scheduled_at: new Date(start).toISOString(),
    completed_at: new Date(start + 6 * HOUR).toISOString(),
    ...over,
  });
};

/** Reserva acordada (confirmada) para dentro de `daysAhead` días a las 08:00. */
export const aheadOn = (daysAhead: number, over: Partial<FixtureBooking> = {}): FixtureBooking => {
  const start = bogota("2026-10-14T08:00:00") + daysAhead * DAY;
  return raw({
    status: "confirmed",
    scheduled_at: new Date(start).toISOString(),
    completed_at: null,
    professional_payout: 0,
    ...over,
  });
};
