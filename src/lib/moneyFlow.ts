// Flujo de dinero por mes de una persona o institución a partir de sus reservas — lógica pura.
//
// Lo comparten el presupuesto de la familia, los ingresos del profesional y los costos de la institución: la misma
// cuenta (lo ya hecho, lo acordado que falta, una proyección del mes con sus supuestos, el mes pasado a la misma fecha y
// las horas por semana) con montos distintos. No inventa precisión: la proyección es un RANGO. Informa; nunca mueve
// dinero (los pagos solo se hacen en la página web de Humanix).
import {
  DAY_MS,
  bogotaMonthKey,
  bogotaYmd,
  daysInMonth,
  monthLabelEs,
  msOf,
  num,
  prevMonthKey,
} from "./intelShared";

/** Una reserva ya normalizada: cuándo cuenta, cuántas horas y cuánto dinero. */
export interface FlowRow {
  id: string;
  status: string;
  /** Instante con el que cuenta en un mes: cuándo terminó, o para cuándo está programada. */
  at: number;
  hours: number;
  amount: number;
}

export interface RawBooking {
  id: string;
  status: string;
  scheduled_at: string;
  completed_at?: string | null;
  duration_hours?: number | string | null;
  hourly_rate?: number | string | null;
  total_amount?: number | string | null;
  professional_payout?: number | string | null;
  platform_fee_amount?: number | string | null;
}

/**
 * «paid»: lo que paga quien contrata (familia o institución). «earned»: lo que recibe el profesional, ya sin la comisión
 * del plan gratuito.
 */
export type AmountKind = "paid" | "earned";

/** Estados de un servicio que ya se prestó. */
export const DONE_STATUS = ["completed"] as const;
/**
 * Estados de un servicio acordado que aún no termina. «pending» no entra: es una solicitud que el profesional todavía
 * no confirmó, y la proyección no debe contar como segura una plata que puede no moverse.
 */
export const COMMITTED_STATUS = ["confirmed", "in_route", "in_progress"] as const;

/** Meses que se muestran en la gráfica (el actual incluido). */
export const FLOW_MONTHS = 6;

/** Lo que paga quien contrata. Si el servidor no trae el total, se reconstruye con tarifa × horas. */
export function paidAmount(b: RawBooking): number {
  const missing = b.total_amount === null || b.total_amount === undefined;
  const rate = num(b.hourly_rate);
  const hours = Math.max(0, num(b.duration_hours));
  return Math.max(0, Math.round(missing ? rate * hours : num(b.total_amount)));
}

/**
 * Lo que recibe el profesional: el neto que el servidor guarda al completar el servicio. Si todavía no está (servicio
 * sin terminar, o filas viejas), se calcula con el total menos la comisión; nunca queda por encima de lo que se pagó.
 */
export function earnedAmount(b: RawBooking): number {
  const gross = paidAmount(b);
  const payout = num(b.professional_payout, 0);
  if (payout > 0) return Math.min(gross > 0 ? gross : payout, Math.round(payout));
  const fee = Math.max(0, num(b.platform_fee_amount, 0));
  return Math.max(0, gross - Math.round(fee));
}

export function normalizeBooking(b: RawBooking, kind: AmountKind): FlowRow | null {
  const scheduled = msOf(b.scheduled_at);
  const done = msOf(b.completed_at);
  const isDone = (DONE_STATUS as readonly string[]).includes(b.status);
  const at = isDone && Number.isFinite(done) ? done : scheduled;
  if (!Number.isFinite(at)) return null;
  return {
    id: b.id,
    status: b.status,
    at,
    hours: Math.max(0, num(b.duration_hours)),
    amount: kind === "earned" ? earnedAmount(b) : paidAmount(b),
  };
}

export interface FlowMonth {
  key: string;
  label: string;
  /** Lo que ya se hizo (gastado o ganado). */
  settled: number;
  /** Lo acordado que todavía no termina. */
  committed: number;
  hours: number;
  services: number;
  isCurrent: boolean;
}

export interface FlowReport {
  months: FlowMonth[];
  current: {
    key: string;
    label: string;
    settledToDate: number;
    committed: number;
    /** Lo ya hecho + lo acordado. Nunca baja de aquí. */
    projectedLow: number;
    /** Si además se mantiene el ritmo semanal de las últimas 4 semanas. */
    projectedHigh: number;
    /** Ritmo semanal de las últimas 4 semanas (null si hay menos de 2 servicios). */
    weeklyPace: number | null;
    daysLeft: number;
  };
  /** Lo hecho a la fecha frente a lo hecho el mes pasado hasta el mismo día. */
  vsLastMonth: { settledToDate: number; lastMonthSameSpan: number; deltaPct: number | null };
  weeklyHours: { last4: number; prev4: number; deltaPct: number | null };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Los últimos `n` meses de Colombia terminando en el de `now`, del más viejo al más nuevo. */
export function lastMonthKeys(now: number, n: number): string[] {
  const keys: string[] = [];
  let key = bogotaMonthKey(now);
  for (let i = 0; i < n; i++) {
    keys.unshift(key);
    key = prevMonthKey(key);
  }
  return keys;
}

export function buildMoneyFlow(args: {
  rows: FlowRow[];
  now: number;
  months?: number;
  settledStatus?: readonly string[];
  committedStatus?: readonly string[];
}): FlowReport {
  const { rows, now } = args;
  const settledStatus = args.settledStatus ?? DONE_STATUS;
  const committedStatus = args.committedStatus ?? COMMITTED_STATUS;
  const settled = rows.filter((r) => settledStatus.includes(r.status));
  const committed = rows.filter((r) => committedStatus.includes(r.status));

  // ── Meses ──────────────────────────────────────────────────────────────────
  const keys = lastMonthKeys(now, Math.max(2, args.months ?? FLOW_MONTHS));
  const currentKey = keys[keys.length - 1];
  const months: FlowMonth[] = keys.map((key) => {
    const s = settled.filter((r) => bogotaMonthKey(r.at) === key);
    const c = committed.filter((r) => bogotaMonthKey(r.at) === key);
    return {
      key,
      label: monthLabelEs(key),
      settled: sum(s.map((r) => r.amount)),
      committed: sum(c.map((r) => r.amount)),
      hours: Math.round(sum(s.map((r) => r.hours)) * 100) / 100,
      services: s.length,
      isCurrent: key === currentKey,
    };
  });
  const cur = months[months.length - 1];

  // ── Proyección del mes en curso ────────────────────────────────────────────
  const { y, m, d } = bogotaYmd(now);
  const daysLeft = Math.max(0, daysInMonth(y, m) - d);
  const recent28 = settled.filter((r) => r.at <= now && r.at > now - 28 * DAY_MS);
  const weeklyPace =
    recent28.length >= 2 ? Math.round(sum(recent28.map((r) => r.amount)) / 4) : null;
  const projectedLow = cur.settled + cur.committed;
  const paceRest = weeklyPace === null ? 0 : Math.round((weeklyPace * daysLeft) / 7);
  const projectedHigh = Math.max(projectedLow, cur.settled + Math.max(cur.committed, paceRest));

  // ── Contra el mes pasado, hasta el mismo día ───────────────────────────────
  const prevKey = prevMonthKey(currentKey);
  const lastSpan = sum(
    settled
      .filter((r) => bogotaMonthKey(r.at) === prevKey && bogotaYmd(r.at).d <= d)
      .map((r) => r.amount),
  );
  const deltaPct = lastSpan > 0 ? Math.round(((cur.settled - lastSpan) / lastSpan) * 100) : null;

  // ── Horas por semana: últimas 4 contra las 4 anteriores ────────────────────
  const hoursIn = (from: number, to: number) =>
    sum(settled.filter((r) => r.at > from && r.at <= to).map((r) => r.hours));
  const last4 = Math.round((hoursIn(now - 28 * DAY_MS, now) / 4) * 10) / 10;
  const prev4 = Math.round((hoursIn(now - 56 * DAY_MS, now - 28 * DAY_MS) / 4) * 10) / 10;
  const hoursDelta = prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : null;

  return {
    months,
    current: {
      key: currentKey,
      label: monthLabelEs(currentKey),
      settledToDate: cur.settled,
      committed: cur.committed,
      projectedLow,
      projectedHigh,
      weeklyPace,
      daysLeft,
    },
    vsLastMonth: { settledToDate: cur.settled, lastMonthSameSpan: lastSpan, deltaPct },
    weeklyHours: { last4, prev4, deltaPct: hoursDelta },
  };
}
