import { describe, expect, it } from "vitest";
import { canActFromMap, pendingDocsCopy, pinTone } from "./mapVerification";
import { verificationFrom } from "./liveMap";

describe("pinTone", () => {
  it("documentos pendientes pintan ámbar aunque esté disponible", () => {
    expect(pinTone({ verification: "pending", dim: false })).toBe("pending");
  });
  it("verificado: verde si está disponible, gris si está ocupado", () => {
    expect(pinTone({ verification: "verified", dim: false })).toBe("available");
    expect(pinTone({ verification: "verified", dim: true })).toBe("busy");
  });
});

describe("canActFromMap", () => {
  it("un profesional con documentos pendientes no se puede pedir ni asignar", () => {
    expect(canActFromMap({ kind: "pro", verification: "pending" })).toBe(false);
  });
  it("un profesional verificado y disponible sí", () => {
    expect(canActFromMap({ kind: "pro", verification: "verified" })).toBe(true);
    expect(canActFromMap({ kind: "pro", verification: "verified", dim: true })).toBe(false);
  });
  it("la oferta de una familia o institución pendiente se puede ver", () => {
    expect(canActFromMap({ kind: "family", verification: "pending" })).toBe(true);
    expect(canActFromMap({ kind: "institution", verification: "pending" })).toBe(true);
  });
});

describe("pendingDocsCopy", () => {
  it("a la propia cuenta le pide subir los documentos, citando la Ley 1581", () => {
    const c = pendingDocsCopy("pro", true);
    expect(c.body).toContain("Ley 1581 de 2012");
    expect(c.body).toContain("Sube tus documentos faltantes para activar servicios inmediatos");
    expect(c.cta?.to).toBe("/dashboard/profesional");
  });
  it("a los demás les explica por qué no se puede pedir, sin acción", () => {
    const c = pendingDocsCopy("pro", false);
    expect(c.body).toContain("no se puede pedir ni asignar");
    expect(c.cta).toBeNull();
  });
});

describe("verificationFrom", () => {
  it("respeta la columna de la base", () => {
    expect(verificationFrom("pending", true)).toBe("pending");
    expect(verificationFrom("verified", false)).toBe("verified");
  });
  it("sin columna usa el respaldo", () => {
    expect(verificationFrom(undefined, true)).toBe("verified");
    expect(verificationFrom(null, false)).toBe("pending");
  });
});
