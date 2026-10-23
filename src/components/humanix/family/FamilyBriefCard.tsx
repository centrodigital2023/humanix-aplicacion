// «Tu día, resuelto»: el héroe del día de la familia — saludo, calma y lo que hay que atender ahora, ordenado por
// urgencia (lógica en `lib/familyBrief`). Es para todas las familias; con plan de pago aparecen además los avisos del
// informe y del presupuesto. La presentación es la del héroe compartido por los tres paneles (`premium/DayHero`).
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DayHero, type HeroAction } from "@/components/humanix/premium/DayHero";
import { calmScore, heroTone, type HeroStat } from "@/lib/dayHero";
import { briefHeadline, type BriefItem, type BriefTarget } from "@/lib/familyBrief";

/** El botón de cada ítem: enlaces con rutas con tipos donde las hay; lo demás baja a la sección del panel. */
function Action({ item, onAction }: { item: BriefItem; onAction: (target: BriefTarget) => void }) {
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
  if (target.kind === "search")
    return (
      <Button asChild size="sm" variant={variant} className="w-full sm:w-auto">
        <Link to="/buscar">{label}</Link>
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

export function FamilyBriefCard({
  items,
  onAction,
  now,
  name,
  stats,
  aside,
  className,
}: {
  items: BriefItem[];
  onAction: (target: BriefTarget) => void;
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
    badge: item.premium ? "Familiar" : undefined,
    cta: <Action item={item} onAction={onAction} />,
  }));

  return (
    <DayHero
      id="family-brief"
      eyebrow="Tu centro de cuidado"
      role="family"
      now={now}
      name={name}
      headline={briefHeadline(items).text}
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
