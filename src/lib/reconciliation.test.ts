import { describe, expect, it } from "vitest";
import {
  expectedFiruxBalance,
  ledgerBalanced,
  ledgerToCsv,
  normalizeReconciliation,
} from "./reconciliation";

describe("conciliación", () => {
  // Mismo escenario que la prueba de la migración en Postgres: 3 turnos de $100k, $80k y $60k al 15 %, uno
  // dispersado, uno sin llave, uno cancelado y devuelto, y $9.000 de comisión de efectivo.
  const accounts = {
    external: -95_000,
    escrow: 0,
    professional: 68_000,
    in_transit: 0,
    platform: 36_000,
    wallet: -9_000,
  };
  it("lo que debe haber en Firux y que el libro cuadre", () => {
    expect(expectedFiruxBalance(accounts)).toBe(95_000);
    expect(ledgerBalanced(accounts)).toBe(true);
    expect(ledgerBalanced({ ...accounts, platform: 35_000 })).toBe(false);
  });
  it("normaliza la respuesta de la base", () => {
    const r = normalizeReconciliation({
      accounts: { escrow: "100", platform: 5 },
      collected_30d: "240000",
      professionals: [{ professional_id: "p", name: "Ana", available: "68000" }],
      issues: [{ code: "payout_stuck", ref: "x", amount_cop: "1" }],
    });
    expect(r.accounts).toMatchObject({ escrow: 100, platform: 5, wallet: 0 });
    expect(r.collected_30d).toBe(240_000);
    expect(r.professionals[0]).toMatchObject({ name: "Ana", available: 68_000, held: 0 });
    expect(r.issues[0]).toMatchObject({
      code: "payout_stuck",
      amount_cop: 1,
      professional_id: null,
    });
    expect(normalizeReconciliation(null).professionals).toEqual([]);
  });
  it("CSV sin fórmulas peligrosas", () => {
    const csv = ledgerToCsv([
      {
        created_at: "2026-11-05",
        ref: "charge:1",
        from_account: "external",
        from_pro: null,
        to_account: "escrow",
        to_pro: null,
        amount_cop: 100000,
        booking_id: "b",
        memo: "=HYPERLINK(1), pago",
      },
    ]);
    const [head, line] = csv.split("\n");
    expect(head.startsWith("fecha,ref")).toBe(true);
    expect(line).toContain(`"'=HYPERLINK(1), pago"`);
  });
});
