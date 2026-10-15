import { describe, expect, it } from "vitest";
import { extraCreditsFromTopups } from "./aiCreditsBalance";

const NOW = Date.parse("2026-10-15T15:00:00Z");
const DAY = 86_400_000;
const row = (credits: unknown, used: unknown, days: number | null) => ({
  credits: credits as number,
  credits_used: used as number,
  expires_at: days === null ? null : new Date(NOW + days * DAY).toISOString(),
});

describe("saldo de créditos IA desde los paquetes", () => {
  it("sin paquetes no hay saldo", () => {
    expect(extraCreditsFromTopups([], NOW)).toEqual({
      extra_total: 0,
      extra_used: 0,
      extra_remaining: 0,
    });
  });

  it("suma solo los paquetes vigentes", () => {
    expect(
      extraCreditsFromTopups([row(100, 30, 10), row(50, 0, -1), row(40, 5, null)], NOW),
    ).toEqual({
      extra_total: 100,
      extra_used: 30,
      extra_remaining: 70,
    });
  });

  it("datos dañados no producen saldo negativo ni créditos regalados", () => {
    expect(
      extraCreditsFromTopups([row(100, 500, 5), row(-20, 0, 5), row("x", -3, 5)], NOW),
    ).toEqual({
      extra_total: 100,
      extra_used: 100,
      extra_remaining: 0,
    });
  });
});
