// Fila plegable del panel de familia: emoji, título y una línea que dice qué hay dentro. El contenido se monta la
// primera vez que se abre (así el inicio carga liviano) y se conserva al cerrar, para no perder lo escrito.
// `anchors` son los ids de las secciones que viven dentro: `scrollToId` abre la fila cuando un atajo apunta a ellas.
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function FamilyFold({
  id,
  emoji,
  title,
  hint,
  anchors = [],
  defaultOpen = false,
  children,
  className,
}: {
  id: string;
  emoji: string;
  title: string;
  hint: string;
  anchors?: string[];
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(defaultOpen);
  return (
    <details
      id={id}
      data-anchors={anchors.join(" ") || undefined}
      open={defaultOpen || undefined}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setMounted(true);
      }}
      className={cn(
        "group rounded-3xl bg-card shadow-sm ring-1 ring-border transition-shadow open:shadow-md",
        className,
      )}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-3xl p-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-2xl"
        >
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-bold leading-tight">{title}</span>
          <span className="block text-sm text-muted-foreground">{hint}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="space-y-4 px-4 pb-5 sm:px-5">{mounted ? children : null}</div>
    </details>
  );
}
