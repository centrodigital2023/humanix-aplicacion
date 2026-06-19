// UI primitives for plan-based feature gating.
//
// Example:
//   <PlanGate feature="whatsapp_contact" fallback={<UpgradeCta min="essential_monthly" />}>
//     <WhatsAppButton ... />
//   </PlanGate>
import { Link } from "@tanstack/react-router";
import { Lock, Sparkles, Crown, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURE_MIN_PLAN, PLAN_CATALOG, type PlanFeature, type PlanKey } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { useAppUser } from "@/hooks/use-app-user";

type GateProps = {
  feature?: PlanFeature;
  min?: PlanKey;
  children: React.ReactNode;
  /** What to render when the user lacks the required plan. Defaults to <UpgradeCta />. */
  fallback?: React.ReactNode;
};

export function PlanGate({ feature, min, children, fallback }: GateProps) {
  const { user } = useAppUser({ requireAuth: false });
  const { can, has, loading } = usePlan(user?.id ?? null);
  if (loading) return null;

  const allowed = feature ? can(feature) : min ? has(min) : true;
  if (allowed) return <>{children}</>;

  if (fallback !== undefined) return <>{fallback}</>;
  const minPlan: PlanKey = min ?? (feature ? FEATURE_MIN_PLAN[feature] : "essential_monthly");
  return <UpgradeCta min={minPlan} />;
}

const ICON_BY_PLAN: Record<PlanKey, typeof Sparkles> = {
  free: Lock,
  essential_monthly: Sparkles,
  pro_monthly: Crown,
  institution_monthly: Building2,
};

export function UpgradeCta({
  min,
  compact = false,
  title,
  description,
}: {
  min: PlanKey;
  compact?: boolean;
  title?: string;
  description?: string;
}) {
  const def = PLAN_CATALOG[min];
  const Icon = ICON_BY_PLAN[min];
  if (compact) {
    return (
      <Link
        to="/planes"
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-copper/40 bg-copper/5 text-copper hover:bg-copper/10 transition"
      >
        <Icon className="h-3.5 w-3.5" />
        Desbloquear con {def.label} · {def.priceLabel}
        {def.priceNote && <span className="text-[10px] opacity-70">{def.priceNote}</span>}
      </Link>
    );
  }
  return (
    <div className="rounded-2xl border border-dashed border-copper/40 bg-copper/5 p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-copper/15 text-copper flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-copper font-semibold">
            Plan requerido: {def.label}
          </p>
          <p className="font-display text-base font-bold mt-0.5">
            {title ?? `Esta función requiere ${def.label}.`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {description ??
              `Activa ${def.label} (${def.priceLabel}${def.priceNote}) para desbloquearla. Sin permanencia, cancela cuando quieras.`}
          </p>
          <Button asChild size="sm" variant="copper" className="mt-3">
            <Link to="/planes">Ver planes</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Small inline badge showing current plan (for dashboards). */
export function PlanBadge({ plan }: { plan: PlanKey }) {
  const def = PLAN_CATALOG[plan];
  const Icon = ICON_BY_PLAN[plan];
  const styles: Record<PlanKey, string> = {
    free: "border-border bg-muted text-muted-foreground",
    essential_monthly: "border-copper/40 bg-copper/10 text-copper",
    pro_monthly: "border-biosensor/40 bg-biosensor/10 text-biosensor",
    institution_monthly: "border-fuchsia-neural/40 bg-fuchsia-neural/10 text-fuchsia-neural",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${styles[plan]}`}
    >
      <Icon className="h-3 w-3" />
      {def.label}
    </span>
  );
}
