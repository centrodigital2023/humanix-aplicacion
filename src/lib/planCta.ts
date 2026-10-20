// Pure CTA logic for plan cards. Extracted so it can be unit-tested without
// rendering the route or mocking TanStack Router. Used by both
// src/routes/planes.tsx and src/components/humanix/Pricing.tsx.
import { PLAN_CATALOG, type PlanKey, tierOf } from "@/lib/plans";

export type CtaContext = {
  /** Authenticated user id (null if logged out). */
  userId: string | null | undefined;
  /** Current plan key from usePlan. */
  currentPlan: PlanKey;
  /** Whether the active subscription has been scheduled to cancel. */
  cancelAtPeriodEnd: boolean;
  /**
   * Quedan pocos días de un plan SIN renovación automática (`planValidity().renewSoon`): la tarjeta del plan actual
   * invita a suscribirse de nuevo. Con renovación automática nunca es `true`.
   */
  renewSoon?: boolean;
};

export type CtaAction =
  | { kind: "current" } // Disabled — already on this plan and not cancelling
  | { kind: "reactivate" } // On this paid plan but cancellation pending → re-checkout
  | { kind: "login"; redirectTo: string } // Send to /auth, resume on /planes
  | { kind: "checkout" } // Pagar el plan en /pagar
  | { kind: "free" } // Free CTA: dashboard if logged in, /auth otherwise
  | { kind: "later" } // Plan menor con uno vigente: se elige cuando termine (no se pierde lo pagado)
  | { kind: "sales" }; // Conversación con ventas (hoy ningún plan la usa)

export type CtaPlan = {
  label: string;
  action: CtaAction;
  disabled: boolean;
};

export function computeCta(target: PlanKey, ctx: CtaContext): CtaPlan {
  const def = PLAN_CATALOG[target];
  const currentTier = tierOf(ctx.currentPlan);
  const isLoggedIn = Boolean(ctx.userId);
  const isCurrent = isLoggedIn && ctx.currentPlan === target;

  // Free card
  if (target === "free") {
    if (!isLoggedIn) {
      return { label: "Crear cuenta gratis", action: { kind: "free" }, disabled: false };
    }
    if (isCurrent) {
      return { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
    }
    // Con un plan de pago no hay nada que «cancelar»: cada pago es un mes y, si no se renueva, el plan pasa solo
    // a Free al vencer. Decirlo así es más honesto que ofrecer un botón que no hace nada.
    return { label: "Al terminar tu plan", action: { kind: "later" }, disabled: true };
  }

  // Planes de pago (Esencial, Pro e IPS Mejorado): se pagan en /pagar, dentro de Humanix.
  if (!isLoggedIn) {
    return {
      label: `Empezar con ${def.label}`,
      action: {
        kind: "login",
        redirectTo: `/planes?plan=${target}`,
      },
      disabled: false,
    };
  }

  if (isCurrent) {
    if (ctx.cancelAtPeriodEnd || ctx.renewSoon) {
      // Suscribirse de nuevo suma un mes desde el vencimiento (no se pierden días). Ver planBilling.subscriptionAfterApproval.
      return { label: "Renovar", action: { kind: "reactivate" }, disabled: false };
    }
    return { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
  }

  if (def.tier > currentTier) {
    return { label: `Mejorar a ${def.label}`, action: { kind: "checkout" }, disabled: false };
  }
  if (currentTier > 0) {
    // Bajar de plan con uno vigente lo bloquea también el servidor (planBilling.checkoutDecision).
    return { label: "Al terminar tu plan", action: { kind: "later" }, disabled: true };
  }
  return { label: `Cambiar a ${def.label}`, action: { kind: "checkout" }, disabled: false };
}
