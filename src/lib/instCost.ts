// Costos de la institución: cuánto invierte, en qué y cómo se compara con el mercado — lógica pura.
//
// Con las reservas de la propia institución (lo que ya puede leer) arma el gasto por mes y su proyección, el costo por hora
// del periodo elegido frente al rango de su ciudad, en qué ofertas y especialidades se va el dinero y qué tiene acordado
// para los próximos 30 días. No inventa precisión: la proyección es un RANGO (lo ya hecho + lo acordado, y hasta lo que daría
// el ritmo habitual), la comparación con el mercado exige una muestra mínima y el mercado no distingue especialidades, así que
// es una referencia, no un veredicto. Informa; nunca mueve dinero (los pagos solo se hacen en la página web de Humanix).

import type { InstBooking } from "./instData";
import {
  DAY_MS,
  hoursEs,
  inPeriod,
  periodPhrase,
  plural,
  previousPeriod,
  type Period,
} from "./intelShared";
import {
  COMMITTED_STATUS,
  DONE_STATUS,
  FLOW_MONTHS,
  buildMoneyFlow,
  normalizeBooking,
  type FlowMonth,
  type FlowReport,
  type FlowRow,
} from "./moneyFlow";
import { marketPosition, type MarketPosition, type MarketStats } from "./negotiation";
import { formatCOP } from "./pricing";

/** Datos de una oferta que explican en qué se gasta (el título y la especialidad que la institución escribió). */
export interface CostOffer {
  title?: string | null;
  specialty?: string | null;
}

/** Servicios terminados mínimos para hablar del costo por hora propio. */
export const MIN_SERVICES_FOR_RATE = 3;
/** Cuántos renglones de «en qué se va el dinero» se muestran antes de agrupar el resto. */
export const DRIVERS_SHOWN = 4;
/** Desde este porcentaje del gasto en una sola oferta se avisa de concentración. */
export const CONCENTRATION_PCT = 50;
/** Variación del costo por hora entre periodos desde la que se avisa. */
export const RATE_TREND_PCT = 10;
/** Variación del gasto contra el mes pasado (a la misma fecha) desde la que se avisa. */
export const PACE_PCT = 25;
/** Gasto mínimo del mes pasado a la misma fecha para comparar (con menos, el porcentaje no dice nada). */
export const PACE_MIN_BASE = 500_000;

export interface CostDriver {
  key: string;
  label: string;
  spent: number;
  hours: number;
  services: number;
  /** Porcentaje del gasto del periodo. */
  share: number;
}

export type CostSeverity = "warn" | "info" | "good";

export interface CostInsight {
  id: string;
  severity: CostSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface CostReport {
  hasData: boolean;
  period: Period;
  months: FlowMonth[];
  current: FlowReport["current"];
  vsLastMonth: FlowReport["vsLastMonth"];
  /** Lo terminado en el periodo elegido. */
  spent: number;
  hours: number;
  services: number;
  /** Costo por hora ponderado por horas (`null` con menos de 3 servicios). */
  avgPerHour: number | null;
  previous: {
    spent: number;
    services: number;
    avgPerHour: number | null;
    /** Variación del costo por hora frente al periodo anterior (`null` si falta alguno de los dos). */
    perHourDeltaPct: number | null;
  };
  rate: {
    position: MarketPosition;
    marketMedian: number | null;
    diffPct: number | null;
    /** Ahorro mensual aproximado si se pagara la mediana (solo si se paga por encima del rango). */
    savingsPerMonth: number | null;
  };
  drivers: CostDriver[];
  otherSpent: number;
  specialties: CostDriver[];
  /** Lo acordado (confirmado, en camino o en curso) para los próximos 30 días. */
  upcoming30: { amount: number; hours: number; services: number };
  insights: CostInsight[];
}

export interface CostInput {
  bookings: InstBooking[];
  offers: Record<string, CostOffer>;
  market: MarketStats | null;
  period: Period;
  now: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (n: number) => formatCOP(n);
const isDone = (r: FlowRow) => (DONE_STATUS as readonly string[]).includes(r.status);
const isCommitted = (r: FlowRow) => (COMMITTED_STATUS as readonly string[]).includes(r.status);

function perHour(rows: FlowRow[]): number | null {
  const hours = sum(rows.map((r) => r.hours));
  return rows.length >= MIN_SERVICES_FOR_RATE && hours > 0
    ? Math.round(sum(rows.map((r) => r.amount)) / hours)
    : null;
}

interface Group {
  key: string;
  label: string;
  rows: FlowRow[];
}

function drivers(groups: Group[], total: number): CostDriver[] {
  return groups
    .map((g) => ({
      key: g.key,
      label: g.label,
      spent: sum(g.rows.map((r) => r.amount)),
      hours: Math.round(sum(g.rows.map((r) => r.hours)) * 10) / 10,
      services: g.rows.length,
      share: total > 0 ? Math.round((sum(g.rows.map((r) => r.amount)) / total) * 100) : 0,
    }))
    .sort((a, b) => b.spent - a.spent || b.services - a.services || a.key.localeCompare(b.key));
}

export function buildCostReport(input: CostInput): CostReport {
  const { period, now } = input;
  const byId = new Map(input.bookings.map((b) => [b.id, b]));
  const rows = input.bookings
    .map((b) => normalizeBooking(b, "paid"))
    .filter((r): r is FlowRow => r !== null);
  const done = rows.filter(isDone);
  const committed = rows.filter(isCommitted);

  // Meses, proyección del mes, mes pasado a la misma fecha y horas por semana: cuenta común a los tres paneles.
  const flow = buildMoneyFlow({ rows, now, months: FLOW_MONTHS });

  // ── Periodo elegido y el anterior ────────────────────────────────────────────
  const inCurrent = done.filter((r) => inPeriod(r.at, period));
  const before = previousPeriod(period);
  const inBefore = done.filter((r) => inPeriod(r.at, before));
  const spent = sum(inCurrent.map((r) => r.amount));
  const hours = Math.round(sum(inCurrent.map((r) => r.hours)) * 100) / 100;
  const avgPerHour = perHour(inCurrent);
  const beforeAvg = perHour(inBefore);
  const perHourDeltaPct =
    avgPerHour !== null && beforeAvg !== null && beforeAvg > 0
      ? Math.round(((avgPerHour - beforeAvg) / beforeAvg) * 100)
      : null;

  // ── Costo por hora frente al mercado ─────────────────────────────────────────
  const position: MarketPosition =
    avgPerHour === null ? "unknown" : marketPosition(avgPerHour, input.market);
  const marketMedian = position === "unknown" ? null : (input.market?.median ?? null);
  const diffPct =
    avgPerHour !== null && marketMedian
      ? Math.round(((avgPerHour - marketMedian) / marketMedian) * 100)
      : null;
  const periodDays = Math.max(1, (period.to - period.from) / DAY_MS);
  const savingsPerMonth =
    position === "above" && avgPerHour !== null && marketMedian
      ? Math.max(0, Math.round((avgPerHour - marketMedian) * (hours / (periodDays / 30))))
      : null;

  // ── En qué se va ─────────────────────────────────────────────────────────────
  const group = (keyOf: (r: FlowRow) => { key: string; label: string }): Group[] => {
    const map = new Map<string, Group>();
    for (const r of inCurrent) {
      const { key, label } = keyOf(r);
      const g = map.get(key) ?? { key, label, rows: [] };
      g.rows.push(r);
      map.set(key, g);
    }
    return [...map.values()];
  };
  const offerGroups = group((r) => {
    const offerId = byId.get(r.id)?.job_offer_id ?? null;
    if (!offerId) return { key: "direct", label: "Servicios sin turno publicado" };
    const title = input.offers[offerId]?.title?.trim();
    // Todas las ofertas sin título se juntan en un solo renglón: dos filas con el mismo nombre no se distinguen.
    return title ? { key: offerId, label: title } : { key: "untitled", label: "Turno sin título" };
  });
  const specialtyGroups = group((r) => {
    const offerId = byId.get(r.id)?.job_offer_id ?? null;
    const specialty = offerId ? input.offers[offerId]?.specialty?.trim() : null;
    return specialty
      ? { key: specialty, label: specialty }
      : { key: "none", label: "Sin especialidad indicada" };
  });
  const allDrivers = drivers(offerGroups, spent);
  const shown = allDrivers.slice(0, DRIVERS_SHOWN);
  const otherSpent = sum(allDrivers.slice(DRIVERS_SHOWN).map((d) => d.spent));

  // ── Lo acordado para los próximos 30 días ────────────────────────────────────
  const soon = committed.filter((r) => r.at > now && r.at <= now + 30 * DAY_MS);

  const report: CostReport = {
    hasData: done.length + committed.length > 0,
    period,
    months: flow.months,
    current: flow.current,
    vsLastMonth: flow.vsLastMonth,
    spent,
    hours,
    services: inCurrent.length,
    avgPerHour,
    previous: {
      spent: sum(inBefore.map((r) => r.amount)),
      services: inBefore.length,
      avgPerHour: beforeAvg,
      perHourDeltaPct,
    },
    rate: { position, marketMedian, diffPct, savingsPerMonth },
    drivers: shown,
    otherSpent,
    specialties: drivers(specialtyGroups, spent).slice(0, DRIVERS_SHOWN),
    upcoming30: {
      amount: sum(soon.map((r) => r.amount)),
      hours: Math.round(sum(soon.map((r) => r.hours)) * 10) / 10,
      services: soon.length,
    },
    insights: [],
  };
  report.insights = costInsights(report, allDrivers.length);
  return report;
}

/** Una frase para el encabezado: lo del mes en curso si hay movimiento; si no, lo del periodo. */
export function costHeadline(r: CostReport): string {
  if (!r.hasData) return "Aún no hay servicios para calcular costos.";
  const c = r.current;
  if (c.settledToDate > 0) {
    const range =
      c.projectedHigh > c.projectedLow
        ? `entre ${money(c.projectedLow)} y ${money(c.projectedHigh)}`
        : money(c.projectedLow);
    return `Llevas ${money(c.settledToDate)} en ${c.label} y proyectamos ${range}.`;
  }
  if (c.committed > 0)
    return `En ${c.label} tienes ${money(c.committed)} acordados; todavía no hay servicios terminados.`;
  if (r.services > 0)
    return `En ${periodPhrase(r.period)} invertiste ${money(r.spent)} en ${plural(r.services, "servicio", "servicios")}.`;
  return "Sin movimiento este mes: lo acordado aparecerá aquí.";
}

const SEVERITY_ORDER: Record<CostSeverity, number> = { warn: 0, info: 1, good: 2 };

/** Hallazgos en lenguaje claro, de lo que pide atención a lo informativo. */
export function costInsights(r: CostReport, driverCount: number): CostInsight[] {
  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no hay servicios para analizar",
        detail:
          "Cuando tengas un servicio acordado o terminado, aquí verás cuánto llevas, cuánto proyectamos y cómo se compara tu costo por hora.",
      },
    ];
  }
  const out: CostInsight[] = [];
  const c = r.current;

  if (c.settledToDate + c.committed > 0) {
    const range =
      c.projectedHigh > c.projectedLow
        ? `entre ${money(c.projectedLow)} y ${money(c.projectedHigh)}`
        : money(c.projectedLow);
    out.push({
      id: "projection",
      severity: "info",
      title: `Proyectamos ${range} para ${c.label}`,
      detail:
        `Llevas ${money(c.settledToDate)} en servicios terminados y ${money(c.committed)} acordados.` +
        (c.projectedHigh > c.projectedLow
          ? ` El tope supone que mantienes el ritmo de las últimas 4 semanas (${money(c.weeklyPace ?? 0)} por semana).`
          : ""),
    });
  }

  const { deltaPct, settledToDate, lastMonthSameSpan } = r.vsLastMonth;
  if (deltaPct !== null && lastMonthSameSpan >= PACE_MIN_BASE) {
    if (deltaPct >= PACE_PCT) {
      out.push({
        id: "pace_up",
        severity: "warn",
        title: `Vas ${deltaPct} % por encima del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(lastMonthSameSpan)} y ahora ${money(settledToDate)}.`,
        action: "Revisa si el aumento es de horas o de valor por hora, y qué ofertas lo explican.",
      });
    } else if (deltaPct <= -PACE_PCT) {
      out.push({
        id: "pace_down",
        severity: "good",
        title: `Vas ${Math.abs(deltaPct)} % por debajo del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(lastMonthSameSpan)} y ahora ${money(settledToDate)}.`,
      });
    }
  }

  if (r.rate.position === "above" && r.rate.diffPct !== null && r.rate.marketMedian) {
    out.push({
      id: "above_market",
      severity: "warn",
      title: `Pagas ${r.rate.diffPct} % más que la mediana de tu ciudad`,
      detail: `Tu promedio es ${money(r.avgPerHour ?? 0)} por hora y la mediana del mercado ${money(r.rate.marketMedian)}.${
        r.rate.savingsPerMonth
          ? ` Pagar la mediana ahorraría unos ${money(r.rate.savingsPerMonth)} al mes (estimado con tus horas).`
          : ""
      } El mercado no distingue especialidades: úsalo como referencia.`,
      action: "Ajusta el valor de tus próximos turnos hacia el rango de tu ciudad.",
    });
  } else if (r.rate.position === "below" && r.rate.diffPct !== null) {
    out.push({
      id: "below_market",
      severity: "info",
      title: "Tu valor por hora está por debajo del rango de tu ciudad",
      detail: `Pagas ${money(r.avgPerHour ?? 0)} por hora. Es buen precio, pero puede costar más cubrir los horarios difíciles (noches y fines de semana).`,
    });
  }

  const delta = r.previous.perHourDeltaPct;
  if (delta !== null && delta >= RATE_TREND_PCT) {
    out.push({
      id: "rate_up",
      severity: "warn",
      title: `Tu costo por hora subió ${delta} % frente al periodo anterior`,
      detail: `Antes pagabas ${money(r.previous.avgPerHour ?? 0)} por hora y ahora ${money(r.avgPerHour ?? 0)}.`,
      action: "Mira en «En qué se va» qué ofertas subieron.",
    });
  } else if (delta !== null && delta <= -RATE_TREND_PCT) {
    out.push({
      id: "rate_down",
      severity: "good",
      title: `Tu costo por hora bajó ${Math.abs(delta)} % frente al periodo anterior`,
      detail: `Antes pagabas ${money(r.previous.avgPerHour ?? 0)} por hora y ahora ${money(r.avgPerHour ?? 0)}.`,
    });
  }

  const topDriver = r.drivers[0];
  if (topDriver && driverCount >= 2 && topDriver.share >= CONCENTRATION_PCT) {
    out.push({
      id: "concentration",
      severity: "info",
      title: `El ${topDriver.share} % del gasto está en «${topDriver.label}»`,
      detail: `Son ${money(topDriver.spent)} en ${plural(topDriver.services, "servicio", "servicios")}. Si ese turno se repite, negociar su valor mueve toda la cuenta.`,
    });
  }

  if (r.upcoming30.services > 0) {
    out.push({
      id: "upcoming",
      severity: "info",
      title: `Ya tienes ${money(r.upcoming30.amount)} acordados para los próximos 30 días`,
      detail: `${plural(r.upcoming30.services, "servicio", "servicios")} y ${hoursEs(r.upcoming30.hours)} h. Es dinero que ya está comprometido, aunque todavía no se haya gastado.`,
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
