// «Tu día, resuelto»: lo que la familia debe atender ahora, ordenado por urgencia (lógica en `lib/familyBrief`).
// Es para todas las familias; con plan de pago aparecen además los avisos del informe y del presupuesto.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Info,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  briefHeadline,
  splitBrief,
  type BriefItem,
  type BriefPriority,
  type BriefTarget,
} from "@/lib/familyBrief";
import { cn } from "@/lib/utils";

const PRIORITY: Record<
  BriefPriority,
  { Icon: typeof Info; icon: string; ring: string; label: string }
> = {
  critical: {
    Icon: AlertTriangle,
    icon: "text-sos bg-sos/10",
    ring: "border-sos/40",
    label: "Urgente",
  },
  high: {
    Icon: BellRing,
    icon: "text-warn bg-warn/10",
    ring: "border-warn/30",
    label: "Importante",
  },
  medium: {
    Icon: ListChecks,
    icon: "text-trust bg-trust/10",
    ring: "border-border",
    label: "Pendiente",
  },
  low: {
    Icon: Info,
    icon: "text-muted-foreground bg-muted",
    ring: "border-border",
    label: "Para tu información",
  },
};

const HEADLINE_TONE = { alert: "text-sos", attention: "text-warn", calm: "text-ok" } as const;

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
  className,
}: {
  items: BriefItem[];
  onAction: (target: BriefTarget) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const head = briefHeadline(items);
  const { shown, hidden } = splitBrief(items, 4);
  const list = expanded ? [...shown, ...hidden] : shown;

  return (
    <Card className={cn("space-y-3 p-4 sm:p-5", className)} aria-labelledby="family-brief-title">
      <div>
        <h3 id="family-brief-title" className="font-display text-base font-semibold">
          Tu día, resuelto
        </h3>
        <p className={cn("text-sm font-semibold", HEADLINE_TONE[head.tone])}>{head.text}</p>
      </div>

      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
          No hay nada pendiente: tus servicios, propuestas y agenda están al día.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Cosas para hacer hoy">
          {list.map((item) => {
            const p = PRIORITY[item.priority];
            return (
              <li
                key={item.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between",
                  p.ring,
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      p.icon,
                    )}
                    aria-hidden="true"
                  >
                    <p.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold leading-snug">
                      <span className="sr-only">{p.label}: </span>
                      {item.title}
                      {item.premium && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-copper">
                          <Sparkles className="h-3 w-3" aria-hidden="true" /> Esencial
                        </span>
                      )}
                    </p>
                    <p className="text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
                <Action item={item} onAction={onAction} />
              </li>
            );
          })}
        </ul>
      )}

      {hidden.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            aria-hidden="true"
          />
          {expanded ? "Ver menos" : `Ver ${hidden.length} más`}
        </Button>
      )}
    </Card>
  );
}
