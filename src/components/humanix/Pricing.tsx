import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { useAppUser } from "@/hooks/use-app-user";
import { computeCta, type CtaAction } from "@/lib/planCta";

const DISPLAY: { key: PlanKey; variant: "glass" | "hero" | "copper" }[] = [
  { key: "free", variant: "glass" },
  { key: "essential_monthly", variant: "hero" },
  { key: "pro_monthly", variant: "glass" },
  { key: "institution_monthly", variant: "copper" },
];

export function Pricing() {
  const { user } = useAppUser({ requireAuth: false });
  const { plan: currentPlan, cancelAtPeriodEnd } = usePlan(user?.id ?? null);

  const hrefFor = (key: PlanKey, action: CtaAction): string => {
    switch (action.kind) {
      case "sales":
        return "mailto:hola@humanix.lat?subject=Plan Institución Humanix (IPS)";
      case "free":
        return user ? "/dashboard" : "/auth";
      case "login":
        return `/auth?redirect=${encodeURIComponent(action.redirectTo)}`;
      case "checkout":
      case "reactivate":
        return `/planes?plan=${key}`;
      case "current":
      default:
        return "/planes";
    }
  };

  return (
    <section id="planes" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-copper font-semibold">
            Planes
          </span>
          <h2 className="mt-3 font-display text-3xl sm:text-5xl font-bold leading-tight">
            Un plan para cada <span className="text-gradient-bio">historia humana</span>.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Pagos en pesos colombianos. Sin permanencia. Cancela cuando quieras.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {DISPLAY.map((d) => {
            const p = PLAN_CATALOG[d.key];
            const cta = computeCta(d.key, {
              userId: user?.id ?? null,
              currentPlan,
              cancelAtPeriodEnd,
            });
            const href = hrefFor(d.key, cta.action);
            return (
            <div
              key={p.key}
              className={`relative rounded-3xl border p-8 flex flex-col ${
                p.highlight
                  ? "border-biosensor/40 bg-card shadow-[var(--shadow-glow-bio)]"
                  : "border-border bg-card shadow-[var(--shadow-card)]"
              }`}
            >
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-biosensor text-biosensor-foreground text-xs font-semibold">
                  Más elegido
                </div>
              )}
              <h3 className="font-display text-xl font-bold">{p.label}</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold">{p.priceLabel}</span>
                <span className="text-sm text-muted-foreground">{p.priceNote}</span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{p.audience}</p>

              <ul className="mt-6 space-y-3 flex-1">
                {p.featuresLabel.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <Check className="h-4 w-4 text-biosensor mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Button
                variant={d.variant}
                size="lg"
                className="mt-8 w-full"
                disabled={cta.disabled}
                asChild={!cta.disabled}
              >
                {cta.disabled ? <span>{cta.label}</span> : <a href={href}>{cta.label}</a>}
              </Button>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
