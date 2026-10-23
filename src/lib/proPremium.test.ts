import { describe, expect, it } from "vitest";
import { FEATURE_MIN_PLAN, PLAN_CATALOG, canUseFeature, type PlanFeature } from "./plans";

/** Las funciones premium del panel del profesional, por el plan que las desbloquea. */
const PRO: PlanFeature[] = ["pro_income_pulse", "pro_rest_guard", "pro_week_planner"];
const PREMIUM: PlanFeature[] = ["pro_reputation_lab", "career_coach", "career_passport"];
const ALL = [...PRO, ...PREMIUM];

describe("funciones premium del panel del profesional", () => {
  it("ingresos, descanso y «Mi semana» salen del plan Pro; reputación, de Premium Profesional", () => {
    for (const f of PRO) expect(FEATURE_MIN_PLAN[f]).toBe("pro_monthly");
    for (const f of PREMIUM) expect(FEATURE_MIN_PLAN[f]).toBe("pro_premium_monthly");
  });

  it("sin plan (o con uno desconocido) están bloqueadas", () => {
    for (const f of ALL) {
      expect(canUseFeature("free", f)).toBe(false);
      expect(canUseFeature(null, f)).toBe(false);
      expect(canUseFeature(undefined, f)).toBe(false);
      expect(canUseFeature("plan_inventado", f)).toBe(false);
    }
  });

  it("cada plan de profesional abre lo suyo y lo del plan de abajo, nunca lo de arriba", () => {
    for (const f of PRO) {
      expect(canUseFeature("pro_monthly", f)).toBe(true);
      expect(canUseFeature("pro_premium_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
    }
    for (const f of PREMIUM) {
      expect(canUseFeature("pro_monthly", f)).toBe(false);
      expect(canUseFeature("pro_premium_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
    }
  });

  it("los planes de familia no traen las herramientas del profesional", () => {
    for (const f of ["pro_week_planner", ...PREMIUM] as PlanFeature[]) {
      expect(canUseFeature("essential_monthly", f)).toBe(false);
      expect(canUseFeature("family_premium_monthly", f)).toBe(false);
    }
  });

  it("quien pagó el Esencial de antes conserva ingresos y descanso", () => {
    expect(canUseFeature("essential_monthly", "pro_income_pulse")).toBe(true);
    expect(canUseFeature("essential_monthly", "pro_rest_guard")).toBe(true);
  });

  it("el catálogo de cada plan las lista y las explica en su tarjeta de precios", () => {
    const pro = PLAN_CATALOG.pro_monthly;
    const premium = PLAN_CATALOG.pro_premium_monthly;
    for (const f of PRO) expect(pro.features).toContain(f);
    for (const f of [...PRO, ...PREMIUM]) expect(premium.features).toContain(f);
    for (const f of PREMIUM) expect(pro.features).not.toContain(f);

    const proLabel = pro.featuresLabel.join(" ");
    for (const word of ["ingresos", "tarifa", "descanso", "Mi semana"]) {
      expect(proLabel).toMatch(new RegExp(word, "i"));
    }
    expect(premium.featuresLabel.join(" ")).toMatch(/reputación/i);
  });

  it("precios de la tabla", () => {
    expect(PLAN_CATALOG.free.amountCOP).toBe(0);
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(19_900);
    expect(PLAN_CATALOG.pro_premium_monthly.amountCOP).toBe(39_900);
  });
});
