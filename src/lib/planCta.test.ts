import { describe, it, expect } from "vitest";
import { computeCta } from "./planCta";
import type { PlanKey } from "./plans";

const LOGGED_OUT = { userId: null, currentPlan: "free" as PlanKey, cancelAtPeriodEnd: false };
const ON_FREE = { userId: "u1", currentPlan: "free" as PlanKey, cancelAtPeriodEnd: false };
const ON_ESSENTIAL = {
  userId: "u1",
  currentPlan: "essential_monthly" as PlanKey,
  cancelAtPeriodEnd: false,
};
const ON_PRO = { userId: "u1", currentPlan: "pro_monthly" as PlanKey, cancelAtPeriodEnd: false };
const ON_PRO_CANCELLING = { ...ON_PRO, cancelAtPeriodEnd: true };

describe("computeCta — logged out", () => {
  it("Free → 'Crear cuenta gratis'", () => {
    const r = computeCta("free", LOGGED_OUT);
    expect(r).toMatchObject({ label: "Crear cuenta gratis", disabled: false });
    expect(r.action.kind).toBe("free");
  });

  it("Essential → 'Empezar con Esencial', login redirect carries plan", () => {
    const r = computeCta("essential_monthly", LOGGED_OUT);
    expect(r.label).toBe("Empezar con Esencial");
    expect(r.action).toEqual({ kind: "login", redirectTo: "/planes?plan=essential_monthly" });
  });

  it("Institution → 'Hablar con ventas' even when logged out", () => {
    const r = computeCta("institution_monthly", LOGGED_OUT);
    expect(r.label).toBe("Hablar con ventas");
    expect(r.action.kind).toBe("sales");
  });
});

describe("computeCta — on Free (upgrades)", () => {
  it("Free card shown as current and disabled", () => {
    expect(computeCta("free", ON_FREE)).toEqual({
      label: "Tu plan actual",
      action: { kind: "current" },
      disabled: true,
    });
  });

  it("Essential → 'Mejorar a Esencial' triggers checkout", () => {
    const r = computeCta("essential_monthly", ON_FREE);
    expect(r.label).toBe("Mejorar a Esencial");
    expect(r.action.kind).toBe("checkout");
    expect(r.disabled).toBe(false);
  });

  it("Pro → 'Mejorar a Pro Profesional'", () => {
    expect(computeCta("pro_monthly", ON_FREE).label).toBe("Mejorar a Pro Profesional");
  });
});

describe("computeCta — paid plan (downgrade / sidegrade / cancel pending)", () => {
  it("Pro user → Essential card waits until the plan ends (no downgrade while paid)", () => {
    const r = computeCta("essential_monthly", ON_PRO);
    expect(r).toEqual({ label: "Al terminar tu plan", action: { kind: "later" }, disabled: true });
  });

  it("Pro user → Pro card is current+disabled", () => {
    const r = computeCta("pro_monthly", ON_PRO);
    expect(r.disabled).toBe(true);
    expect(r.action.kind).toBe("current");
  });

  it("Pro user with cancellation pending → Pro card offers 'Renovar 1 mes'", () => {
    const r = computeCta("pro_monthly", ON_PRO_CANCELLING);
    expect(r.label).toBe("Renovar 1 mes");
    expect(r.action.kind).toBe("reactivate");
    expect(r.disabled).toBe(false);
  });

  it("Pro user close to the end → Pro card offers 'Renovar 1 mes' (no automatic charges)", () => {
    const r = computeCta("pro_monthly", { ...ON_PRO, renewSoon: true });
    expect(r).toEqual({ label: "Renovar 1 mes", action: { kind: "reactivate" }, disabled: false });
    expect(computeCta("pro_monthly", { ...ON_PRO, renewSoon: false }).action.kind).toBe("current");
  });

  it("Essential user → Pro card says 'Mejorar a Pro Profesional'", () => {
    expect(computeCta("pro_monthly", ON_ESSENTIAL).label).toBe("Mejorar a Pro Profesional");
  });

  it("Paid user → Free card explains it arrives when the plan ends", () => {
    const r = computeCta("free", ON_PRO);
    expect(r).toEqual({ label: "Al terminar tu plan", action: { kind: "later" }, disabled: true });
  });

  it("Paid (non-institution) user → Institution still says 'Hablar con ventas'", () => {
    expect(computeCta("institution_monthly", ON_PRO).label).toBe("Hablar con ventas");
  });
});
