// Ingresos reales del profesional (plan Esencial) — lógica pura.
//
// Con las reservas del propio profesional (lo que ya puede leer) arma lo ganado por mes (el neto que le queda), lo
// acordado que falta, una proyección del mes con sus supuestos a la vista, qué días rinde más, cuántas familias vuelven,
// cuánta comisión pagó y dónde queda su tarifa frente al rango de su ciudad. No inventa precisión: la proyección es un
// RANGO y las comparaciones exigen una muestra mínima. Informa; nunca mueve dinero (los pagos solo se hacen en la
// página web de Humanix) y no es asesoría tributaria (el planificador de ingresos explica los supuestos de los aportes).
import {
  DAY_MS,
  bogotaMonthKey,
  bogotaWeekday,
  msOf,
  num,
  pctOf,
  plural,
  weekdayNameEs,
} from "./intelShared";
import {
  DONE_STATUS,
  FLOW_MONTHS,
  buildMoneyFlow,
  normalizeBooking,
  paidAmount,
  type FlowReport,
  type FlowRow,
  type RawBooking,
} from "./moneyFlow";
import { marketPosition, roundToStep, type MarketPosition, type MarketStats } from "./negotiation";
import { formatCOP } from "./pricing";
import { PLAN_CATALOG } from "./plans";

export interface EarningsBooking extends RawBooking {
  client_id?: string | null;
}

/** Días hacia atrás para los promedios por hora, los días fuertes y la comisión. */
export const EARNINGS_WINDOW_DAYS = 90;
/** Días hacia atrás para saber qué familias vuelven. */
export const REPEAT_WINDOW_DAYS = 180;
/** Servicios terminados mínimos para hablar de un promedio por hora. */
export const MIN_SERVICES_FOR_HOURLY = 3;
/** Servicios terminados mínimos para hablar de días fuertes. */
export const MIN_SERVICES_FOR_WEEKDAY = 8;
/** Servicios terminados mínimos para sugerir un cambio de tarifa. */
export const MIN_SERVICES_FOR_RATE_ADVICE = 5;
/** Familias distintas mínimas para hablar del porcentaje de familias que vuelven. */
export const MIN_FAMILIES_FOR_REPEAT = 3;
/** Servicios mínimos (de cualquier estado) para hablar de cancelaciones. */
export const MIN_SERVICES_FOR_CANCEL = 5;

export type EarningsSeverity = "warn" | "info" | "good";

export interface EarningsInsight {
  id: string;
  severity: EarningsSeverity;
  title: string;
  detail: string;
  action?: string;
}

export interface WeekdayEarnings {
  /** 0 = lunes … 6 = domingo. */
  dow: number;
  label: string;
  earned: number;
  hours: number;
  services: number;
}

export interface EarningsReport {
  hasData: boolean;
  flow: FlowReport;
  perHour: {
    /** Lo que le queda por hora trabajada (ya sin comisión). */
    net: number | null;
    /** Lo que pagaron las familias por hora. */
    gross: number | null;
    services: number;
  };
  commission: {
    paid90: number;
    paidMonth: number;
    gross90: number;
    /** Comisión efectiva sobre lo pagado en 90 días (0 si está en un plan sin comisión). */
    effectivePct: number | null;
    /** Lo que cuesta el plan Esencial por los mismos 3 meses. */
    essentialCost90: number;
    /** Lo que habría ahorrado con el plan Esencial en 90 días; null si no pagó comisión o no le compensa. */
    savingWithEssential90: number | null;
  };
  weekdays: WeekdayEarnings[];
  bestDay: WeekdayEarnings | null;
  repeat: { families: number; repeatFamilies: number; sharePct: number | null };
  cancellations: { count: number; total: number; pct: number | null };
  rate: {
    published: number | null;
    marketMedian: number | null;
    position: MarketPosition;
    diffPct: number | null;
    suggested: number | null;
    /** Cuánto sumaría al mes la tarifa sugerida con las horas de los últimos 90 días. */
    extraPerMonth: number | null;
  };
  insights: EarningsInsight[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (n: number) => formatCOP(n);

export function buildEarningsReport(args: {
  bookings: EarningsBooking[];
  /** Tarifa por hora publicada en su perfil. */
  publishedRate?: number | null;
  market?: MarketStats | null;
  now?: number;
}): EarningsReport {
  const now = args.now ?? Date.now();
  const rows = args.bookings
    .map((b) => normalizeBooking(b, "earned"))
    .filter((r): r is FlowRow => r !== null);
  const flow = buildMoneyFlow({ rows, now, months: FLOW_MONTHS });
  const since = now - EARNINGS_WINDOW_DAYS * DAY_MS;

  const isDone = (b: EarningsBooking) => (DONE_STATUS as readonly string[]).includes(b.status);
  const doneAt = (b: EarningsBooking): number => {
    const t = msOf(b.completed_at);
    return Number.isFinite(t) ? t : msOf(b.scheduled_at);
  };
  const done90 = args.bookings.filter((b) => isDone(b) && doneAt(b) > since && doneAt(b) <= now);
  const hours90 = sum(done90.map((b) => Math.max(0, num(b.duration_hours))));
  const earned90 = sum(done90.map((b) => normalizeBooking(b, "earned")?.amount ?? 0));
  const gross90 = sum(done90.map((b) => paidAmount(b)));

  // ── Por hora ───────────────────────────────────────────────────────────────
  const hourlyOk = done90.length >= MIN_SERVICES_FOR_HOURLY && hours90 > 0;
  const perHour = {
    net: hourlyOk ? Math.round(earned90 / hours90) : null,
    gross: hourlyOk ? Math.round(gross90 / hours90) : null,
    services: done90.length,
  };

  // ── Comisión (solo la paga quien está en el plan gratuito) ─────────────────
  const fee = (b: EarningsBooking) => Math.max(0, Math.round(num(b.platform_fee_amount, 0)));
  const paid90 = sum(done90.map(fee));
  const monthKey = flow.current.key;
  const paidMonth = sum(
    args.bookings.filter((b) => isDone(b) && bogotaMonthKey(doneAt(b)) === monthKey).map(fee),
  );
  const essentialCost90 = PLAN_CATALOG.essential_monthly.amountCOP * 3;
  const commission = {
    paid90,
    paidMonth,
    gross90,
    effectivePct: gross90 > 0 && paid90 > 0 ? Math.round((paid90 / gross90) * 1000) / 10 : null,
    essentialCost90,
    savingWithEssential90: paid90 > essentialCost90 ? paid90 - essentialCost90 : null,
  };

  // ── Días de la semana (según cuándo empezó el servicio) ────────────────────
  const weekdays: WeekdayEarnings[] = Array.from({ length: 7 }, (_, dow) => ({
    dow,
    label: weekdayNameEs(dow),
    earned: 0,
    hours: 0,
    services: 0,
  }));
  for (const b of done90) {
    const start = msOf(b.scheduled_at);
    if (!Number.isFinite(start)) continue;
    const day = weekdays[bogotaWeekday(start)];
    day.earned += normalizeBooking(b, "earned")?.amount ?? 0;
    day.hours += Math.max(0, num(b.duration_hours));
    day.services += 1;
  }
  let bestDay: WeekdayEarnings | null = null;
  if (done90.length >= MIN_SERVICES_FOR_WEEKDAY) {
    for (const d of weekdays)
      if (d.earned > 0 && (!bestDay || d.earned > bestDay.earned)) bestDay = d;
  }

  // ── Familias que vuelven ───────────────────────────────────────────────────
  const sinceRepeat = now - REPEAT_WINDOW_DAYS * DAY_MS;
  const perClient = new Map<string, number>();
  for (const b of args.bookings) {
    if (!isDone(b) || !b.client_id) continue;
    const t = doneAt(b);
    if (!(t > sinceRepeat && t <= now)) continue;
    perClient.set(b.client_id, (perClient.get(b.client_id) ?? 0) + 1);
  }
  const families = perClient.size;
  const repeatFamilies = [...perClient.values()].filter((n) => n >= 2).length;
  const repeat = {
    families,
    repeatFamilies,
    sharePct: families >= MIN_FAMILIES_FOR_REPEAT ? pctOf(repeatFamilies, families) : null,
  };

  // ── Cancelaciones ──────────────────────────────────────────────────────────
  const windowed = rows.filter((r) => r.at > since && r.at <= now + 30 * DAY_MS);
  const cancelled = windowed.filter((r) => r.status === "cancelled");
  const cancellations = {
    count: cancelled.length,
    total: windowed.length,
    pct:
      windowed.length >= MIN_SERVICES_FOR_CANCEL ? pctOf(cancelled.length, windowed.length) : null,
  };

  // ── Tarifa frente al mercado ───────────────────────────────────────────────
  const published =
    typeof args.publishedRate === "number" && args.publishedRate > 0 ? args.publishedRate : null;
  const position: MarketPosition =
    published === null ? "unknown" : marketPosition(published, args.market);
  const median = position === "unknown" ? null : (args.market?.median ?? null);
  const diffPct =
    published !== null && median ? Math.round(((published - median) / median) * 100) : null;
  let suggested: number | null = null;
  if (
    position === "below" &&
    published !== null &&
    args.market?.p25 != null &&
    done90.length >= MIN_SERVICES_FOR_RATE_ADVICE
  ) {
    // Primer paso prudente: llegar al borde bajo del rango (p25), no saltar de golpe a la mediana.
    const step = roundToStep(args.market.p25);
    if (step > published) suggested = step;
  }
  const monthlyHours = hours90 / (EARNINGS_WINDOW_DAYS / 30);
  const extraPerMonth =
    suggested !== null && published !== null && monthlyHours > 0
      ? Math.round((suggested - published) * monthlyHours)
      : null;

  const report: EarningsReport = {
    hasData:
      done90.length > 0 || flow.current.committed > 0 || flow.months.some((m) => m.settled > 0),
    flow,
    perHour,
    commission,
    weekdays,
    bestDay,
    repeat,
    cancellations,
    rate: { published, marketMedian: median, position, diffPct, suggested, extraPerMonth },
    insights: [],
  };
  report.insights = earningsInsights(report);
  return report;
}

/** Hallazgos en lenguaje claro, de lo que pide atención a lo que celebra. */
export function earningsInsights(r: EarningsReport): EarningsInsight[] {
  const out: EarningsInsight[] = [];

  if (!r.hasData) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no hay servicios para analizar",
        detail:
          "Cuando termines tu primer servicio verás aquí cuánto ganas por mes, cuánto proyectamos y qué días te rinden más.",
      },
    ];
  }

  const c = r.flow.current;
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
        `Llevas ${money(c.settledToDate)} en servicios terminados y ${money(c.committed)} acordados por hacer.` +
        (c.projectedHigh > c.projectedLow
          ? ` El tope supone que mantienes el ritmo de las últimas 4 semanas (${money(c.weeklyPace ?? 0)} por semana).`
          : ""),
    });
  }

  const { deltaPct } = r.flow.vsLastMonth;
  if (deltaPct !== null && r.flow.vsLastMonth.lastMonthSameSpan >= 100_000) {
    if (deltaPct >= 15) {
      out.push({
        id: "pace_up",
        severity: "good",
        title: `Vas ${deltaPct} % por encima del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(r.flow.vsLastMonth.lastMonthSameSpan)} y ahora ${money(r.flow.vsLastMonth.settledToDate)}. Buen ritmo.`,
      });
    } else if (deltaPct <= -25) {
      out.push({
        id: "pace_down",
        severity: "info",
        title: `Vas ${Math.abs(deltaPct)} % por debajo del mes pasado a esta altura`,
        detail: `A la misma fecha llevabas ${money(r.flow.vsLastMonth.lastMonthSameSpan)} y ahora ${money(r.flow.vsLastMonth.settledToDate)}.`,
        action:
          "Mira «Mi semana»: te proponemos turnos compatibles con tu agenda para llenar los huecos.",
      });
    }
  }

  const k = r.commission;
  if (k.paid90 > 0) {
    if (k.savingWithEssential90 !== null) {
      out.push({
        id: "commission_saving",
        severity: "warn",
        title: `En 90 días pagaste ${money(k.paid90)} de comisión`,
        detail: `El plan Esencial (${PLAN_CATALOG.essential_monthly.priceLabel}${PLAN_CATALOG.essential_monthly.priceNote}) no cobra comisión: con tu volumen habrías conservado unos ${money(k.savingWithEssential90)} después de pagar el plan.`,
        action: "Compara los planes; la suscripción se hace en la página web.",
      });
    } else {
      out.push({
        id: "commission_info",
        severity: "info",
        title: `En 90 días pagaste ${money(k.paid90)} de comisión`,
        detail: `Con tu volumen actual el plan Esencial todavía no se paga solo (costaría ${money(k.essentialCost90)} en 3 meses). Si tus horas suben, vuelve a mirarlo.`,
      });
    }
  }

  const { rate } = r;
  if (rate.position === "below" && rate.published !== null) {
    out.push({
      id: "rate_below",
      severity: "info",
      title: "Tu tarifa está por debajo del rango de tu ciudad",
      detail:
        `Publicas ${money(rate.published)} por hora y la mediana del mercado es ${money(rate.marketMedian ?? 0)}.` +
        (rate.suggested !== null
          ? ` Subir a ${money(rate.suggested)} (el borde bajo del rango) sumaría unos ${money(rate.extraPerMonth ?? 0)} al mes con tus horas actuales.`
          : ""),
      action:
        rate.suggested !== null
          ? "Cambia tu tarifa en el perfil; las familias nuevas verán el valor actualizado."
          : undefined,
    });
  } else if (rate.position === "within") {
    out.push({
      id: "rate_within",
      severity: "good",
      title: "Tu tarifa está dentro del rango de tu ciudad",
      detail: `Publicas ${money(rate.published ?? 0)} por hora, entre lo que paga la mayoría de familias.`,
    });
  } else if (rate.position === "above" && rate.published !== null) {
    out.push({
      id: "rate_above",
      severity: "info",
      title: "Tu tarifa está por encima del rango de tu ciudad",
      detail: `Publicas ${money(rate.published)} por hora. Es normal con experiencia y buena reputación; si recibes pocas propuestas, mira si ayuda mostrar tu trayectoria o ajustar el valor en horarios difíciles.`,
    });
  }

  if (r.bestDay) {
    out.push({
      id: "best_day",
      severity: "info",
      title: `Tu día más fuerte es el ${r.bestDay.label}`,
      detail: `En 90 días el ${r.bestDay.label} te dejó ${money(r.bestDay.earned)} en ${plural(r.bestDay.services, "servicio", "servicios")}. Mantener ese día disponible suele darte más ofertas.`,
    });
  }

  const rep = r.repeat;
  if (rep.sharePct !== null) {
    if (rep.sharePct >= 30) {
      out.push({
        id: "repeat_good",
        severity: "good",
        title: `${plural(rep.repeatFamilies, "familia volvió", "familias volvieron")} a contratarte`,
        detail: `Son ${rep.sharePct} % de las ${rep.families} familias de los últimos 6 meses. Quien vuelve confía en ti: es la base de un ingreso estable.`,
      });
    } else {
      out.push({
        id: "repeat_low",
        severity: "info",
        title: `${rep.sharePct} % de tus familias volvieron a contratarte`,
        detail:
          "Un parte claro al terminar cada turno y guardar a la familia en tu equipo de confianza ayudan a que vuelvan.",
      });
    }
  }

  const x = r.cancellations;
  if (x.pct !== null && x.pct >= 20) {
    out.push({
      id: "cancellations",
      severity: "warn",
      title: `Se cancelaron ${plural(x.count, "servicio", "servicios")} de ${x.total} (${x.pct} %)`,
      detail:
        "Cada cancelación deja un hueco en tu agenda. Confirmar horarios por el chat el día anterior suele reducirlas.",
    });
  }

  const w = r.flow.weeklyHours;
  if (w.deltaPct !== null && Math.abs(w.deltaPct) >= 25 && w.prev4 >= 2) {
    out.push({
      id: "hours_trend",
      severity: "info",
      title:
        w.deltaPct > 0
          ? `Tus horas subieron ${w.deltaPct} % frente a las 4 semanas anteriores`
          : `Tus horas bajaron ${Math.abs(w.deltaPct)} % frente a las 4 semanas anteriores`,
      detail: `Ahora son ${w.last4} h por semana en promedio; antes eran ${w.prev4} h.`,
    });
  }

  const order: Record<EarningsSeverity, number> = { warn: 0, info: 1, good: 2 };
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order[a.x.severity] - order[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
