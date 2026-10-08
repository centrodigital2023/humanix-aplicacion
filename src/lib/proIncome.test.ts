import { describe, it, expect } from "vitest";
import {
  CO_RULES,
  comparePaidPlan,
  goalProgress,
  monthlyContributions,
  projectIncome,
  requiredHourlyRate,
  solidarityRate,
} from "./proIncome";

describe("solidarityRate", () => {
  it("escala por tramos de salarios mínimos", () => {
    expect(solidarityRate(3.99)).toBe(0);
    expect(solidarityRate(4)).toBe(0.01);
    expect(solidarityRate(15.99)).toBe(0.01);
    expect(solidarityRate(16)).toBe(0.012);
    expect(solidarityRate(19.5)).toBe(0.018);
    expect(solidarityRate(20)).toBe(0.02);
    expect(solidarityRate(25)).toBe(0.02);
  });
});

describe("monthlyContributions", () => {
  it("con ingresos bajo un salario mínimo no inventa aportes", () => {
    expect(monthlyContributions(1_500_000)).toMatchObject({ applicable: false, total: 0 });
  });

  it("aplica el piso de un salario mínimo como base", () => {
    const c = monthlyContributions(2_860_000);
    expect(c).toEqual({
      applicable: true,
      ibc: 1_750_905,
      health: 218_863,
      pension: 280_145,
      arl: 9_140,
      solidarity: 0,
      total: 508_148,
    });
  });

  it("usa el 40 % del ingreso cuando supera el piso", () => {
    const c = monthlyContributions(10_398_000);
    expect(c.ibc).toBe(4_159_200);
    expect(c.health).toBe(519_900);
    expect(c.pension).toBe(665_472);
    expect(c.arl).toBe(21_711);
    expect(c.total).toBe(1_207_083);
  });

  it("suma el fondo de solidaridad desde 4 salarios mínimos de base", () => {
    const c = monthlyContributions(20_000_000);
    expect(c.ibc).toBe(8_000_000);
    expect(c.solidarity).toBe(80_000);
    expect(c.total).toBe(1_000_000 + 1_280_000 + 41_760 + 80_000);
  });

  it("respeta el tope de 25 salarios mínimos y la clase de riesgo ARL", () => {
    const capped = monthlyContributions(200_000_000);
    expect(capped.ibc).toBe(CO_RULES.smmlv * 25);
    expect(capped.solidarity).toBe(Math.round(CO_RULES.smmlv * 25 * 0.02));
    const high = monthlyContributions(2_860_000, 3);
    expect(high.arl).toBe(Math.round(1_750_905 * 0.02436));
  });

  it("no aplica si la persona no cotiza como independiente", () => {
    expect(monthlyContributions(5_000_000, 1, false).applicable).toBe(false);
  });
});

describe("projectIncome", () => {
  it("proyecta un plan Free con comisión del 12 %", () => {
    const p = projectIncome({
      hoursPerWeek: 30,
      hourlyRate: 25000,
      commissionPct: 12,
      paysContributions: true,
    });
    expect(p.hoursPerMonth).toBe(130);
    expect(p.grossMonthly).toBe(3_250_000);
    expect(p.commission).toBe(390_000);
    expect(p.billedMonthly).toBe(2_860_000);
    expect(p.contributions.total).toBe(508_148);
    expect(p.netMonthly).toBe(2_351_852);
    expect(p.netPerHour).toBe(18_091);
    expect(p.belowMinimumWage).toBe(false);
    expect(p.notes.join(" ")).toMatch(/mínimo legal/);
  });

  it("sin comisión el neto sube exactamente lo que se evita pagar", () => {
    const base = { hoursPerWeek: 30, hourlyRate: 25000, paysContributions: true } as const;
    const free = projectIncome({ ...base, commissionPct: 12 });
    const paid = projectIncome({ ...base, commissionPct: 0 });
    expect(paid.netMonthly - free.netMonthly).toBe(390_000);
  });

  it("avisa cuando el ingreso queda bajo el mínimo y explica la cotización", () => {
    const p = projectIncome({
      hoursPerWeek: 10,
      hourlyRate: 20000,
      commissionPct: 12,
      paysContributions: true,
    });
    expect(p.contributions.applicable).toBe(false);
    expect(p.belowMinimumWage).toBe(true);
    expect(p.notes.join(" ")).toMatch(/Piso de Protección Social/);
  });

  it("tolera entradas inválidas", () => {
    const p = projectIncome({
      hoursPerWeek: NaN,
      hourlyRate: -3,
      commissionPct: 500,
      paysContributions: true,
    });
    expect(p.grossMonthly).toBe(0);
    expect(p.netMonthly).toBe(0);
    expect(p.netPerHour).toBe(0);
  });
});

describe("requiredHourlyRate", () => {
  it("encuentra la menor tarifa que alcanza la meta aun con el salto de los aportes", () => {
    const r = requiredHourlyRate({
      targetNetMonthly: 2_000_000,
      hoursPerWeek: 30,
      commissionPct: 12,
      paysContributions: true,
    });
    expect(r).toEqual({ rate: 22_000, reachable: true });
  });

  it("reporta cuando la meta es inalcanzable o faltan datos", () => {
    expect(
      requiredHourlyRate({
        targetNetMonthly: 100_000_000,
        hoursPerWeek: 5,
        commissionPct: 12,
        paysContributions: true,
      }),
    ).toEqual({ rate: null, reachable: false });
    expect(
      requiredHourlyRate({
        targetNetMonthly: 0,
        hoursPerWeek: 5,
        commissionPct: 12,
        paysContributions: true,
      }),
    ).toEqual({ rate: null, reachable: false });
  });
});

describe("comparePaidPlan", () => {
  it("calcula el ahorro y el punto de equilibrio frente a la comisión", () => {
    const c = comparePaidPlan({ grossMonthly: 500_000, planPrice: 9000 });
    expect(c).toEqual({
      commissionAvoided: 60_000,
      planPrice: 9000,
      monthlySavings: 51_000,
      breakEvenMonthly: 75_000,
      worthIt: true,
    });
  });
  it("con poca facturación el plan no compensa", () => {
    const c = comparePaidPlan({ grossMonthly: 50_000, planPrice: 9000 });
    expect(c.monthlySavings).toBe(-3000);
    expect(c.worthIt).toBe(false);
  });
});

describe("goalProgress", () => {
  it("calcula avance y horas faltantes", () => {
    expect(goalProgress({ confirmedHours: 45, targetHours: 120 })).toEqual({
      pct: 38,
      remainingHours: 75,
    });
    expect(goalProgress({ confirmedHours: 200, targetHours: 120 })).toEqual({
      pct: 100,
      remainingHours: 0,
    });
    expect(goalProgress({ confirmedHours: 10, targetHours: 0 })).toEqual({
      pct: 0,
      remainingHours: 0,
    });
  });
});
