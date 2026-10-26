// Tabla de precios oficial (oct 2026), una prueba por regla.
import { describe, expect, it } from "vitest";
import {
  PLAN_CATALOG,
  bookingCommissionPct,
  calculateInstitutionBilling,
  FREE_COMMISSION_PCT,
} from "./plans";
import { buildPriceBreakdown } from "./pricing";

describe("tabla de precios Humanix", () => {
  it("Free cuesta COP 0 y cobra 10 % al profesional por servicio", () => {
    expect(PLAN_CATALOG.free.amountCOP).toBe(0);
    expect(FREE_COMMISSION_PCT).toBe(10);
    expect(bookingCommissionPct("free", "free")).toBe(10);
    const b = buildPriceBreakdown(100_000, 1, bookingCommissionPct("free", "free"));
    expect(b.commission).toBe(10_000);
    expect(b.professionalNet).toBe(90_000);
    expect(b.total).toBe(100_000);
  });

  it("Familiar cuesta 9.900/mes y la familia contrata sin comisión", () => {
    expect(PLAN_CATALOG.essential_monthly.amountCOP).toBe(9_900);
    expect(PLAN_CATALOG.essential_monthly.segment).toBe("family");
    expect(bookingCommissionPct("free", "essential_monthly")).toBe(0);
  });

  it("Premium Familiar cuesta 24.900/mes, sin comisión e incluye todo lo del Familiar", () => {
    expect(PLAN_CATALOG.family_premium_monthly.amountCOP).toBe(24_900);
    expect(bookingCommissionPct("free", "family_premium_monthly")).toBe(0);
    for (const f of PLAN_CATALOG.essential_monthly.features)
      expect(PLAN_CATALOG.family_premium_monthly.features).toContain(f);
  });

  it("Pro cuesta 19.900/mes con 0 % de comisión", () => {
    expect(PLAN_CATALOG.pro_monthly.amountCOP).toBe(19_900);
    expect(PLAN_CATALOG.pro_monthly.segment).toBe("professional");
    expect(bookingCommissionPct("pro_monthly", "free")).toBe(0);
  });

  it("Premium Profesional cuesta 39.900/mes, sin comisión e incluye todo lo del Pro", () => {
    expect(PLAN_CATALOG.pro_premium_monthly.amountCOP).toBe(39_900);
    expect(bookingCommissionPct("pro_premium_monthly", "free")).toBe(0);
    for (const f of PLAN_CATALOG.pro_monthly.features)
      expect(PLAN_CATALOG.pro_premium_monthly.features).toContain(f);
  });

  it("Institucional desde 299.000/mes con una sede", () => {
    expect(PLAN_CATALOG.institution_monthly.amountCOP).toBe(299_000);
    expect(calculateInstitutionBilling({ branches: 1, cycle: "monthly" }).totalCOP).toBe(299_000);
  });

  it("cada sede adicional suma 50.000/mes", () => {
    expect(calculateInstitutionBilling({ branches: 2, cycle: "monthly" }).totalCOP).toBe(349_000);
    expect(calculateInstitutionBilling({ branches: 4, cycle: "monthly" }).totalCOP).toBe(449_000);
  });

  it("contrato anual: 12 meses por el precio de 10", () => {
    expect(calculateInstitutionBilling({ branches: 1, cycle: "annual" }).totalCOP).toBe(2_990_000);
    expect(calculateInstitutionBilling({ branches: 3, cycle: "annual" }).totalCOP).toBe(3_990_000);
  });
});
