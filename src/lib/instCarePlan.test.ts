import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FREE_LIMITS, PREMIUM_PERKS, thousandsEs } from "./instCare";
import {
  FEATURE_MIN_PLAN,
  PLAN_CATALOG,
  PLAN_ORDER,
  canUseFeature,
  type PlanFeature,
} from "./plans";

/** Las funciones de pacientes y monitoreo clínico: todas son del plan IPS Mejorado (Free las prueba con topes chicos). */
const CARE_FEATURES = [
  "inst_care_scale",
  "inst_devices",
  "inst_alert_escalation",
  "inst_care_followups",
  "inst_shift_handoff",
  "inst_care_export",
] as const satisfies readonly PlanFeature[];

const SQL = readFileSync(
  new URL("../../supabase/migrations/20261014100000_institution_care_core.sql", import.meta.url),
  "utf8",
);

/** Los topes que de verdad aplica la base de datos (`hx_inst_care_limits`). */
function dbLimits(): {
  free: Record<string, number | boolean>;
  premium: Record<string, number | boolean>;
} {
  const fn =
    /FUNCTION public\.hx_inst_care_limits[\s\S]*?THEN '([^']+)'::jsonb\s+ELSE '([^']+)'::jsonb/.exec(
      SQL,
    );
  expect(fn, "hx_inst_care_limits").not.toBeNull();
  return { premium: JSON.parse(fn![1]!), free: JSON.parse(fn![2]!) };
}

describe("funciones de pacientes y monitoreo clínico en los planes", () => {
  it("se desbloquean con IPS Mejorado y con ningún plan de abajo", () => {
    for (const f of CARE_FEATURES) {
      expect(FEATURE_MIN_PLAN[f]).toBe("institution_monthly");
      expect(canUseFeature("institution_monthly", f)).toBe(true);
      for (const lower of [
        "free",
        "essential_monthly",
        "pro_monthly",
        null,
        undefined,
        "plan_inventado",
      ]) {
        expect(canUseFeature(lower, f), `${f} con ${String(lower)}`).toBe(false);
      }
    }
  });

  it("el catálogo las lista y las explica con los topes reales de la base de datos", () => {
    const plan = PLAN_CATALOG.institution_monthly;
    for (const f of CARE_FEATURES) expect(plan.features).toContain(f);
    for (const key of PLAN_ORDER.filter((k) => k !== "institution_monthly"))
      for (const f of CARE_FEATURES) expect(PLAN_CATALOG[key].features).not.toContain(f);
    const label = plan.featuresLabel.find((l) => /Pacientes y monitoreo clínico a escala/.test(l));
    expect(label).toBeDefined();
    const { free, premium } = dbLimits();
    expect(label).toContain(`hasta ${thousandsEs(premium.patients as number)} pacientes`);
    expect(label).toContain(`${premium.monitored} en monitoreo`);
    expect(label).toContain(`Free: ${free.patients} y ${free.monitored}`);
    for (const word of ["NEWS2", "relojes", "escalamiento", "seguimientos", "relevo", "FHIR"]) {
      expect(label).toMatch(new RegExp(word, "i"));
    }
  });

  it("los topes de Free que muestra la pantalla son los de la base de datos", () => {
    const { free } = dbLimits();
    expect({ ...FREE_LIMITS }).toEqual(free);
  });

  it("lo que anuncia la invitación a mejorar coincide con los topes de IPS Mejorado", () => {
    const { premium } = dbLimits();
    const perks = PREMIUM_PERKS.join(" | ");
    expect(perks).toContain(`${thousandsEs(premium.patients as number)} pacientes`);
    expect(perks).toContain(`${premium.monitored} en monitoreo`);
    expect(perks).toContain(`hasta ${premium.devices}`);
  });

  it("cada interruptor de la base de datos corresponde a una función del catálogo", () => {
    const { free, premium } = dbLimits();
    const byFlag: Record<string, PlanFeature> = {
      escalation: "inst_alert_escalation",
      followups: "inst_care_followups",
      handoff: "inst_shift_handoff",
      export: "inst_care_export",
    };
    for (const [flag, feature] of Object.entries(byFlag)) {
      expect(premium[flag], `${flag} en IPS Mejorado`).toBe(true);
      expect(free[flag], `${flag} en Free`).toBe(false);
      expect(canUseFeature("institution_monthly", feature)).toBe(true);
      expect(canUseFeature("free", feature)).toBe(false);
    }
    // Los dispositivos y la escala son números: Free no tiene dispositivos, IPS Mejorado sí.
    expect(free.devices).toBe(0);
    expect(premium.devices as number).toBeGreaterThan(0);
    expect(premium.patients as number).toBeGreaterThan(free.patients as number);
  });
});
