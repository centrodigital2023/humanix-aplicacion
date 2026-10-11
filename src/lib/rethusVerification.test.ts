import { describe, it, expect } from "vitest";
import {
  namesMatch,
  normalizeName,
  isValidDocumentNumber,
  hasConsumedSingleAttempt,
  missingPrerequisite,
  isActiveSubscription,
  adminRemaining,
} from "./rethusVerification";

describe("rethusVerification", () => {
  it("normaliza tildes y espacios", () => {
    expect(normalizeName("  José  Fabián Pérez ")).toBe("JOSE FABIAN PEREZ");
  });
  it("compara nombres con tolerancia", () => {
    expect(namesMatch("José Pérez", "PEREZ GOMEZ JOSE FABIAN")).toBe(true);
    expect(namesMatch("María López", "PEREZ GOMEZ JOSE")).toBe(false);
    expect(namesMatch("", "PEREZ")).toBe(false);
  });
  it("valida documento", () => {
    expect(isValidDocumentNumber("1234567890")).toBe(true);
    expect(isValidDocumentNumber("12a4")).toBe(false);
  });
  it("intento único: estados finales lo consumen, error no", () => {
    expect(hasConsumedSingleAttempt([])).toBe(false);
    expect(hasConsumedSingleAttempt([{ status: "error" }, { status: "error" }])).toBe(false);
    expect(hasConsumedSingleAttempt([{ status: "verified" }])).toBe(true);
    expect(hasConsumedSingleAttempt([{ status: "not_found" }])).toBe(true);
    expect(hasConsumedSingleAttempt([{ status: "name_mismatch" }])).toBe(true);
  });
  it("re-verificaciones de admin no cuentan como intento del profesional", () => {
    expect(hasConsumedSingleAttempt([{ status: "verified", reverified: true }])).toBe(false);
  });
  it("exige las tres condiciones en orden", () => {
    expect(missingPrerequisite({ hasConsent: false, hasActivePlan: true, hasDocument: true })).toBe(
      "consent_required",
    );
    expect(missingPrerequisite({ hasConsent: true, hasActivePlan: false, hasDocument: true })).toBe(
      "plan_required",
    );
    expect(missingPrerequisite({ hasConsent: true, hasActivePlan: true, hasDocument: false })).toBe(
      "document_required",
    );
    expect(
      missingPrerequisite({ hasConsent: true, hasActivePlan: true, hasDocument: true }),
    ).toBeNull();
  });
  it("plan activo solo con suscripción vigente", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(isActiveSubscription(null, now)).toBe(false);
    expect(isActiveSubscription({ status: "pending", current_period_end: null }, now)).toBe(false);
    expect(
      isActiveSubscription({ status: "active", current_period_end: "2026-10-01T00:00:00Z" }, now),
    ).toBe(false);
    expect(
      isActiveSubscription({ status: "active", current_period_end: "2026-11-01T00:00:00Z" }, now),
    ).toBe(true);
    expect(isActiveSubscription({ status: "approved", current_period_end: null }, now)).toBe(true);
  });
  it("límite admin de 20 por hora", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const recent = Array(20).fill("2026-10-08T11:30:00Z");
    expect(adminRemaining([], now)).toBe(20);
    expect(adminRemaining(recent, now)).toBe(0);
    expect(adminRemaining([...recent.slice(0, 5), "2026-10-08T10:00:00Z"], now)).toBe(15);
  });
});
