import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock,
  MapPin,
  Send,
  Siren,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { URGENCY_LABEL, formatShiftRange, hoursBetween, type ProIntro } from "@/lib/opportunities";
import {
  applicationBadge,
  estimatedOfferTotal,
  hourlyEquivalent,
  type RankedOffer,
} from "@/lib/institutionOffers";
import { MODALITY_LABEL, professionalNet } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import type { PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { InstitutionReputationBadge } from "./InstitutionReputationBadge";
import { OfferContactPanel } from "./OfferContactPanel";

interface Props {
  ranked: RankedOffer;
  userId: string;
  plan: PlanKey;
  commissionPct: number;
  intro: ProIntro;
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

const BADGE_TONE = {
  ok: "text-ok",
  warn: "text-warn",
  muted: "text-muted-foreground",
} as const;

/** Un turno de una institución: agenda, valor y neto, compatibilidad explicada, reputación y acciones. */
export function InstitutionOfferCard({
  ranked,
  userId,
  plan,
  commissionPct,
  intro,
  onApply,
}: Props) {
  const { offer, match, urgency } = ranked;
  const [showAll, setShowAll] = useState(false);
  const total = estimatedOfferTotal(offer);
  const net = total != null ? professionalNet(total, commissionPct) : null;
  const hourly = hourlyEquivalent(offer);
  const shifts = showAll ? offer.shifts : offer.shifts.slice(0, 3);
  const badge = applicationBadge(offer);
  const app = offer.application;
  const firstShiftHint = offer.shifts[0]
    ? `«${offer.title}» (${formatShiftRange(offer.shifts[0].starts_at, offer.shifts[0].ends_at)})`
    : `«${offer.title}»`;

  return (
    <Card
      className={cn("space-y-3 p-4", match.conflict && "opacity-80")}
      aria-label={`Oferta de ${offer.institutionName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            {offer.institutionName}
            {offer.verified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verificada
              </span>
            )}
            {offer.city && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <MapPin className="h-3 w-3" aria-hidden /> {offer.city}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm">{offer.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[offer.institutionType, offer.serviceArea, offer.specialty]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {offer.urgent && (
            <Badge className="border-0 bg-sos text-[10px] text-sos-foreground">
              <Siren className="mr-1 h-3 w-3" aria-hidden /> Urgente
            </Badge>
          )}
          {!offer.urgent && (
            <Badge className={cn("border-0 text-[10px]", URGENCY_STYLE[urgency])}>
              {URGENCY_LABEL[urgency]}
            </Badge>
          )}
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
                institución. No usa datos personales.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">Valor publicado</p>
          <p className="text-sm font-semibold">
            {formatCOP(offer.amount)} {MODALITY_LABEL[offer.modality]}
          </p>
          {hourly != null && offer.modality === "shift" && (
            <p className="text-[11px] text-muted-foreground">≈ {formatCOP(hourly)} por hora</p>
          )}
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            {offer.hasAgenda
              ? `Total (${offer.shifts.length} ${offer.shifts.length === 1 ? "turno" : "turnos"})`
              : "Total"}
          </p>
          <p className="text-sm font-semibold">{total != null ? formatCOP(total) : "—"}</p>
          {offer.hasAgenda && (
            <p className="text-[11px] text-muted-foreground">{offer.totalHours} h en total</p>
          )}
        </div>
        <div className="rounded-lg bg-ok/10 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            Te quedan{commissionPct > 0 ? ` (−${commissionPct}%)` : " (sin comisión)"}
          </p>
          <p className="text-sm font-semibold text-ok">{net ? formatCOP(net.net) : "—"}</p>
        </div>
      </div>

      {offer.hasAgenda ? (
        <div className="rounded-lg border border-border p-2.5 text-xs">
          <p className="mb-1 font-medium text-foreground">Agenda de la institución</p>
          <ul className="space-y-1">
            {shifts.map((s) => {
              const clash = match.conflictingShiftIds.includes(s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden />
                  <span className={cn(clash && "line-through")}>
                    {formatShiftRange(s.starts_at, s.ends_at)}
                  </span>
                  <span>
                    · {s.positions - s.filled} {s.positions - s.filled === 1 ? "cupo" : "cupos"}
                  </span>
                  <span className="sr-only">{hoursBetween(s.starts_at, s.ends_at)} horas</span>
                  {clash && <span className="text-warn">se cruza con tu agenda</span>}
                </li>
              );
            })}
          </ul>
          {offer.shifts.length > 3 && (
            <button
              type="button"
              className="mt-1 font-medium text-biosensor hover:underline"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Ver menos" : `Ver ${offer.shifts.length - 3} turno(s) más`}
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground">
          Horario por coordinar con la institución al aceptar.
        </p>
      )}

      {offer.requirements.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Requisitos:</strong>{" "}
          {offer.requirements.slice(0, 4).join(" · ")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <InstitutionReputationBadge
          institutionId={offer.institutionId}
          stars={offer.rating.stars}
          ratings={offer.rating.ratings}
          completed={offer.completedServices}
        />
      </div>

      {match.warnings.length > 0 && !app && (
        <p className="inline-flex items-start gap-1.5 text-xs text-warn">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {match.warnings[0]}
        </p>
      )}

      {app ? (
        <div className="space-y-2">
          {badge && (
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium",
                BADGE_TONE[badge.tone],
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {badge.label}
            </p>
          )}
          <OfferContactPanel
            applicationId={app.id}
            userId={userId}
            plan={plan}
            institutionName={offer.institutionName}
            shiftHint={firstShiftHint}
            proName={intro.name}
            accepted={app.status === "accepted"}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            La dirección exacta se ve al aceptar la reserva; el WhatsApp, con plan Esencial o
            superior.
          </p>
          <Button size="sm" variant="hero" onClick={onApply} disabled={match.conflict}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            {match.conflict ? "Cruce de horario" : badge ? "Postularme de nuevo" : "Postularme"}
          </Button>
        </div>
      )}
    </Card>
  );
}
