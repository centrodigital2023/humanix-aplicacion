import { describe, expect, it } from "vitest";
import {
  bookingCommissionPct,
  canUseFeature,
  effectivePlan,
  FREE_COMMISSION_PCT,
  longDateEs,
  planValidity,
  PLAN_CATALOG,
  PLANS_FOR_SEGMENT,
} from "./plans";

const NOW = Date.parse("2026-11-03T15:00:00Z");
const DAY = 86_400_000;
const inst = (over: object = {}) => ({
  plan: "institution_small_annual",
  status: "active",
  amount: 3_480_000,
  currency: "COP",
  current_period_end: new Date(NOW + 200 * DAY).toISOString(),
  ...over,
});

describe("nivel efectivo (misma regla que plan_key_for en SQL)", () => {
  it("familia y profesional tienen todo gratis; sin perfil, Free", () => {
    expect(effectivePlan(["family"], null, NOW).plan).toBe("family_premium_monthly");
    expect(effectivePlan(["professional"], null, NOW).plan).toBe("pro_monthly");
    expect(effectivePlan(["professional", "family"], null, NOW).plan).toBe("pro_monthly");
    expect(effectivePlan([], null, NOW).plan).toBe("free");
    expect(effectivePlan(["institution"], null, NOW).plan).toBe("free");
  });
  it("institución con plan anual vigente: Institucional y su tamaño", () => {
    expect(effectivePlan(["institution"], inst(), NOW)).toMatchObject({
      plan: "institution_monthly",
      institutionSize: "small",
    });
    expect(
      effectivePlan(["institution"], inst({ plan: "institution_large_annual" }), NOW)
        .institutionSize,
    ).toBe("large");
  });
  it("vencido, pendiente o con una clave vieja de Mercado Pago no abre nada", () => {
    expect(
      effectivePlan(
        ["institution"],
        inst({ current_period_end: new Date(NOW - DAY).toISOString() }),
        NOW,
      ).plan,
    ).toBe("free");
    expect(effectivePlan(["institution"], inst({ status: "pending" }), NOW).plan).toBe("free");
    expect(effectivePlan(["family"], inst({ plan: "essential_monthly" }), NOW).plan).toBe(
      "family_premium_monthly",
    );
  });
});

describe("funciones y comisión", () => {
  it("la comisión ya no depende del plan: ningún plan abre «sin comisión»", () => {
    for (const k of Object.keys(PLAN_CATALOG))
      expect(canUseFeature(k, "no_commission")).toBe(false);
  });
  it("matriz: 15/12/10 % por turnos del profesional; 12/10 % con institución", () => {
    expect(FREE_COMMISSION_PCT).toBe(15);
    expect(bookingCommissionPct(0)).toBe(15);
    expect(bookingCommissionPct(20)).toBe(12);
    expect(bookingCommissionPct(60)).toBe(10);
    expect(bookingCommissionPct(70, "small")).toBe(12);
    expect(bookingCommissionPct(0, "large")).toBe(10);
  });
  it("familia y profesional son gratis; cada perfil ve su único plan", () => {
    expect(PLAN_CATALOG.family_premium_monthly.amountCOP).toBe(0);
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(0);
    expect(PLANS_FOR_SEGMENT).toEqual({
      family: ["family_premium_monthly"],
      professional: ["pro_monthly"],
      institution: ["institution_monthly"],
    });
    expect(canUseFeature("pro_monthly", "career_passport")).toBe(true);
    expect(canUseFeature("family_premium_monthly", "family_circle")).toBe(true);
  });
});

describe("vigencia del plan institucional", () => {
  it("sin plan institucional no hay vigencia", () => {
    expect(planValidity({ plan: "pro_monthly", currentPeriodEnd: null }, NOW).line).toBeNull();
  });
  it("dice hasta cuándo y recuerda renovar en el último mes", () => {
    const end = Date.parse("2027-11-03T15:00:00Z");
    expect(
      planValidity(
        { plan: "institution_monthly", currentPeriodEnd: new Date(end).toISOString() },
        NOW,
      ),
    ).toEqual({
      daysLeft: 365,
      renewSoon: false,
      line: "Vigente hasta el 3 de noviembre de 2027",
    });
    expect(
      planValidity(
        { plan: "institution_monthly", currentPeriodEnd: new Date(NOW + 20 * DAY).toISOString() },
        NOW,
      ).renewSoon,
    ).toBe(true);
    expect(longDateEs(NOW)).toBe("3 de noviembre");
  });
});
