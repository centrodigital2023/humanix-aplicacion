import { BellRing, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOpportunityFeed } from "@/hooks/use-opportunity-feed";

/**
 * Barra «En vivo» del profesional: en lugar de contar usuarios registrados, muestra lo que sí le
 * sirve ahora mismo (turnos abiertos para él) y, si no hay nada, qué hacer al respecto.
 */
export function OpportunityPulse({ userId, onOpen }: { userId: string; onOpen: () => void }) {
  const { model, isLoading, error } = useOpportunityFeed(userId);

  if (isLoading || error || !model) return null;
  const { summary } = model;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card/60 px-4 py-2.5 text-xs">
      <span className="flex shrink-0 items-center gap-1.5 font-semibold text-ok">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
        En vivo
      </span>
      <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
      {summary.shifts > 0 ? (
        <>
          <span className="text-muted-foreground">
            <strong className="text-foreground">{summary.shifts}</strong> turnos abiertos para ti ·{" "}
            <strong className="text-foreground">{summary.hours} h</strong>
          </span>
          {summary.urgent > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-sos">
              <Flame className="h-3.5 w-3.5" aria-hidden /> {summary.urgent} urgentes hoy
            </span>
          )}
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <BellRing className="h-3.5 w-3.5" aria-hidden />
          Sin turnos abiertos ahora. Crea una alerta y te avisamos cuando aparezca uno.
        </span>
      )}
      <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onOpen}>
        {summary.shifts > 0 ? "Ver turnos" : "Crear alerta"}
      </Button>
    </div>
  );
}
