import { describe, expect, it } from "vitest";
import { buildCheckoutUrl, integrityString, verifyWompiEvent } from "./wompi";

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("wompi", () => {
  it("firma de integridad: referencia + centavos + moneda + secreto", () => {
    expect(
      integrityString({ reference: "sk8-438k4-xmxm392-sn2m", amountInCents: 2490000, currency: "COP", secret: "test_integrity_x" }),
    ).toBe("sk8-438k4-xmxm392-sn2m2490000COPtest_integrity_x");
  });

  it("el enlace cobra el monto en centavos con la referencia del cobro", async () => {
    const url = new URL(
      await buildCheckoutUrl(
        { publicKey: "pub_test_1", integritySecret: "s", redirectUrl: "https://humanix.lat/pago/exito" },
        { reference: "abc", amountCop: 80000 },
      ),
    );
    expect(url.searchParams.get("amount-in-cents")).toBe("8000000");
    expect(url.searchParams.get("reference")).toBe("abc");
    expect(url.searchParams.get("signature:integrity")).toBe(await sha("abc8000000COPs"));
  });

  it("acepta un aviso bien firmado y rechaza uno alterado", async () => {
    const tx = { id: "t1", status: "APPROVED", amount_in_cents: 8000000, reference: "abc" };
    const ts = 1530291411;
    const checksum = await sha(`t1APPROVED8000000${ts}evsecret`);
    const body = {
      event: "transaction.updated",
      data: { transaction: tx },
      signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum },
      timestamp: ts,
    };
    const ok = await verifyWompiEvent(JSON.stringify(body), "evsecret");
    expect(ok).toMatchObject({ reference: "abc", status: "APPROVED", amountCop: 80000 });
    body.data.transaction.amount_in_cents = 100;
    expect(await verifyWompiEvent(JSON.stringify(body), "evsecret")).toBeNull();
  });
});
