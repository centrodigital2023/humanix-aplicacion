import { describe, expect, it } from "vitest";
import {
  FEATURE_MIN_PLAN,
  PLAN_CATALOG,
  PLAN_ORDER,
  canUseFeature,
  tierOf,
  type PlanFeature,
} from "./plans";

/** Las funciones premium del panel de instituciones (EPS, IPS, clínicas y hospitales): todas son del plan IPS Mejorado. */
const INSTITUTION_PREMIUM: PlanFeature[] = [
  "inst_cost_intel",
  "inst_quality_compliance",
  "inst_team_reliability",
  "inst_coverage_forecast",
  "inst_executive_report",
  "inst_agenda_insights",
];

describe("funciones premium del panel de instituciones", () => {
  it("se desbloquean con el plan de instituciones y con ningún plan de abajo", () => {
    for (const f of INSTITUTION_PREMIUM) {
      expect(FEATURE_MIN_PLAN[f]).toBe("institution_monthly");
      expect(canUseFeature("institution_monthly", f)).toBe(true);
      for (const lower of ["free", "essential_monthly", "pro_monthly"]) {
        expect(canUseFeature(lower, f), `${f} con ${lower}`).toBe(false);
      }
    }
  });

  it("sin plan, o con uno desconocido, están bloqueadas", () => {
    for (const f of INSTITUTION_PREMIUM) {
      expect(canUseFeature(null, f)).toBe(false);
      expect(canUseFeature(undefined, f)).toBe(false);
      expect(canUseFeature("plan_inventado", f)).toBe(false);
    }
  });

  it("el catálogo del plan las lista y las explica en su tarjeta de precios", () => {
    const plan = PLAN_CATALOG.institution_monthly;
    for (const f of INSTITUTION_PREMIUM) expect(plan.features).toContain(f);
    const label = plan.featuresLabel.find((l) => /Centro de gestión inteligente/.test(l));
    expect(label).toBeDefined();
    for (const word of ["costos", "calidad", "cumplimiento", "equipo", "pronóstico", "informe"]) {
      expect(label).toMatch(new RegExp(word, "i"));
    }
    for (const key of PLAN_ORDER.filter((k) => k !== "institution_monthly")) {
      for (const f of INSTITUTION_PREMIUM) expect(PLAN_CATALOG[key].features).not.toContain(f);
    }
  });

  it("la agenda inteligente se explica en la tarjeta de precios", () => {
    const label = PLAN_CATALOG.institution_monthly.featuresLabel.find((l) =>
      /Agenda inteligente/.test(l),
    );
    expect(label).toMatch(/inasistencia/);
    expect(label).toMatch(/utilización/);
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

  it("el plan de instituciones sigue siendo el más alto y las funciones de los tres paneles no se mezclan", () => {
    expect(PLAN_ORDER[PLAN_ORDER.length - 1]).toBe("institution_monthly");
    const all = new Set<PlanFeature>(Object.keys(FEATURE_MIN_PLAN) as PlanFeature[]);
    for (const f of INSTITUTION_PREMIUM) {
      expect(all.has(f)).toBe(true);
      expect(f.startsWith("inst_")).toBe(true);
    }
  });
});
