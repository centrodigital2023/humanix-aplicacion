import { describe, it, expect } from "vitest";
import { computeCta, type CtaContext } from "./planCta";

const OUT: CtaContext = { userId: null, currentPlan: "free" };
const FAMILY: CtaContext = {
  userId: "u1",
  currentPlan: "family_premium_monthly",
  segment: "family",
};
const PRO: CtaContext = { userId: "u2", currentPlan: "pro_monthly", segment: "professional" };
const INST: CtaContext = { userId: "u3", currentPlan: "free", segment: "institution" };
const INST_ON: CtaContext = { ...INST, currentPlan: "institution_monthly" };

describe("planes gratis (Familia y Profesional)", () => {
  it("sin sesión: crear la cuenta gratis", () => {
    expect(computeCta("family_premium_monthly", OUT)).toEqual({
      label: "Crear cuenta gratis",
      action: { kind: "free" },
      disabled: false,
    });
    expect(computeCta("pro_monthly", OUT).action.kind).toBe("free");
  });
  it("con su perfil: ya lo tiene", () => {
    expect(computeCta("family_premium_monthly", FAMILY)).toMatchObject({
      action: { kind: "current" },
      disabled: true,
    });
    expect(computeCta("pro_monthly", PRO)).toMatchObject({
      label: "Ya lo tienes 💚",
      disabled: true,
    });
  });
  it("otro perfil: lleva a su panel, nunca a pagar", () => {
    expect(computeCta("pro_monthly", FAMILY)).toMatchObject({
      label: "Ir a mi panel",
      action: { kind: "free" },
    });
  });
});

describe("plan Institucional (el único que se paga)", () => {
  it("sin sesión: login y vuelve al plan", () => {
    expect(computeCta("institution_monthly", OUT).action).toEqual({
      kind: "login",
      redirectTo: "/planes?plan=institution_monthly",
    });
  });
  it("institución sin plan: activar con Bre-B", () => {
    expect(computeCta("institution_monthly", INST)).toEqual({
      label: "Activar con Bre-B",
      action: { kind: "pay" },
      disabled: false,
    });
  });
  it("vigente: plan actual; en el último mes, renovar", () => {
    expect(computeCta("institution_monthly", INST_ON)).toMatchObject({
      action: { kind: "current" },
      disabled: true,
    });
    expect(computeCta("institution_monthly", { ...INST_ON, renewSoon: true }).action.kind).toBe(
      "pay",
    );
  });
  it("una familia o un profesional no pueden comprarlo", () => {
    expect(computeCta("institution_monthly", FAMILY)).toMatchObject({
      action: { kind: "other_profile" },
      disabled: true,
    });
    expect(computeCta("institution_monthly", PRO).disabled).toBe(true);
  });
});
