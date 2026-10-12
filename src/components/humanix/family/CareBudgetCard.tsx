// Presupuesto de cuidado (plan Esencial): gasto por mes, proyección del mes en curso con sus supuestos y costo por hora
// frente al rango de la ciudad (lógica en `lib/careBudget`). Informa; no mueve dinero: los pagos se hacen solo en la
// página web de Humanix.
import { Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BudgetReport, BudgetSeverity } from "@/lib/careBudget";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { MonthBars } from "@/components/humanix/premium/MonthBars";
import { StatTile } from "@/components/humanix/premium/StatTile";

const TONE: Record<BudgetSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

const POSITION_TEXT = {
  below: "por debajo del rango de tu ciudad",
  within: "dentro del rango de tu ciudad",
  above: "por encima del rango de tu ciudad",
  unknown: "",
} as const;

export function CareBudgetCard({
  report,
  loading,
  error,
  className,
}: {
  report: BudgetReport | null;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Presupuesto de cuidado">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Wallet className="h-4 w-4 text-trust" aria-hidden="true" /> Presupuesto de cuidado
        </h3>
        <p className="text-xs text-muted-foreground">
          Lo que llevas, lo que ya tienes programado y cuánto proyectamos para el mes.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus servicios. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatTile
              label={`Llevas en ${report.current.label}`}
              value={formatCOP(report.current.spentToDate)}
              hint="en servicios terminados"
            />
            <StatTile
              label="Programado"
              value={formatCOP(report.current.committed)}
              hint="servicios acordados que aún no terminan"
            />
            <StatTile
              label="Proyección del mes"
              value={
                report.current.projectedHigh > report.current.projectedLow
                  ? `${formatCOP(report.current.projectedLow)} – ${formatCOP(report.current.projectedHigh)}`
                  : formatCOP(report.current.projectedLow)
              }
              hint={
                report.current.projectedHigh > report.current.projectedLow
                  ? `el tope mantiene tu ritmo de 4 semanas (${formatCOP(report.current.weeklyPace ?? 0)} por semana)`
                  : `faltan ${report.current.daysLeft} días del mes`
              }
            />
          </dl>

          {report.vsLastMonth.deltaPct !== null && (
            <p className="text-sm">
              Frente al mes pasado a esta altura:{" "}
              <strong
                className={cn(
                  report.vsLastMonth.deltaPct > 0
                    ? "text-warn"
                    : report.vsLastMonth.deltaPct < 0
                      ? "text-ok"
                      : "text-foreground",
                )}
              >
                {report.vsLastMonth.deltaPct > 0 ? "+" : ""}
                {report.vsLastMonth.deltaPct} %
              </strong>{" "}
              ({formatCOP(report.vsLastMonth.spentToDate)} contra{" "}
              {formatCOP(report.vsLastMonth.lastMonthSameSpan)}).
            </p>
          )}

          <MonthBars
            months={report.months.map((m) => ({
              key: m.key,
              label: m.label,
              settled: m.spent,
              committed: m.committed,
              hours: m.hours,
              isCurrent: m.isCurrent,
            }))}
            title="Gasto por mes"
            settledLabel="Gastado"
            committedLabel="Programado"
            emptyText="Aún no hay servicios en estos meses."
          />

          {report.rate.avgPerHour !== null && (
            <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              Tu tarifa promedio es <strong>{formatCOP(report.rate.avgPerHour)} por hora</strong>{" "}
              (últimos 90 días, {report.rate.services} servicios)
              {report.rate.position !== "unknown" &&
              report.rate.diffPct !== null &&
              report.rate.marketMedian
                ? `: ${POSITION_TEXT[report.rate.position]}, ${report.rate.diffPct > 0 ? "+" : ""}${report.rate.diffPct} % frente a la mediana de ${formatCOP(report.rate.marketMedian)}.`
                : ". Aún no hay suficientes servicios comparables en tu ciudad para dar una referencia."}
            </p>
          )}

          <InsightList
            label="Hallazgos del presupuesto"
            items={report.insights.map((i) => ({
              id: i.id,
              tone: TONE[i.severity],
              title: i.title,
              detail: i.detail,
              action: i.action,
            }))}
          />

          <p className="text-[11px] text-muted-foreground">
            La proyección es un rango, no una promesa: suma lo ya terminado y lo programado, y su
            tope supone que mantienes el ritmo de las últimas 4 semanas. Los pagos se hacen
            únicamente en la página web de Humanix.
          </p>
        </>
      )}
    </Card>
  );
}
