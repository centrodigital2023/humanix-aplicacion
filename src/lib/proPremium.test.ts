import { describe, expect, it } from "vitest";
import {
  FEATURE_MIN_PLAN,
  PLAN_CATALOG,
  PLAN_ORDER,
  canUseFeature,
  tierOf,
  type PlanFeature,
} from "./plans";

/** Las funciones premium del panel del profesional, por el plan que las desbloquea. No cambian ningún precio. */
const ESSENTIAL: PlanFeature[] = ["pro_income_pulse", "pro_rest_guard"];
const PRO: PlanFeature[] = ["pro_week_planner", "pro_reputation_lab"];
const ALL = [...ESSENTIAL, ...PRO];

describe("funciones premium del panel del profesional", () => {
  it("ingresos y descanso salen del plan Esencial; «Mi semana» y reputación, del plan Pro", () => {
    for (const f of ESSENTIAL) expect(FEATURE_MIN_PLAN[f]).toBe("essential_monthly");
    for (const f of PRO) expect(FEATURE_MIN_PLAN[f]).toBe("pro_monthly");
  });

  it("sin plan (o con uno desconocido) están bloqueadas", () => {
    for (const f of ALL) {
      expect(canUseFeature("free", f)).toBe(false);
      expect(canUseFeature(null, f)).toBe(false);
      expect(canUseFeature(undefined, f)).toBe(false);
      expect(canUseFeature("plan_inventado", f)).toBe(false);
    }
  });

  it("cada plan de pago abre lo suyo y lo de los planes de abajo, nunca lo de arriba", () => {
    for (const f of ESSENTIAL) {
      expect(canUseFeature("essential_monthly", f)).toBe(true);
      expect(canUseFeature("pro_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
    }
    for (const f of PRO) {
      expect(canUseFeature("essential_monthly", f)).toBe(false);
      expect(canUseFeature("pro_monthly", f)).toBe(true);
      expect(canUseFeature("institution_monthly", f)).toBe(true);
    }
  });

  it("el catálogo de cada plan las lista y las explica en su tarjeta de precios", () => {
    const essential = PLAN_CATALOG.essential_monthly;
    const pro = PLAN_CATALOG.pro_monthly;
    for (const f of ESSENTIAL) expect(essential.features).toContain(f);
    for (const f of PRO) expect(pro.features).toContain(f);

    const essentialLabel = essential.featuresLabel.find((l) =>
      /Panel del profesional inteligente/.test(l),
    );
    expect(essentialLabel).toBeDefined();
    for (const word of ["ingresos", "tarifa", "descanso"]) {
      expect(essentialLabel).toMatch(new RegExp(word, "i"));
    }
    const proLabel = pro.featuresLabel.find((l) => /Mi semana/.test(l));
    expect(proLabel).toBeDefined();
    expect(proLabel).toMatch(/reputación/i);

    // ninguna otra tarjeta las anuncia como propias
    for (const key of PLAN_ORDER.filter((k) => k !== "essential_monthly")) {
      for (const f of ESSENTIAL) expect(PLAN_CATALOG[key].features).not.toContain(f);
    }
    for (const key of PLAN_ORDER.filter((k) => k !== "pro_monthly")) {
      for (const f of PRO) expect(PLAN_CATALOG[key].features).not.toContain(f);
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
