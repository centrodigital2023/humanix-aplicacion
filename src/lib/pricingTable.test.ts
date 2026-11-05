// Tabla de precios oficial (nov 2026, Bre-B con Wompi), una prueba por regla.
import { describe, expect, it } from "vitest";
import { INSTITUTION_PLANS, PLAN_CATALOG, bookingCommissionPct } from "./plans";
import { buildPriceBreakdown } from "./pricing";

describe("tabla de precios Humanix", () => {
  it("Familia: $0 y nunca paga comisión (paga solo el valor del turno)", () => {
    expect(PLAN_CATALOG.family_premium_monthly.amountCOP).toBe(0);
    const b = buildPriceBreakdown(50_000, 2, bookingCommissionPct(0));
    expect(b.total).toBe(100_000);
  });
  it("Profesional: $0 y comisión 15 % (0–19 turnos), 12 % (20–59), 10 % (60+)", () => {
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(0);
    const b = buildPriceBreakdown(100_000, 1, bookingCommissionPct(3));
    expect(b.commission).toBe(15_000);
    expect(b.professionalNet).toBe(85_000);
    expect(buildPriceBreakdown(100_000, 1, bookingCommissionPct(25)).commission).toBe(12_000);
    expect(buildPriceBreakdown(100_000, 1, bookingCommissionPct(60)).commission).toBe(10_000);
  });
  it("Institucional: $290.000/mes (1–9) o $490.000/mes (10+), un pago al año", () => {
    expect(INSTITUTION_PLANS.small).toMatchObject({
      monthlyCOP: 290_000,
      annualCOP: 3_480_000,
      pct: 12,
    });
    expect(INSTITUTION_PLANS.large).toMatchObject({
      monthlyCOP: 490_000,
      annualCOP: 5_880_000,
      pct: 10,
    });
    expect(PLAN_CATALOG.institution_monthly.amountCOP).toBe(290_000);
  });
});
