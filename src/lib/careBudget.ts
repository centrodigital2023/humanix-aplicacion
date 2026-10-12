// Presupuesto de cuidado (plan de pago) — lógica pura.
//
// Con las reservas de la propia familia (lo que ya puede leer) arma el gasto por mes, una proyección del mes en curso
// con sus supuestos a la vista, el costo por hora frente al rango de la ciudad y las cancelaciones. No inventa
// precisión: la proyección es un RANGO (lo ya ejecutado + lo programado, y hasta lo que daría el ritmo habitual) y
// la comparación con el mercado exige una muestra mínima. Informa; nunca mueve dinero (los pagos solo se hacen en la
// página web de Humanix).

import { marketPosition, type MarketPosition, type MarketStats } from "./negotiation";
import {
  DAY_MS,
  bogotaMonthKey,
  bogotaYmd,
  daysInMonth,
  monthLabelEs,
  msOf,
  num,
  pctOf,
  plural,
  prevMonthKey,
} from "./familyIntelShared";
import { formatCOP } from "./pricing";

export interface BudgetBooking {
  id: string;
  status: string;
  scheduled_at: string;
  completed_at?: string | null;
  duration_hours: number | string | null;
  hourly_rate?: number | string | null;
  /** Lo que paga la familia por el servicio. */
  total_amount: number | string | null;
}

/** Estados de un servicio que ya se prestó (se cuenta como gasto). */
const SPENT_STATUS = ["completed"];
/**
 * Estados de un servicio acordado que aún no termina (se cuenta como comprometido). «pending» no entra: es una
 * solicitud que el profesional todavía no confirmó, y la proyección no debe contar como segura una plata que puede
 * no gastarse.
 */
const COMMITTED_STATUS = ["confirmed", "in_route", "in_progress"];

/** Meses que se muestran en la gráfica (el actual incluido). */
export const BUDGET_MONTHS = 6;
/** Días hacia atrás para calcular el costo por hora y las cancelaciones. */
export const RATE_WINDOW_DAYS = 90;
/** Servicios completados mínimos para hablar del costo por hora propio. */
export const MIN_SERVICES_FOR_RATE = 3;
/** Servicios mínimos para hablar de cancelaciones. */
export const MIN_SERVICES_FOR_CANCEL = 5;

export interface BudgetMonth {
  key: string;
  label: string;
  spent: number;
  committed: number;
  hours: number;
  services: number;
  isCurrent: boolean;
}

export type BudgetSeverity = "warn" | "info" | "good";

export interface BudgetInsight {
  id: string;
  severity: BudgetSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface BudgetReport {
  hasData: boolean;
  months: BudgetMonth[];
  current: {
    key: string;
    label: string;
    spentToDate: number;
    committed: number;
    /** Lo ya ejecutado + lo programado. Nunca baja de aquí. */
    projectedLow: number;
    /** Si además se mantiene el ritmo semanal de las últimas 4 semanas. */
    projectedHigh: number;
    /** Ritmo semanal de las últimas 4 semanas (null si hay menos de 2 servicios). */
    weeklyPace: number | null;
    daysLeft: number;
  };
  /** Lo gastado a la fecha frente a lo gastado el mes pasado hasta el mismo día. */
  vsLastMonth: { spentToDate: number; lastMonthSameSpan: number; deltaPct: number | null };
  rate: {
    /** Promedio ponderado por horas de los servicios completados en 90 días. */
    avgPerHour: number | null;
    services: number;
    marketMedian: number | null;
    position: MarketPosition;
    diffPct: number | null;
    /** Ahorro mensual aproximado si se negociara a la mediana (solo si estás por encima del rango). */
    savingsPerMonth: number | null;
  };
  cancellations: { count: number; total: number; pct: number | null };
  weeklyHours: { last4: number; prev4: number; deltaPct: number | null };
  insights: BudgetInsight[];
}

interface Normalized {
  id: string;
  status: string;
  /** Fecha con la que el servicio cuenta en un mes: terminó el… o está programado para el… */
  at: number;
  hours: number;
  total: number;
}

function normalize(b: BudgetBooking): Normalized | null {
  const scheduled = msOf(b.scheduled_at);
  const done = msOf(b.completed_at);
  const at = SPENT_STATUS.includes(b.status) && Number.isFinite(done) ? done : scheduled;
  if (!Number.isFinite(at)) return null;
  const rate = num(b.hourly_rate);
  const hours = Math.max(0, num(b.duration_hours));
  // Si el servidor no trae el total, se reconstruye con tarifa × horas; un total negativo no existe.
  const missing = b.total_amount === null || b.total_amount === undefined;
  const total = Math.max(0, Math.round(missing ? rate * hours : num(b.total_amount)));
  return { id: b.id, status: b.status, at, hours, total };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Los últimos `n` meses de Colombia terminando en el de `now`, del más viejo al más nuevo. */
function lastMonthKeys(now: number, n: number): string[] {
  const keys: string[] = [];
  let key = bogotaMonthKey(now);
  for (let i = 0; i < n; i++) {
    keys.unshift(key);
    key = prevMonthKey(key);
  }
  return keys;
}

export function buildBudgetReport(args: {
  bookings: BudgetBooking[];
  market?: MarketStats | null;
  now?: number;
}): BudgetReport {
  const now = args.now ?? Date.now();
  const rows = args.bookings.map(normalize).filter((r): r is Normalized => r !== null);
  const spent = rows.filter((r) => SPENT_STATUS.includes(r.status));
  const committed = rows.filter((r) => COMMITTED_STATUS.includes(r.status));
  const cancelled = rows.filter((r) => r.status === "cancelled");

  // ── Meses ──────────────────────────────────────────────────────────────────
  const keys = lastMonthKeys(now, BUDGET_MONTHS);
  const currentKey = keys[keys.length - 1];
  const months: BudgetMonth[] = keys.map((key) => {
    const s = spent.filter((r) => bogotaMonthKey(r.at) === key);
    const c = committed.filter((r) => bogotaMonthKey(r.at) === key);
    return {
      key,
      label: monthLabelEs(key),
      spent: sum(s.map((r) => r.total)),
      committed: sum(c.map((r) => r.total)),
      hours: Math.round(sum(s.map((r) => r.hours)) * 100) / 100,
      services: s.length,
      isCurrent: key === currentKey,
    };
  });
  const cur = months[months.length - 1];

  // ── Proyección del mes en curso ────────────────────────────────────────────
  const { y, m, d } = bogotaYmd(now);
  const daysLeft = Math.max(0, daysInMonth(y, m) - d);
  const recent28 = spent.filter((r) => r.at <= now && r.at > now - 28 * DAY_MS);
  const weeklyPace =
    recent28.length >= 2 ? Math.round(sum(recent28.map((r) => r.total)) / 4) : null;
  const projectedLow = cur.spent + cur.committed;
  const paceRest = weeklyPace === null ? 0 : Math.round((weeklyPace * daysLeft) / 7);
  const projectedHigh = Math.max(projectedLow, cur.spent + Math.max(cur.committed, paceRest));

  // ── Contra el mes pasado, hasta el mismo día ───────────────────────────────
  const prevKey = prevMonthKey(currentKey);
  const lastSpan = sum(
    spent
      .filter((r) => bogotaMonthKey(r.at) === prevKey && bogotaYmd(r.at).d <= d)
      .map((r) => r.total),
  );
  const deltaPct = lastSpan > 0 ? Math.round(((cur.spent - lastSpan) / lastSpan) * 100) : null;

  // ── Costo por hora frente al mercado ───────────────────────────────────────
  const since = now - RATE_WINDOW_DAYS * DAY_MS;
  const rated = spent.filter((r) => r.at > since && r.at <= now && r.hours > 0);
  const ratedHours = sum(rated.map((r) => r.hours));
  const avgPerHour =
    rated.length >= MIN_SERVICES_FOR_RATE && ratedHours > 0
      ? Math.round(sum(rated.map((r) => r.total)) / ratedHours)
      : null;
  const position: MarketPosition =
    avgPerHour === null ? "unknown" : marketPosition(avgPerHour, args.market);
  const median = position === "unknown" ? null : (args.market?.median ?? null);
  const diffPct =
    avgPerHour !== null && median ? Math.round(((avgPerHour - median) / median) * 100) : null;
  const monthlyHours = ratedHours / (RATE_WINDOW_DAYS / 30);
  const savingsPerMonth =
    position === "above" && avgPerHour !== null && median
      ? Math.max(0, Math.round((avgPerHour - median) * monthlyHours))
      : null;

  // ── Cancelaciones ──────────────────────────────────────────────────────────
  const windowed = rows.filter((r) => r.at > since && r.at <= now + 30 * DAY_MS);
  const cancelledInWindow = cancelled.filter((r) => r.at > since && r.at <= now + 30 * DAY_MS);
  const cancelTotal = windowed.length;
  const cancelPct =
    cancelTotal >= MIN_SERVICES_FOR_CANCEL ? pctOf(cancelledInWindow.length, cancelTotal) : null;

  // ── Horas por semana: últimas 4 contra las 4 anteriores ────────────────────
  const hoursIn = (from: number, to: number) =>
    sum(spent.filter((r) => r.at > from && r.at <= to).map((r) => r.hours));
  const last4 = Math.round((hoursIn(now - 28 * DAY_MS, now) / 4) * 10) / 10;
  const prev4 = Math.round((hoursIn(now - 56 * DAY_MS, now - 28 * DAY_MS) / 4) * 10) / 10;
  const hoursDelta = prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : null;

  const hasData = spent.length + committed.length > 0;

  const report: BudgetReport = {
    hasData,
    months,
    current: {
      key: currentKey,
      label: monthLabelEs(currentKey),
      spentToDate: cur.spent,
      committed: cur.committed,
      projectedLow,
      projectedHigh,
      weeklyPace,
      daysLeft,
    },
    vsLastMonth: { spentToDate: cur.spent, lastMonthSameSpan: lastSpan, deltaPct },
    rate: {
      avgPerHour,
      services: rated.length,
      marketMedian: median,
      position,
      diffPct,
      savingsPerMonth,
    },
    cancellations: {
      count: cancelledInWindow.length,
      total: cancelTotal,
      pct: cancelPct,
    },
    weeklyHours: { last4, prev4, deltaPct: hoursDelta },
    insights: [],
  };
  report.insights = budgetInsights(report, rated.length);
  return report;
}

const money = (n: number) => formatCOP(n);

/** Hallazgos en lenguaje claro, de lo que pide atención a lo informativo. */
export function budgetInsights(r: BudgetReport, ratedServices: number): BudgetInsight[] {
  const out: BudgetInsight[] = [];

  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no hay servicios para analizar",
        detail:
          "Cuando tengas un servicio programado o terminado, aquí verás cuánto llevas y cuánto proyectamos para el mes.",
      },
    ];
  }

  const { current: c } = r;
  if (c.spentToDate + c.committed > 0) {
    const range =
      c.projectedHigh > c.projectedLow
        ? `entre ${money(c.projectedLow)} y ${money(c.projectedHigh)}`
        : `${money(c.projectedLow)}`;
    out.push({
      id: "projection",
      severity: "info",
      title: `Proyectamos ${range} para ${c.label}`,
      detail:
        `Llevas ${money(c.spentToDate)} en servicios terminados y ${money(c.committed)} programados.` +
        (c.projectedHigh > c.projectedLow
          ? ` El tope supone que mantienes el ritmo de las últimas 4 semanas (${money(c.weeklyPace ?? 0)} por semana).`
          : ""),
    });
  }

  const { deltaPct } = r.vsLastMonth;
  if (deltaPct !== null && r.vsLastMonth.spentToDate >= 100_000) {
    if (deltaPct >= 25) {
      out.push({
        id: "pace_up",
        severity: "warn",
        title: `Vas ${deltaPct} % por encima del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(r.vsLastMonth.lastMonthSameSpan)} y ahora ${money(r.vsLastMonth.spentToDate)}.`,
        action:
          "Revisa si el aumento es de horas o de tarifa; el comparador de postulaciones te ayuda a negociar.",
      });
    } else if (deltaPct <= -25) {
      out.push({
        id: "pace_down",
        severity: "good",
        title: `Vas ${Math.abs(deltaPct)} % por debajo del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(r.vsLastMonth.lastMonthSameSpan)} y ahora ${money(r.vsLastMonth.spentToDate)}.`,
      });
    }
  }

  const { rate } = r;
  if (rate.position === "above" && rate.diffPct !== null && rate.marketMedian) {
    out.push({
      id: "above_market",
      severity: "warn",
      title: `Pagas ${rate.diffPct} % más que la mediana de tu ciudad`,
      detail: `Tu promedio es ${money(rate.avgPerHour ?? 0)} por hora y la mediana del mercado ${money(rate.marketMedian)}.${
        rate.savingsPerMonth
          ? ` Negociar a la mediana ahorraría unos ${money(rate.savingsPerMonth)} al mes (estimado con tus horas).`
          : ""
      }`,
      action: "Pide una contraoferta antes de aceptar el próximo servicio.",
    });
  } else if (rate.position === "below" && rate.diffPct !== null) {
    out.push({
      id: "below_market",
      severity: "info",
      title: "Tu tarifa está por debajo del rango de tu ciudad",
      detail: `Pagas ${money(rate.avgPerHour ?? 0)} por hora. Es buen precio, pero puede tardar más en llegar alguien disponible en los horarios difíciles.`,
    });
  } else if (rate.position === "within") {
    out.push({
      id: "within_market",
      severity: "good",
      title: "Tu tarifa está dentro del rango de tu ciudad",
      detail: `Pagas ${money(rate.avgPerHour ?? 0)} por hora, entre lo que paga la mayoría de familias.`,
    });
  } else if (ratedServices > 0 && ratedServices < MIN_SERVICES_FOR_RATE) {
    out.push({
      id: "small_sample",
      severity: "info",
      title: "Aún es pronto para comparar tu tarifa",
      detail: `Con ${plural(ratedServices, "servicio terminado", "servicios terminados")} no se puede hablar de un promedio. Hacen falta ${MIN_SERVICES_FOR_RATE}.`,
    });
  }

  const { cancellations: k } = r;
  if (k.pct !== null && k.pct >= 25) {
    out.push({
      id: "cancellations",
      severity: "warn",
      title: `Se cancelaron ${plural(k.count, "servicio", "servicios")} de ${k.total} (${k.pct} %)`,
      detail:
        "Muchas cancelaciones cuestan tiempo y dejan huecos sin cubrir. Los horarios fijos con alguien de tu equipo de confianza suelen cancelarse menos.",
    });
  }

  const { weeklyHours: w } = r;
  if (w.deltaPct !== null && Math.abs(w.deltaPct) >= 25 && w.prev4 >= 2) {
    out.push({
      id: "hours_trend",
      severity: "info",
      title:
        w.deltaPct > 0
          ? `Las horas de cuidado subieron ${w.deltaPct} % frente a las 4 semanas anteriores`
          : `Las horas de cuidado bajaron ${Math.abs(w.deltaPct)} % frente a las 4 semanas anteriores`,
      detail: `Ahora son ${w.last4} h por semana en promedio; antes eran ${w.prev4} h.`,
    });
  }

  const order: Record<BudgetSeverity, number> = { warn: 0, info: 1, good: 2 };
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order[a.x.severity] - order[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
