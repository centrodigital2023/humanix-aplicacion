import { describe, expect, it } from "vitest";
import {
  WELCOME_WINDOW_MS,
  markWelcomeSeen,
  readWelcomeSeen,
  shouldShowFamilyWelcome,
  welcomeSteps,
} from "./familyWelcome";

const now = Date.parse("2026-10-28T12:00:00Z");

describe("shouldShowFamilyWelcome", () => {
  it("se muestra a una cuenta recién creada que no la ha visto", () => {
    expect(shouldShowFamilyWelcome({ createdAt: "2026-10-28T11:59:00Z", now, seen: false })).toBe(
      true,
    );
  });
  it("no se muestra si ya la vio", () => {
    expect(shouldShowFamilyWelcome({ createdAt: "2026-10-28T11:59:00Z", now, seen: true })).toBe(
      false,
    );
  });
  it("no se muestra a una cuenta vieja ni sin fecha", () => {
    const old = new Date(now - WELCOME_WINDOW_MS - 1).toISOString();
    expect(shouldShowFamilyWelcome({ createdAt: old, now, seen: false })).toBe(false);
    expect(shouldShowFamilyWelcome({ createdAt: null, now, seen: false })).toBe(false);
    expect(shouldShowFamilyWelcome({ createdAt: "no-es-fecha", now, seen: false })).toBe(false);
  });
});

describe("marca de bienvenida vista", () => {
  it("se guarda y se lee por usuario", () => {
    const m = new Map<string, string>();
    const storage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(readWelcomeSeen(storage, "u1")).toBe(false);
    markWelcomeSeen(storage, "u1");
    expect(readWelcomeSeen(storage, "u1")).toBe(true);
    expect(readWelcomeSeen(storage, "u2")).toBe(false);
  });
  it("sin almacenamiento cuenta como vista (no insiste)", () => {
    expect(readWelcomeSeen(null, "u1")).toBe(true);
    const broken = {
      getItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(readWelcomeSeen(broken, "u1")).toBe(true);
  });
});

it("welcomeSteps marca lo que ya está", () => {
  const steps = welcomeSteps({ idNumber: "123", address: " ", emergencyPhone: null });
  expect(steps.map((s) => s.done)).toEqual([true, false, false]);
});
