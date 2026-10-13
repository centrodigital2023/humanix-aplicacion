import { Building2, HeartPulse, Users, type LucideIcon } from "lucide-react";
import { useActiveUsersCount } from "@/hooks/use-active-users-count";
import { counterItems, type CounterKey, type CounterViewer } from "@/lib/liveMap";
import { cn } from "@/lib/utils";

type LivePulseBarProps = {
  /** Quién mira: decide qué grupos se muestran (solo lo que le sirve). */
  role: CounterViewer;
  className?: string;
};

const ICON: Record<CounterKey, LucideIcon> = {
  professionals: HeartPulse,
  families: Users,
  institutions: Building2,
};

const TONE: Record<CounterKey, string> = {
  professionals: "text-trust",
  families: "text-copper",
  institutions: "text-fuchsia-neural",
};

/**
 * Barra de actividad en vivo, con números reales de la base: por grupo, cuántos están disponibles, cuántos tienen la aplicación abierta
 * ahora («en vivo») y cuántos están ocupados, de los registrados. Se actualiza sola cuando algo cambia (ver `use-live-map.ts`).
 */
export function LivePulseBar({ role, className }: LivePulseBarProps) {
  const { live, loading } = useActiveUsersCount();

  if (loading) return null;

  const items = counterItems(role, live);

  return (
    <div
      role="group"
      aria-label="Actividad en vivo"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs",
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-1.5 font-semibold text-ok">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
        En vivo
      </span>
      <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
      {items.map((it) => {
        const Icon = ICON[it.key];
        return (
          <span
            key={it.key}
            data-testid={`pulse-${it.key}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"
          >
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Icon className={cn("h-3.5 w-3.5 shrink-0", TONE[it.key])} aria-hidden />
              {it.label}
            </span>
            <span>
              <strong className="font-bold text-ok">{it.available}</strong> {it.availableLabel}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
              <strong className="font-bold text-foreground">{it.live}</strong> en vivo
            </span>
            <span>
              <strong className="font-bold text-warn">{it.busy}</strong> {it.busyLabel}
            </span>
            <span className="text-muted-foreground/70">de {it.total} registrados</span>
          </span>
        );
      })}
    </div>
  );
}
