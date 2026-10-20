import { Crown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { usePlan } from "@/hooks/use-plan";
import { PLAN_CATALOG, longDateEs } from "@/lib/plans";

export function PlanStatus({ userId }: { userId: string }) {
  const plan = usePlan(userId);
  if (plan.loading)
    return (
      <div
        aria-label="Revisando tu plan"
        aria-busy="true"
        className="h-24 animate-pulse rounded-lg bg-muted"
      />
    );
  if (plan.error)
    return (
      <div role="status" className="space-y-3">
        <p>No pudimos confirmar tu plan.</p>
        <Button variant="outline" onClick={() => void plan.refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    );
  const end = plan.currentPeriodEnd ? Date.parse(plan.currentPeriodEnd) : NaN;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Crown className="h-5 w-5 text-copper" />
        <h2 className="font-semibold">Tu plan Humanix</h2>
        <PlanBadge plan={plan.plan} />
      </div>
      {plan.plan !== "free" && Number.isFinite(end) && (
        <p className="text-sm text-muted-foreground">Vigente hasta el {longDateEs(end)}</p>
      )}
      <ul className="space-y-1 text-sm">
        {PLAN_CATALOG[plan.plan].featuresLabel.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Los pagos en línea no están disponibles.</p>
      {plan.autoRenew && (
        <p role="status" className="text-sm text-muted-foreground">
          Si contrataste una renovación automática, gestiona su cancelación con el proveedor
          original. Retirar los pagos de Humanix no cancela ese acuerdo.
        </p>
      )}
    </div>
  );
}
