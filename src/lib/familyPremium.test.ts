import { describe, expect, it } from "vitest";
import { FEATURE_MIN_PLAN, PLAN_CATALOG, canUseFeature, type PlanFeature } from "./plans";

/** Las funciones premium del panel de familia: todas salen del plan Familiar (y las tiene Premium Familiar). */
const FAMILY_PREMIUM: PlanFeature[] = [
  "family_wellbeing_report",
  "smart_applicant_ranking",
  "care_budget_forecast",
  "coverage_radar",
];

describe("funciones premium del panel de familia", () => {
  it("se desbloquean con el plan Familiar", () => {
    for (const f of FAMILY_PREMIUM) expect(FEATURE_MIN_PLAN[f]).toBe("essential_monthly");
  });

  it("sin plan (o con uno desconocido) están bloqueadas; con los planes de familia, abiertas", () => {
    for (const f of FAMILY_PREMIUM) {
      expect(canUseFeature("free", f)).toBe(false);
      expect(canUseFeature(null, f)).toBe(false);
      expect(canUseFeature(undefined, f)).toBe(false);
      expect(canUseFeature("plan_inventado", f)).toBe(false);
      expect(canUseFeature("essential_monthly", f)).toBe(true);
      expect(canUseFeature("family_premium_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
      // Son del panel de familia: los planes de profesional no las traen.
      expect(canUseFeature("pro_monthly", f)).toBe(false);
    }
  });

  it("el catálogo del plan Familiar las lista y las explica en la tarjeta de precios", () => {
    const essential = PLAN_CATALOG.essential_monthly;
    for (const f of FAMILY_PREMIUM) expect(essential.features).toContain(f);
    const label = essential.featuresLabel.find((l) => /Panel de familia inteligente/.test(l));
    expect(label).toBeDefined();
    for (const word of ["bienestar", "comparador", "presupuesto", "cobertura"]) {
      expect(label).toMatch(new RegExp(word, "i"));
    }
    // los planes de profesional no las traen
    for (const key of ["free", "pro_monthly", "pro_premium_monthly"] as const) {
      for (const f of FAMILY_PREMIUM) expect(PLAN_CATALOG[key].features).not.toContain(f);
    }
  });
});
