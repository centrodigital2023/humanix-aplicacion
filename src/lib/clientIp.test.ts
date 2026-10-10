import { describe, expect, it } from "vitest";
import { clientIp } from "./clientIp";

const from = (h: Record<string, string>) => (n: string) => h[n];

describe("clientIp", () => {
  it("prefiere el encabezado de Cloudflare aunque el cliente mande otro x-forwarded-for", () => {
    // Un atacante que escribe x-forwarded-for no puede cambiar de IP ante los límites.
    expect(
      clientIp(from({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" })),
    ).toBe("203.0.113.9");
    expect(clientIp(from({ "cf-connecting-ip": "  203.0.113.9  " }))).toBe("203.0.113.9");
  });

  it("sin Cloudflare usa x-forwarded-for y luego x-real-ip", () => {
    expect(clientIp(from({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(from({ "x-real-ip": "4.4.4.4" }))).toBe("4.4.4.4");
    expect(clientIp(from({ "x-forwarded-for": "  ", "x-real-ip": "4.4.4.4" }))).toBe("4.4.4.4");
  });

  it("sin ningún encabezado devuelve «unknown»", () => {
    expect(clientIp(() => undefined)).toBe("unknown");
    expect(clientIp(from({ "cf-connecting-ip": "" }))).toBe("unknown");
  });
});
