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
};

export type CtaAction =
  | { kind: "current" } // Disabled — already on this plan and not cancelling
  | { kind: "reactivate" } // On this paid plan but cancellation pending → re-checkout
  | { kind: "login"; redirectTo: string } // Send to /auth, resume on /planes
  | { kind: "checkout" } // Trigger MP checkout for this plan
  | { kind: "free" } // Free CTA: dashboard if logged in, /auth otherwise
  | { kind: "sales" }; // Institution → mailto

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

  // Institution is always a sales conversation, regardless of plan state.
  if (target === "institution_monthly") {
    if (isCurrent && !ctx.cancelAtPeriodEnd) {
      return { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
    }
    return { label: "Hablar con ventas", action: { kind: "sales" }, disabled: false };
  }

  // Free card
  if (target === "free") {
    if (!isLoggedIn) {
      return { label: "Crear cuenta gratis", action: { kind: "free" }, disabled: false };
    }
    if (isCurrent) {
      return { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
    }
    // User has a paid plan — going to Free means cancelling. We surface the
    // dashboard where the cancel flow lives instead of pretending we can
    // "subscribe" to Free.
    return { label: "Bajar a Free", action: { kind: "free" }, disabled: false };
  }

  // Paid plan cards (essential / pro)
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
    if (ctx.cancelAtPeriodEnd) {
      return {
        label: "Reactivar renovación",
        action: { kind: "reactivate" },
        disabled: false,
      };
    }
    return { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
  }

  if (def.tier > currentTier) {
    return { label: `Mejorar a ${def.label}`, action: { kind: "checkout" }, disabled: false };
  }
  return { label: `Cambiar a ${def.label}`, action: { kind: "checkout" }, disabled: false };
}
