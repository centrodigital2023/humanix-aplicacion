// Ingresos reales del profesional (plan Pro): lo que le queda por mes, lo acordado, la proyección, su día más fuerte,
// las familias que vuelven y su tarifa frente al rango de la ciudad (lógica en `lib/proEarnings`). Informa; no mueve
// dinero: los pagos se hacen solo en la página web de Humanix, y no es asesoría tributaria.
import { HeartHandshake, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { MonthBars } from "@/components/humanix/premium/MonthBars";
import { StatTile } from "@/components/humanix/premium/StatTile";
import {
  earningsHeadline,
  type EarningsReport,
  type EarningsSeverity,
  type WeekdayEarnings,
} from "@/lib/proEarnings";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const TONE: Record<EarningsSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** Hallazgos que la propia tarjeta ya muestra de otra forma (frase de apertura, cifras, familias y rango de tarifa). */
const HIDDEN_INSIGHTS = new Set([
  "projection",
  "pace_up",
  "repeat_good",
  "rate_within",
  "rate_above",
]);

const POSITION_TEXT = {
  below: "por debajo del rango de tu ciudad",
  within: "dentro del rango de tu ciudad",
  above: "por encima del rango de tu ciudad",
  unknown: "",
} as const;

/** Siete barras (lunes a domingo) con el día más fuerte resaltado. */
function WeekdayBars({ days, best }: { days: WeekdayEarnings[]; best: WeekdayEarnings | null }) {
  const max = Math.max(0, ...days.map((d) => d.earned));
  if (max === 0) return null;
  return (
    <section aria-label="Ingresos por día de la semana" className="space-y-2">
      <h4 className="text-sm font-semibold">Qué días te rinden más</h4>
      <div
        className="grid h-20 grid-cols-7 items-end gap-2"
        role="img"
        aria-label={`Ingresos de 90 días por día de la semana: ${days
          .map((d) => `${d.label} ${formatCOP(d.earned)} en ${d.services} servicios`)
          .join("; ")}`}
      >
        {days.map((d) => (
          <div key={d.dow} className="flex h-full flex-col justify-end" aria-hidden="true">
            <div
              className={cn("w-full rounded-t", best?.dow === d.dow ? "bg-ok" : "bg-ok/35")}
              style={{ height: `${(d.earned / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7 gap-2 text-center text-[10px] text-muted-foreground"
        aria-hidden="true"
      >
        {days.map((d) => (
          <span key={d.dow} className={cn(best?.dow === d.dow && "font-bold text-foreground")}>
            {d.label.slice(0, 3)}
          </span>
        ))}
      </div>
    </section>
  );
}

export function EarningsCard({
  report,
  loading,
  error,
  className,
}: {
  report: EarningsReport | null;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const up = report ? (report.flow.vsLastMonth.deltaPct ?? 0) >= 15 : false;

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Ingresos reales">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Wallet className="h-4 w-4 text-ok" aria-hidden="true" /> Tus ingresos reales
        </h3>
        <p className="text-xs text-muted-foreground">
          Lo que te queda por mes, lo acordado, tu mejor día y tu tarifa frente al mercado.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus servicios. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <p className="flex items-start gap-3 rounded-2xl border border-ok/25 bg-gradient-to-br from-ok/10 via-background to-trust/10 p-4 text-base font-medium leading-snug">
            {up ? (
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
            ) : (
              <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
            )}
            <span>{earningsHeadline(report)}</span>
          </p>

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatTile
              label={`Llevas en ${report.flow.current.label}`}
              value={formatCOP(report.flow.current.settledToDate)}
              hint="neto, en servicios terminados"
            />
            <StatTile
              label="Acordado por hacer"
              value={formatCOP(report.flow.current.committed)}
              hint="servicios confirmados que aún no terminan"
            />
            <StatTile
              label="Proyección del mes"
              value={
                report.flow.current.projectedHigh > report.flow.current.projectedLow
                  ? `${formatCOP(report.flow.current.projectedLow)} – ${formatCOP(report.flow.current.projectedHigh)}`
                  : formatCOP(report.flow.current.projectedLow)
              }
              hint={
                report.flow.current.projectedHigh > report.flow.current.projectedLow
                  ? `el tope mantiene tu ritmo de 4 semanas (${formatCOP(report.flow.current.weeklyPace ?? 0)} por semana)`
                  : `faltan ${report.flow.current.daysLeft} días del mes`
              }
            />
          </dl>

          {report.flow.vsLastMonth.deltaPct !== null && (
            <p className="text-sm">
              Frente al mes pasado a esta altura:{" "}
              <strong
                className={cn(
                  report.flow.vsLastMonth.deltaPct > 0
                    ? "text-ok"
                    : report.flow.vsLastMonth.deltaPct < 0
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                {report.flow.vsLastMonth.deltaPct > 0 ? "+" : ""}
                {report.flow.vsLastMonth.deltaPct} %
              </strong>{" "}
              ({formatCOP(report.flow.vsLastMonth.settledToDate)} contra{" "}
              {formatCOP(report.flow.vsLastMonth.lastMonthSameSpan)}).
            </p>
          )}

          <MonthBars
            months={report.flow.months}
            title="Ingresos por mes"
            settledLabel="Ganado"
            committedLabel="Acordado"
            emptyText="Aún no hay servicios en estos meses."
            colorClass="ok"
          />

          {report.perHour.net !== null && (
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <StatTile
                label="Te queda por hora"
                value={formatCOP(report.perHour.net)}
                hint={`promedio de ${report.perHour.services} servicios en 90 días`}
                tone="ok"
              />
              <StatTile
                label="Las familias pagaron por hora"
                value={formatCOP(report.perHour.gross ?? 0)}
                hint={
                  report.commission.paid90 > 0
                    ? "la diferencia es la comisión del plan gratuito"
                    : "sin comisión: cobras todo directo"
                }
              />
            </dl>
          )}

          <WeekdayBars days={report.weekdays} best={report.bestDay} />

          {report.repeat.sharePct !== null && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <HeartHandshake className="h-4 w-4 text-copper" aria-hidden="true" />
                {report.repeat.repeatFamilies} de {report.repeat.families} familias volvieron a
                contratarte
              </p>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${report.repeat.sharePct} % de las familias de los últimos 6 meses volvieron`}
              >
                <div
                  className="h-full rounded-full bg-copper"
                  style={{ width: `${report.repeat.sharePct}%` }}
                />
              </div>
            </div>
          )}

          {report.rate.published !== null && (
            <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              Publicas <strong>{formatCOP(report.rate.published)} por hora</strong>
              {report.rate.position !== "unknown" &&
              report.rate.diffPct !== null &&
              report.rate.marketMedian
                ? `: ${POSITION_TEXT[report.rate.position]}, ${report.rate.diffPct > 0 ? "+" : ""}${report.rate.diffPct} % frente a la mediana de ${formatCOP(report.rate.marketMedian)}.`
                : ". Aún no hay suficientes tarifas comparables en tu ciudad para dar una referencia."}
            </p>
          )}

          <InsightList
            label="Hallazgos de tus ingresos"
            items={report.insights
              .filter((i) => !HIDDEN_INSIGHTS.has(i.id))
              .map((i) => ({
                id: i.id,
                tone: TONE[i.severity],
                title: i.title,
                detail: i.detail,
                action: i.action,
              }))}
          />

          <p className="text-[11px] text-muted-foreground">
            Los montos son netos (lo que te queda después de la comisión del plan gratuito). La
            proyección es un rango, no una promesa. No es asesoría tributaria: para aportes y
            retenciones usa el planificador de ingresos. Los pagos se hacen únicamente en la página
            web de Humanix.
          </p>
        </>
      )}
    </Card>
  );
}
