/**
 * Flujo de las tarjetas de plan (/planes): qué pasa al tocar cada una. Replica el `choose()` de
 * `src/routes/planes.tsx` alrededor de `computeCta`, sin montar el router.
 *  - pagar, mejorar o renovar → /pagar (dentro de Humanix) con el plan
 *  - sin sesión → /auth y vuelve al plan
 *  - plan actual → nada
 */
import { describe, expect, it } from "vitest";
import { computeCta, type CtaContext } from "./planCta";
import { payPageHref } from "./checkout";
import type { PlanKey } from "./plans";

type FlowResult = { kind: "navigate"; href: string } | { kind: "noop"; reason: string };

function runChoose(target: PlanKey, ctx: CtaContext): FlowResult {
  const cta = computeCta(target, ctx);
  if (cta.action.kind === "free")
    return { kind: "navigate", href: ctx.userId ? "/dashboard" : "/auth" };
  if (cta.action.kind === "login") {
    return {
      kind: "navigate",
      href: `/auth?redirect=${encodeURIComponent(cta.action.redirectTo)}`,
    };
  }
  if (cta.action.kind === "current" || cta.action.kind === "later" || cta.action.kind === "sales") {
    return { kind: "noop", reason: cta.action.kind };
  }
  return { kind: "navigate", href: payPageHref(target) };
}

describe("tarjetas de plan → pagar dentro de Humanix", () => {
  it("Free → Esencial lleva a /pagar", () => {
    expect(
      runChoose("essential_monthly", {
        userId: "u1",
        currentPlan: "free",
        cancelAtPeriodEnd: false,
      }),
    ).toEqual({
      kind: "navigate",
      href: "/pagar?plan=essential_monthly",
    });
  });

  it("Esencial → Pro (mejora) lleva a /pagar con Pro", () => {
    expect(
      runChoose("pro_monthly", {
        userId: "u1",
        currentPlan: "essential_monthly",
        cancelAtPeriodEnd: false,
      }),
    ).toEqual({ kind: "navigate", href: "/pagar?plan=pro_monthly" });
  });

  it("IPS Mejorado también se paga en /pagar", () => {
    expect(
      runChoose("institution_monthly", {
        userId: "u1",
        currentPlan: "free",
        cancelAtPeriodEnd: false,
      }),
    ).toEqual({ kind: "navigate", href: "/pagar?plan=institution_monthly" });
  });

  it("renovar el plan actual cuando está por vencer lleva a /pagar", () => {
    expect(
      runChoose("pro_monthly", {
        userId: "u1",
        currentPlan: "pro_monthly",
        cancelAtPeriodEnd: false,
        renewSoon: true,
      }),
    ).toEqual({ kind: "navigate", href: "/pagar?plan=pro_monthly" });
  });

  it("el plan actual vigente no abre ningún pago", () => {
    expect(
      runChoose("pro_monthly", {
        userId: "u1",
        currentPlan: "pro_monthly",
        cancelAtPeriodEnd: false,
      }),
    ).toEqual({
      kind: "noop",
      reason: "current",
    });
  });

  it("sin sesión va al login y vuelve al plan elegido", () => {
    expect(
      runChoose("pro_monthly", { userId: null, currentPlan: "free", cancelAtPeriodEnd: false }),
    ).toEqual({
      kind: "navigate",
      href: "/auth?redirect=%2Fplanes%3Fplan%3Dpro_monthly",
    });
  });
});
