// Botón de cada tarjeta de plan (lógica pura, probada en `planCta.test.ts`). La usan /planes, la portada y PlanStrip.
//
// Desde nov 2026 solo se paga el plan Institucional (anual, por Bre-B). Familia y Profesional son gratis: su botón
// lleva a crear la cuenta o al panel.
import { PLAN_CATALOG, type PlanKey, type PlanSegment } from "@/lib/plans";

export type CtaContext = {
  /** Authenticated user id (null if logged out). */
  userId: string | null | undefined;
  /** Nivel actual (usePlan). */
  currentPlan: PlanKey;
  /** Perfil de la cuenta (segmentOfRoles). */
  segment?: PlanSegment | null;
  /** Quedan 30 días o menos del plan institucional (`planValidity().renewSoon`). */
  renewSoon?: boolean;
};

export type CtaAction =
  | { kind: "current" } // Ya lo tiene
  | { kind: "login"; redirectTo: string } // A /auth y de vuelta a /planes
  | { kind: "pay" } // Pagar el plan institucional con Bre-B
  | { kind: "free" } // Cuenta gratis: al panel si hay sesión, a /auth si no
  | { kind: "other_profile" }; // El plan es de otro perfil (p. ej. una familia mirando el Institucional)

export type CtaPlan = { label: string; action: CtaAction; disabled: boolean };

export function computeCta(target: PlanKey, ctx: CtaContext): CtaPlan {
  const def = PLAN_CATALOG[target];
  const isLoggedIn = Boolean(ctx.userId);

  if (target !== "institution_monthly") {
    if (!isLoggedIn)
      return { label: "Crear cuenta gratis", action: { kind: "free" }, disabled: false };
    if (ctx.currentPlan === target)
      return { label: "Ya lo tienes 💚", action: { kind: "current" }, disabled: true };
    return { label: "Ir a mi panel", action: { kind: "free" }, disabled: false };
  }

  if (!isLoggedIn) {
    return {
      label: `Empezar con ${def.label}`,
      action: { kind: "login", redirectTo: `/planes?plan=${target}` },
      disabled: false,
    };
  }
  if (ctx.segment && ctx.segment !== "institution") {
    return { label: "Para IPS y clínicas", action: { kind: "other_profile" }, disabled: true };
  }
  if (ctx.currentPlan === "institution_monthly") {
    return ctx.renewSoon
      ? { label: "Renovar el año", action: { kind: "pay" }, disabled: false }
      : { label: "Tu plan actual", action: { kind: "current" }, disabled: true };
  }
  return { label: "Activar con Bre-B", action: { kind: "pay" }, disabled: false };
}
