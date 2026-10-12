/**
 * EPSDashboard — resumen operativo del portal EPS/IPS con datos reales de la institución.
 *
 * Antes mostraba tendencias al azar, una «facturación» de servicios × $85.000 y cifras fijas (cumplimiento, reingresos,
 * «+12 %»), y leía las alertas y los puntajes de toda la plataforma. Ahora todo sale de los servicios de la propia
 * institución y de las alertas y puntajes de riesgo ligados a esos servicios (lógica en `lib/epsMetrics`). Lo que no se
 * pudo cargar se dice; nunca se muestra como cero. Informa: no mueve dinero ni contacta a nadie.
 */
import { useMemo, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarSeries } from "@/components/humanix/premium/BarSeries";
import { StatTile } from "@/components/humanix/premium/StatTile";
import { useEpsClinical } from "@/hooks/use-eps-intel";
import { useInstBookings } from "@/hooks/use-inst-intel";
import { useNow } from "@/hooks/use-now";
import {
  EPS_LEVELS,
  EPS_LEVEL_LABEL,
  MIN_SERVICES_FOR_DURATION,
  buildEpsMetrics,
  type EpsLevel,
} from "@/lib/epsMetrics";
import { buildCostReport } from "@/lib/instCost";
import { hoursEs, plural, resolvePeriod, type PeriodKey } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface Props {
  /** La institución (su usuario): todo lo que se muestra es de sus servicios. */
  institutionId: string;
  title?: string;
}

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
  { key: "last_month", label: "Mes pasado" },
];

const LEVEL_BAR: Record<EpsLevel, string> = {
  critical: "bg-sos",
  high: "bg-warn",
  medium: "bg-warn/50",
  low: "bg-ok",
};

/** Cómo se lee el promedio de riesgo (los mismos cortes de siempre del portal). */
function riskReading(avg: number): { text: string; tone: "ok" | "warn" | "sos" } {
  if (avg < 25) return { text: "población estable", tone: "ok" };
  if (avg < 50) return { text: "monitoreo moderado", tone: "warn" };
  return { text: "alto seguimiento", tone: "sos" };
}

export function EPSDashboard({ institutionId, title = "Resumen de tu institución" }: Props) {
  const now = useNow();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [refreshing, setRefreshing] = useState(false);
  const period = useMemo(() => resolvePeriod(periodKey, now), [periodKey, now]);

  const bookingsQ = useInstBookings(institutionId);
  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);
  const clinical = useEpsClinical(institutionId, bookingsQ.data, now);

  const metrics = useMemo(
    () =>
      buildEpsMetrics({ bookings, alerts: clinical.alerts, risks: clinical.risks, period, now }),
    [bookings, clinical.alerts, clinical.risks, period, now],
  );
  const cost = useMemo(
    () => buildCostReport({ bookings, offers: {}, market: null, period, now }),
    [bookings, period, now],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([bookingsQ.refetch(), clinical.refresh()]);
    } finally {
      setRefreshing(false);
    }
  };

  const updatedAt = Math.max(bookingsQ.dataUpdatedAt, clinical.updatedAt);
  const { alerts, risk } = metrics;
  const perBucket = metrics.bucketDays === 7 ? "semana" : "día";
  const reading = risk && risk.avg !== null ? riskReading(risk.avg) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-trust/10">
            <Building2 className="h-4 w-4 text-trust" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
            {updatedAt > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Actualizado {formatDistanceToNow(updatedAt, { locale: es, addSuffix: true })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Periodo del resumen" className="flex gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant={p.key === periodKey ? "default" : "outline"}
                aria-pressed={p.key === periodKey}
                className="h-7 px-2.5 text-xs"
                onClick={() => setPeriodKey(p.key)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="h-7 gap-1 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} aria-hidden="true" />
            Actualizar
          </Button>
        </div>
      </div>

      {bookingsQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : bookingsQ.isError ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          No pudimos cargar los servicios de tu institución. Inténtalo de nuevo en un momento.
        </Card>
      ) : !metrics.hasData ? (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Aún no hay servicios de tu institución en Humanix. Cuando publiques turnos y los
          profesionales los acepten, aquí verás cómo van, sus alertas y el riesgo clínico.
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {period.label}: {plural(cost.services, "servicio terminado", "servicios terminados")}.
          </p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Servicios en curso"
              value={metrics.services.active}
              hint="ahora mismo"
            />
            <StatTile
              label="Servicios terminados"
              value={metrics.services.completed}
              hint={`${plural(metrics.services.cancelled, "cancelado", "cancelados")} en el periodo`}
            />
            <StatTile
              label="Alertas sin atender"
              value={alerts ? alerts.active : "—"}
              hint={
                alerts
                  ? alerts.activeCritical > 0
                    ? plural(alerts.activeCritical, "crítica", "críticas")
                    : "ninguna crítica"
                  : clinical.alertsFailed
                    ? "no se pudieron cargar"
                    : "cargando"
              }
              tone={
                alerts && alerts.activeCritical > 0
                  ? "sos"
                  : alerts && alerts.active > 0
                    ? "warn"
                    : undefined
              }
            />
            <StatTile
              label="Inversión del periodo"
              value={formatCOP(cost.spent)}
              hint={`${plural(cost.services, "servicio", "servicios")} · ${hoursEs(cost.hours)} h`}
            />
          </dl>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Riesgo clínico promedio"
              value={risk && risk.avg !== null ? `${risk.avg}/100` : "—"}
              hint={
                reading
                  ? reading.text
                  : risk
                    ? "sin puntajes de riesgo todavía"
                    : clinical.risksFailed
                      ? "no se pudieron cargar"
                      : "cargando"
              }
              tone={reading?.tone}
            />
            <StatTile
              label="Pacientes con puntaje"
              value={risk ? risk.patients : "—"}
              hint={
                risk
                  ? `${plural(risk.levels.critical, "crítico", "críticos")} · ${plural(risk.levels.high, "alto", "altos")}`
                  : "último puntaje de cada uno"
              }
            />
            <StatTile
              label="Duración promedio"
              value={metrics.avgHours !== null ? `${hoursEs(metrics.avgHours)} h` : "—"}
              hint={
                metrics.avgHours !== null
                  ? "por servicio terminado"
                  : `se necesitan al menos ${MIN_SERVICES_FOR_DURATION} servicios con horas registradas`
              }
            />
            <StatTile
              label="Alertas del periodo"
              value={alerts ? alerts.inPeriod : "—"}
              hint={
                alerts
                  ? `${plural(alerts.bySeverity.critical, "crítica", "críticas")} · ${plural(alerts.bySeverity.high, "alta", "altas")}`
                  : "no disponibles"
              }
            />
          </dl>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <BarSeries
                title={`Servicios terminados por ${perBucket}`}
                points={metrics.points.map((p) => ({
                  key: p.dayMs,
                  label: p.label,
                  value: p.services,
                }))}
                unit={["servicio", "servicios"]}
                emptyText="Aún no hay servicios terminados en este periodo."
                colorClass="trust"
                firstColumn={metrics.bucketDays === 7 ? "Semana desde" : "Día"}
              />
            </Card>
            <Card className="p-4">
              <BarSeries
                title={`Alertas por ${perBucket}`}
                points={metrics.points.map((p) => ({
                  key: p.dayMs,
                  label: p.label,
                  value: p.alerts,
                }))}
                unit={["alerta", "alertas"]}
                emptyText={
                  alerts ? "No hubo alertas en este periodo." : "Las alertas no se pudieron cargar."
                }
                colorClass="sos"
                firstColumn={metrics.bucketDays === 7 ? "Semana desde" : "Día"}
              />
            </Card>
          </div>

          <Card className="space-y-3 p-4">
            <h4 className="text-sm font-semibold">Distribución de riesgo clínico</h4>
            {!risk || risk.patients === 0 ? (
              <p className="text-sm text-muted-foreground">
                {risk
                  ? "Aún no hay puntajes de riesgo ligados a tus servicios."
                  : "Los puntajes de riesgo no se pudieron cargar."}
              </p>
            ) : (
              <>
                <div
                  className="flex h-3 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`Distribución de riesgo de ${plural(risk.patients, "paciente", "pacientes")}: ${EPS_LEVELS.map(
                    (l) => `${risk.levels[l]} ${EPS_LEVEL_LABEL[l].toLowerCase()}`,
                  ).join(", ")}`}
                >
                  {EPS_LEVELS.map((l) =>
                    risk.levels[l] > 0 ? (
                      <div
                        key={l}
                        className={LEVEL_BAR[l]}
                        style={{ width: `${(risk.levels[l] / risk.patients) * 100}%` }}
                      />
                    ) : null,
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  {EPS_LEVELS.map((l) => (
                    <li key={l} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn("h-2.5 w-2.5 rounded-full", LEVEL_BAR[l])}
                          aria-hidden="true"
                        />
                        {EPS_LEVEL_LABEL[l]}
                      </span>
                      <span className="font-bold tabular-nums">{risk.levels[l]}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Son los servicios que tu institución contrató en Humanix y las alertas y los puntajes de
            riesgo ligados a ellos (servicios de los últimos 120 días
            {clinical.truncated ? "; se muestran los 300 más recientes" : ""}). La inversión es lo
            que pagaste por los servicios terminados. Los pagos se hacen únicamente en la página web
            de Humanix.
          </p>
        </>
      )}
    </div>
  );
}
