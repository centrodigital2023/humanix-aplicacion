// Cuánto del plan se está usando, con medidores que cambian de color al acercarse al tope, y la invitación a mejorar cuando conviene (nunca
// antes de que sea útil). El plan lo decide la base de datos (`inst_care_overview`), no la pantalla: aquí solo se cuenta.
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  isPremiumPlan,
  planName,
  thousandsEs,
  upsellFor,
  usageMeters,
  type CareOverview,
} from "@/lib/instCare";
import { cn } from "@/lib/utils";

const BAR: Record<string, string> = {
  ok: "bg-ok",
  near: "bg-warn",
  full: "bg-sos",
  locked: "bg-transparent",
};

export function PlanMeters({
  overview,
  canManagePlan,
  className,
}: {
  overview: CareOverview;
  /** Solo el dueño de la cuenta paga: el equipo ve el aviso pero no el botón. */
  canManagePlan: boolean;
  className?: string;
}) {
  const premium = isPremiumPlan(overview);
  const meters = usageMeters(overview);
  const upsell = upsellFor(overview);
  return (
    <section aria-label="Tu plan y su uso" className={cn("space-y-3", className)}>
      <Card className="rounded-2xl border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Tu plan</p>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
              premium
                ? "border-copper/40 bg-copper/10 text-copper"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {premium && <Sparkles className="h-3 w-3" aria-hidden />}
            {planName(overview.plan)}
          </span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {meters.map((m) => (
            <li key={m.key} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">{m.label}</span>
                <span
                  className={cn(
                    "tabular-nums",
                    m.state === "full" && "font-semibold text-sos",
                    m.state === "near" && "font-semibold text-warn",
                    m.state === "locked" && "text-muted-foreground",
                  )}
                >
                  {m.state === "locked" ? (
                    <Lock className="inline h-3 w-3" aria-label="No incluido en tu plan" />
                  ) : (
                    `${thousandsEs(m.used)} / ${thousandsEs(m.limit)}`
                  )}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${m.label}: ${m.message}`}
                aria-valuemin={0}
                aria-valuemax={m.limit}
                aria-valuenow={m.used}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none",
                    BAR[m.state],
                  )}
                  style={{ width: `${Math.round(m.ratio * 100)}%` }}
                />
              </div>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{m.message}</p>
            </li>
          ))}
        </ul>
      </Card>

      {upsell.show && (
        <Card
          className={cn(
            "relative overflow-hidden rounded-2xl border p-4",
            upsell.urgency === "full"
              ? "border-sos/30 bg-gradient-to-br from-sos/5 via-card to-card"
              : upsell.urgency === "near"
                ? "border-warn/30 bg-gradient-to-br from-warn/5 via-card to-card"
                : "border-copper/30 bg-gradient-to-br from-copper/5 via-card to-fuchsia-neural/5",
          )}
          data-testid="plan-upsell"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-copper" aria-hidden /> {upsell.headline}
              </p>
              <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                {upsell.perks.slice(0, 6).map((p) => (
                  <li key={p} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok" aria-hidden /> {p}
                  </li>
                ))}
              </ul>
            </div>
            {canManagePlan ? (
              <Button asChild variant="copper" size="sm" className="shrink-0">
                <Link to="/planes">
                  Conocer IPS Mejorado <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <p className="max-w-[16rem] text-xs text-muted-foreground">
                Pídele a quien administra la cuenta que mejore el plan.
              </p>
            )}
          </div>
        </Card>
      )}
    </section>
  );
}
