import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, HeartPulse, MapPin, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  URGENCY_LABEL,
  estimatedTotal,
  formatShiftRange,
  type FamilyInfo,
  type ProIntro,
  type RankedShift,
} from "@/lib/opportunities";
import { buildPriceBreakdown, formatCOP } from "@/lib/pricing";
import type { PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { ContactRevealPanel } from "./ContactRevealPanel";
import { FamilyReputationBadge } from "./FamilyReputationBadge";

interface Props {
  ranked: RankedShift;
  family?: FamilyInfo;
  applied: boolean;
  userId: string;
  plan: PlanKey;
  commissionPct: number;
  intro: ProIntro;
  revealedToday: Set<string>;
  onApply: () => void;
}

const URGENCY_STYLE = {
  now: "bg-sos text-sos-foreground",
  today: "bg-warn text-warn-foreground",
  tomorrow: "bg-secondary text-secondary-foreground",
  week: "bg-secondary text-secondary-foreground",
  later: "bg-muted text-muted-foreground",
} as const;

function matchStyle(score: number, conflict: boolean): string {
  if (conflict) return "border-sos/40 bg-sos/10 text-sos";
  if (score >= 80) return "border-ok/40 bg-ok/10 text-ok";
  if (score >= 60) return "border-trust/40 bg-trust/10 text-trust";
  if (score >= 40) return "border-warn/40 bg-warn/10 text-warn";
  return "border-border bg-muted text-muted-foreground";
}

/** Un turno de una familia: compatibilidad explicada, valor neto, reputación y acciones. */
export function ShiftCard({
  ranked,
  family,
  applied,
  userId,
  plan,
  commissionPct,
  intro,
  revealedToday,
  onApply,
}: Props) {
  const { shift, match, urgency } = ranked;
  const [showAll, setShowAll] = useState(false);
  const total = estimatedTotal(shift.rate_avg, shift.hours);
  const net =
    shift.rate_avg != null ? buildPriceBreakdown(shift.rate_avg, shift.hours, commissionPct) : null;
  const rateLabel =
    shift.rate_avg == null
      ? "Valor por acordar"
      : shift.rate_min !== shift.rate_max
        ? `${formatCOP(shift.rate_min ?? 0)}–${formatCOP(shift.rate_max ?? 0)} / h`
        : `${formatCOP(shift.rate_avg)} / h`;
  const notes = showAll ? shift.notes : shift.notes.slice(0, 1);

  return (
    <Card
      className={cn("space-y-3 p-4", match.conflict && "opacity-80")}
      aria-label={`Turno de ${shift.display_name}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {shift.display_name}
            {shift.city && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <MapPin className="h-3 w-3" aria-hidden /> {shift.city}
              </span>
            )}
          </p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden />{" "}
            {formatShiftRange(shift.starts_at, shift.ends_at)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge className={cn("border-0 text-[10px]", URGENCY_STYLE[urgency])}>
            {URGENCY_LABEL[urgency]}
          </Badge>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  matchStyle(match.score, match.conflict),
                )}
                aria-label={`Compatibilidad ${match.score} de 100. Ver por qué`}
              >
                {match.conflict ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
                {match.score}% · {match.label}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2 text-xs" align="end">
              <p className="text-sm font-semibold">¿Por qué te lo mostramos?</p>
              {match.reasons.length > 0 && (
                <ul className="space-y-1">
                  {match.reasons.map((r) => (
                    <li key={r} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />{" "}
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {match.warnings.length > 0 && (
                <ul className="space-y-1">
                  {match.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-1.5">
                      <AlertTriangle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn"
                        aria-hidden
                      />{" "}
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                Puntaje calculado con tu ciudad, especialidad, tarifa, agenda y la reputación de la
                familia. No usa datos personales de la familia.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">Valor</p>
          <p className="text-sm font-semibold">{rateLabel}</p>
          <p className="text-[11px] text-muted-foreground">{shift.hours} h</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">Total del servicio</p>
          <p className="text-sm font-semibold">{total != null ? formatCOP(total) : "—"}</p>
        </div>
        <div className="rounded-lg bg-ok/10 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            Te quedan{commissionPct > 0 ? ` (−${commissionPct}%)` : " (sin comisión)"}
          </p>
          <p className="text-sm font-semibold text-ok">
            {net ? formatCOP(net.professionalNet) : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {shift.care_type && (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
            <HeartPulse className="h-3 w-3" aria-hidden /> {shift.care_type}
          </span>
        )}
        <FamilyReputationBadge
          familyId={shift.family_user_id}
          stars={family?.stars ?? null}
          ratings={family?.ratings ?? 0}
          completed={family?.completed ?? 0}
        />
      </div>

      {notes.length > 0 && (
        <div className="rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
          {notes.map((n) => (
            <p key={n}>“{n}”</p>
          ))}
          {shift.notes.length > 1 && (
            <button
              type="button"
              className="mt-1 font-medium text-biosensor hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Ver menos" : `Ver ${shift.notes.length - 1} nota(s) más`}
            </button>
          )}
        </div>
      )}

      {match.warnings.length > 0 && (
        <p className="inline-flex items-start gap-1.5 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {match.warnings[0]}
        </p>
      )}

      {applied ? (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ok">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Ya te postulaste a este turno
          </p>
          <ContactRevealPanel
            shift={shift}
            userId={userId}
            plan={plan}
            hasApplied
            proName={intro.name}
            revealedToday={revealedToday}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            La dirección exacta y el WhatsApp se ven después de postularte, con plan Esencial o
            superior.
          </p>
          <Button size="sm" variant="hero" onClick={onApply} disabled={match.conflict}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            {match.conflict ? "Cruce de horario" : "Postularme"}
          </Button>
        </div>
      )}
    </Card>
  );
}
