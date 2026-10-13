// «Tu Trust Score»: el puntaje de confianza de la propia cuenta (familia o institución) y de dónde sale cada punto. Es lo que ven los
// profesionales cuando miran una oferta o una solicitud tuya. El desglose y los consejos solo los ve la propia cuenta.

import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustBadge } from "@/components/humanix/TrustBadge";
import { useOwnTrustScore } from "@/hooks/use-trust-score";
import { cn } from "@/lib/utils";
import { TRUST_LEVEL_LABEL, trustLines, trustTips } from "@/lib/trustScore";

export function OwnTrustCard({
  userId,
  kind,
  className,
}: {
  userId: string;
  kind: "family" | "institution";
  className?: string;
}) {
  const trust = useOwnTrustScore(userId);

  if (trust.isLoading) {
    return <Skeleton className={cn("h-40 w-full rounded-2xl", className)} />;
  }
  const info = trust.data;
  // Sin función en la base, sin sesión o sin puntaje: no se inventa nada.
  if (!info || info.summary.score == null) return null;

  const { summary, components } = info;
  const lines = components ? trustLines(components, kind) : [];
  const tips = components ? trustTips(components, kind) : [];
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
          {kind === "family"
            ? "Los profesionales lo ven junto a tu solicitud. "
            : "Los profesionales lo ven junto a las ofertas de tu institución. "}
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
