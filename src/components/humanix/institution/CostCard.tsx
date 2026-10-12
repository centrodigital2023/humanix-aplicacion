// Costos de la institución: lo que lleva en el mes, lo acordado, la proyección (un rango), el costo por hora frente al
// mercado y en qué se va el dinero (lógica en `lib/instCost`). Informa; no mueve dinero: los pagos se hacen solo en la
// página web de Humanix, y no es asesoría contable.
import { Layers, TrendingUp, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { MonthBars } from "@/components/humanix/premium/MonthBars";
import { StatTile } from "@/components/humanix/premium/StatTile";
import {
  MIN_SERVICES_FOR_RATE,
  costHeadline,
  type CostDriver,
  type CostReport,
  type CostSeverity,
} from "@/lib/instCost";
import { hoursEs, plural } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const TONE: Record<CostSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** La proyección ya se muestra en cifras: repetirla como hallazgo sobra. */
const HIDDEN_INSIGHTS = new Set(["projection"]);

const POSITION_HINT = {
  below: "por debajo del rango de tu ciudad",
  within: "dentro del rango de tu ciudad",
  above: "por encima del rango de tu ciudad",
  unknown: "",
} as const;

/** Renglones con su parte del gasto: una barra y las palabras (la barra sola no dice nada a un lector de pantalla). */
function DriverList({
  title,
  items,
  otherSpent = 0,
}: {
  title: string;
  items: CostDriver[];
  otherSpent?: number;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{d.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatCOP(d.spent)} <span className="text-muted-foreground">· {d.share} %</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-trust" style={{ width: `${d.share}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {plural(d.services, "servicio", "servicios")} · {hoursEs(d.hours)} h
            </p>
          </li>
        ))}
      </ul>
      {otherSpent > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Y {formatCOP(otherSpent)} repartidos en otras ofertas.
        </p>
      )}
    </section>
  );
}

export function CostCard({
  report,
  loading,
  error,
  className,
}: {
  report: CostReport | null;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const range = report
    ? report.current.projectedHigh > report.current.projectedLow
      ? `${formatCOP(report.current.projectedLow)} – ${formatCOP(report.current.projectedHigh)}`
      : formatCOP(report.current.projectedLow)
    : "";
  const specialties = report ? report.specialties.filter((s) => s.key !== "none") : [];

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Costos de la institución">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Wallet className="h-4 w-4 text-trust" aria-hidden="true" /> Costos de tu institución
        </h3>
        <p className="text-xs text-muted-foreground">
          Cuánto llevas, cuánto tienes acordado, cuánto proyectamos y cómo se compara tu costo por
          hora.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus servicios. Inténtalo de nuevo en un momento.
        </p>
      ) : !report.hasData ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {costHeadline(report)} Cuando tengas un servicio acordado o terminado, aquí verás tus
          costos.
        </p>
      ) : (
        <>
          <p className="flex items-start gap-3 rounded-2xl border border-trust/25 bg-gradient-to-br from-trust/10 via-background to-ok/10 p-4 text-base font-medium leading-snug">
            <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-trust" aria-hidden="true" />
            <span>{costHeadline(report)}</span>
          </p>

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <StatTile
              label={`Llevas en ${report.current.label}`}
              value={formatCOP(report.current.settledToDate)}
              hint="en servicios terminados"
            />
            <StatTile
              label="Acordado por hacer"
              value={formatCOP(report.current.committed)}
              hint="servicios confirmados que aún no terminan"
            />
            <StatTile
              label="Proyección del mes"
              value={range}
              hint={
                report.current.projectedHigh > report.current.projectedLow
                  ? `el tope mantiene el ritmo de 4 semanas (${formatCOP(report.current.weeklyPace ?? 0)} por semana)`
                  : `faltan ${report.current.daysLeft} días del mes`
              }
            />
          </dl>

          {report.vsLastMonth.deltaPct !== null && (
            <p className="text-sm">
              Frente al mes pasado a esta altura:{" "}
              <strong>
                {report.vsLastMonth.deltaPct > 0 ? "+" : ""}
                {report.vsLastMonth.deltaPct} %
              </strong>{" "}
              ({formatCOP(report.vsLastMonth.settledToDate)} contra{" "}
              {formatCOP(report.vsLastMonth.lastMonthSameSpan)}).
            </p>
          )}

          <MonthBars
            months={report.months}
            title="Gasto por mes"
            settledLabel="Gastado"
            committedLabel="Acordado"
            emptyText="Aún no hay servicios en estos meses."
            colorClass="trust"
          />

          <section aria-label="Costo por hora del periodo" className="space-y-2">
            <h4 className="text-sm font-semibold">{report.period.label}</h4>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                label="Invertido"
                value={formatCOP(report.spent)}
                hint={`${plural(report.services, "servicio", "servicios")} · ${hoursEs(report.hours)} h`}
              />
              <StatTile
                label="Costo por hora"
                value={report.avgPerHour !== null ? formatCOP(report.avgPerHour) : "—"}
                hint={
                  report.avgPerHour === null
                    ? `se necesitan al menos ${MIN_SERVICES_FOR_RATE} servicios terminados`
                    : POSITION_HINT[report.rate.position] || "promedio ponderado por horas"
                }
              />
              <StatTile
                label="Mediana de tu ciudad"
                value={report.rate.marketMedian ? formatCOP(report.rate.marketMedian) : "—"}
                hint={
                  report.rate.diffPct !== null
                    ? `${report.rate.diffPct > 0 ? "+" : ""}${report.rate.diffPct} % tu costo frente a ella`
                    : "sin suficientes tarifas comparables"
                }
              />
              <StatTile
                label="Periodo anterior"
                value={formatCOP(report.previous.spent)}
                hint={
                  report.previous.perHourDeltaPct !== null
                    ? `costo por hora ${report.previous.perHourDeltaPct > 0 ? "+" : ""}${report.previous.perHourDeltaPct} %`
                    : plural(report.previous.services, "servicio", "servicios")
                }
              />
            </dl>
          </section>

          <DriverList
            title="En qué se va el dinero"
            items={report.drivers}
            otherSpent={report.otherSpent}
          />
          {specialties.length > 0 && <DriverList title="Por especialidad" items={specialties} />}

          <InsightList
            label="Hallazgos de tus costos"
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

          <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <Layers className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              La proyección es un rango, no una promesa. La mediana del mercado no distingue
              especialidades: úsala como referencia. No es asesoría contable. Los pagos se hacen
              únicamente en la página web de Humanix.
            </span>
          </p>
        </>
      )}
    </Card>
  );
}
