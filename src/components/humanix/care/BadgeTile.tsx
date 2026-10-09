// Sello de la trayectoria: ganado (con su nivel) o en camino (con su avance). Presentacional.
import { ClipboardCheck, Clock, Flame, Heart, HeartHandshake, Medal, Star } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { tierName, type Badge, type BadgeIcon, type BadgeTone } from "@/lib/careerStats";
import { cn } from "@/lib/utils";

const ICONS: Record<BadgeIcon, React.ElementType> = {
  Medal,
  Clock,
  Heart,
  HeartHandshake,
  ClipboardCheck,
  Flame,
  Star,
};

const TONE: Record<BadgeTone, string> = {
  copper: "bg-copper/15 text-copper",
  biosensor: "bg-biosensor/15 text-biosensor",
  ok: "bg-ok/15 text-ok",
  trust: "bg-trust/15 text-trust",
  "fuchsia-neural": "bg-fuchsia-neural/15 text-fuchsia-neural",
};

export function BadgeTile({ badge }: { badge: Badge }) {
  const Icon = ICONS[badge.icon];
  const max = badge.tier >= badge.maxTier;
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3",
        badge.earned ? "border-border bg-card" : "border-dashed border-border bg-muted/20",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          badge.earned ? TONE[badge.tone] : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
          {badge.title}
          {badge.earned && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                TONE[badge.tone],
              )}
            >
              {tierName(badge.tier)}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">{badge.description}</p>
        {!max ? (
          <div className="mt-2">
            <Progress
              value={Math.round(badge.progress * 100)}
              className="h-1.5"
              aria-label={`${badge.title}: ${badge.current} de ${badge.target}`}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {badge.current} de {badge.target} para {tierName(badge.tier + 1)}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[11px] font-medium text-ok">Nivel máximo alcanzado</p>
        )}
      </div>
    </li>
  );
}
