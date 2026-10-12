// Pronóstico de cobertura: los próximos 14 días día por día, cuántos cupos van cubiertos, dónde está el riesgo y qué
// horarios suelen quedar sin cubrir (lógica en `lib/instForecast`). Informa; no publica ni contacta a nadie: para
// actuar se usa el centro de cobertura de Inicio.
import { CalendarRange, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { StatTile } from "@/components/humanix/premium/StatTile";
import {
  HISTORY_DAYS,
  forecastHeadline,
  type DayRisk,
  type ForecastDay,
  type ForecastReport,
  type ForecastSeverity,
} from "@/lib/instForecast";
import { RISK_LABEL } from "@/lib/institutionCoverage";
import { hoursEs, plural } from "@/lib/intelShared";
import { cn } from "@/lib/utils";

const TONE: Record<ForecastSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** El riesgo se dice con palabras (en la leyenda y en cada día), no solo con color. */
const RISK: Record<DayRisk, { word: string; cell: string; chip: string }> = {
  none: {
    word: "Sin turnos",
    cell: "border-dashed border-border bg-muted/20 text-muted-foreground",
    chip: "border-border bg-muted/40 text-muted-foreground",
  },
  covered: {
    word: RISK_LABEL.covered,
    cell: "border-ok/50 bg-ok/20 text-foreground",
    chip: "border-ok/40 bg-ok/10 text-ok",
  },
  ok: {
    word: RISK_LABEL.ok,
    cell: "border-ok/30 bg-ok/10 text-foreground",
    chip: "border-ok/30 bg-ok/5 text-ok",
  },
  watch: {
    word: RISK_LABEL.watch,
    cell: "border-warn/40 bg-warn/10 text-foreground",
    chip: "border-warn/40 bg-warn/10 text-warn",
  },
  high: {
    word: RISK_LABEL.high,
    cell: "border-warn bg-warn/25 text-foreground",
    chip: "border-warn bg-warn/20 text-warn",
  },
  critical: {
    word: RISK_LABEL.critical,
    cell: "border-sos bg-sos/25 text-foreground",
    chip: "border-sos/60 bg-sos/15 text-sos",
  },
};

const LEGEND: DayRisk[] = ["covered", "ok", "watch", "high", "critical", "none"];

/** «mié 14 oct» → «mié» y «14». */
const weekdayOf = (label: string) => label.split(" ")[0] ?? label;
const dayNumber = (label: string) => label.split(" ")[1] ?? label;

function DayStrip({ days }: { days: ForecastDay[] }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
        {days.map((d) => (
          <div
            key={d.dayMs}
            className={cn(
              "flex h-12 flex-col items-center justify-center gap-0.5 rounded-md border text-xs font-semibold leading-none",
              RISK[d.risk].cell,
              d.isToday && "ring-2 ring-foreground/60 ring-offset-1 ring-offset-background",
            )}
          >
            <span className="text-[9px] font-normal capitalize">{weekdayOf(d.label)}</span>
            <span>{dayNumber(d.label)}</span>
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {LEGEND.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              className={cn("h-2.5 w-2.5 rounded-sm border", RISK[k].cell)}
              aria-hidden="true"
            />
            {RISK[k].word}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ForecastCard({
  report,
  loading,
  error,
  onOpenCoverage,
  className,
}: {
  report: ForecastReport | null;
  loading: boolean;
  error: boolean;
  /** Lleva al centro de cobertura de Inicio, donde se invita al equipo, se sube el valor o se marca urgente. */
  onOpenCoverage?: () => void;
  className?: string;
}) {
  const withShifts = report ? report.days.filter((d) => d.shifts > 0) : [];
  const empty = report ? report.days.length - withShifts.length : 0;

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Pronóstico de cobertura">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <CalendarRange className="h-4 w-4 text-trust" aria-hidden="true" /> Pronóstico de
          cobertura
        </h3>
        <p className="text-xs text-muted-foreground">
          Qué días de las próximas dos semanas van cubiertos, dónde está el riesgo y qué horarios
          suelen quedar vacíos.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus turnos. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <p className="flex items-start gap-3 rounded-2xl border border-trust/25 bg-gradient-to-br from-trust/10 via-background to-ok/10 p-4 text-base font-medium leading-snug">
            <CalendarRange className="mt-0.5 h-5 w-5 shrink-0 text-trust" aria-hidden="true" />
            <span>{forecastHeadline(report)}</span>
          </p>

          {report.hasData && (
            <>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <StatTile
                  label="Cupos cubiertos"
                  value={
                    report.totals.coveragePct === null ? "—" : `${report.totals.coveragePct} %`
                  }
                  hint={`${report.totals.filled} de ${plural(report.totals.positions, "cupo", "cupos")} en ${plural(report.totals.shifts, "turno", "turnos")}`}
                />
                <StatTile
                  label="Horas por cubrir"
                  value={`${hoursEs(report.totals.openHours)} h`}
                  hint={`${plural(report.totals.open, "cupo libre", "cupos libres")}`}
                  tone={report.totals.openHours > 0 ? "warn" : "ok"}
                />
                <StatTile
                  label="En las próximas 48 h"
                  value={`${hoursEs(report.next48.openHours)} h`}
                  hint={
                    report.next48.shifts > 0
                      ? plural(report.next48.shifts, "turno sin cubrir", "turnos sin cubrir")
                      : "nada urgente sin cubrir"
                  }
                  tone={report.next48.openHours > 0 ? "sos" : "ok"}
                />
              </dl>

              <DayStrip days={report.days} />

              <section aria-label="Días con turnos" className="space-y-2">
                <h4 className="text-sm font-semibold">Día por día</h4>
                <ul className="space-y-1.5">
                  {withShifts.map((d) => (
                    <li
                      key={d.dayMs}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-medium">
                        {d.label}
                        {d.isToday ? " · hoy" : ""}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {d.filled} de {plural(d.positions, "cupo", "cupos")}
                          {d.openHours > 0 ? ` · ${hoursEs(d.openHours)} h por cubrir` : ""}
                        </span>
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                            RISK[d.risk].chip,
                          )}
                        >
                          {RISK[d.risk].word}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {empty > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {plural(empty, "día sin turnos publicados", "días sin turnos publicados")}.
                  </p>
                )}
              </section>

              <section aria-label="Cobertura por semana" className="space-y-2">
                <h4 className="text-sm font-semibold">Por semana</h4>
                <ul className="space-y-2">
                  {report.weeks.map((w) => (
                    <li key={w.label} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{w.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {w.coveragePct === null
                            ? "sin turnos"
                            : `${w.coveragePct} % cubierto${w.openHours > 0 ? ` · ${hoursEs(w.openHours)} h por cubrir` : ""}`}
                        </span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${w.label}: ${w.coveragePct === null ? "sin turnos" : `${w.coveragePct} % cubierto`}`}
                      >
                        {w.coveragePct !== null && (
                          <div
                            className={cn(
                              "h-full rounded-full",
                              w.coveragePct >= 90
                                ? "bg-ok"
                                : w.coveragePct >= 60
                                  ? "bg-warn"
                                  : "bg-sos",
                            )}
                            style={{ width: `${w.coveragePct}%` }}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {report.pattern && (
            <p className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span>
                <strong>
                  {report.pattern.label.charAt(0).toUpperCase()}
                  {report.pattern.label.slice(1)}
                </strong>{" "}
                suelen quedar sin cubrir: {report.pattern.gapShifts} de {report.pattern.totalShifts}{" "}
                turnos de ese horario, en {report.pattern.weeks} semanas distintas.
              </span>
            </p>
          )}

          <InsightList
            label="Hallazgos de cobertura"
            items={report.insights.map((i) => ({
              id: i.id,
              tone: TONE[i.severity],
              title: i.title,
              detail: i.detail,
              action: i.action,
            }))}
          />

          {onOpenCoverage && report.totals.open > 0 && (
            <Button type="button" size="sm" variant="hero" onClick={onOpenCoverage}>
              Abrir el centro de cobertura
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Mira los turnos publicados que siguen abiertos o cubiertos; el historial de las últimas{" "}
            {Math.round(HISTORY_DAYS / 7)} semanas solo incluye esos turnos, así que un horario
            repetido sin cubrir es una pista, no una certeza. Humanix no publica ni contacta a nadie
            por ti.
          </p>
        </>
      )}
    </Card>
  );
}
