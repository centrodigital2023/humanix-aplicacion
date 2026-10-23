import { describe, expect, it } from "vitest";
import {
  PLAN_PRICE_COP,
  PLAN_TITLE,
  brickMethodOf,
  brickPaymentRequest,
  brickPaymentView,
  cardSubscriptionRequest,
  findSubscriptionPlan,
  subscriptionPlanRequest,
} from "./planBilling";

const USER = "11111111-2222-4333-8444-555555555555";
const base = {
  userId: USER,
  plan: "pro_monthly" as const,
  accountEmail: "cuenta@humanix.lat",
  ip: "190.0.0.1",
  callbackUrl: "https://humanix.lat/pago/exito?tipo=plan&plan=pro_monthly&from=%2Fdashboard",
  notificationUrl: "https://humanix.lat/api/public/mercadopago/webhook",
};

const pseForm = {
  payment_method_id: "pse",
  transaction_amount: 1,
  payer: {
    email: "paga@correo.co",
    entity_type: "individual",
    first_name: "Ana",
    last_name: "Gómez",
    identification: { type: "CC", number: "13071151" },
    address: { zip_code: "110111", street_name: "Calle 1", street_number: "2", city: "Bogotá" },
    phone: { area_code: "57", number: "3001234567" },
  },
  transaction_details: { financial_institution: "1007" },
};

describe("pago de un mes desde el formulario de Mercado Pago", () => {
  it("el precio, el plan y la referencia los fija el servidor, nunca el formulario", () => {
    const r = brickPaymentRequest({
      ...base,
      form: {
        token: "abcdef123456",
        payment_method_id: "visa",
        transaction_amount: 1,
        installments: 3,
        issuer_id: "1",
        payer: { email: "x@y.co" },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe("card");
    expect(r.body.transaction_amount).toBe(PLAN_PRICE_COP.pro_monthly);
    expect(r.body.metadata).toEqual({
      user_id: USER,
      plan: "pro_monthly",
      price_cop: 19900,
      months: 1,
      cycle: "monthly",
      branches: 1,
    });
    expect(r.body.external_reference).toBe(USER);
    expect(r.body.notification_url).toBe(base.notificationUrl);
    expect(r.body.installments).toBe(3);
    expect(r.body.callback_url).toBeUndefined();
  });

  it("PSE (Bancolombia, Nequi y demás bancos) lleva banco, IP y URL de regreso", () => {
    const r = brickPaymentRequest({ ...base, form: pseForm });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.method).toBe("pse");
    expect(r.body.transaction_details).toEqual({ financial_institution: "1007" });
    expect(r.body.additional_info).toEqual({ ip_address: "190.0.0.1" });
    expect(r.body.callback_url).toBe(base.callbackUrl);
    expect((r.body.payer as Record<string, unknown>).entity_type).toBe("individual");
    expect(r.body.transaction_amount).toBe(19900);
  });

  it("PSE sin banco o sin documento no se envía", () => {
    const sinBanco = { ...pseForm, transaction_details: {} };
    expect(brickPaymentRequest({ ...base, form: sinBanco }).ok).toBe(false);
    const sinDoc = { ...pseForm, payer: { ...pseForm.payer, identification: {} } };
    expect(brickPaymentRequest({ ...base, form: sinDoc }).ok).toBe(false);
  });

  it("efectivo (Efecty) es un pago sin token ni banco", () => {
    const form = { payment_method_id: "efecty", payer: { email: "a@b.co" } };
    expect(brickMethodOf(form)).toBe("ticket");
    const r = brickPaymentRequest({ ...base, form });
    expect(r.ok && r.method).toBe("ticket");
  });

  it("sin correo en el formulario usa el de la cuenta; sin ninguno no se paga", () => {
    const form = { token: "abcdef123456", payment_method_id: "master" };
    const r = brickPaymentRequest({ ...base, form });
    expect(r.ok && (r.body.payer as Record<string, unknown>).email).toBe("cuenta@humanix.lat");
    expect(brickPaymentRequest({ ...base, accountEmail: null, form }).ok).toBe(false);
  });

  it("un medio de pago raro no se acepta", () => {
    expect(brickMethodOf({ payment_method_id: "<script>" })).toBeNull();
    expect(brickPaymentRequest({ ...base, form: {} }).ok).toBe(false);
  });

  it("solo se devuelve una URL https: la del banco para PSE y el recibo para efectivo", () => {
    const pay = {
      id: 123,
      status: "pending",
      transaction_details: { external_resource_url: "https://banco.example/pse" },
    };
    expect(brickPaymentView(pay, "pse").redirectUrl).toBe("https://banco.example/pse");
    expect(brickPaymentView(pay, "ticket").voucherUrl).toBe("https://banco.example/pse");
    expect(brickPaymentView(pay, "card").redirectUrl).toBeNull();
    const bad = { ...pay, transaction_details: { external_resource_url: "javascript:alert(1)" } };
    expect(brickPaymentView(bad, "pse").redirectUrl).toBeNull();
  });
});

describe("suscripción con plan asociado", () => {
  it("el plan de Mercado Pago cobra el precio del plan cada mes, en pesos", () => {
    expect(subscriptionPlanRequest("essential_monthly", "https://humanix.lat/pago/exito")).toEqual({
      reason: PLAN_TITLE.essential_monthly,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 9900,
        currency_id: "COP",
      },
      back_url: "https://humanix.lat/pago/exito",
    });
  });

  it("reutiliza el plan ya creado (el más antiguo) y no uno con otro precio o inactivo", () => {
    const ok = (id: string, date: string) => ({
      id,
      status: "active",
      reason: PLAN_TITLE.pro_monthly,
      date_created: date,
      auto_recurring: { transaction_amount: 19900, currency_id: "COP" },
    });
    expect(
      findSubscriptionPlan(
        [
          ok("nuevo", "2026-10-21"),
          ok("viejo", "2026-10-20"),
          {
            ...ok("caro", "2026-01-01"),
            auto_recurring: { transaction_amount: 1, currency_id: "COP" },
          },
          { ...ok("inactivo", "2026-01-01"), status: "cancelled" },
        ],
        "pro_monthly",
      ),
    ).toBe("viejo");
    expect(findSubscriptionPlan([ok("x", "2026-10-20")], "essential_monthly")).toBeNull();
    expect(findSubscriptionPlan(null, "pro_monthly")).toBeNull();
  });

  it("la suscripción nace autorizada con el token de la tarjeta y la referencia del servidor", () => {
    expect(
      cardSubscriptionRequest({
        subscriptionPlanId: "2c93808",
        userId: USER,
        plan: "pro_monthly",
        email: "a@b.co",
        cardTokenId: "tok_123456789",
        backUrl: "https://humanix.lat/pago/exito",
      }),
    ).toEqual({
      preapproval_plan_id: "2c93808",
      reason: PLAN_TITLE.pro_monthly,
      external_reference: `sub:${USER}:pro_monthly`,
      payer_email: "a@b.co",
      card_token_id: "tok_123456789",
      back_url: "https://humanix.lat/pago/exito",
      status: "authorized",
    });
  });
});

import { brickPaymentRequest as _bpr } from "../../supabase/functions/_shared/planBilling";
describe("PSE envía dirección y teléfono aunque el formulario no los pida", () => {
  it("completa address, phone e IP válida", () => {
    const r = _bpr({
      form: {
        payment_method_id: "pse",
        payer: { email: "a@b.co", identification: { type: "CC", number: "123456" } },
        transaction_details: { financial_institution: "1007" },
      },
      userId: "u1",
      plan: "pro_monthly" as never,
      accountEmail: "a@b.co",
      accountName: "Ana Gómez",
      accountPhone: "+57 310 555 1234",
      accountCity: "Pasto",
      ip: "unknown",
      callbackUrl: "https://humanix.lat/pago/exito",
      notificationUrl: "https://humanix.lat/api/public/mercadopago/webhook",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const payer = r.body.payer as Record<string, any>;
    expect(payer.phone).toEqual({ area_code: "57", number: "3105551234" });
    expect(payer.address.city).toBe("Pasto");
    expect((r.body.additional_info as any).ip_address).toBe("127.0.0.1");
  });
});
