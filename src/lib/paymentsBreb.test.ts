import { describe, expect, it } from "vitest";
import {
  formatBrebKey,
  guessBrebKeyType,
  maskBrebKey,
  normalizeBrebKey,
  validateBrebKey,
} from "./breb";
import {
  INSTITUTION_PLANS,
  cashAcceptCheck,
  canTakeNewShifts,
  commissionQuote,
  nextTier,
  proTier,
  suggestedTopupCOP,
} from "./commissionMatrix";
import {
  buildChargeBody,
  firuxSignatureFor,
  parseFiruxEvent,
  payLink,
  verifyFiruxSignature,
} from "./firux";

describe("llave Bre-B", () => {
  it("adivina el tipo por lo que se escribe", () => {
    expect(guessBrebKeyType("300 123 4567")).toBe("phone");
    expect(guessBrebKeyType("+57 300 123 4567")).toBe("phone");
    expect(guessBrebKeyType("1.085.123.456")).toBe("document");
    expect(guessBrebKeyType("laura@gmail.com")).toBe("email");
    expect(guessBrebKeyType("@laura.enf")).toBe("alias");
    expect(guessBrebKeyType("  ")).toBeNull();
  });
  it("limpia y valida cada tipo", () => {
    expect(validateBrebKey("phone", "+57 300-123-4567")).toEqual({
      ok: true,
      type: "phone",
      value: "3001234567",
    });
    expect(validateBrebKey("phone", "200 123 4567")).toMatchObject({ ok: false, error: "phone" });
    expect(validateBrebKey("document", "1.085.123.456")).toEqual({
      ok: true,
      type: "document",
      value: "1085123456",
    });
    expect(validateBrebKey("document", "123")).toMatchObject({ ok: false });
    expect(validateBrebKey("email", " Laura@Gmail.com ")).toEqual({
      ok: true,
      type: "email",
      value: "laura@gmail.com",
    });
    expect(validateBrebKey("email", "laura@")).toMatchObject({ ok: false, error: "email" });
    expect(validateBrebKey("alias", "laura.enf")).toEqual({
      ok: true,
      type: "alias",
      value: "@laura.enf",
    });
    expect(validateBrebKey("alias", "@a")).toMatchObject({ ok: false, error: "alias" });
    expect(validateBrebKey("phone", "")).toMatchObject({ ok: false, error: "empty" });
  });
  it("nunca se muestra completa", () => {
    expect(maskBrebKey("phone", "3001234567")).toBe("300 *** 4567");
    expect(maskBrebKey("document", "1085123456")).toBe("•••• 3456");
    expect(maskBrebKey("email", "laura@gmail.com")).toBe("la***@gmail.com");
    expect(maskBrebKey("alias", "@laura.enf")).toBe("@lau***");
    expect(formatBrebKey("phone", "3001234567")).toBe("300 123 4567");
    expect(normalizeBrebKey("phone", "573001234567")).toBe("3001234567");
  });
});

describe("matriz de comisiones", () => {
  it("escalones del profesional por turnos de los últimos 30 días", () => {
    expect(proTier(0).pct).toBe(15);
    expect(proTier(19).pct).toBe(15);
    expect(proTier(20).pct).toBe(12);
    expect(proTier(59).pct).toBe(12);
    expect(proTier(60).pct).toBe(10);
    expect(nextTier(5)).toEqual({ shiftsToGo: 15, pct: 12 });
    expect(nextTier(25)).toEqual({ shiftsToGo: 35, pct: 10 });
    expect(nextTier(70)).toBeNull();
  });
  const base = {
    totalCOP: 100_000,
    proCompletedLast30d: 3,
    institutionPlan: null,
    previousShiftsTogether: 2,
    clientAgeDays: 200,
  };
  it("familia: 15 % al profesional, la familia no paga comisión", () => {
    expect(commissionQuote(base)).toEqual({
      pct: 15,
      grossCOP: 15_000,
      exemptCOP: 0,
      feeCOP: 15_000,
      netCOP: 85_000,
      firstShift: false,
    });
  });
  it("institución con plan: 12 % o 10 % según el tamaño de la sede", () => {
    expect(commissionQuote({ ...base, institutionPlan: "small" }).pct).toBe(12);
    expect(commissionQuote({ ...base, institutionPlan: "large", proCompletedLast30d: 0 }).pct).toBe(
      10,
    );
    expect(INSTITUTION_PLANS.small.annualCOP).toBe(12 * 290_000);
    expect(INSTITUTION_PLANS.large.annualCOP).toBe(12 * 490_000);
  });
  it("primer turno de la pareja: exonerado hasta $30.000 si quien contrata tiene ≤ 90 días", () => {
    expect(
      commissionQuote({ ...base, previousShiftsTogether: 0, clientAgeDays: 10 }),
    ).toMatchObject({
      feeCOP: 0,
      exemptCOP: 15_000,
      netCOP: 100_000,
      firstShift: true,
    });
    // $300.000 al 15 % = $45.000; se exoneran $30.000 y se cobran $15.000.
    expect(
      commissionQuote({ ...base, totalCOP: 300_000, previousShiftsTogether: 0, clientAgeDays: 90 }),
    ).toMatchObject({
      grossCOP: 45_000,
      exemptCOP: 30_000,
      feeCOP: 15_000,
    });
    expect(
      commissionQuote({ ...base, previousShiftsTogether: 0, clientAgeDays: 91 }).firstShift,
    ).toBe(false);
  });
  it("pesos enteros", () => {
    expect(commissionQuote({ ...base, totalCOP: 45_333 }).feeCOP).toBe(6_800);
  });
});

describe("billetera para turnos en efectivo", () => {
  it("saldo + cupo de −$30.000 debe cubrir la comisión", () => {
    expect(cashAcceptCheck(0, 15_000)).toEqual({ ok: true, availableCOP: 30_000 });
    expect(cashAcceptCheck(-20_000, 15_000)).toEqual({
      ok: false,
      reason: "insufficient",
      availableCOP: 10_000,
      missingCOP: 5_000,
    });
    expect(cashAcceptCheck(-30_000, 0)).toEqual({ ok: true, availableCOP: 0 });
  });
  it("por debajo de −$30.000 queda bloqueado para turnos nuevos", () => {
    expect(cashAcceptCheck(-31_000, 0)).toMatchObject({
      ok: false,
      reason: "blocked",
      missingCOP: 1_000,
    });
    expect(canTakeNewShifts(-30_000)).toBe(true);
    expect(canTakeNewShifts(-30_001)).toBe(false);
  });
  it("recarga sugerida: a miles hacia arriba y desde el mínimo de Firux", () => {
    expect(suggestedTopupCOP(5_200)).toBe(6_000);
    expect(suggestedTopupCOP(100)).toBe(2_000);
    expect(suggestedTopupCOP(0)).toBe(2_000);
  });
});

describe("Firux", () => {
  it("cobro en COP enteros entre $2.000 y $12.000.000", () => {
    expect(buildChargeBody({ amountCop: 100000.4, reference: "b1", description: "Turno" })).toEqual(
      {
        ok: true,
        body: { amount: 100000, external_reference: "b1", description: "Turno" },
      },
    );
    expect(buildChargeBody({ amountCop: 1999, reference: "b1", description: "" })).toMatchObject({
      ok: false,
    });
    expect(
      buildChargeBody({ amountCop: 12_000_001, reference: "b1", description: "" }),
    ).toMatchObject({ ok: false });
    expect(buildChargeBody({ amountCop: 5000, reference: " ", description: "" })).toMatchObject({
      error: "missing_reference",
    });
  });
  it("firma HMAC con ventana de 5 minutos", async () => {
    const body = JSON.stringify({
      type: "charge.paid",
      data: { charge_id: "ch_1", external_reference: "b1", amount_paid: 100000 },
    });
    const ts = "1793750000";
    const sig = await firuxSignatureFor("secreto", ts, body);
    const ok = (o: Partial<Parameters<typeof verifyFiruxSignature>[0]>) =>
      verifyFiruxSignature({
        rawBody: body,
        timestamp: ts,
        signature: `v1=${sig}`,
        secret: "secreto",
        nowSeconds: 1793750100,
        ...o,
      });
    expect(await ok({})).toBe(true);
    expect(await ok({ signature: `v1=abc, v1=${sig}` })).toBe(true);
    expect(await ok({ secret: "otro" })).toBe(false);
    expect(await ok({ rawBody: body.replace("100000", "1") })).toBe(false);
    expect(await ok({ nowSeconds: 1793750000 + 301 })).toBe(false);
    expect(await ok({ timestamp: null })).toBe(false);
  });
  it("lee el evento", () => {
    expect(
      parseFiruxEvent(
        '{"type":"charge.paid","data":{"charge_id":"ch_1","external_reference":"b1","amount_paid":100000}}',
      ),
    ).toEqual({
      type: "charge.paid",
      chargeId: "ch_1",
      reference: "b1",
      amountPaid: 100000,
    });
    expect(parseFiruxEvent("no-json")).toBeNull();
    expect(parseFiruxEvent('{"type":"charge.paid","data":{}}')).toBeNull();
    expect(payLink({ payment_url: "https://pay.firux.co/x" })).toBe("https://pay.firux.co/x");
    expect(payLink({ payment_url: "javascript:alert(1)" })).toBeNull();
  });
});
