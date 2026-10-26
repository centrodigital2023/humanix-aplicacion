// Tabla de precios de oct 2026: cotización de cada pago (sedes y contrato anual), comisión del 10 % en Free,
// precios de antes que se siguen respetando y qué plan se ofrece a cada perfil.
import { describe, expect, it } from "vitest";
import {
  checkoutDecision,
  minAcceptedPrice,
  planQuote,
  preapprovalRequest,
  quoteTitle,
  subscriptionAfterApproval,
} from "./planBilling";
import {
  FREE_COMMISSION_PCT,
  PLAN_CATALOG,
  bookingCommissionPct,
  calculateInstitutionBilling,
  canUseFeature,
  segmentOfRoles,
  upgradePlanFor,
} from "./plans";

const NOW = Date.parse("2026-10-15T15:00:00Z");
const USER = "11111111-2222-4333-8444-555555555555";

describe("cotización de cada pago", () => {
  it("los planes de familia y profesional son siempre un mes, sin sedes ni anual", () => {
    expect(planQuote("family_premium_monthly", { cycle: "annual", branches: 5 })).toEqual({
      plan: "family_premium_monthly",
      cycle: "monthly",
      branches: 1,
      months: 1,
      monthlyCOP: 24900,
      amount: 24900,
    });
    expect(planQuote("pro_premium_monthly").amount).toBe(39900);
  });

  it("Institucional: 299.000 con una sede y 50.000 por cada sede adicional", () => {
    expect(planQuote("institution_monthly").amount).toBe(299_000);
    expect(planQuote("institution_monthly", { branches: 3 }).amount).toBe(399_000);
    expect(planQuote("institution_monthly", { branches: 0 }).branches).toBe(1);
    expect(planQuote("institution_monthly", { branches: "x" }).branches).toBe(1);
    expect(planQuote("institution_monthly", { branches: 10_000 }).branches).toBe(200);
  });

  it("anual: 12 meses por el precio de 10", () => {
    const q = planQuote("institution_monthly", { cycle: "anual", branches: 2 });
    expect(q).toEqual({
      plan: "institution_monthly",
      cycle: "annual",
      branches: 2,
      months: 12,
      monthlyCOP: 349_000,
      amount: 3_490_000,
    });
    const b = calculateInstitutionBilling({ branches: 2, cycle: "annual" });
    expect(b.totalCOP).toBe(3_490_000);
    expect(b.annualDiscountCOP).toBe(698_000);
  });

  it("el nombre del cobro en Mercado Pago dice sedes y ciclo", () => {
    expect(quoteTitle(planQuote("essential_monthly"), "once")).toBe("Humanix Familiar · 1 mes");
    expect(
      quoteTitle(planQuote("institution_monthly", { branches: 3, cycle: "annual" }), "once"),
    ).toBe("Humanix Institucional · 3 sedes · 12 meses (pagas 10)");
    expect(quoteTitle(planQuote("institution_monthly", { cycle: "annual" }), "recurring")).toBe(
      "Humanix Institucional · anual",
    );
  });

  it("el servidor cotiza el pago con las sedes y el ciclo, nunca con un monto del navegador", () => {
    const d = checkoutDecision(null, "institution_monthly", NOW, { cycle: "annual", branches: 4 });
    expect(d).toMatchObject({ ok: true, amount: 4_490_000, quote: { months: 12, branches: 4 } });
  });

  it("la suscripción anual se cobra cada 12 meses con su propia referencia", () => {
    const body = preapprovalRequest({
      userId: USER,
      plan: "institution_monthly",
      email: "ips@x.co",
      backUrl: "https://humanix.lat/pago/exito",
      quote: planQuote("institution_monthly", { cycle: "annual" }),
    });
    expect(body.auto_recurring).toMatchObject({
      frequency: 12,
      frequency_type: "months",
      transaction_amount: 2_990_000,
    });
    expect(body.external_reference).toBe(`sub:${USER}:institution_monthly:annual`);
  });
});

describe("pago aprobado con el contrato anual y con precios de antes", () => {
  it("el anual activa 12 meses", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: {
        transaction_amount: 2_990_000,
        currency_id: "COP",
        metadata: { plan: "institution_monthly", price_cop: 2_990_000, months: 12 },
      },
      now: NOW,
    });
    expect(out.ok && out.patch.current_period_end).toBe("2027-10-15T15:00:00.000Z");
  });

  it("un anual que llega con el valor de un mes no se activa", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: {
        transaction_amount: 299_000,
        currency_id: "COP",
        metadata: { plan: "institution_monthly", price_cop: 299_000, months: 12 },
      },
      now: NOW,
    });
    expect(out).toEqual({ ok: false, error: "amount_mismatch" });
  });

  it("quien ya pagaba Pro a 29.000 o Familiar a 9.000 sigue renovando a ese precio", () => {
    expect(minAcceptedPrice("pro_monthly", 1)).toBe(19900);
    expect(minAcceptedPrice("essential_monthly", 1)).toBe(9000);
    expect(minAcceptedPrice("institution_monthly", 12)).toBe(2_990_000);
    const out = subscriptionAfterApproval({
      row: null,
      payment: {
        transaction_amount: 9000,
        currency_id: "COP",
        metadata: { plan: "essential_monthly", price_cop: 9000 },
      },
      now: NOW,
    });
    expect(out).toMatchObject({ ok: true, patch: { plan: "essential_monthly", amount: 9000 } });
  });

  it("un precio por debajo de cualquiera que haya tenido el plan no activa nada", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: {
        transaction_amount: 5000,
        currency_id: "COP",
        metadata: { plan: "pro_monthly", price_cop: 5000 },
      },
      now: NOW,
    });
    expect(out).toEqual({ ok: false, error: "amount_mismatch" });
  });
});

describe("comisión por servicio", () => {
  it("10 % cuando ni el profesional ni la familia tienen plan de pago", () => {
    expect(FREE_COMMISSION_PCT).toBe(10);
    expect(bookingCommissionPct("free", "free")).toBe(10);
    expect(bookingCommissionPct(null, undefined)).toBe(10);
  });

  it("0 % si cualquiera de los dos paga un plan", () => {
    expect(bookingCommissionPct("pro_monthly", "free")).toBe(0);
    expect(bookingCommissionPct("free", "essential_monthly")).toBe(0);
    expect(bookingCommissionPct("free", "family_premium_monthly")).toBe(0);
    expect(bookingCommissionPct("pro_premium_monthly", null)).toBe(0);
  });
});

describe("beneficios por perfil", () => {
  it("Familiar: acuerdos, bitácora, alertas y soporte prioritario; Premium Familiar suma lo avanzado", () => {
    for (const f of [
      "digital_agreements",
      "care_log",
      "care_alerts",
      "priority_support",
    ] as const) {
      expect(canUseFeature("essential_monthly", f), f).toBe(true);
      expect(canUseFeature("free", f), f).toBe(false);
    }
    for (const f of [
      "advanced_tracking",
      "family_circle",
      "doctor_reports",
      "priority_alerts",
      "sos_priority",
      "dedicated_support",
    ] as const) {
      expect(canUseFeature("family_premium_monthly", f), f).toBe(true);
      expect(canUseFeature("essential_monthly", f), f).toBe(false);
    }
  });

  it("Pro: visibilidad y ofertas; Premium Profesional: prioridad, badge, más IA y reputación", () => {
    for (const f of ["visibility_boost", "offers_access"] as const) {
      expect(canUseFeature("pro_monthly", f), f).toBe(true);
      expect(canUseFeature("free", f), f).toBe(false);
    }
    for (const f of [
      "priority_listing",
      "verified_badge_featured",
      "ai_credits_plus",
      "pro_reputation_lab",
    ] as const) {
      expect(canUseFeature("pro_premium_monthly", f), f).toBe(true);
      expect(canUseFeature("pro_monthly", f), f).toBe(false);
    }
  });

  it("a cada perfil se le ofrece el plan de su perfil", () => {
    expect(segmentOfRoles(["family"])).toBe("family");
    expect(segmentOfRoles(["family", "professional"])).toBe("professional");
    expect(segmentOfRoles(["institution", "professional"])).toBe("institution");
    expect(segmentOfRoles(null)).toBeNull();
    expect(upgradePlanFor("negotiate_rate", "family")).toBe("essential_monthly");
    expect(upgradePlanFor("negotiate_rate", "professional")).toBe("pro_monthly");
    expect(upgradePlanFor("verified_badge_featured", "family")).toBe("pro_premium_monthly");
    expect(PLAN_CATALOG.essential_monthly.segment).toBe("family");
  });
});
