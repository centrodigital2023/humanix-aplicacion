// Comparador inteligente (plan Esencial): ordena las propuestas y postulaciones pendientes con un puntaje que se puede
// desarmar (lógica en `lib/applicantRanking`). Es un apoyo para decidir: aceptar o negociar sigue pasando por la
// bandeja de propuestas y de postulaciones de siempre.
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { rankingHeadline, type RankedApplicant } from "@/lib/applicantRanking";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const SHOWN = 3;

const LABEL_TONE: Record<RankedApplicant["label"], string> = {
  "Muy buena opción": "text-ok",
  "Buena opción": "text-biosensor",
  "Para considerar": "text-warn",
  "Revisa con cuidado": "text-sos",
  "Pocos datos": "text-muted-foreground",
};

function Candidate({
  r,
  onOpenInbox,
}: {
  r: RankedApplicant;
  onOpenInbox: (source: "proposal" | "application") => void;
}) {
  const a = r.applicant;
  const unit = a.hourly ? "/h" : "";
  const asks =
    a.offeredRate === null ? "Sin tarifa indicada" : `Pide ${formatCOP(a.offeredRate)}${unit}`;
  const posted =
    a.postedRate !== null && a.postedRate !== a.offeredRate
      ? ` · publicaste ${formatCOP(a.postedRate)}${unit}`
      : "";
  const who = a.name ?? "Profesional";

  return (
    <li
      className={cn(
        "space-y-3 rounded-2xl border bg-card p-4",
        r.isTop ? "border-biosensor/50 shadow-sm" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
              {r.rank}
            </span>
            <p className="truncate font-semibold">{who}</p>
            {r.isTop && (
              <Badge className="bg-biosensor text-biosensor-foreground">Mejor opción</Badge>
            )}
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {a.source === "proposal" ? "Propuesta" : "Postulación"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {asks}
            {posted}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-2xl font-bold leading-none">
            {r.score}
            <span className="sr-only"> de 100</span>
          </p>
          <p className="text-[10px] text-muted-foreground" aria-hidden="true">
            de 100
          </p>
          <p className={cn("mt-1 text-xs font-semibold", LABEL_TONE[r.label])}>{r.label}</p>
        </div>
      </div>

      <Progress
        value={r.score}
        aria-label={`Puntaje de ${who}: ${r.score} de 100`}
        className="h-1.5"
      />

      {r.pros.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={`Lo bueno de ${who}`}>
          {r.pros.slice(0, SHOWN).map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {r.cautions.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label={`Para tener en cuenta de ${who}`}>
          {r.cautions.map((c) => (
            <li key={c} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {r.counter && (
        <p className="rounded-lg border border-copper/30 bg-copper/5 p-3 text-sm">
          <strong>
            Contraoferta sugerida: {formatCOP(r.counter.suggested)}
            {unit}
          </strong>
          <br />
          <span className="text-muted-foreground">{r.counter.rationale}</span>
        </p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">¿Cómo se calculó?</summary>
        <ul className="mt-2 space-y-2">
          {r.factors.map((f) => (
            <li key={f.key}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold">{f.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {f.points} / {f.max}
                </span>
              </div>
              <Progress value={(f.points / f.max) * 100} aria-hidden="true" className="mt-1 h-1" />
              <p className="mt-0.5 text-xs text-muted-foreground">{f.note}</p>
            </li>
          ))}
          {r.pros.length > SHOWN && (
            <li className="text-xs text-muted-foreground">
              Y también: {r.pros.slice(SHOWN).join(" · ")}.
            </li>
          )}
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to="/profesional/$proId" params={{ proId: a.professionalId }}>
            Ver perfil
          </Link>
        </Button>
        <Button type="button" size="sm" variant="hero" onClick={() => onOpenInbox(a.source)}>
          {a.source === "proposal" ? "Responder la propuesta" : "Responder la postulación"}
        </Button>
      </div>
    </li>
  );
}

export function ApplicantsRankingCard({
  ranked,
  loading,
  onOpenInbox,
  className,
}: {
  ranked: RankedApplicant[];
  loading: boolean;
  onOpenInbox: (source: "proposal" | "application") => void;
  className?: string;
}) {
  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Comparador inteligente">
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          <Scale className="h-4 w-4 text-trust" aria-hidden="true" /> Comparador inteligente
        </h3>
        <p className="text-sm text-muted-foreground">{rankingHeadline(ranked)}</p>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : ranked.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No hay propuestas ni postulaciones pendientes. Cuando lleguen, las ordenamos por
          verificación, confianza, calificaciones, precio frente a tu ciudad, cercanía y si ya te
          conocen.
        </p>
      ) : (
        <ul className="space-y-3" aria-label="Opciones ordenadas">
          {ranked.map((r) => (
            <Candidate
              key={`${r.applicant.source}:${r.applicant.id}`}
              r={r}
              onOpenInbox={onOpenInbox}
            />
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground">
        El puntaje usa solo lo que muestra el perfil público y lo que ya pasó contigo; es una ayuda
        para decidir, no una recomendación médica ni una garantía.
      </p>
    </Card>
  );
}
