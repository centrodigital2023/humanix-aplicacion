// Tarjeta «Tu plan Humanix» de los paneles.
//
// Cómo se cobra (ver `supabase/functions/_shared/planBilling.ts`): cada plan es una suscripción de Mercado Pago que
// cobra un mes cada mes, en la web. La tarjeta dice «se renueva el …» y ofrece cancelar la renovación (el plan sigue
// vigente hasta el vencimiento). Un plan sin renovación automática (pago único antiguo o renovación cancelada) dice
// «vigente hasta», recuerda renovar en los últimos días y ofrece volver a suscribirse.
//  - Suscribirse al mismo plan con uno vigente suma un mes desde el vencimiento: no se pierde ningún día.
//  - Subir de plan convierte los días que quedaban al valor del plan nuevo.
//  - Con un plan vigente no se baja de plan (lo bloquea también el servidor); se elige cuando termine.
//  - Si no se pudo leer el plan, no se ofrece pagar: podría ser un cobro repetido.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { usePlan } from "@/hooks/use-plan";
import { startCheckout } from "@/lib/checkout";
import { cancelMercadoPagoRenewal } from "@/lib/payments.functions";
import { PLAN_CATALOG, COP, planValidity, tierOf, type PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";

const PAID_PLANS: PlanKey[] = ["essential_monthly", "pro_monthly", "institution_monthly"];

/** Panel al que vuelve quien paga: el que tiene abierto (el servidor lo confirma contra su rol). */
function currentPanel(): string | null {
  if (typeof window === "undefined") return null;
  const p = window.location.pathname;
  return p.startsWith("/dashboard/") ? p.split("/").slice(0, 3).join("/") : null;
}

export function MercadoPagoSubscription({
  userId,
  defaultPlan = "pro_monthly",
  plans = PAID_PLANS,
}: {
  userId: string;
  defaultPlan?: PlanKey;
  /** Planes a mostrar (cada perfil ve solo los suyos). */
  plans?: PlanKey[];
}) {
  const plan = usePlan(userId);
  const cancelRenewal = useServerFn(cancelMercadoPagoRenewal);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selected, setSelected] = useState<PlanKey>(defaultPlan);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (plan.plan !== "free") setSelected(plan.plan);
  }, [plan.plan]);

  // La vigencia se recalcula cada hora (sin consultas: solo el reloj).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 3_600_000);
    return () => window.clearInterval(id);
  }, []);

  if (plan.loading) {
    return (
      <div
        className="h-40 w-full animate-pulse rounded-2xl bg-muted/60"
        aria-busy="true"
        aria-label="Revisando tu plan"
      />
    );
  }

  if (plan.error) {
    return (
      <div className="rounded-2xl border border-border bg-card/95 p-6 space-y-3" role="status">
        <p className="font-semibold">No pudimos confirmar tu plan ahora mismo.</p>
        <p className="text-sm text-muted-foreground">
          Tus beneficios no cambian por esto. Revisa tu conexión y vuelve a intentarlo.
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void plan.refresh()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </Button>
      </div>
    );
  }

  const isActive = plan.plan !== "free";
  const currentDef = PLAN_CATALOG[plan.plan];
  const validity = planValidity(plan, now);
  const currentTier = tierOf(plan.plan);
  const selectedDef = PLAN_CATALOG[selected];
  const isRenew = isActive && selected === plan.plan;
  const autoRenewing = isRenew && plan.autoRenew;
  const isUpgrade = isActive && selectedDef.tier > currentTier;
  const isLater = isActive && selectedDef.tier < currentTier;

  const pay = async () => {
    setBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const r = await startCheckout(supabase.functions.invoke.bind(supabase.functions), {
      plan: selected,
      email: sess.session?.user.email,
      returnTo: currentPanel(),
    });
    if (r.ok) {
      window.location.href = r.url;
      return;
    }
    toast(r.message);
    setBusy(false);
  };

  const stopRenewal = async () => {
    if (
      !window.confirm("¿Cancelar la renovación automática? Conservas tu plan hasta el vencimiento.")
    )
      return;
    setCancelling(true);
    try {
      const r = await cancelRenewal();
      toast(
        r.ok
          ? "Listo: tu plan ya no se cobrará el próximo mes. Sigue activo hasta el vencimiento."
          : "No encontramos una renovación automática activa.",
      );
      await plan.refresh();
    } catch {
      toast("No pudimos cancelar la renovación ahora. Inténtalo de nuevo en un momento.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/95 p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Crown className="h-5 w-5 text-copper" aria-hidden="true" />
        <h2 className="font-semibold">Tu plan Humanix</h2>
        <PlanBadge plan={plan.plan} />
      </div>

      {isActive ? (
        <>
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{currentDef.label}</strong> ·{" "}
            {plan.amount != null && plan.amount > 0 ? COP(plan.amount) : currentDef.priceLabel}
            {currentDef.priceNote}
          </p>
          {validity.line && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              {validity.line}
              {validity.daysLeft !== null && (
                <span>
                  {" "}
                  · {validity.daysLeft === 1 ? "queda 1 día" : `quedan ${validity.daysLeft} días`}
                </span>
              )}
            </p>
          )}
          {validity.renewSoon && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-copper/30 bg-copper/5 p-3 text-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
              <span>
                Tu plan termina pronto. Si renuevas ahora sumamos un mes{" "}
                <strong>desde el vencimiento</strong>: no pierdes ningún día.
              </span>
            </div>
          )}
          <ul className="mt-4 space-y-1.5 text-sm">
            {currentDef.featuresLabel.map((f) => (
              <li key={f} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Estás en el plan <strong className="text-foreground">Free</strong>. Elige un plan y
          desbloquea todo lo premium: se cobra cada mes y cancelas cuando quieras.
        </p>
      )}

      <div
        className={cn(
          "mt-5 grid gap-2",
          plans.length >= 3 ? "sm:grid-cols-3" : plans.length === 2 ? "sm:grid-cols-2" : "",
        )}
        role="radiogroup"
        aria-label="Planes disponibles"
      >
        {plans.map((key) => {
          const def = PLAN_CATALOG[key];
          const isCurrent = plan.plan === key;
          const later = isActive && def.tier < currentTier;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected === key}
              onClick={() => setSelected(key)}
              className={cn(
                "rounded-xl border p-3 text-left transition motion-safe:active:scale-[0.98]",
                selected === key
                  ? "border-foreground bg-foreground/5"
                  : "border-border hover:border-foreground/30",
                later && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-semibold">{def.label}</p>
                {isCurrent && (
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-ok">
                    Actual
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm font-bold">{def.priceLabel}</p>
              <p className="text-[10px] text-muted-foreground">
                {later ? "Al terminar tu plan" : def.priceNote}
              </p>
            </button>
          );
        })}
      </div>

      <p className="mt-3 min-h-[1.25rem] text-xs text-muted-foreground" aria-live="polite">
        {isLater
          ? `Tu plan ${currentDef.label} sigue ${validity.line ? validity.line.toLowerCase() : "vigente"}. Cuando termine podrás pasar a ${selectedDef.label}.`
          : isUpgrade
            ? "Los días que te quedan se convierten a tu nuevo plan: no pierdes lo que ya pagaste."
            : autoRenewing
              ? "Tu plan se cobra solo cada mes. Si cancelas la renovación, lo conservas hasta el vencimiento."
              : isRenew
                ? "Al suscribirte sumamos un mes desde tu vencimiento y después se renueva solo."
                : null}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        {autoRenewing ? (
          <Button
            onClick={() => void stopRenewal()}
            disabled={cancelling}
            variant="outline"
            className="min-w-[180px] flex-1"
          >
            {cancelling && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            Cancelar renovación automática
          </Button>
        ) : (
          <Button
            onClick={() => void pay()}
            disabled={busy || isLater}
            variant="hero"
            className="min-w-[180px] flex-1"
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {!isActive
              ? `Activar ${selectedDef.label}`
              : isRenew
                ? "Activar renovación mensual"
                : isUpgrade
                  ? `Mejorar a ${selectedDef.label}`
                  : "Disponible al terminar tu plan"}
            {!isLater && <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden="true" />}
          </Button>
        )}
      </div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Pago seguro en la web con Mercado Pago · Cobro mensual · Cancela cuando quieras
      </p>
    </div>
  );
}
