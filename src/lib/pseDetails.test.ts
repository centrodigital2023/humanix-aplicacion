import { describe, expect, it } from "vitest";
import { pseDetailsSchema, withPseDetails } from "./pseDetails";
import { brickPaymentRequest } from "./planBilling";

const details = { firstName: "Ana", lastName: "Gómez", streetName: "Calle 1", streetNumber: "2", neighborhood: "Centro", city: "Bogotá", zipCode: "110111", phone: "3001234567" };
const form = { payment_method_id: "pse", transaction_amount: 1, payer: { email: "paga@example.co", entity_type: "individual", identification: { type: "CC", number: "13071151" } }, transaction_details: { financial_institution: "1007" } };

describe("datos adicionales de PSE", () => {
  it("completa el payload real del Brick sin perder banco o documento", () => {
    const result = withPseDetails(form, details);
    expect(result.payer.first_name).toBe("Ana");
    expect(result.payer.last_name).toBe("Gómez");
    expect(result.payer).toMatchObject({ identification: form.payer.identification, address: { city: "Bogotá", zip_code: "110111" }, phone: { area_code: "57", number: "3001234567" } });
    expect(result.transaction_details).toEqual({ financial_institution: "1007" });
  });
  it.each(["firstName", "lastName", "streetName", "streetNumber", "neighborhood", "city", "zipCode", "phone"])("no omite %s", (field) => {
    expect(pseDetailsSchema.safeParse({ ...details, [field]: "" }).success).toBe(false);
  });
  it.each([ ["essential_monthly", 9000], ["pro_monthly", 29000], ["enterprise_monthly", 299000] ] as const)("PSE conserva el importe autorizado para %s", (plan, amount) => {
    const result = brickPaymentRequest({ form: withPseDetails(form, details), plan, userId: "11111111-2222-4333-8444-555555555555", accountEmail: null, ip: "190.0.0.1", callbackUrl: "https://humanix.lat/pago/exito", notificationUrl: "https://humanix.lat/api/public/mercadopago/webhook" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.transaction_amount).toBe(amount);
  });
});