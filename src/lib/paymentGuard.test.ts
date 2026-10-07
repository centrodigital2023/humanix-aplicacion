import { describe, it, expect } from "vitest";
import {
  buildPlanInquiryMessage,
  containsPaymentInstruction,
  guardOutgoing,
  hasDisallowedUrl,
} from "../../supabase/functions/_shared/paymentGuard";

const HOSTS = ["humanix.lat", "wa.me"];
const SAFE = "Los pagos se realizan únicamente en la página.";

describe("paymentGuard", () => {
  it("lets informational plan replies through", () => {
    const r = guardOutgoing("Conoce los planes en https://humanix.lat/planes", SAFE, HOSTS);
    expect(r.blocked).toBe(false);
  });

  it("blocks Mercado Pago links and payment instructions", () => {
    expect(guardOutgoing("Paga aquí: https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=1", SAFE, HOSTS).blocked).toBe(true);
    expect(guardOutgoing("Tu enlace de pago es este", SAFE, HOSTS).blocked).toBe(true);
    expect(containsPaymentInstruction("Transfiere a la cuenta de ahorros 123")).toBe(true);
    expect(containsPaymentInstruction("Nequi: 3001234567")).toBe(true);
  });

  it("blocks URLs outside the allowlist", () => {
    expect(hasDisallowedUrl("mira https://pagos-falsos.example/x", HOSTS)).toBe(true);
    expect(hasDisallowedUrl("mira https://www.humanix.lat/planes", HOSTS)).toBe(false);
  });

  it("replaces blocked text with the safe reply", () => {
    expect(guardOutgoing("checkout_url=abc", SAFE, HOSTS).text).toBe(SAFE);
  });

  it("builds a plan inquiry message without payment content", () => {
    const m = buildPlanInquiryMessage("Plan IPS <script>");
    expect(m).toContain("No deseo realizar un pago");
    expect(m).not.toContain("<");
    expect(containsPaymentInstruction(m)).toBe(false);
  });
});
