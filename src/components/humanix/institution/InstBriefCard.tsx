// «Tu día» de la institución: saludo, calma y lo que hay que atender ahora, ordenado por urgencia (lógica en
// `lib/instBrief`). Es para todas las instituciones; la presentación es la del héroe compartido por los tres paneles.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DayHero, type HeroAction } from "@/components/humanix/premium/DayHero";
import { calmScore, heroTone, type HeroStat } from "@/lib/dayHero";
import { instHeadline, type InstBriefItem, type InstBriefTarget } from "@/lib/instBrief";

/** El botón de cada ítem: enlaces con rutas con tipos donde las hay; lo demás cambia de pestaña o baja a la sección. */
function Action({
  item,
  onAction,
}: {
  item: InstBriefItem;
  onAction: (target: InstBriefTarget) => void;
}) {
  const { target, label } = item.cta;
  const variant = item.priority === "critical" ? "default" : "outline";
  if (target.kind === "service")
    return (
      <Button asChild size="sm" variant={variant} className="w-full sm:w-auto">
        <Link to="/servicio/$bookingId" params={{ bookingId: target.bookingId }}>
          {label}
        </Link>
      </Button>
    );
  if (target.kind === "plans")
    return (
      <Button asChild size="sm" variant={variant} className="w-full sm:w-auto">
        <Link to="/planes">{label}</Link>
      </Button>
    );
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className="w-full sm:w-auto"
      onClick={() => onAction(target)}
    >
      {label}
    </Button>
  );
}

export function InstBriefCard({
  items,
  onAction,
  now,
  name,
  stats,
  coveragePct,
  aside,
  className,
}: {
  items: InstBriefItem[];
  onAction: (target: InstBriefTarget) => void;
  now: number;
  name?: string | null;
  stats?: HeroStat[];
  coveragePct?: number | null;
  aside?: ReactNode;
  className?: string;
}) {
  const priorities = items.map((i) => i.priority);
  const actions: HeroAction[] = items.map((item) => ({
    id: item.id,
    priority: item.priority,
    title: item.title,
    detail: item.detail,
    badge: item.badge,
    cta: <Action item={item} onAction={onAction} />,
  }));

  return (
    <DayHero
      id="inst-brief"
      eyebrow="Tu día"
      role="institution"
      now={now}
      name={name}
      headline={instHeadline(items, coveragePct ?? null).text}
      calm={calmScore(priorities)}
      tone={heroTone(priorities)}
      stats={stats}
      actions={actions}
      emptyMessage="No hay nada pendiente: tus turnos, postulaciones y contratos están al día."
      aside={aside}
      className={className}
    />
  );
}
