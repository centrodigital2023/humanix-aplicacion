// «Mi semana» (plan Pro): una combinación de turnos compatibles que encaja en la agenda sin cruces, con margen entre
// servicios, topes de horas y un día libre protegido (lógica en `lib/proWeekPlan`). Es una sugerencia: postularse,
// negociar y contactar se hace desde Ofertas; aquí no se contacta a nadie.
import { CalendarRange, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList } from "@/components/humanix/premium/InsightList";
import { dayLabelEs, plural } from "@/lib/intelShared";
import { formatShiftRange } from "@/lib/opportunities";
import { formatCOP } from "@/lib/pricing";
import { MAX_HOURS_PER_DAY, type WeekPlan } from "@/lib/proWeekPlan";
import { cn } from "@/lib/utils";

/** «dom 18»: día de la semana y número, a partir del mediodía de ese día (así la zona horaria no lo corre). */
const shortDay = (dayMs: number) =>
  dayLabelEs(dayMs + 12 * 3_600_000)
    .split(" ")
    .slice(0, 2)
    .join(" ");

export function WeekPlanCard({
  plan,
  loading,
  error,
  onOpenOpportunities,
  className,
}: {
  plan: WeekPlan | null;
  loading: boolean;
  error: boolean;
  onOpenOpportunities: () => void;
  className?: string;
}) {
  const freeLabels = (plan?.days ?? []).filter((d) => d.isFree).map((d) => shortDay(d.dayMs));

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Mi semana">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <CalendarRange className="h-4 w-4 text-trust" aria-hidden="true" /> Mi semana
        </h3>
        <p className="text-xs text-muted-foreground">
          Turnos compatibles que encajan en tu agenda: sin cruces, con margen entre servicios y un
          día libre protegido.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !plan ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar los turnos. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <p className="rounded-2xl border border-trust/25 bg-gradient-to-br from-trust/10 via-background to-ok/10 p-4 text-base font-medium leading-snug">
            {plan.chosen.length > 0 ? (
              <>
                {plural(plan.totals.shifts, "turno", "turnos")} · {plan.totals.hours} h ·{" "}
                <strong>{formatCOP(plan.totals.earnings)}</strong>
                <span className="block text-sm font-normal text-muted-foreground">
                  Te quedarían {plural(plan.after.freeDays, "día libre", "días libres")} esta semana
                  {freeLabels.length > 0 && ` (${freeLabels.slice(0, 3).join(", ")})`}.
                </span>
              </>
            ) : (
              <>Hoy no hay turnos que encajen con tu agenda.</>
            )}
          </p>

          <section aria-label="Tu semana día por día" className="space-y-2">
            <div
              className="grid grid-cols-7 gap-1.5"
              role="img"
              aria-label={`Tu semana: ${plan.days
                .map(
                  (d) =>
                    `${d.label}, ${d.bookedHours} h confirmadas, ${d.plannedHours} h propuestas${d.isFree ? ", día libre" : ""}`,
                )
                .join("; ")}`}
            >
              {plan.days.map((d) => (
                <div
                  key={d.dayMs}
                  aria-hidden="true"
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-1.5 text-center",
                    d.isToday ? "border-trust/50" : "border-border",
                    d.isFree && "bg-ok/5",
                  )}
                >
                  <span className="text-[10px] font-semibold leading-none">
                    {shortDay(d.dayMs)}
                  </span>
                  <div className="flex h-12 w-full flex-col justify-end gap-px">
                    <div
                      className="w-full rounded-t bg-primary/70"
                      style={{
                        height: `${Math.min(100, (d.plannedHours / MAX_HOURS_PER_DAY) * 100)}%`,
                      }}
                    />
                    <div
                      className="w-full bg-muted-foreground/40"
                      style={{
                        height: `${Math.min(100, (d.bookedHours / MAX_HOURS_PER_DAY) * 100)}%`,
                      }}
                    />
                  </div>
                  {d.isFree ? (
                    <Leaf className="h-3 w-3 text-ok" />
                  ) : (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {Math.round((d.bookedHours + d.plannedHours) * 10) / 10} h
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-muted-foreground/40" aria-hidden="true" /> Ya
                confirmado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-primary/70" aria-hidden="true" /> Propuesto
              </span>
              <span className="flex items-center gap-1.5">
                <Leaf className="h-3 w-3 text-ok" aria-hidden="true" /> Día libre
              </span>
            </p>
          </section>

          {plan.chosen.length > 0 && (
            <ul className="space-y-2" aria-label="Turnos propuestos">
              {plan.chosen.map((c) => (
                <li
                  key={c.key}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">{formatShiftRange(c.startsAt, c.endsAt)}</p>
                    <p className="text-muted-foreground">
                      {c.familyName}
                      {c.city ? ` · ${c.city}` : ""} · {c.label} ({c.score})
                    </p>
                    <p className="font-medium">
                      {c.total !== null ? formatCOP(c.total) : "Tarifa por acordar"}
                      {c.rate !== null && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {formatCOP(c.rate)} por hora
                        </span>
                      )}
                    </p>
                    {c.reasons.length > 0 && (
                      <p className="text-xs text-muted-foreground">{c.reasons.join(" · ")}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full shrink-0 sm:w-auto"
                    onClick={onOpenOpportunities}
                  >
                    Ver y postularme
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {plan.skipped.length > 0 && (
            <details className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer font-semibold">
                Por qué dejamos fuera {plural(plan.skipped.length, "turno", "turnos")}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {plan.skipped.map((s) => (
                  <li key={s.key} className="text-muted-foreground">
                    <strong className="text-foreground">{s.familyName}</strong>,{" "}
                    {dayLabelEs(Date.parse(s.startsAt))} ({s.hours} h
                    {s.total !== null ? `, ${formatCOP(s.total)}` : ""}): {s.text}.
                  </li>
                ))}
              </ul>
            </details>
          )}

          <InsightList
            label="Notas de tu semana"
            items={plan.insights
              .filter((i) => i.id !== "plan_ready")
              .map((i) => ({
                id: i.id,
                tone: i.severity === "good" ? "ok" : "info",
                title: i.title,
                detail: i.detail,
              }))}
          />

          <p className="text-[11px] text-muted-foreground">
            Es una sugerencia, no la única combinación posible: tú decides a qué te postulas.
            Tomamos lo que ya tienes confirmado, dejamos al menos 60 minutos entre servicios y no
            pasamos de {MAX_HOURS_PER_DAY} h por día. Postularse, negociar el valor y contactar se
            hace desde la pestaña Ofertas.
          </p>
        </>
      )}
    </Card>
  );
}
