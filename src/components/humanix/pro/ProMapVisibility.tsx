// «¿Me ven en el mapa?» para el profesional: el estado sale de su perfil y de sus ofertas (la base decide qué se ve; aquí se explica) y cada
// paso pendiente lleva a donde se arregla. Va junto a los contadores en vivo (`LivePulseBar`).
import { CheckCircle2, Circle, Eye, EyeOff, Loader2, MapPin, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useMyServiceOffers } from "@/hooks/use-service-offers";
import {
  proVisibility,
  visibilityProgress,
  type VisibilityAction,
  type VisibilityStatus,
} from "@/lib/proVisibility";
import { cn } from "@/lib/utils";

export interface ProMapVisibilityProfile {
  published: boolean | null;
  active: boolean | null;
  blocked?: boolean | null;
  lat: number | null;
  lng: number | null;
  available: boolean | null;
}

const ACTION_LABEL: Record<VisibilityAction, string> = {
  show: "Volver a mostrarme",
  profile: "Ir a mi perfil",
  availability: "Ponerme disponible",
  offer: "Publicar mi oferta",
};

const STATUS_STYLE: Record<VisibilityStatus, string> = {
  visible: "border-ok/40 bg-ok/5",
  hidden: "border-warn/40 bg-warn/5",
  blocked: "border-sos/40 bg-sos/5",
};

export function ProMapVisibility({
  userId,
  profile,
  busy,
  onAction,
}: {
  userId: string;
  profile: ProMapVisibilityProfile | null;
  /** Alguna acción está en curso (cambiar disponibilidad o volver a mostrarse). */
  busy?: boolean;
  onAction: (action: VisibilityAction) => void;
}) {
  const offers = useMyServiceOffers(userId);
  if (!profile) return null;

  const v = proVisibility({
    published: !!profile.published,
    active: profile.active,
    blocked: !!profile.blocked,
    hasLocation: profile.lat != null && profile.lng != null,
    available: !!profile.available,
    hasVisibleServiceOffer: (offers.data ?? []).some((o) => o.visible),
  });
  const { done, total } = visibilityProgress(v);
  const pending = v.steps.filter((s) => !s.done);
  const Icon = v.status === "blocked" ? ShieldAlert : v.onMap ? Eye : EyeOff;

  return (
    <Card
      className={cn("space-y-3 p-4", STATUS_STYLE[v.status])}
      aria-label="¿Me ven en el mapa?"
      data-testid="pro-map-visibility"
      data-status={v.status}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            v.status === "visible"
              ? "bg-ok/15 text-ok"
              : v.status === "blocked"
                ? "bg-sos/15 text-sos"
                : "bg-warn/15 text-warn",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{v.headline}</p>
          <p className="text-xs text-muted-foreground">{v.detail}</p>
        </div>
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          aria-label={`${done} de ${total} pasos completos`}
        >
          {done}/{total}
        </span>
      </div>

      <ul className="space-y-1.5" aria-label="Pasos para aparecer en el mapa">
        {v.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-xs">
            {s.done ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={cn(s.done ? "text-foreground" : "text-muted-foreground")}>
              <span className="font-medium text-foreground">{s.label}</span>
              {s.hint && <span> — {s.hint}</span>}
            </span>
          </li>
        ))}
      </ul>

      {pending.length > 0 && v.status !== "blocked" && (
        <div className="flex flex-wrap gap-2">
          {[...new Set(pending.map((s) => s.action).filter((a): a is VisibilityAction => !!a))].map(
            (action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "availability" || action === "show" ? "hero" : "outline"}
                disabled={busy && (action === "availability" || action === "show")}
                onClick={() => onAction(action)}
              >
                {busy && (action === "availability" || action === "show") ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : action === "profile" ? (
                  <MapPin className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : null}
                {ACTION_LABEL[action]}
              </Button>
            ),
          )}
        </div>
      )}
    </Card>
  );
}
