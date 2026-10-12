// Tu equipo: quién cumple, de quién depende la institución y a quién sumar (lógica en `lib/instTeam`), y cómo la ven los
// profesionales (lógica en `lib/instEmployer`). Es una guía para decidir con evidencia, no un ranking de personas: cada
// etiqueta sale de reglas visibles, nunca se juzga con pocos datos y no contacta ni cambia el equipo.
import { Link } from "@tanstack/react-router";
import { BadgeCheck, HeartHandshake, Star, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightList, type InsightTone } from "@/components/humanix/premium/InsightList";
import { StatTile } from "@/components/humanix/premium/StatTile";
import type { EmployerReport } from "@/lib/instEmployer";
import {
  RELIABILITY_LABEL,
  type ConcentrationRisk,
  type Reliability,
  type TeamMember,
  type TeamReport,
  type TeamSeverity,
} from "@/lib/instTeam";
import { dateEs, hoursEs, msOf, plural } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const TONE: Record<TeamSeverity, InsightTone> = { warn: "warn", info: "info", good: "ok" };

/** Los miembros que se listan; el resto se resume en una frase. */
const MEMBERS_SHOWN = 6;

const RELIABILITY_STYLE: Record<Reliability, string> = {
  excellent: "border-ok/40 bg-ok/10 text-ok",
  solid: "border-ok/30 bg-ok/5 text-ok",
  watch: "border-warn/40 bg-warn/10 text-warn",
  review: "border-sos/40 bg-sos/10 text-sos",
  new: "border-border bg-muted/40 text-muted-foreground",
};

const CONCENTRATION: Record<Exclude<ConcentrationRisk, "none">, { word: string; bar: string }> = {
  healthy: { word: "El cuidado está bien repartido", bar: "bg-ok" },
  moderate: { word: "Una persona concentra buena parte de las horas", bar: "bg-warn" },
  high: { word: "Dependes mucho de una sola persona", bar: "bg-sos" },
  single: { word: "Todo el cuidado depende de una sola persona", bar: "bg-sos" },
};

function MemberRow({ m }: { m: TeamMember }) {
  return (
    <li className="space-y-1.5 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="truncate">{m.name ?? "Profesional"}</span>
          {m.inTeam && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-copper/10 px-2 py-0.5 text-[10px] font-semibold text-copper">
              <HeartHandshake className="h-3 w-3" aria-hidden="true" /> De tu equipo
            </span>
          )}
        </p>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            RELIABILITY_STYLE[m.reliability],
          )}
        >
          {RELIABILITY_LABEL[m.reliability]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {plural(m.services, "servicio", "servicios")} · {hoursEs(m.hours)} h · {formatCOP(m.spend)}
        {m.onTimePct !== null
          ? ` · ${m.onTimePct} % puntual (${plural(m.arrivals, "llegada", "llegadas")})`
          : m.arrivals > 0
            ? " · aún pocas llegadas para medir puntualidad"
            : ""}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {m.rethusVerified === true ? (
          <span className="inline-flex items-center gap-1 text-ok">
            <BadgeCheck className="h-3 w-3" aria-hidden="true" /> RETHUS verificado
          </span>
        ) : m.rethusVerified === false ? (
          <span>RETHUS sin verificar</span>
        ) : (
          <span>RETHUS: sin dato</span>
        )}
        {m.cancelledByProfessional > 0 && (
          <span>
            {plural(m.cancelledByProfessional, "cancelación suya", "cancelaciones suyas")}
          </span>
        )}
        {m.unstarted > 0 && <span>{plural(m.unstarted, "sin iniciar", "sin iniciar")}</span>}
      </p>
    </li>
  );
}

/** Cómo ven los profesionales a la institución: solo agregados, nunca los comentarios (son privados). */
function EmployerBlock({ employer }: { employer: EmployerReport }) {
  const rep = employer.reputation;
  return (
    <section
      aria-label="Cómo te ven los profesionales"
      className="space-y-3 rounded-2xl border border-copper/25 bg-gradient-to-br from-copper/10 via-background to-trust/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Star className="mt-0.5 h-5 w-5 shrink-0 text-copper" aria-hidden="true" />
        <div>
          <h4 className="text-sm font-semibold">Cómo te ven los profesionales</h4>
          <p className="text-sm">{employer.headline}</p>
          {rep.reliablePayer && (
            <p className="mt-1 text-xs text-ok">Se reconoce que cumples los pagos a tiempo.</p>
          )}
        </div>
      </div>

      {rep.dimensions.length > 0 && (
        <ul aria-label="Calificación por aspecto" className="space-y-2">
          {rep.dimensions.map((d) => (
            <li key={d.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{d.label}</span>
                <span className="tabular-nums">
                  {d.average.toFixed(1).replace(".", ",")} de 5{" "}
                  <span className="text-[11px] text-muted-foreground">({d.ratings})</span>
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${d.label}: ${d.average.toFixed(1).replace(".", ",")} de 5`}
              >
                <div
                  className="h-full rounded-full bg-copper"
                  style={{ width: `${(d.average / 5) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {employer.strongest && (
        <p className="text-sm">
          Lo que más valoran: <strong>{employer.strongest.label.toLowerCase()}</strong>
          {employer.weakest ? (
            <>
              . Lo que más puedes mejorar: <strong>{employer.weakest.label.toLowerCase()}</strong>.
            </>
          ) : (
            "."
          )}
        </p>
      )}

      {employer.tips.length > 0 && (
        <ul aria-label="Consejos para mejorar" className="space-y-2">
          {employer.tips.map((t) => (
            <li key={t.key} className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="font-semibold">{t.label}</p>
              <p className="text-muted-foreground">{t.tip}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        Solo ves promedios con 3 calificaciones o más. Los comentarios de texto de los profesionales
        son privados.
      </p>
    </section>
  );
}

export function TeamCard({
  report,
  employer,
  serviceIds,
  loading,
  error,
  className,
}: {
  report: TeamReport | null;
  employer: EmployerReport | null;
  /** Último servicio terminado de cada profesional: desde ahí se guarda como favorito. */
  serviceIds: Record<string, string>;
  loading: boolean;
  error: boolean;
  className?: string;
}) {
  const shown = report ? report.members.slice(0, MEMBERS_SHOWN) : [];
  const more = report ? report.members.length - shown.length : 0;
  const risk = report && report.concentration.risk !== "none" ? report.concentration.risk : null;
  const topName = report
    ? (report.members.find((m) => m.id === report.concentration.topProfessionalId)?.name ?? null)
    : null;

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Tu equipo">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Users className="h-4 w-4 text-trust" aria-hidden="true" /> Tu equipo
        </h3>
        <p className="text-xs text-muted-foreground">
          Quién cumple, de quién dependes, a quién sumar y cómo te ven los profesionales.
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
          {report.hasData ? (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Profesionales" value={report.totals.professionals} />
                <StatTile label="Servicios" value={report.totals.services} />
                <StatTile label="Horas" value={`${hoursEs(report.totals.hours)} h`} />
                <StatTile label="Inversión" value={formatCOP(report.totals.spend)} />
              </dl>

              {risk && report.concentration.topShare !== null && (
                <section aria-label="Dependencia del equipo" className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <h4 className="font-semibold">{CONCENTRATION[risk].word}</h4>
                    <span className="shrink-0 tabular-nums">
                      {report.concentration.topShare} % de las horas
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`${topName ?? "La persona con más horas"} prestó el ${report.concentration.topShare} % de las horas`}
                  >
                    <div
                      className={cn("h-full rounded-full", CONCENTRATION[risk].bar)}
                      style={{ width: `${report.concentration.topShare}%` }}
                    />
                  </div>
                </section>
              )}

              <section aria-label="Profesionales del periodo" className="space-y-2">
                <h4 className="text-sm font-semibold">Quién prestó servicios</h4>
                <ul className="space-y-2">
                  {shown.map((m) => (
                    <MemberRow key={m.id} m={m} />
                  ))}
                </ul>
                {more > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Y {plural(more, "profesional más", "profesionales más")} con menos horas.
                  </p>
                )}
              </section>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Aún no hay servicios en este periodo. Cuando tus profesionales presten servicios,
              verás aquí quién cumple y de quién dependes.
            </p>
          )}

          {report.bench.idle.length > 0 && (
            <section aria-label="Equipo de confianza sin servicios recientes" className="space-y-2">
              <h4 className="text-sm font-semibold">
                Tu equipo de confianza, sin trabajar contigo
              </h4>
              <ul className="space-y-1.5">
                {report.bench.idle.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{i.name ?? "Profesional"}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.lastServiceAt
                        ? `Último servicio: ${dateEs(msOf(i.lastServiceAt))}`
                        : "Aún no ha trabajado contigo"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.candidates.length > 0 && (
            <section aria-label="Profesionales para sumar al equipo" className="space-y-2">
              <h4 className="text-sm font-semibold">Para sumar a tu equipo de confianza</h4>
              <ul className="space-y-1.5">
                {report.candidates.map((c) => {
                  const bookingId = serviceIds[c.id];
                  const row = (
                    <>
                      <span className="font-medium">{c.name ?? "Profesional"}</span>
                      <span className="text-xs text-muted-foreground">
                        {plural(c.services, "servicio", "servicios")} · {c.onTimePct} % puntual
                        {bookingId ? " · ver su servicio" : ""}
                      </span>
                    </>
                  );
                  const style =
                    "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-sm";
                  return (
                    <li key={c.id}>
                      {bookingId ? (
                        <Link
                          to="/servicio/$bookingId"
                          params={{ bookingId }}
                          className={cn(
                            style,
                            "transition-colors hover:bg-ok/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className={style}>{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Sin cancelaciones ni servicios sin iniciar en los últimos 90 días. Abre uno de sus
                servicios y usa «Guardar como favorito» para sumarlos a tu equipo.
              </p>
            </section>
          )}

          <InsightList
            label="Hallazgos del equipo"
            items={report.insights.map((i) => ({
              id: i.id,
              tone: TONE[i.severity],
              title: i.title,
              detail: i.detail,
              action: i.action,
            }))}
          />

          {employer && employer.hasData && <EmployerBlock employer={employer} />}
          {employer && !employer.hasData && (
            <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
              {employer.headline} Cuando los profesionales te califiquen, verás aquí cómo te ven.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Las etiquetas salen de reglas simples y nunca se juzga con pocos datos. Una cancelación
            de motivo desconocido no se le atribuye a nadie. Es una guía, no un ranking de personas.
          </p>
        </>
      )}
    </Card>
  );
}
