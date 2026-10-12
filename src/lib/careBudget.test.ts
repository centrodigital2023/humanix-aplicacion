import { describe, expect, it } from "vitest";
import {
  BUDGET_MONTHS,
  MIN_SERVICES_FOR_CANCEL,
  MIN_SERVICES_FOR_RATE,
  buildBudgetReport,
  type BudgetBooking,
} from "./careBudget";
import { DAY, HOUR, NOW, aheadIn, booking, doneAgo, iso, mulberry32 } from "./familyIntel.fixture";
import type { MarketStats } from "./negotiation";

const market = (over: Partial<MarketStats> = {}): MarketStats => ({
  n: 12,
  p25: 20_000,
  median: 24_000,
  p75: 28_000,
  ...over,
});

/** Un escenario con todo calculado a mano (hoy: miércoles 14 de octubre de 2026, 10:00 en Colombia). */
const scenario = (): BudgetBooking[] => [
  // octubre: 4 servicios terminados de $150.000
  doneAgo(12),
  doneAgo(9),
  doneAgo(5),
  doneAgo(2),
  // septiembre: el 3, el 10 (antes del día 14) y el 20
  doneAgo(41),
  doneAgo(34),
  doneAgo(24),
  // programados en octubre
  aheadIn(6),
  aheadIn(13),
];

describe("gasto por mes", () => {
  it("devuelve 6 meses terminando en el actual, del más viejo al más nuevo", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    expect(r.months).toHaveLength(BUDGET_MONTHS);
    expect(r.months.map((m) => m.key)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(r.months.map((m) => m.isCurrent)).toEqual([false, false, false, false, false, true]);
    expect(r.months[5].label).toBe("oct 2026");
  });

  it("separa lo gastado (terminado) de lo comprometido (programado) y cuenta horas y servicios", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    const oct = r.months[5];
    expect(oct).toMatchObject({ spent: 600_000, committed: 300_000, hours: 24, services: 4 });
    const sep = r.months[4];
    expect(sep).toMatchObject({ spent: 450_000, committed: 0, hours: 18, services: 3 });
    expect(r.months[0]).toMatchObject({ spent: 0, committed: 0, hours: 0, services: 0 });
  });

  it("el mes lo decide la hora de Colombia, no la de UTC", () => {
    const now = Date.parse("2026-11-03T15:00:00Z");
    const rows = [
      // 30 sep 22:00 en Colombia = 1 oct 03:00 UTC → septiembre
      booking({
        scheduled_at: "2026-10-01T01:00:00Z",
        completed_at: "2026-10-01T03:00:00Z",
        total_amount: 100_000,
      }),
      // 31 oct 23:59 en Colombia = 1 nov 04:59 UTC → octubre
      booking({
        scheduled_at: "2026-11-01T01:00:00Z",
        completed_at: "2026-11-01T04:59:00Z",
        total_amount: 200_000,
      }),
      // 1 nov 00:01 en Colombia = 1 nov 05:01 UTC → noviembre
      booking({
        scheduled_at: "2026-11-01T03:00:00Z",
        completed_at: "2026-11-01T05:01:00Z",
        total_amount: 400_000,
      }),
    ];
    const r = buildBudgetReport({ bookings: rows, now });
    const by = Object.fromEntries(r.months.map((m) => [m.key, m.spent]));
    expect(by["2026-09"]).toBe(100_000);
    expect(by["2026-10"]).toBe(200_000);
    expect(by["2026-11"]).toBe(400_000);
  });

  it("en enero los meses anteriores cruzan el año", () => {
    const r = buildBudgetReport({ bookings: [], now: Date.parse("2026-01-15T15:00:00Z") });
    expect(r.months.map((m) => m.key)).toEqual([
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });

  it("una solicitud pendiente (sin confirmar) no se cuenta como gasto programado", () => {
    const r = buildBudgetReport({
      bookings: [aheadIn(3, { status: "pending" }), aheadIn(4)],
      now: NOW,
    });
    expect(r.months[5].committed).toBe(150_000); // solo la confirmada
    expect(r.current.projectedLow).toBe(150_000);
  });

  it("lo cancelado no cuenta como gasto ni como compromiso", () => {
    const r = buildBudgetReport({
      bookings: [
        booking({ status: "cancelled", completed_at: null }),
        aheadIn(3, { status: "cancelled" }),
      ],
      now: NOW,
    });
    expect(r.months[5]).toMatchObject({ spent: 0, committed: 0, services: 0 });
    expect(r.hasData).toBe(false);
  });
});

describe("proyección del mes en curso", () => {
  it("es un rango: lo ejecutado más lo programado, y hasta el ritmo de las últimas 4 semanas", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    expect(r.current).toMatchObject({
      key: "2026-10",
      spentToDate: 600_000,
      committed: 300_000,
      projectedLow: 900_000,
      weeklyPace: 187_500, // 5 servicios terminados en 28 días = $750.000 / 4 semanas
      daysLeft: 17, // del 14 al 31 de octubre
    });
    // 600.000 + máx(300.000 programados, 187.500 × 17 / 7 = 455.357)
    expect(r.current.projectedHigh).toBe(1_055_357);
  });

  it("el tope nunca baja del piso y, sin ritmo suficiente, es igual al piso", () => {
    const r = buildBudgetReport({ bookings: [doneAgo(2), aheadIn(5)], now: NOW });
    expect(r.current.weeklyPace).toBeNull(); // un solo servicio en 28 días no es un ritmo
    expect(r.current.projectedHigh).toBe(r.current.projectedLow);
    expect(r.current.projectedLow).toBe(300_000);
  });

  it("si lo programado ya supera al ritmo, manda lo programado", () => {
    const rows = [
      doneAgo(10),
      doneAgo(3),
      aheadIn(2),
      aheadIn(4),
      aheadIn(6),
      aheadIn(8),
      aheadIn(10),
      aheadIn(12),
    ];
    const r = buildBudgetReport({ bookings: rows, now: NOW });
    expect(r.current.weeklyPace).toBe(75_000); // $300.000 / 4
    expect(r.current.projectedLow).toBe(300_000 + 900_000);
    expect(r.current.projectedHigh).toBe(r.current.projectedLow);
  });

  it("el último día del mes ya no queda ritmo por proyectar", () => {
    const now = Date.parse("2026-10-31T20:00:00Z"); // 31 oct, 15:00 en Colombia
    const rows = [doneAgo(0, {}), doneAgo(7)].map((b, i) => ({
      ...b,
      scheduled_at: new Date(now - (i === 0 ? 0 : 7 * DAY)).toISOString(),
      completed_at: new Date(now - (i === 0 ? 0 : 7 * DAY) + HOUR).toISOString(),
    }));
    const r = buildBudgetReport({ bookings: rows, now });
    expect(r.current.daysLeft).toBe(0);
    expect(r.current.projectedHigh).toBe(r.current.projectedLow);
  });
});

describe("contra el mes pasado, al mismo día", () => {
  it("compara lo gastado hasta hoy con lo gastado hasta el día 14 del mes pasado", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    // septiembre hasta el día 14: el 3 y el 10 = $300.000 (el del 20 no entra)
    expect(r.vsLastMonth).toEqual({
      spentToDate: 600_000,
      lastMonthSameSpan: 300_000,
      deltaPct: 100,
    });
  });

  it("el mismo día del mes pasado entra en la comparación (el 14 también)", () => {
    // 14 de septiembre, 16:00 en Colombia: hoy es 14 de octubre
    const r = buildBudgetReport({ bookings: [doneAgo(2), doneAgo(30)], now: NOW });
    expect(r.vsLastMonth.lastMonthSameSpan).toBe(150_000);
    // el 15 de septiembre todavía no había pasado a esta altura del mes
    const r2 = buildBudgetReport({ bookings: [doneAgo(2), doneAgo(29)], now: NOW });
    expect(r2.vsLastMonth.lastMonthSameSpan).toBe(0);
  });

  it("sin gasto el mes pasado no inventa un porcentaje", () => {
    const r = buildBudgetReport({ bookings: [doneAgo(2)], now: NOW });
    expect(r.vsLastMonth.deltaPct).toBeNull();
  });

  it("un gasto menor da un porcentaje negativo", () => {
    const r = buildBudgetReport({
      bookings: [
        doneAgo(2, { total_amount: 150_000 }),
        doneAgo(41),
        doneAgo(40),
        doneAgo(39),
        doneAgo(38),
      ],
      now: NOW,
    });
    // el 3, 4, 5 y 6 de septiembre = $600.000; hoy $150.000
    expect(r.vsLastMonth.lastMonthSameSpan).toBe(600_000);
    expect(r.vsLastMonth.deltaPct).toBe(-75);
  });
});

describe("costo por hora frente al mercado", () => {
  it("dentro del rango", () => {
    const r = buildBudgetReport({ bookings: scenario(), market: market(), now: NOW });
    expect(r.rate).toMatchObject({
      avgPerHour: 25_000,
      services: 7,
      marketMedian: 24_000,
      position: "within",
      diffPct: 4,
      savingsPerMonth: null,
    });
  });

  it("por encima del rango: calcula cuánto ahorraría negociar a la mediana", () => {
    const r = buildBudgetReport({
      bookings: scenario(),
      market: market({ p25: 18_000, median: 20_000, p75: 22_000 }),
      now: NOW,
    });
    expect(r.rate.position).toBe("above");
    expect(r.rate.diffPct).toBe(25);
    // 42 horas en 90 días = 14 h al mes × ($25.000 − $20.000)
    expect(r.rate.savingsPerMonth).toBe(70_000);
  });

  it("por debajo del rango", () => {
    const r = buildBudgetReport({
      bookings: scenario(),
      market: market({ p25: 30_000, median: 33_000, p75: 36_000 }),
      now: NOW,
    });
    expect(r.rate.position).toBe("below");
    expect(r.rate.savingsPerMonth).toBeNull();
  });

  it("sin mercado, o con una muestra pequeña, no compara", () => {
    for (const m of [
      null,
      undefined,
      market({ n: 3 }),
      market({ p25: null, median: null, p75: null }),
    ]) {
      const r = buildBudgetReport({ bookings: scenario(), market: m, now: NOW });
      expect(r.rate.position).toBe("unknown");
      expect(r.rate.marketMedian).toBeNull();
      expect(r.rate.diffPct).toBeNull();
      expect(r.rate.avgPerHour).toBe(25_000); // el promedio propio sí se conoce
    }
  });

  it(`con menos de ${MIN_SERVICES_FOR_RATE} servicios terminados no hay promedio propio`, () => {
    const r = buildBudgetReport({ bookings: [doneAgo(2), doneAgo(5)], market: market(), now: NOW });
    expect(r.rate.avgPerHour).toBeNull();
    expect(r.rate.position).toBe("unknown");
    expect(r.insights.some((i) => i.id === "small_sample")).toBe(true);
  });

  it("el promedio pesa por horas: un turno largo cuenta más que uno corto", () => {
    const rows = [
      doneAgo(2, { duration_hours: 12, total_amount: 240_000 }), // $20.000/h
      doneAgo(3, { duration_hours: 2, total_amount: 80_000 }), //  $40.000/h
      doneAgo(4, { duration_hours: 2, total_amount: 80_000 }),
    ];
    const r = buildBudgetReport({ bookings: rows, now: NOW });
    expect(r.rate.avgPerHour).toBe(25_000); // 400.000 / 16 h (el promedio simple de tarifas daría 33.333)
  });

  it("solo cuenta los últimos 90 días", () => {
    const rows = [doneAgo(10), doneAgo(20), doneAgo(30), doneAgo(120, { total_amount: 6_000_000 })];
    const r = buildBudgetReport({ bookings: rows, now: NOW });
    expect(r.rate.services).toBe(3);
    expect(r.rate.avgPerHour).toBe(25_000);
  });
});

describe("cancelaciones", () => {
  const cancelled = (daysAgo: number) =>
    doneAgo(daysAgo, { status: "cancelled", completed_at: null, total_amount: 150_000 });

  it("avisa cuando hay muchas, con la cuenta exacta", () => {
    const rows = [doneAgo(2), doneAgo(5), doneAgo(8), doneAgo(11), cancelled(14), cancelled(17)];
    const r = buildBudgetReport({ bookings: rows, now: NOW });
    expect(r.cancellations).toEqual({ count: 2, total: 6, pct: 33 });
    const insight = r.insights.find((i) => i.id === "cancellations");
    expect(insight?.severity).toBe("warn");
    expect(insight?.title).toBe("Se cancelaron 2 servicios de 6 (33 %)");
  });

  it(`con menos de ${MIN_SERVICES_FOR_CANCEL} servicios no habla de porcentaje`, () => {
    const r = buildBudgetReport({
      bookings: [doneAgo(2), doneAgo(5), doneAgo(8), cancelled(11)],
      now: NOW,
    });
    expect(r.cancellations.pct).toBeNull();
    expect(r.insights.some((i) => i.id === "cancellations")).toBe(false);
  });

  it("un porcentaje bajo no genera aviso", () => {
    const rows = [...Array.from({ length: 9 }, (_, i) => doneAgo(i + 1)), cancelled(12)];
    const r = buildBudgetReport({ bookings: rows, now: NOW });
    expect(r.cancellations.pct).toBe(10);
    expect(r.insights.some((i) => i.id === "cancellations")).toBe(false);
  });
});

describe("horas por semana", () => {
  it("compara las últimas 4 semanas con las 4 anteriores", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    expect(r.weeklyHours).toEqual({ last4: 7.5, prev4: 3, deltaPct: 150 });
    expect(r.insights.find((i) => i.id === "hours_trend")?.title).toContain("subieron 150 %");
  });

  it("sin semanas anteriores no hay porcentaje", () => {
    const r = buildBudgetReport({ bookings: [doneAgo(2), doneAgo(4)], now: NOW });
    expect(r.weeklyHours.prev4).toBe(0);
    expect(r.weeklyHours.deltaPct).toBeNull();
  });
});

describe("hallazgos", () => {
  it("sin servicios, un solo mensaje que dice qué esperar", () => {
    const r = buildBudgetReport({ bookings: [], now: NOW });
    expect(r.hasData).toBe(false);
    expect(r.insights.map((i) => i.id)).toEqual(["no_data"]);
  });

  it("los avisos van antes que lo informativo y lo bueno", () => {
    const r = buildBudgetReport({ bookings: scenario(), market: market(), now: NOW });
    expect(r.insights.map((i) => i.id)).toEqual([
      "pace_up",
      "projection",
      "hours_trend",
      "within_market",
    ]);
    expect(r.insights.map((i) => i.severity)).toEqual(["warn", "info", "info", "good"]);
  });

  it("la proyección nombra el rango y el supuesto del ritmo", () => {
    const r = buildBudgetReport({ bookings: scenario(), now: NOW });
    const p = r.insights.find((i) => i.id === "projection")!;
    expect(p.title).toMatch(/^Proyectamos entre .*900\.000.* y .*1\.055\.357.* para oct 2026$/);
    expect(p.detail).toContain("ritmo de las últimas 4 semanas");
  });

  it("avisa cuando el gasto baja bastante frente al mes pasado", () => {
    const r = buildBudgetReport({
      bookings: [doneAgo(2), doneAgo(41), doneAgo(40), doneAgo(39), doneAgo(38), doneAgo(37)],
      now: NOW,
    });
    const down = r.insights.find((i) => i.id === "pace_down");
    expect(down?.severity).toBe("good");
    expect(down?.title).toBe("Vas 80 % por debajo del mes pasado a esta altura");
  });

  it("no comenta un cambio de gasto cuando el monto es pequeño", () => {
    const r = buildBudgetReport({
      bookings: [doneAgo(2, { total_amount: 60_000 }), doneAgo(41, { total_amount: 20_000 })],
      now: NOW,
    });
    expect(r.vsLastMonth.deltaPct).toBe(200);
    expect(r.insights.some((i) => i.id === "pace_up")).toBe(false);
  });

  it("la tarifa por encima del mercado propone una acción concreta", () => {
    const r = buildBudgetReport({
      bookings: scenario(),
      market: market({ p25: 18_000, median: 20_000, p75: 22_000 }),
      now: NOW,
    });
    const above = r.insights.find((i) => i.id === "above_market")!;
    expect(above.severity).toBe("warn");
    expect(above.title).toBe("Pagas 25 % más que la mediana de tu ciudad");
    expect(above.detail).toContain("ahorraría unos");
    expect(above.action).toMatch(/contraoferta/);
  });
});

describe("datos sucios del servidor", () => {
  it("lee números como texto (así llega `numeric`) y ordena por la fecha real", () => {
    const r = buildBudgetReport({
      bookings: [
        booking({ total_amount: "150000.00", duration_hours: "6.00", hourly_rate: "25000.00" }),
        booking({ total_amount: "150000.00", duration_hours: "6.00", hourly_rate: "25000.00" }),
        booking({ total_amount: "150000.00", duration_hours: "6.00", hourly_rate: "25000.00" }),
      ],
      now: NOW,
    });
    expect(r.months[5].spent).toBe(450_000);
    expect(r.rate.avgPerHour).toBe(25_000);
  });

  it("un total que ni siquiera viene en la fila también se reconstruye", () => {
    const row = booking({ hourly_rate: 20_000, duration_hours: 5 });
    delete (row as { total_amount?: unknown }).total_amount;
    expect(buildBudgetReport({ bookings: [row], now: NOW }).months[5].spent).toBe(100_000);
  });

  it("si falta el total, lo reconstruye con tarifa × horas; un total negativo vale 0", () => {
    const r = buildBudgetReport({
      bookings: [
        booking({ total_amount: null, hourly_rate: 20_000, duration_hours: 5 }),
        booking({ total_amount: -50_000 }),
      ],
      now: NOW,
    });
    expect(r.months[5].spent).toBe(100_000);
  });

  it("ignora fechas dañadas y estados desconocidos sin lanzar", () => {
    const r = buildBudgetReport({
      bookings: [
        booking({ scheduled_at: "no-es-fecha", completed_at: null }),
        booking({ status: "otro_estado" }),
        booking({ duration_hours: "abc", total_amount: "xyz" }),
      ],
      now: NOW,
    });
    expect(Number.isFinite(r.current.projectedHigh)).toBe(true);
    expect(r.months[5].spent).toBe(0);
  });
});

describe("invariantes (reservas aleatorias)", () => {
  const STATUSES = [
    "completed",
    "confirmed",
    "pending",
    "in_progress",
    "in_route",
    "cancelled",
    "raro",
  ];
  for (const seed of [1, 9, 77, 2026, 31415]) {
    it(`semilla ${seed}: nada sale NaN, el tope no baja del piso y las sumas cuadran`, () => {
      const rnd = mulberry32(seed);
      const rows: BudgetBooking[] = Array.from({ length: 150 }, () => {
        const offset = (rnd() * 240 - 150) * DAY; // de hace 150 días a dentro de 90
        const hours = rnd() < 0.05 ? "x" : Math.round(rnd() * 12 * 10) / 10;
        const rate = Math.round(rnd() * 40_000);
        return booking({
          status: STATUSES[Math.floor(rnd() * STATUSES.length)],
          scheduled_at: rnd() < 0.03 ? "fecha-rota" : iso(offset),
          completed_at: rnd() < 0.2 ? null : iso(offset + 3 * HOUR),
          duration_hours: hours,
          hourly_rate: rate,
          total_amount:
            rnd() < 0.1 ? null : Math.round(rate * (typeof hours === "number" ? hours : 0)),
        });
      });
      const r = buildBudgetReport({ bookings: rows, market: market(), now: NOW });
      const numbers = [
        r.current.spentToDate,
        r.current.committed,
        r.current.projectedLow,
        r.current.projectedHigh,
        r.current.daysLeft,
        r.weeklyHours.last4,
        r.weeklyHours.prev4,
        ...r.months.flatMap((m) => [m.spent, m.committed, m.hours, m.services]),
      ];
      for (const n of numbers) {
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
      expect(r.current.projectedHigh).toBeGreaterThanOrEqual(r.current.projectedLow);
      expect(r.current.projectedLow).toBe(r.current.spentToDate + r.current.committed);
      expect(r.months).toHaveLength(BUDGET_MONTHS);
      expect(new Set(r.months.map((m) => m.key)).size).toBe(BUDGET_MONTHS);
      expect(new Set(r.insights.map((i) => i.id)).size).toBe(r.insights.length);
      for (const i of r.insights) {
        expect(`${i.title} ${i.detail} ${i.action ?? ""}`).not.toMatch(
          /undefined|NaN|Infinity|\[object/,
        );
      }
    });
  }

  it("el orden de las reservas no cambia el resultado", () => {
    const rows = scenario();
    const a = buildBudgetReport({ bookings: rows, market: market(), now: NOW });
    const b = buildBudgetReport({ bookings: [...rows].reverse(), market: market(), now: NOW });
    expect(b).toEqual(a);
  });
});
