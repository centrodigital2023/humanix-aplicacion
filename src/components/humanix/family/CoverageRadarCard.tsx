// Radar de cobertura (plan Esencial): qué horas de la agenda siguen sin profesional, con qué urgencia y a quién avisar
// primero (lógica en `lib/coverageRadar`). No contacta a nadie por su cuenta: cada recomendación lleva a la pantalla
// donde la familia decide.
import { Link } from "@tanstack/react-router";
import { Radar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { Advice, AdviceSeverity, CoverageRadar, GapLevel } from "@/lib/coverageRadar";
import { URGENCY_LABEL, formatShiftRange } from "@/lib/opportunities";
import { cn } from "@/lib/utils";
import { InsightList, type InsightTone } from "./InsightList";

export type RadarAnchor = "agenda" | "proposals" | "team";

const TONE: Record<AdviceSeverity, InsightTone> = {
  alert: "alert",
  warn: "warn",
  info: "info",
  good: "ok",
};

const LEVEL: Record<GapLevel, { label: string; cls: string }> = {
  critical: { label: "Urgente", cls: "border-sos/40 bg-sos/10 text-sos" },
  high: { label: "En menos de 24 h", cls: "border-warn/40 bg-warn/10 text-warn" },
  medium: { label: "En 3 días", cls: "border-trust/40 bg-trust/10 text-trust" },
  low: { label: "Más adelante", cls: "border-border bg-muted text-muted-foreground" },
};

function AdviceActions({
  advice,
  radar,
  onGoTo,
}: {
  advice: Advice;
  radar: CoverageRadar;
  onGoTo: (a: RadarAnchor) => void;
}) {
  switch (advice.kind) {
    case "team":
      return (
        <>
          {radar.team.available.slice(0, 3).map((m) => (
            <Button key={m.professional_id} asChild size="sm" variant="outline">
              <Link to="/profesional/$proId" params={{ proId: m.professional_id }}>
                Ver a {m.display_name.split(" ")[0]}
              </Link>
            </Button>
          ))}
        </>
      );
    case "search":
      return (
        <Button asChild size="sm" variant="hero">
          <Link to="/buscar">Buscar profesionales</Link>
        </Button>
      );
    case "rate":
    case "calendar":
      return (
        <Button type="button" size="sm" variant="outline" onClick={() => onGoTo("agenda")}>
          Ir a mi agenda
        </Button>
      );
    case "proposals":
      return (
        <Button type="button" size="sm" variant="hero" onClick={() => onGoTo("proposals")}>
          Ver propuestas
        </Button>
      );
    case "build_team":
      return (
        <Button type="button" size="sm" variant="outline" onClick={() => onGoTo("team")}>
          Ver mi equipo
        </Button>
      );
    default:
      return null;
  }
}

export function CoverageRadarCard({
  radar,
  loading,
  onGoTo,
  className,
}: {
  radar: CoverageRadar;
  loading: boolean;
  onGoTo: (a: RadarAnchor) => void;
  className?: string;
}) {
  const s = radar.summary;
  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Radar de cobertura">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Radar className="h-4 w-4 text-trust" aria-hidden="true" /> Radar de cobertura
        </h3>
        <p className="text-xs text-muted-foreground">
          Qué horas de tu agenda siguen sin profesional y a quién avisar primero.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="space-y-1.5">
            {s.neededHours > 0 ? (
              <>
                <p className="text-sm">
                  <strong>
                    {s.coveredHours} de {s.neededHours} h
                  </strong>{" "}
                  cubiertas en los próximos {s.windowDays} días ({s.coveragePct ?? 0} %).
                </p>
                <Progress
                  value={s.coveragePct ?? 0}
                  aria-label={`Cobertura de los próximos ${s.windowDays} días: ${s.coveragePct ?? 0} %`}
                  className="h-2"
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay horas marcadas en tu agenda para los próximos {s.windowDays} días.
              </p>
            )}
            <p className="text-xs text-muted-foreground">{radar.team.headline}</p>
          </div>

          {radar.gaps.length > 0 && (
            <section aria-label="Horas sin cubrir" className="space-y-2">
              <h4 className="text-sm font-semibold">Horas sin cubrir</h4>
              <ul className="space-y-2">
                {radar.gaps.slice(0, 6).map((g) => (
                  <li key={g.key} className="space-y-1 rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{formatShiftRange(g.startsAt, g.endsAt)}</p>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          LEVEL[g.level].cls,
                        )}
                      >
                        {LEVEL[g.level].label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{URGENCY_LABEL[g.urgency]}</p>
                    {g.reasons.map((r) => (
                      <p key={r} className="text-xs">
                        {r}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
              {radar.gaps.length > 6 && (
                <p className="text-xs text-muted-foreground">
                  Y {radar.gaps.length - 6} huecos más en las próximas semanas.
                </p>
              )}
            </section>
          )}

          <InsightList
            label="Recomendaciones de cobertura"
            items={radar.advice.map((a) => ({
              id: a.id,
              tone: TONE[a.severity],
              title: a.title,
              detail: a.detail,
              cta: <AdviceActions advice={a} radar={radar} onGoTo={onGoTo} />,
            }))}
          />
        </>
      )}
    </Card>
  );
}
