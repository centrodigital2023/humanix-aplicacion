// «Cuida a quien cuida» (plan Esencial): carga de trabajo, días seguidos, noches y descansos del profesional, con un día
// libre sugerido (lógica en `lib/proWorkload`). Es orientación de bienestar: no es asesoría laboral ni médica y solo lo ve
// la propia persona.
import { BedDouble, HeartHandshake, Leaf, Sprout } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { StatTile } from "@/components/humanix/premium/StatTile";
import {
  REFERENCE_WEEKLY_HOURS,
  type WorkloadLevel,
  type WorkloadReport,
  type WorkloadSeverity,
} from "@/lib/proWorkload";
import { cn } from "@/lib/utils";

const TONE: Record<WorkloadSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** El «buen equilibrio» ya lo dicen el encabezado y las cifras de la tarjeta. */
const HIDDEN_INSIGHTS = new Set(["balanced"]);

const LEVEL = {
  ok: {
    box: "border-ok/30 bg-gradient-to-br from-ok/10 via-background to-trust/10",
    icon: "text-ok",
    Icon: Sprout,
    label: "Buen equilibrio",
    text: "Tu carga es razonable. Sigue cuidando de ti como cuidas de los demás.",
  },
  watch: {
    box: "border-warn/30 bg-gradient-to-br from-warn/10 via-background to-trust/10",
    icon: "text-warn",
    Icon: Leaf,
    label: "Atención a tu descanso",
    text: "Tu semana viene exigente: un descanso a tiempo te ayuda a seguir cuidando bien.",
  },
  high: {
    box: "border-sos/30 bg-gradient-to-br from-sos/10 via-background to-warn/10",
    icon: "text-sos",
    Icon: BedDouble,
    label: "Es hora de descansar",
    text: "Llevas mucha carga. Descansar no es abandonar: es poder volver con energía.",
  },
} as const satisfies Record<WorkloadLevel, unknown>;

export function WorkloadCard({
  report,
  loading,
  error,
  className,
}: {
  report: WorkloadReport | null;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const max = report ? Math.max(REFERENCE_WEEKLY_HOURS, ...report.weeks.map((w) => w.hours)) : 0;
  const lvl = report ? LEVEL[report.level] : null;

  return (
    <Card
      className={cn("space-y-4 p-4 sm:p-5", className)}
      aria-label="Carga de trabajo y descanso"
    >
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <HeartHandshake className="h-4 w-4 text-copper" aria-hidden="true" /> Cuida a quien cuida
        </h3>
        <p className="text-xs text-muted-foreground">
          Tu carga de trabajo y tus descansos. Solo tú ves esto.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : error || !report || !lvl ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No pudimos cargar tus servicios. Inténtalo de nuevo en un momento.
        </p>
      ) : (
        <>
          <div className={cn("flex items-start gap-3 rounded-2xl border p-4", lvl.box)}>
            <lvl.Icon className={cn("mt-0.5 h-6 w-6 shrink-0", lvl.icon)} aria-hidden="true" />
            <div>
              <p className="font-display text-base font-bold">{lvl.label}</p>
              <p className="text-sm text-muted-foreground">{lvl.text}</p>
            </div>
          </div>

          {report.hasData && (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  label="Últimos 7 días"
                  value={`${report.last7Hours} h`}
                  hint="trabajadas"
                />
                <StatTile
                  label="Próximos 7 días"
                  value={`${report.next7Hours} h`}
                  hint="programadas"
                />
                <StatTile
                  label="Días seguidos"
                  value={report.run.length}
                  hint={report.run.length === 0 ? "hoy descansas" : "con servicios, contando hoy"}
                />
                <StatTile
                  label="Descansaste"
                  value={`${report.restDays14} de 14`}
                  hint="días sin servicios"
                />
              </dl>

              <section aria-label="Horas por semana" className="space-y-2">
                <h4 className="text-sm font-semibold">Horas por semana</h4>
                <div
                  className="relative grid h-24 grid-cols-5 items-end gap-2"
                  role="img"
                  aria-label={`Horas por semana: ${report.weeks
                    .map((w) => `semana del ${w.label}, ${w.hours} h en ${w.services} servicios`)
                    .join("; ")}. Referencia: ${REFERENCE_WEEKLY_HOURS} h`}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
                    style={{ bottom: `${(REFERENCE_WEEKLY_HOURS / max) * 100}%` }}
                  />
                  {report.weeks.map((w) => (
                    <div
                      key={w.startMs}
                      className="flex h-full flex-col justify-end"
                      aria-hidden="true"
                    >
                      <div
                        className={cn(
                          "w-full rounded-t",
                          w.hours > REFERENCE_WEEKLY_HOURS ? "bg-warn" : "bg-trust",
                          w.isCurrent && "opacity-70",
                        )}
                        style={{ height: `${(w.hours / max) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div
                  className="grid grid-cols-5 gap-2 text-center text-[10px] text-muted-foreground"
                  aria-hidden="true"
                >
                  {report.weeks.map((w) => (
                    <span
                      key={w.startMs}
                      className={cn(w.isCurrent && "font-bold text-foreground")}
                    >
                      {w.isCurrent ? "Esta semana" : w.label}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  La línea punteada marca {REFERENCE_WEEKLY_HOURS} h, la jornada semanal máxima de
                  un empleado en Colombia: es una referencia, no una norma para ti como
                  independiente.
                </p>
              </section>
            </>
          )}

          <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <Leaf className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
            {report.nextRestDay ? (
              report.nextRestDay.isToday ? (
                <span>
                  <strong>Hoy no tienes servicios.</strong> Es un buen día para descansar.
                </span>
              ) : (
                <span>
                  Tu próximo día libre es el <strong>{report.nextRestDay.label}</strong>.
                </span>
              )
            ) : (
              <span>
                No tienes un día libre en los próximos 7 días: si puedes, deja uno sin turnos.
              </span>
            )}
          </p>

          <InsightList
            label="Hallazgos de tu carga"
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
            Es orientación de bienestar, no asesoría laboral ni médica. Nada de esto lo ven las
            familias ni las instituciones y no cambia tus servicios.
          </p>
        </>
      )}
    </Card>
  );
}
