// Presupuesto de cuidado (plan de pago) — lógica pura.
//
// Con las reservas de la propia familia (lo que ya puede leer) arma el gasto por mes, una proyección del mes en curso
// con sus supuestos a la vista, el costo por hora frente al rango de la ciudad y las cancelaciones. No inventa
// precisión: la proyección es un RANGO (lo ya ejecutado + lo programado, y hasta lo que daría el ritmo habitual) y
// la comparación con el mercado exige una muestra mínima. Informa; nunca mueve dinero (los pagos solo se hacen en la
// página web de Humanix).

import { marketPosition, type MarketPosition, type MarketStats } from "./negotiation";
import { DAY_MS, pctOf, plural } from "./intelShared";
import {
  COMMITTED_STATUS,
  DONE_STATUS,
  FLOW_MONTHS,
  buildMoneyFlow,
  normalizeBooking,
  type FlowRow,
  type RawBooking,
} from "./moneyFlow";
import { formatCOP } from "./pricing";

/** Reserva de la familia: lo que paga es `total_amount`. */
export type BudgetBooking = RawBooking;

/** Estados de un servicio que ya se prestó (se cuenta como gasto). */
const SPENT_STATUS = DONE_STATUS;

/** Meses que se muestran en la gráfica (el actual incluido). */
export const BUDGET_MONTHS = FLOW_MONTHS;
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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function buildBudgetReport(args: {
  bookings: BudgetBooking[];
  market?: MarketStats | null;
  now?: number;
}): BudgetReport {
  const now = args.now ?? Date.now();
  const rows = args.bookings
    .map((b) => normalizeBooking(b, "paid"))
    .filter((r): r is FlowRow => r !== null);
  const spent = rows.filter((r) => (SPENT_STATUS as readonly string[]).includes(r.status));
  const committed = rows.filter((r) => (COMMITTED_STATUS as readonly string[]).includes(r.status));
  const cancelled = rows.filter((r) => r.status === "cancelled");

  // Meses, proyección del mes, mes pasado a la misma fecha y horas por semana: cuenta común a los tres paneles.
  const flow = buildMoneyFlow({ rows, now, months: BUDGET_MONTHS });
  const months: BudgetMonth[] = flow.months.map((m) => ({
    key: m.key,
    label: m.label,
    spent: m.settled,
    committed: m.committed,
    hours: m.hours,
    services: m.services,
    isCurrent: m.isCurrent,
  }));
  const cur = flow.current;

  // ── Costo por hora frente al mercado ───────────────────────────────────────
  const since = now - RATE_WINDOW_DAYS * DAY_MS;
  const rated = spent.filter((r) => r.at > since && r.at <= now && r.hours > 0);
  const ratedHours = sum(rated.map((r) => r.hours));
  const avgPerHour =
    rated.length >= MIN_SERVICES_FOR_RATE && ratedHours > 0
      ? Math.round(sum(rated.map((r) => r.amount)) / ratedHours)
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

  const hasData = spent.length + committed.length > 0;

  const report: BudgetReport = {
    hasData,
    months,
    current: {
      key: cur.key,
      label: cur.label,
      spentToDate: cur.settledToDate,
      committed: cur.committed,
      projectedLow: cur.projectedLow,
      projectedHigh: cur.projectedHigh,
      weeklyPace: cur.weeklyPace,
      daysLeft: cur.daysLeft,
    },
    vsLastMonth: {
      spentToDate: flow.vsLastMonth.settledToDate,
      lastMonthSameSpan: flow.vsLastMonth.lastMonthSameSpan,
      deltaPct: flow.vsLastMonth.deltaPct,
    },
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
    weeklyHours: flow.weeklyHours,
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
