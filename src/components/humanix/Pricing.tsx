import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG, segmentOfRoles, type PlanKey } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { useAppUser } from "@/hooks/use-app-user";
import { computeCta, type CtaAction } from "@/lib/planCta";

const DISPLAY: { key: PlanKey; variant: "glass" | "hero" | "copper"; emoji: string }[] = [
  { key: "family_premium_monthly", variant: "hero", emoji: "🏡" },
  { key: "pro_monthly", variant: "glass", emoji: "🩺" },
  { key: "institution_monthly", variant: "copper", emoji: "🏥" },
];

export function Pricing() {
  const { user } = useAppUser({ requireAuth: false });
  const { plan: currentPlan } = usePlan(user?.id ?? null);
  const segment = segmentOfRoles(user?.roles);

  const hrefFor = (key: PlanKey, action: CtaAction): string => {
    switch (action.kind) {
      case "free":
        return user ? "/dashboard" : "/auth";
      case "login":
        return `/auth?redirect=${encodeURIComponent(action.redirectTo)}`;
      case "pay":
        return `/planes?plan=${key}`;
      default:
        return "/planes";
    }
  };

  return (
    <section id="planes" className="py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">
            Planes
          </span>
          <h2 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-5xl">
            Gratis para cuidar. <span className="text-gradient-bio">Simple para pagar.</span>
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Familias y profesionales usan Humanix sin mensualidad. Los pagos van por Bre-B, desde la
            app de tu banco.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {DISPLAY.map((d) => {
            const p = PLAN_CATALOG[d.key];
            const cta = computeCta(d.key, { userId: user?.id ?? null, currentPlan, segment });
            const href = hrefFor(d.key, cta.action);
            return (
              <div
                key={p.key}
                className={`relative flex flex-col rounded-3xl border p-8 ${
                  p.highlight
                    ? "border-biosensor/40 bg-card shadow-[var(--shadow-glow-bio)]"
                    : "border-border bg-card shadow-[var(--shadow-card)]"
                }`}
              >
                <p aria-hidden="true" className="text-4xl">
                  {d.emoji}
                </p>
                <h3 className="mt-2 font-display text-xl font-bold">{p.label}</h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold">{p.priceLabel}</span>
                  <span className="text-sm text-muted-foreground">{p.priceNote}</span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{p.audience}</p>

                <ul className="mt-6 flex-1 space-y-3">
                  {p.featuresLabel.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-biosensor"
                        aria-hidden="true"
                      />
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
        <p className="mt-8 text-center text-sm text-muted-foreground">
          <a href="/planes" className="font-semibold text-foreground underline underline-offset-2">
            Ver todos los detalles y la comisión por turno
          </a>
        </p>
      </div>
    </section>
  );
}
