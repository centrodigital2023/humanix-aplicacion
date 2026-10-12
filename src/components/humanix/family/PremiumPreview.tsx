// Lo que ve quien aún no tiene el plan Esencial en una herramienta premium: qué es, qué recibiría y un dato real de
// su propia cuenta (sin revelar el análisis). El botón lleva a /planes: el pago se hace solo en la página web.
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { UpgradeCta } from "@/components/humanix/PlanGate";
import { PLAN_CATALOG } from "@/lib/plans";

export function PremiumPreview({
  icon,
  title,
  description,
  bullets,
  teaser,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  bullets: string[];
  /** Un dato de la cuenta de la persona (por ejemplo «6 servicios en 30 días»). */
  teaser?: string | null;
}) {
  return (
    <Card className="space-y-3 p-4 sm:p-5" aria-label={`${title} (plan Esencial)`}>
      <div>
        <h3 className="flex items-center gap-2 font-display text-base font-semibold">
          {icon}
          {title}
          <span className="inline-flex items-center gap-1 rounded-full border border-copper/40 bg-copper/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-copper">
            <Lock className="h-3 w-3" aria-hidden="true" /> Esencial
          </span>
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {teaser && (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm">
          {teaser}
        </p>
      )}
      <ul className="space-y-1.5 text-sm">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-copper"
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <UpgradeCta
        min="essential_monthly"
        title="Actívalo con el plan Esencial"
        description={`${PLAN_CATALOG.essential_monthly.priceLabel}${PLAN_CATALOG.essential_monthly.priceNote}, sin permanencia. Incluye también la historia de cuidado exportable.`}
      />
    </Card>
  );
}
