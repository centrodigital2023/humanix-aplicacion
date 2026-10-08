import { Link } from "@tanstack/react-router";
import { Ban, CheckCircle2, Lock, ShieldAlert, Sparkles, Unlock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ShareButtons } from "@/components/humanix/ShareButtons";
import { COVERAGE_META } from "@/lib/coverage";
import type { OfferRow, PriceVerdict, RiskSeverity } from "@/lib/marketplaceInsights";
import { MatchPanel } from "./MatchPanel";
import { MODALITY_LABEL, formatCOP, relativeTime, shortDate } from "./format";
import type { OfferInsight } from "./insights";

const RISK_STYLE: Record<RiskSeverity, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-700",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  low: "border-border bg-muted text-muted-foreground",
};

const PRICE_STYLE: Record<PriceVerdict, string> = {
  below: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  in_range: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  above: "border-sky-500/40 bg-sky-500/10 text-sky-700",
  insufficient: "border-border bg-muted text-muted-foreground",
};

function priceText(i: OfferInsight): string {
  const b = i.bench;
  if (b.verdict === "insufficient" || b.median === null || b.deltaPct === null)
    return "Sin pares suficientes para comparar el valor";
  const sign = b.deltaPct > 0 ? "+" : "";
  const label =
    b.verdict === "below"
      ? "Por debajo del mercado"
      : b.verdict === "above"
        ? "Por encima del mercado"
        : "En rango de mercado";
  return `${label}: ${sign}${b.deltaPct}% vs. mediana ${formatCOP(b.median)} (${b.scope}, ${b.peers} ofertas)`;
}

interface Props {
  offer: OfferRow;
  insight: OfferInsight;
  now: number;
  matchOpen: boolean;
  onToggleMatch: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onClose: () => void;
}

export function OfferCard({
  offer,
  insight,
  now,
  matchOpen,
  onToggleMatch,
  onBlock,
  onUnblock,
  onClose,
}: Props) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://humanix.lat";
  const live = offer.status === "open" && !offer.blocked;
  const cov = COVERAGE_META[insight.coverage];

  return (
    <Card className={`p-5 ${offer.blocked ? "border-red-500/30 bg-red-500/[0.03]" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-semibold">{offer.title}</h3>
            <Badge
              variant={offer.status === "open" ? "default" : "secondary"}
              className="text-[10px]"
            >
              {offer.status === "open"
                ? "Abierta"
                : offer.status === "filled"
                  ? "Cubierta"
                  : "Cerrada"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {offer.poster_type === "institution" ? "IPS/EPS" : "Familia"}
            </Badge>
            {offer.specialty_required && (
              <Badge variant="outline" className="text-[10px]">
                {offer.specialty_required}
              </Badge>
            )}
            {offer.blocked && (
              <Badge className="gap-1 bg-red-600 text-[10px] text-white">
                <Lock className="h-3 w-3" aria-hidden="true" /> Bloqueada
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {offer.city} · {formatCOP(offer.amount)}{" "}
            {MODALITY_LABEL[offer.modality] ?? offer.modality}
            {offer.start_date ? ` · inicia ${shortDate(offer.start_date)}` : ""} · publicada{" "}
            {relativeTime(offer.created_at, now)}
          </p>
          {offer.blocked && offer.blocked_reason && (
            <p className="mt-1 text-xs text-red-700">Motivo: {offer.blocked_reason}</p>
          )}
          {offer.description && (
            <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{offer.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
              <span className={`h-2 w-2 rounded-full ${cov.dot}`} aria-hidden="true" /> {cov.label}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {insight.apps.length} postulación(es)
              {insight.pending ? ` · ${insight.pending} por aprobar` : ""}
              {insight.accepted ? ` · ${insight.accepted} aprobada(s)` : ""}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 ${PRICE_STYLE[insight.bench.verdict]}`}
            >
              {priceText(insight)}
            </span>
          </div>

          {insight.risk.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Señales de riesgo">
              {insight.risk.map((s) => (
                <li
                  key={s.code}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${RISK_STYLE[s.severity]}`}
                >
                  <ShieldAlert className="h-3 w-3" aria-hidden="true" /> {s.label}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-3">
            <Progress
              value={insight.quality.score}
              className="h-1.5 w-32"
              aria-label={`Calidad de la oferta ${insight.quality.score} de 100`}
            />
            <span className="text-[11px] text-muted-foreground">
              Calidad {insight.quality.score}/100
              {insight.quality.missing.length > 0 &&
                ` · falta: ${insight.quality.missing.slice(0, 3).join(", ").toLowerCase()}`}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {live && (
            <Button
              size="sm"
              variant={matchOpen ? "default" : "outline"}
              onClick={onToggleMatch}
              className="gap-1.5"
              aria-expanded={matchOpen}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Matchmaking IA
            </Button>
          )}
          {offer.blocked ? (
            <Button size="sm" variant="outline" onClick={onUnblock} className="gap-1.5">
              <Unlock className="h-3.5 w-3.5" aria-hidden="true" /> Desbloquear
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onBlock} className="gap-1.5 text-red-700">
              <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Bloquear
            </Button>
          )}
          {offer.status === "open" && !offer.blocked && (
            <Button size="sm" variant="ghost" onClick={onClose} className="gap-1.5">
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cerrar
            </Button>
          )}
          {live && (
            <>
              <Link
                to="/oferta/$offerId"
                params={{ offerId: offer.id }}
                className="inline-flex items-center gap-1 text-[11px] text-biosensor hover:underline"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ver como la ve el público
              </Link>
              <ShareButtons
                url={`${origin}/buscar?offer=${offer.id}`}
                title={`${offer.title} · ${offer.city}`}
                description={offer.description ?? ""}
              />
            </>
          )}
        </div>
      </div>

      {matchOpen && live && <MatchPanel offer={offer} />}
    </Card>
  );
}
