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

const TONE: Record<BudgetSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

const POSITION_TEXT = {
  below: "por debajo del rango de tu ciudad",
  within: "dentro del rango de tu ciudad",
  above: "por encima del rango de tu ciudad",
  unknown: "",
} as const;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-lg font-bold leading-tight">{value}</dd>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

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
  const max = report ? Math.max(0, ...report.months.map((m) => m.spent + m.committed)) : 0;

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
            <Tile
              label={`Llevas en ${report.current.label}`}
              value={formatCOP(report.current.spentToDate)}
              hint="en servicios terminados"
            />
            <Tile
              label="Programado"
              value={formatCOP(report.current.committed)}
              hint="servicios acordados que aún no terminan"
            />
            <Tile
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

          <section aria-label="Gasto por mes" className="space-y-2">
            <h4 className="text-sm font-semibold">Últimos 6 meses</h4>
            {max === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay servicios en estos meses.</p>
            ) : (
              <>
                <div
                  className="grid h-28 grid-cols-6 items-end gap-2"
                  role="img"
                  aria-label={`Gasto por mes: ${report.months
                    .map(
                      (m) =>
                        `${m.label} ${formatCOP(m.spent)} gastado y ${formatCOP(m.committed)} programado`,
                    )
                    .join("; ")}`}
                >
                  {report.months.map((m) => (
                    <div
                      key={m.key}
                      className="flex h-full flex-col justify-end gap-px"
                      aria-hidden="true"
                    >
                      <div
                        className="w-full rounded-t bg-trust/40"
                        style={{ height: `${(m.committed / max) * 100}%` }}
                      />
                      <div
                        className={cn("w-full bg-trust", m.committed === 0 && "rounded-t")}
                        style={{ height: `${(m.spent / max) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div
                  className="grid grid-cols-6 gap-2 text-center text-[10px] text-muted-foreground"
                  aria-hidden="true"
                >
                  {report.months.map((m) => (
                    <span key={m.key} className={cn(m.isCurrent && "font-bold text-foreground")}>
                      {m.label.split(" ")[0]}
                    </span>
                  ))}
                </div>
                <p className="flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-trust" aria-hidden="true" /> Gastado
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-trust/40" aria-hidden="true" />{" "}
                    Programado
                  </span>
                </p>
                <table className="sr-only">
                  <caption>Gasto por mes</caption>
                  <thead>
                    <tr>
                      <th>Mes</th>
                      <th>Gastado</th>
                      <th>Programado</th>
                      <th>Horas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.months.map((m) => (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        <td>{formatCOP(m.spent)}</td>
                        <td>{formatCOP(m.committed)}</td>
                        <td>{m.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

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
