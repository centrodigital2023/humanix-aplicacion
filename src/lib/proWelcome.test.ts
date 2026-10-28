import { describe, expect, it } from "vitest";
import { missingWelcomeDocs, proWelcomeSteps, shouldShowProWelcome } from "./proWelcome";

const empty = {
  avatarUrl: null,
  specialty: "",
  cities: "",
  hourlyRate: "" as const,
  docs: {},
  available: false,
};

describe("proWelcomeSteps", () => {
  it("un recién registrado tiene los cuatro pasos pendientes", () => {
    expect(proWelcomeSteps(empty).map((s) => s.done)).toEqual([false, false, false, false]);
  });

  it("«Lo que haces» pide especialidad, ciudad y tarifa", () => {
    const step = (over: Partial<typeof empty> | Record<string, unknown>) =>
      proWelcomeSteps({ ...empty, ...over }).find((s) => s.key === "work")!.done;
    expect(step({ specialty: "Enfermería", cities: "Cali" })).toBe(false);
    expect(step({ specialty: "Enfermería", cities: "Cali", hourlyRate: 0 })).toBe(false);
    expect(step({ specialty: "Enfermería", cities: "Cali", hourlyRate: 25000 })).toBe(true);
  });

  it("los documentos piden cédula, RETHUS o diploma y hoja de vida", () => {
    expect(missingWelcomeDocs({})).toEqual(["Cédula", "RETHUS o diploma", "Hoja de vida"]);
    expect(missingWelcomeDocs({ id_document: true, diploma: true })).toEqual(["Hoja de vida"]);
    expect(missingWelcomeDocs({ id_document: true, rethus: true, cv: true })).toEqual([]);
  });
});

describe("shouldShowProWelcome", () => {
  const done = proWelcomeSteps({
    avatarUrl: "x",
    specialty: "Enfermería",
    cities: "Cali",
    hourlyRate: 25000,
    docs: { id_document: true, rethus: true, cv: true },
    available: true,
  });

  it("sale al entrar mientras falte algo y no la haya cerrado", () => {
    expect(shouldShowProWelcome(false, proWelcomeSteps(empty))).toBe(true);
    expect(shouldShowProWelcome(true, proWelcomeSteps(empty))).toBe(false);
    expect(shouldShowProWelcome(false, done)).toBe(false);
  });
});
