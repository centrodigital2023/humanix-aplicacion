// Subscription manager used inside dashboards. Replaces the old single-tier
// (Pro only) card. Lets the user:
//   • View current plan status + next renewal
//   • Upgrade / downgrade between Essential / Pro / Institution
//   • Cancel at period end (via RPC cancel_my_subscription) or resume
import { useEffect, useState } from "react";
import {
  CreditCard,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Crown,
  AlertTriangle,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PLAN_CATALOG, type PlanKey, COP } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { PlanBadge } from "@/components/humanix/PlanGate";

const PAID_PLANS: PlanKey[] = ["essential_monthly", "pro_monthly", "institution_monthly"];

export function MercadoPagoSubscription({
  userId,
  defaultPlan = "pro_monthly",
}: {
  userId: string;
  defaultPlan?: PlanKey;
}) {
  const plan = usePlan(userId);
  const [busy, setBusy] = useState<PlanKey | "cancel" | "resume" | null>(null);
  const [selected, setSelected] = useState<PlanKey>(defaultPlan);

  useEffect(() => {
    if (plan.plan !== "free") setSelected(plan.plan);
  }, [plan.plan]);

  const subscribe = async (key: PlanKey) => {
    if (key === "institution_monthly") {
      const msg = encodeURIComponent(
        "Hola Humanix 👋, quiero información del Plan Institución (IPS).",
      );
      window.open(`https://wa.me/573147444715?text=${msg}`, "_blank", "noopener,noreferrer");
      return;
    }
    setBusy(key);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const email = sess.session?.user.email;
      const def = PLAN_CATALOG[key];
      const { data, error } = await supabase.functions.invoke("mp-create-subscription", {
        body: { plan: key, amount: def.amountCOP, email },
      });
      if (error) throw error;
      const url =
        (data as { init_point?: string; sandbox_init_point?: string })?.init_point ??
        (data as { sandbox_init_point?: string })?.sandbox_init_point;
      if (!url) throw new Error("No se obtuvo URL de pago");
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error con Mercado Pago");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (
      !confirm(
        "¿Cancelar tu suscripción al final del período actual? Mantienes el plan hasta entonces.",
      )
    ) {
      return;
    }
    setBusy("cancel");
    try {
      const { error } = await supabase.rpc("cancel_my_subscription" as never);
      if (error) throw error;
      toast.success("Cancelación programada. Sigues con el plan hasta el fin del período.");
      await plan.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cancelar");
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    setBusy("resume");
    try {
      const { error } = await supabase.rpc("resume_my_subscription" as never);
      if (error) throw error;
      toast.success("¡Listo! Reactivamos la renovación automática.");
      await plan.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reactivar");
    } finally {
      setBusy(null);
    }
  };

  if (plan.loading) {
    return (
      <div className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando plan…
      </div>
    );
  }

  const isActive = plan.plan !== "free";
  const currentDef = PLAN_CATALOG[plan.plan];

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Crown className="h-5 w-5 text-fuchsia-neural" />
        <h2 className="font-semibold">Tu plan Humanix</h2>
        <PlanBadge plan={plan.plan} />
        {plan.cancelAtPeriodEnd && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
            <AlertTriangle className="h-3 w-3" /> Cancela al terminar período
          </span>
        )}
      </div>

      {isActive ? (
        <>
          <p className="text-sm text-muted-foreground">
            Plan activo: <strong>{currentDef.label}</strong> ·{" "}
            {plan.amount != null ? COP(plan.amount) : currentDef.priceLabel}
            {currentDef.priceNote}
          </p>
          {plan.currentPeriodEnd && (
            <p className="text-xs text-muted-foreground mt-1">
              {plan.cancelAtPeriodEnd ? "Termina" : "Próxima renovación"}:{" "}
              {new Date(plan.currentPeriodEnd).toLocaleDateString("es-CO")}
            </p>
          )}
          <ul className="mt-4 space-y-1.5 text-sm">
            {currentDef.featuresLabel.map((f) => (
              <li key={f} className="flex gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Estás en el plan <strong>Free</strong>. Desbloquea funciones premium eligiendo un plan.
        </p>
      )}

      <div className="mt-5 grid sm:grid-cols-3 gap-2">
        {PAID_PLANS.map((key) => {
          const def = PLAN_CATALOG[key];
          const isCurrent = plan.plan === key;
          const isSelected = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={`text-left p-3 rounded-xl border transition ${
                isSelected
                  ? "border-foreground bg-foreground/5"
                  : "border-border hover:border-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-semibold">{def.label}</p>
                {isCurrent && (
                  <span className="text-[9px] uppercase tracking-wider text-emerald-600 font-semibold">
                    Actual
                  </span>
                )}
              </div>
              <p className="text-sm font-bold mt-0.5">{def.priceLabel}</p>
              <p className="text-[10px] text-muted-foreground">{def.priceNote}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => subscribe(selected)}
          disabled={busy !== null || (selected === plan.plan && !plan.cancelAtPeriodEnd)}
          variant="hero"
          className="flex-1 min-w-[180px]"
        >
          {busy === selected ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4 mr-1.5" />
          )}
          {selected === "institution_monthly"
            ? "Hablar con ventas"
            : plan.plan === "free"
              ? `Activar ${PLAN_CATALOG[selected].label}`
              : selected === plan.plan
                ? "Renovar ahora"
                : `Cambiar a ${PLAN_CATALOG[selected].label}`}
          {selected !== "institution_monthly" && <ExternalLink className="h-3 w-3 ml-1.5" />}
        </Button>

        {isActive && !plan.cancelAtPeriodEnd && (
          <Button
            onClick={cancel}
            disabled={busy !== null}
            variant="outline"
            className="text-destructive hover:text-destructive"
          >
            {busy === "cancel" ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4 mr-1.5" />
            )}
            Cancelar
          </Button>
        )}
        {isActive && plan.cancelAtPeriodEnd && (
          <Button onClick={resume} disabled={busy !== null} variant="outline">
            {busy === "resume" ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1.5" />
            )}
            Reactivar renovación
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 text-center">
        Pago seguro · Tarjeta, PSE, Nequi, Daviplata, Bancolombia · Sin permanencia
      </p>
    </div>
  );
}
