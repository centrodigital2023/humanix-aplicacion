// Plan Institucional anual: dos tamaños de sede, un solo pago al año por Bre-B. Activo → vigencia y renovación.
// El precio y el plan los pone el servidor (`payInstitutionPlan`); el plan lo activa solo el aviso de pago.
import { useState } from "react";
import { Building2, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlan } from "@/hooks/use-plan";
import { COP, INSTITUTION_PLANS, type InstitutionSize } from "@/lib/commissionMatrix";
import { payInstitutionPlan } from "@/lib/payments.functions";
import { planValidity } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { PaySheet } from "./PaySheet";

const SIZES: InstitutionSize[] = ["small", "large"];

export function InstitutionPlanCard({ userId }: { userId: string }) {
  const plan = usePlan(userId);
  const [size, setSize] = useState<InstitutionSize>(plan.institutionSize ?? "small");
  const [open, setOpen] = useState(false);
  const active = plan.plan === "institution_monthly";
  const validity = planValidity(plan, Date.now());
  const chosen = INSTITUTION_PLANS[size];

  return (
    <section
      aria-label="Plan Institucional"
      className="overflow-hidden rounded-3xl border border-border bg-card"
    >
      <div className="bg-gradient-to-br from-trust/10 to-fuchsia-neural/10 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Building2 className="h-4 w-4" aria-hidden="true" /> Plan Institucional
        </p>
        {active ? (
          <>
            <p className="mt-2 flex items-center gap-2 font-display text-2xl font-bold">
              <CheckCircle2 className="h-6 w-6 text-biosensor" aria-hidden="true" /> Activo
              {plan.institutionSize && (
                <span className="text-base font-medium text-muted-foreground">
                  · {INSTITUTION_PLANS[plan.institutionSize].label}
                </span>
              )}
            </p>
            {validity.line && <p className="text-sm text-muted-foreground">{validity.line}</p>}
          </>
        ) : (
          <p className="mt-2 text-base">
            Todo el centro de gestión, agenda inteligente y monitoreo a escala. Un pago al año.
          </p>
        )}
      </div>

      {(!active || validity.renewSoon) && (
        <div className="space-y-4 p-5">
          <div
            role="radiogroup"
            aria-label="Tamaño de la sede"
            className="grid gap-2 sm:grid-cols-2"
          >
            {SIZES.map((s) => {
              const p = INSTITUTION_PLANS[s];
              const on = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSize(s)}
                  className={cn(
                    "rounded-2xl border-2 p-4 text-left transition",
                    on
                      ? "border-biosensor bg-biosensor/10"
                      : "border-border hover:border-biosensor/40",
                  )}
                >
                  <p className="font-semibold">{p.label}</p>
                  <p className="font-display text-2xl font-bold">
                    {COP(p.monthlyCOP)}
                    <span className="text-sm font-medium text-muted-foreground">/mes</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {COP(p.annualCOP)} al año · comisión {p.pct} % al profesional
                  </p>
                </button>
              );
            })}
          </div>
          <Button
            size="lg"
            className="h-14 w-full rounded-2xl text-base font-bold"
            onClick={() => setOpen(true)}
            disabled={plan.error}
          >
            <Zap className="mr-2 h-5 w-5" aria-hidden="true" />
            {active ? "Renovar" : "Activar"} · {COP(chosen.annualCOP)} con Bre-B
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Un solo pago al año, desde la app del banco de la institución. Sin cobros automáticos.
          </p>
        </div>
      )}

      <PaySheet
        open={open}
        onOpenChange={setOpen}
        title="Plan Institucional"
        subtitle={`${chosen.label} · 12 meses`}
        start={() => payInstitutionPlan({ data: { size } })}
        paidMessage="Tu plan queda activo por un año. ¡Bienvenidos!"
        onPaid={() => void plan.refresh()}
      />
    </section>
  );
}
