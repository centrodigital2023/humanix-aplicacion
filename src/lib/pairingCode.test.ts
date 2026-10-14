import { describe, expect, it } from "vitest";
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  generatePairingCode,
  isCurrentPairingCode,
  type FillRandom,
} from "./pairingCode";

/** Una fuente repetible (no criptográfica) para probar la forma del código. */
function seeded(seed: number): FillRandom {
  let s = seed >>> 0;
  return (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      bytes[i] = s >>> 24;
    }
    return bytes;
  };
}

describe("código de emparejamiento", () => {
  it("el alfabeto tiene 32 símbolos sin I, O, 0 ni 1 (no se confunden al copiar)", () => {
    expect(PAIRING_ALPHABET).toHaveLength(32);
    expect(new Set(PAIRING_ALPHABET).size).toBe(32);
    expect(PAIRING_ALPHABET).not.toMatch(/[IO01]/);
    expect(256 % PAIRING_ALPHABET.length).toBe(0); // sin sesgo al tomar 5 bits
  });

  it("12 caracteres del alfabeto (60 bits)", () => {
    const code = generatePairingCode();
    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(PAIRING_CODE_LENGTH * Math.log2(PAIRING_ALPHABET.length)).toBeGreaterThanOrEqual(60);
    for (const ch of code) expect(PAIRING_ALPHABET).toContain(ch);
    expect(isCurrentPairingCode(code)).toBe(true);
  });

  it("con la fuente del navegador no se repite (miles de códigos, ninguno igual)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generatePairingCode());
    expect(seen.size).toBe(5000);
  });

  it("reparte los símbolos por igual (sin sesgo apreciable)", () => {
    const random = seeded(42);
    const counts = new Map<string, number>();
    const n = 3200; // códigos de 12 → 38 400 símbolos, 1 200 de cada uno en promedio
    for (let i = 0; i < n; i++)
      for (const ch of generatePairingCode(12, random)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const expected = (n * 12) / 32;
    for (const ch of PAIRING_ALPHABET) {
      const c = counts.get(ch) ?? 0;
      expect(Math.abs(c - expected) / expected, `${ch}: ${c}`).toBeLessThan(0.1);
    }
  });

  it("depende solo de la fuente: la misma fuente, el mismo código; no usa la hora", () => {
    expect(generatePairingCode(12, seeded(7))).toBe(generatePairingCode(12, seeded(7)));
    expect(generatePairingCode(12, seeded(7))).not.toBe(generatePairingCode(12, seeded(8)));
  });

  it("cada byte aporta sus 5 bits bajos", () => {
    const fixed: FillRandom = (b) => b.map((_, i) => i * 3);
    expect(generatePairingCode(12, fixed)).toBe(
      Array.from({ length: 12 }, (_, i) => PAIRING_ALPHABET[(i * 3) & 31]).join(""),
    );
  });

  it("no acepta largos más cortos que 12 ni fuentes rotas", () => {
    expect(() => generatePairingCode(8)).toThrow();
    expect(() => generatePairingCode(65)).toThrow();
    expect(() => generatePairingCode(12.5)).toThrow();
    expect(() => generatePairingCode(12, () => new Uint8Array(3))).toThrow(/aleatorios/);
  });

  it("los códigos de 8 caracteres de antes no cuentan como actuales", () => {
    expect(isCurrentPairingCode("ABCD2345")).toBe(false);
    expect(isCurrentPairingCode("abcdefghjklm")).toBe(false);
    expect(isCurrentPairingCode("ABCDEFGHJKLM")).toBe(true);
    expect(isCurrentPairingCode("ABCDEFGHJKL0")).toBe(false);
  });
});
