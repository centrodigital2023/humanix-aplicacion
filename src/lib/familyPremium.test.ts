import { describe, expect, it } from "vitest";
import {
  FEATURE_MIN_PLAN,
  PLAN_CATALOG,
  PLAN_ORDER,
  canUseFeature,
  tierOf,
  type PlanFeature,
} from "./plans";

/** Las funciones premium del panel de familia: todas salen del plan Esencial y no cambian ningún precio. */
const FAMILY_PREMIUM: PlanFeature[] = [
  "family_wellbeing_report",
  "smart_applicant_ranking",
  "care_budget_forecast",
  "coverage_radar",
];

describe("funciones premium del panel de familia", () => {
  it("se desbloquean con el plan Esencial", () => {
    for (const f of FAMILY_PREMIUM) expect(FEATURE_MIN_PLAN[f]).toBe("essential_monthly");
  });

  it("sin plan (o con uno desconocido) están bloqueadas; con cualquier plan de pago, abiertas", () => {
    for (const f of FAMILY_PREMIUM) {
      expect(canUseFeature("free", f)).toBe(false);
      expect(canUseFeature(null, f)).toBe(false);
      expect(canUseFeature(undefined, f)).toBe(false);
      expect(canUseFeature("plan_inventado", f)).toBe(false);
      expect(canUseFeature("essential_monthly", f)).toBe(true);
      expect(canUseFeature("pro_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
    }
  });

  it("el catálogo del plan Esencial las lista y las explica en la tarjeta de precios", () => {
    const essential = PLAN_CATALOG.essential_monthly;
    for (const f of FAMILY_PREMIUM) expect(essential.features).toContain(f);
    const label = essential.featuresLabel.find((l) => /Panel de familia inteligente/.test(l));
    expect(label).toBeDefined();
    for (const word of ["bienestar", "comparador", "presupuesto", "cobertura"]) {
      expect(label).toMatch(new RegExp(word, "i"));
    }
    // ninguna otra tarjeta las anuncia
    for (const key of PLAN_ORDER.filter((k) => k !== "essential_monthly")) {
      for (const f of FAMILY_PREMIUM) expect(PLAN_CATALOG[key].features).not.toContain(f);
    }
  });

  it("no cambió ningún precio", () => {
    expect(PLAN_CATALOG.free.amountCOP).toBe(0);
    expect(PLAN_CATALOG.essential_monthly.amountCOP).toBe(9000);
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(29000);
    expect(PLAN_CATALOG.institution_monthly.amountCOP).toBe(299_000);
  });

  it("todas las funciones de cada plan se desbloquean exactamente con ese plan", () => {
    for (const key of PLAN_ORDER) {
      for (const f of PLAN_CATALOG[key].features) {
        expect(FEATURE_MIN_PLAN[f], `${f} en ${key}`).toBe(key);
        expect(tierOf(key)).toBeGreaterThanOrEqual(tierOf(FEATURE_MIN_PLAN[f]));
      }
    }
  });
});
