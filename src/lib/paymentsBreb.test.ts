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
  walletHealth,
  MIN_BOOKING_COP,
} from "./commissionMatrix";
import {
  buildCheckoutUrl,
  parseWompiTransactionEvent,
  verifyWompiEvent,
  wompiApiBase,
  wompiIntegritySignature,
} from "./wompi";

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
  it("la exoneración del primer turno se usa una sola vez por pareja", () => {
    expect(
      commissionQuote({
        ...base,
        previousShiftsTogether: 0,
        clientAgeDays: 10,
        exemptionUsedTogether: true,
      }),
    ).toMatchObject({ feeCOP: 15_000, exemptCOP: 0, firstShift: false });
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
  it("aparta la comisión de los turnos en efectivo aceptados y sin terminar", () => {
    // Dos turnos de $100.000 al 15 %: $30.000 apartados; un tercero ya no cabe en el cupo.
    expect(cashAcceptCheck(0, 15_000, -30_000, 15_000)).toEqual({ ok: true, availableCOP: 15_000 });
    expect(cashAcceptCheck(0, 15_000, -30_000, 30_000)).toEqual({
      ok: false,
      reason: "insufficient",
      availableCOP: 0,
      missingCOP: 15_000,
    });
    // Si el turno no paga comisión (primer turno exonerado), se acepta aunque no quede nada libre.
    expect(cashAcceptCheck(-30_000, 0, -30_000, 0)).toEqual({ ok: true, availableCOP: 0 });
  });
  it("estado de la billetera igual que get_my_wallet", () => {
    expect(walletHealth(50_000)).toBe("ok");
    expect(walletHealth(-5_000)).toBe("credit");
    expect(walletHealth(-25_000)).toBe("low");
    expect(walletHealth(0, 25_000)).toBe("low");
    expect(walletHealth(-30_000)).toBe("low");
    expect(walletHealth(-30_001)).toBe("blocked");
  });
  it("el turno mínimo es de $20.000", () => {
    expect(MIN_BOOKING_COP).toBe(20_000);
  });
  it("recarga sugerida: a miles hacia arriba y desde el mínimo de cobro", () => {
    expect(suggestedTopupCOP(5_200)).toBe(6_000);
    expect(suggestedTopupCOP(100)).toBe(2_000);
    expect(suggestedTopupCOP(0)).toBe(2_000);
  });
});

describe("Wompi", () => {
  it("firma de integridad: vectores oficiales de docs.wompi.co", async () => {
    const secret = "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6";
    expect(
      await wompiIntegritySignature({
        reference: "sk8-438k4-xmxm392-sn2m",
        amountInCents: 2490000,
        integritySecret: secret,
      }),
    ).toBe("37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5");
  });

  it("enlace del checkout: centavos, referencia, firma y límites de $2.000 a $12.000.000", async () => {
    const r = await buildCheckoutUrl({
      publicKey: "pub_test_abc",
      integritySecret: "test_integrity_x",
      amountCop: 100000.4,
      reference: "c1",
      redirectUrl: "https://humanix.lat/pago/exito",
      expirationTime: "2026-11-06T10:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe("https://checkout.wompi.co/p/");
    expect(u.searchParams.get("amount-in-cents")).toBe("10000000");
    expect(u.searchParams.get("currency")).toBe("COP");
    expect(u.searchParams.get("reference")).toBe("c1");
    expect(u.searchParams.get("redirect-url")).toBe("https://humanix.lat/pago/exito");
    expect(u.searchParams.get("signature:integrity")).toBe(
      await wompiIntegritySignature({
        reference: "c1",
        amountInCents: 10000000,
        expirationTime: "2026-11-06T10:00:00.000Z",
        integritySecret: "test_integrity_x",
      }),
    );
    const base = { publicKey: "pub_test_abc", integritySecret: "s", reference: "c1" };
    expect(await buildCheckoutUrl({ ...base, amountCop: 1999 })).toMatchObject({ ok: false });
    expect(await buildCheckoutUrl({ ...base, amountCop: 12_000_001 })).toMatchObject({ ok: false });
    expect(await buildCheckoutUrl({ ...base, amountCop: 5000, reference: " " })).toMatchObject({
      error: "missing_reference",
    });
    expect(await buildCheckoutUrl({ ...base, integritySecret: "", amountCop: 5000 })).toMatchObject(
      {
        error: "not_configured",
      },
    );
  });

  it("sandbox o producción según la llave pública", () => {
    expect(wompiApiBase("pub_test_x")).toBe("https://sandbox.wompi.co/v1");
    expect(wompiApiBase("pub_prod_x")).toBe("https://production.wompi.co/v1");
  });

  // El ejemplo de la página de eventos de cobros trae un checksum ilustrativo que no corresponde a su propia cadena;
  // la regla es la misma que la de Pagos a Terceros (cuyo vector oficial sí cuadra, abajo).
  it("firma de eventos de cobros: valores + timestamp + secreto", async () => {
    const body = JSON.stringify({
      event: "transaction.updated",
      data: {
        transaction: {
          id: "1234-1610641025-49201",
          amount_in_cents: 4490000,
          reference: "MZQ3X2DE2SMX",
          status: "APPROVED",
          payment_method_type: "NEQUI",
        },
      },
      environment: "prod",
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
        checksum: "5A18EC5E8FDB7DF463E9F94774CBA8F583BA21BD04A09CEFF2EA68A4BC0AEFBE",
      },
      timestamp: 1530291411,
    });
    const secret = "prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z";
    expect(await verifyWompiEvent({ rawBody: body, secret })).toBe(true);
    expect(
      await verifyWompiEvent({
        rawBody: body,
        headerChecksum: "5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe",
        secret,
      }),
    ).toBe(true);
    expect(await verifyWompiEvent({ rawBody: body, secret: "otro" })).toBe(false);
    expect(await verifyWompiEvent({ rawBody: body.replace("4490000", "1"), secret })).toBe(false);
    expect(await verifyWompiEvent({ rawBody: body, headerChecksum: "abc", secret })).toBe(false);
    expect(await verifyWompiEvent({ rawBody: "no-json", secret })).toBe(false);
  });

  it("firma de eventos: vector oficial (pagos a terceros, timestamp en ms)", async () => {
    const body = JSON.stringify({
      event: "transaction.updated",
      data: {
        transaction: {
          id: "04a6e53d-a244-4140-ab9e-48fa541f9fe5",
          status: "FAILED",
          amountInCents: 7500000,
        },
      },
      signature: {
        properties: ["transaction.id", "transaction.status", "transaction.amountInCents"],
        checksum: "82f0e769716170e202edfd348f604bd8461cdeeb416594cde563a890215a5282",
      },
      timestamp: 1747673128600,
    });
    expect(
      await verifyWompiEvent({
        rawBody: body,
        secret: "prod_events_7b193c8afd7b47949f90d443cb1e1742",
      }),
    ).toBe(true);
  });

  it("lee transaction.updated de cobros", () => {
    expect(
      parseWompiTransactionEvent(
        '{"event":"transaction.updated","data":{"transaction":{"id":"t1","reference":"c1","status":"approved","amount_in_cents":10000050,"payment_method_type":"PSE"}},"timestamp":1}',
      ),
    ).toEqual({
      type: "transaction.updated",
      transactionId: "t1",
      reference: "c1",
      status: "APPROVED",
      amountCop: 100000,
      paymentMethod: "PSE",
      timestamp: "1",
    });
    expect(parseWompiTransactionEvent("no-json")).toBeNull();
    expect(parseWompiTransactionEvent('{"event":"nequi_token.updated","data":{}}')).toBeNull();
    expect(
      parseWompiTransactionEvent(
        '{"event":"transaction.updated","data":{"transaction":{"id":"t1"}}}',
      ),
    ).toBeNull();
  });
});
