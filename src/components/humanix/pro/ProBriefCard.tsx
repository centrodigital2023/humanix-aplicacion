// «Tu día» del profesional: saludo, calma y lo que hay que atender ahora, ordenado por urgencia (lógica en
// `lib/proBrief`). Es para todos los profesionales; la presentación es la del héroe compartido por los tres paneles.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DayHero, type HeroAction } from "@/components/humanix/premium/DayHero";
import { calmScore, heroTone, type HeroStat } from "@/lib/dayHero";
import { proHeadline, type ProBriefItem, type ProBriefTarget } from "@/lib/proBrief";

/** El botón de cada ítem: enlaces con rutas con tipos donde las hay; lo demás cambia de pestaña o baja a la sección. */
function Action({
  item,
  onAction,
}: {
  item: ProBriefItem;
  onAction: (target: ProBriefTarget) => void;
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

export function ProBriefCard({
  items,
  onAction,
  now,
  name,
  stats,
  aside,
  className,
}: {
  items: ProBriefItem[];
  onAction: (target: ProBriefTarget) => void;
  now: number;
  name?: string | null;
  stats?: HeroStat[];
  aside?: ReactNode;
  className?: string;
}) {
  const priorities = items.map((i) => i.priority);
  const actions: HeroAction[] = items.map((item) => ({
    id: item.id,
    priority: item.priority,
    title: item.title,
    detail: item.detail,
    cta: <Action item={item} onAction={onAction} />,
  }));

  return (
    <DayHero
      id="pro-brief"
      eyebrow="Tu día"
      role="professional"
      now={now}
      name={name}
      headline={proHeadline(items).text}
      calm={calmScore(priorities)}
      tone={heroTone(priorities)}
      stats={stats}
      actions={actions}
      emptyMessage="No hay nada pendiente: tus servicios, propuestas y agenda están al día."
      aside={aside}
      className={className}
    />
  );
}
