import { describe, it, expect } from "vitest";
import { namesMatch, normalizeName, remainingAttempts, isValidDocumentNumber } from "./rethusVerification";

describe("rethusVerification", () => {
  it("normaliza tildes y espacios", () => {
    expect(normalizeName("  José  Fabián Pérez ")).toBe("JOSE FABIAN PEREZ");
  });
  it("compara nombres con tolerancia", () => {
    expect(namesMatch("José Pérez", "PEREZ GOMEZ JOSE FABIAN")).toBe(true);
    expect(namesMatch("María López", "PEREZ GOMEZ JOSE")).toBe(false);
    expect(namesMatch("", "PEREZ")).toBe(false);
  });
  it("cuenta intentos en 24 h", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const recent = "2026-10-08T10:00:00Z";
    const old = "2026-10-06T10:00:00Z";
    expect(remainingAttempts([], now)).toBe(3);
    expect(remainingAttempts([recent, recent, old], now)).toBe(1);
    expect(remainingAttempts([recent, recent, recent, recent], now)).toBe(0);
  });
  it("valida documento", () => {
    expect(isValidDocumentNumber("1234567890")).toBe(true);
    expect(isValidDocumentNumber("12a4")).toBe(false);
  });
});
