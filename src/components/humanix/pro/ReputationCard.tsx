// Reputación en detalle (plan Pro): promedio y distribución de estrellas, tendencia, las 4 dimensiones, consejos amables,
// lo que dicen de ti y la siguiente meta (lógica en `lib/proReputation`). Es para acompañar, no para juzgar: solo lo ve la
// propia persona y los comentarios que se muestran son positivos y sin datos de contacto.
import { Award, Quote, Star, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import {
  MIN_DIM_RATINGS,
  type ReputationReport,
  type ReputationSeverity,
} from "@/lib/proReputation";
import { dateEs } from "@/lib/intelShared";
import { cn } from "@/lib/utils";

const TONE: Record<ReputationSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** Hallazgos que la tarjeta ya muestra de otra forma (etiquetas de fortaleza, consejos y la meta). */
const HIDDEN_INSIGHTS = new Set(["strength", "improve", "goal"]);
const fmt = (n: number) => n.toFixed(1).replace(".", ",");

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-4 w-4",
            i <= Math.round(value) ? "fill-copper text-copper" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

export function ReputationCard({
  report,
  loading,
  error,
  className,
}: {
  report: ReputationReport | null;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const maxDist = report ? Math.max(1, ...Object.values(report.stars.distribution)) : 1;
  const trend = report?.stars.trend;

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Reputación en detalle">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Award className="h-4 w-4 text-copper" aria-hidden="true" /> Tu reputación en detalle
        </h3>
        <p className="text-xs text-muted-foreground">
          Lo que opinan de ti, tus fortalezas y cómo seguir creciendo. Solo tú ves esto.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus calificaciones. Inténtalo de nuevo en un momento.
        </p>
      ) : !report.hasData ? (
        <InsightList
          label="Aún sin calificaciones"
          items={report.insights.map((i) => ({
            id: i.id,
            tone: TONE[i.severity],
            title: i.title,
            detail: i.detail,
          }))}
        />
      ) : (
        <>
          {report.stars.average !== null && (
            <div className="flex flex-col gap-4 rounded-2xl border border-copper/25 bg-gradient-to-br from-copper/10 via-background to-trust/10 p-4 sm:flex-row sm:items-center">
              <div className="text-center sm:text-left">
                <p className="font-display text-4xl font-bold tabular-nums">
                  {fmt(report.stars.average)}
                  <span className="text-lg text-muted-foreground"> / 5</span>
                </p>
                <Stars value={report.stars.average} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.stars.count}{" "}
                  {report.stars.count === 1 ? "calificación" : "calificaciones"}
                </p>
                {trend && trend.direction !== "unknown" && trend.delta !== null && (
                  <p
                    className={cn(
                      "mt-1 inline-flex items-center gap-1 text-xs font-semibold",
                      trend.direction === "up"
                        ? "text-ok"
                        : trend.direction === "down"
                          ? "text-muted-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {trend.direction === "up" ? (
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : trend.direction === "down" ? (
                      <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : null}
                    {trend.direction === "up"
                      ? `Subiendo (+${fmt(Math.abs(trend.delta))})`
                      : trend.direction === "down"
                        ? `Un poco más baja (−${fmt(Math.abs(trend.delta))})`
                        : "Estable"}
                  </p>
                )}
              </div>
              <ul className="min-w-0 flex-1 space-y-1" aria-label="Calificaciones por estrellas">
                {([5, 4, 3, 2, 1] as const).map((n) => (
                  <li key={n} className="flex items-center gap-2 text-xs">
                    <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{n} ★</span>
                    <span
                      className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-copper"
                        style={{ width: `${(report.stars.distribution[n] / maxDist) * 100}%` }}
                      />
                    </span>
                    <span className="w-6 shrink-0 text-right tabular-nums">
                      {report.stars.distribution[n]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section aria-label="Calificación por dimensión" className="space-y-2">
            <h4 className="text-sm font-semibold">Cómo te ven en cada aspecto</h4>
            <ul className="space-y-2">
              {report.dimensions.map((d) => (
                <li key={d.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span
                      className={cn(
                        d.key === report.strongest?.key && "font-semibold",
                        d.key === report.weakest?.key && "font-semibold",
                      )}
                    >
                      {d.label}
                      {d.key === report.strongest?.key && report.strongest !== report.weakest && (
                        <span className="ml-2 rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">
                          Tu fortaleza
                        </span>
                      )}
                      {d.key === report.weakest?.key && (
                        <span className="ml-2 rounded-full bg-trust/15 px-1.5 py-0.5 text-[10px] font-semibold text-trust">
                          Para crecer
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.average === null
                        ? `faltan ${MIN_DIM_RATINGS - d.count} calificaciones`
                        : `${fmt(d.average)} · ${d.count}`}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={
                      d.average === null
                        ? `${d.label}: sin promedio todavía`
                        : `${d.label}: ${fmt(d.average)} de 5`
                    }
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        d.average !== null && d.average >= 4.5 ? "bg-ok" : "bg-trust",
                      )}
                      style={{ width: `${d.average === null ? 0 : (d.average / 5) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {report.tips.length > 0 && (
            <section aria-label="Consejos" className="space-y-2">
              <h4 className="text-sm font-semibold">Un empujón para crecer</h4>
              <ul className="space-y-2">
                {report.tips.map((t) => (
                  <li
                    key={t.key}
                    className="rounded-xl border border-trust/25 bg-trust/5 p-3 text-sm"
                  >
                    <p className="font-semibold">
                      {t.label} · {fmt(t.average)}
                    </p>
                    <p className="text-muted-foreground">{t.tip}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.praise.length > 0 && (
            <section aria-label="Lo que dicen de ti" className="space-y-2">
              <h4 className="text-sm font-semibold">Lo que dicen de ti</h4>
              <ul className="space-y-2">
                {report.praise.map((p, i) => (
                  <li
                    key={`${p.createdAt ?? "x"}-${i}`}
                    className="flex gap-3 rounded-xl border border-copper/25 bg-copper/5 p-3 text-sm"
                  >
                    <Quote className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
                    <div className="min-w-0">
                      <p>«{p.text}»</p>
                      <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Stars value={p.stars} />
                        <span className="sr-only">{p.stars} estrellas</span>
                        {p.createdAt && Number.isFinite(Date.parse(p.createdAt)) && (
                          <span>{dateEs(Date.parse(p.createdAt))}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.nextGoal && (
            <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <Award className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
              <span>
                <strong>Próxima meta: {fmt(report.nextGoal.target)}.</strong> {report.nextGoal.text}
              </span>
            </p>
          )}

          {report.levers.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground" aria-label="Para destacar más">
              {report.levers.map((l) => (
                <li key={l} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-copper"
                  />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}

          <InsightList
            label="Hallazgos de tu reputación"
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
            Aquí solo se muestran comentarios positivos y sin datos de contacto. Las dimensiones
            aparecen desde {MIN_DIM_RATINGS} calificaciones para que un solo caso no defina tu
            promedio.
          </p>
        </>
      )}
    </Card>
  );
}
