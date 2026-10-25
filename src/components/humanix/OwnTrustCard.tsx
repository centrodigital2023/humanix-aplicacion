// «Tu Trust Score»: el puntaje de confianza de la propia cuenta (familia, profesional o institución) y de dónde sale cada punto. Es
// lo que ve la otra parte junto a una oferta, una solicitud o una postulación. El desglose, qué falta de la identidad y los consejos
// solo los ve la propia cuenta.

import { CheckCircle2, Circle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustBadge } from "@/components/humanix/TrustBadge";
import { useOwnTrustScore } from "@/hooks/use-trust-score";
import { cn } from "@/lib/utils";
import {
  TRUST_CAPS,
  TRUST_LEVEL_LABEL,
  identityParts,
  trustLines,
  trustTips,
  type TrustKind,
} from "@/lib/trustScore";

const WHO_SEES: Record<TrustKind, string> = {
  family: "Los profesionales lo ven junto a tu solicitud. ",
  institution: "Los profesionales lo ven junto a las ofertas de tu institución. ",
  professional: "Las familias y las instituciones lo ven junto a tu perfil y tus postulaciones. ",
};

export function OwnTrustCard({
  userId,
  kind,
  onCompleteIdentity,
  completeLabel = "Completar mi identidad",
  className,
}: {
  userId: string;
  kind: TrustKind;
  /** Lleva a donde se completa la identidad (perfil, Documentos o el perfil de la institución). */
  onCompleteIdentity?: () => void;
  completeLabel?: string;
  className?: string;
}) {
  const trust = useOwnTrustScore(userId, kind);

  if (trust.isLoading) {
    return <Skeleton className={cn("h-40 w-full rounded-2xl", className)} />;
  }
  const info = trust.data;
  // Sin función en la base, sin sesión o sin puntaje: no se inventa nada.
  if (!info || info.summary.score == null) return null;

  const { summary, components } = info;
  const progress = { ratingsCount: info.ratingsCount, completedServices: info.completedServices };
  const parts = identityParts(kind, info.identityParts);
  const lines = components ? trustLines(components, kind, progress) : [];
  const tips = components
    ? trustTips(components, kind, info.identityParts ? parts : undefined)
    : [];
  const identityMissing = !!components && components.identity < TRUST_CAPS.identity;
  const level = TRUST_LEVEL_LABEL[summary.level];

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Tu Trust Score">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <ShieldCheck className="h-4 w-4 text-trust" aria-hidden />
          Tu Trust Score
        </h2>
        <TrustBadge summary={summary} kind={kind} />
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-bold leading-none">{summary.score}</span>
          <span className="text-sm text-muted-foreground">de 100 · {level}</span>
        </div>
        <Progress
          value={summary.score}
          aria-label={`Trust Score ${summary.score} de 100`}
          className="h-2 bg-trust/15 [&>div]:bg-trust"
        />
        <p className="text-xs text-muted-foreground">
          {WHO_SEES[kind]}
          {summary.enough
            ? `Se calcula con ${info.ratingsCount} calificaci${info.ratingsCount === 1 ? "ón" : "ones"} y ${info.completedServices} servicio${info.completedServices === 1 ? "" : "s"} completado${info.completedServices === 1 ? "" : "s"}.`
            : "Tu cuenta es nueva en Humanix: el número se afianza con las primeras calificaciones y servicios."}
        </p>
      </div>

      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {lines.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="font-medium">{l.label}</p>
                <p className="text-xs text-muted-foreground">{l.hint}</p>
                {l.key === "identity" && info.identityParts && (
                  <ul className="mt-1.5 space-y-1" aria-label="Qué tienes y qué falta">
                    {parts.map((p) => (
                      <li
                        key={p.key}
                        className={cn(
                          "flex items-center gap-1.5 text-xs",
                          p.done ? "text-ok" : "text-muted-foreground",
                        )}
                      >
                        {p.done ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        <span>
                          {p.label} · {p.done ? "entregado" : `falta (+${p.points})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {l.key === "identity" && identityMissing && onCompleteIdentity && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 text-xs"
                    onClick={onCompleteIdentity}
                  >
                    {completeLabel}
                  </Button>
                )}
              </div>
              <p
                className={cn(
                  "shrink-0 font-mono text-sm font-semibold tabular-nums",
                  l.value < 0 && "text-warn",
                )}
              >
                {l.value > 0 && l.key !== "base" ? "+" : ""}
                {l.value}
                {l.max != null && l.key !== "base" ? (
                  <span className="font-normal text-muted-foreground"> / {l.max}</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}

      {tips.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-trust/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-trust">
            Para subir tu puntaje
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {tips.slice(0, 3).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
