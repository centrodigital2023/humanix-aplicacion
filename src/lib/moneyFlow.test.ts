import { describe, expect, it } from "vitest";
import {
  COMMITTED_STATUS,
  FLOW_MONTHS,
  buildMoneyFlow,
  earnedAmount,
  lastMonthKeys,
  normalizeBooking,
  paidAmount,
  type FlowRow,
} from "./moneyFlow";
import { DAY, HOUR, NOW, aheadOn, bogota, doneOn, iso, mulberry32, raw } from "./intel.fixture";

const rowsOf = (...bs: ReturnType<typeof raw>[]) =>
  bs.map((b) => normalizeBooking(b, "paid")).filter((r): r is FlowRow => r !== null);

describe("paidAmount", () => {
  it("usa el total del servidor", () => {
    expect(paidAmount(raw({ total_amount: 180_000 }))).toBe(180_000);
  });

  it("si falta el total lo reconstruye con tarifa × horas, también con texto numérico", () => {
    expect(
      paidAmount(raw({ total_amount: undefined, hourly_rate: 20_000, duration_hours: 5 })),
    ).toBe(100_000);
    expect(
      paidAmount(raw({ total_amount: null, hourly_rate: "20000", duration_hours: "2.5" })),
    ).toBe(50_000);
    expect(paidAmount(raw({ total_amount: "150000.4" }))).toBe(150_000);
  });

  it("un total en cero es un cero (no se reconstruye), y lo negativo o dañado vale 0", () => {
    expect(paidAmount(raw({ total_amount: 0 }))).toBe(0);
    expect(paidAmount(raw({ total_amount: -5_000 }))).toBe(0);
    expect(paidAmount(raw({ total_amount: "abc" }))).toBe(0);
    expect(paidAmount(raw({ total_amount: undefined, hourly_rate: -1, duration_hours: 3 }))).toBe(
      0,
    );
  });
});

describe("earnedAmount (lo que recibe el profesional)", () => {
  it("prefiere el neto que el servidor guardó al completar", () => {
    expect(earnedAmount(raw({ total_amount: 150_000, professional_payout: 132_000 }))).toBe(
      132_000,
    );
  });

  it("sin neto guardado resta la comisión registrada", () => {
    expect(
      earnedAmount(
        raw({ total_amount: 150_000, professional_payout: 0, platform_fee_amount: 18_000 }),
      ),
    ).toBe(132_000);
    expect(earnedAmount(raw({ total_amount: 150_000, professional_payout: null }))).toBe(150_000);
  });

  it("el neto nunca supera lo que se pagó, aunque el dato venga raro", () => {
    expect(earnedAmount(raw({ total_amount: 100_000, professional_payout: 250_000 }))).toBe(
      100_000,
    );
  });

  it("una comisión negativa o dañada no suma dinero de la nada", () => {
    expect(
      earnedAmount(
        raw({ total_amount: 100_000, professional_payout: 0, platform_fee_amount: -9_999 }),
      ),
    ).toBe(100_000);
    expect(
      earnedAmount(
        raw({ total_amount: 100_000, professional_payout: 0, platform_fee_amount: "x" }),
      ),
    ).toBe(100_000);
  });

  it("si no hay total pero sí neto, devuelve el neto; sin nada, 0", () => {
    expect(
      earnedAmount(
        raw({ total_amount: 0, hourly_rate: 0, duration_hours: 0, professional_payout: 88_000 }),
      ),
    ).toBe(88_000);
    expect(
      earnedAmount(raw({ total_amount: 0, professional_payout: 0, platform_fee_amount: 0 })),
    ).toBe(0);
  });
});

describe("normalizeBooking", () => {
  it("un servicio terminado cuenta en el mes en que terminó, no en el que se programó", () => {
    const r = normalizeBooking(
      raw({
        scheduled_at: "2026-09-30T23:00:00-05:00",
        completed_at: "2026-10-01T05:00:00-05:00",
      }),
      "paid",
    )!;
    expect(r.at).toBe(bogota("2026-10-01T05:00:00"));
  });

  it("uno sin terminar cuenta en la fecha programada", () => {
    const r = normalizeBooking(aheadOn(3), "paid")!;
    expect(r.at).toBe(bogota("2026-10-17T08:00:00"));
  });

  it("un servicio terminado sin fecha de cierre cae en la programada", () => {
    const b = raw({ completed_at: null });
    expect(normalizeBooking(b, "paid")!.at).toBe(Date.parse(b.scheduled_at));
  });

  it("descarta reservas sin fecha válida", () => {
    expect(
      normalizeBooking(raw({ scheduled_at: "no-es-fecha", completed_at: null }), "paid"),
    ).toBeNull();
    expect(normalizeBooking(raw({ scheduled_at: "", completed_at: null }), "paid")).toBeNull();
  });

  it("las horas nunca son negativas ni NaN", () => {
    expect(normalizeBooking(raw({ duration_hours: -4 }), "paid")!.hours).toBe(0);
    expect(normalizeBooking(raw({ duration_hours: "x" }), "paid")!.hours).toBe(0);
  });

  it("el monto depende de quién mira: lo pagado o lo ganado", () => {
    const b = raw({ total_amount: 150_000, professional_payout: 132_000 });
    expect(normalizeBooking(b, "paid")!.amount).toBe(150_000);
    expect(normalizeBooking(b, "earned")!.amount).toBe(132_000);
  });
});

describe("lastMonthKeys", () => {
  it("termina en el mes de Colombia del instante y cruza el cambio de año", () => {
    expect(lastMonthKeys(NOW, 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(lastMonthKeys(bogota("2026-02-10T10:00:00"), 4)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("a las 23:30 del 31 de octubre en Colombia todavía es octubre (aunque en UTC ya sea noviembre)", () => {
    expect(lastMonthKeys(bogota("2026-10-31T23:30:00"), 1)).toEqual(["2026-10"]);
    expect(lastMonthKeys(bogota("2026-11-01T00:30:00"), 1)).toEqual(["2026-11"]);
  });
});

describe("buildMoneyFlow", () => {
  it("sin reservas todo es cero y no hay proyección inventada", () => {
    const f = buildMoneyFlow({ rows: [], now: NOW });
    expect(f.months).toHaveLength(FLOW_MONTHS);
    expect(f.months.every((m) => m.settled === 0 && m.committed === 0 && m.services === 0)).toBe(
      true,
    );
    expect(f.current).toMatchObject({
      settledToDate: 0,
      committed: 0,
      projectedLow: 0,
      projectedHigh: 0,
      weeklyPace: null,
    });
    expect(f.vsLastMonth.deltaPct).toBeNull();
    expect(f.weeklyHours).toEqual({ last4: 0, prev4: 0, deltaPct: null });
  });

  it("separa lo hecho de lo acordado y deja fuera lo pendiente y lo cancelado", () => {
    const f = buildMoneyFlow({
      rows: rowsOf(
        doneOn(2),
        aheadOn(1),
        raw({ status: "pending", scheduled_at: iso(DAY), completed_at: null }),
        raw({ status: "cancelled", scheduled_at: iso(2 * DAY), completed_at: null }),
      ),
      now: NOW,
    });
    expect(f.current.settledToDate).toBe(150_000);
    expect(f.current.committed).toBe(150_000);
    expect(f.current.projectedLow).toBe(300_000);
  });

  it("los estados acordados son confirmado, en camino y en curso", () => {
    expect([...COMMITTED_STATUS]).toEqual(["confirmed", "in_route", "in_progress"]);
  });

  it("el último mes de la serie es el actual y los meses vienen del más viejo al más nuevo", () => {
    const f = buildMoneyFlow({ rows: [], now: NOW });
    expect(f.months.map((m) => m.key)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(f.months.map((m) => m.isCurrent)).toEqual([false, false, false, false, false, true]);
    expect(f.current.label).toBe("oct 2026");
  });

  it("acepta otra cantidad de meses, con un mínimo de 2", () => {
    expect(buildMoneyFlow({ rows: [], now: NOW, months: 3 }).months).toHaveLength(3);
    expect(buildMoneyFlow({ rows: [], now: NOW, months: 0 }).months).toHaveLength(2);
  });

  it("reparte por mes de Colombia, con el cambio de mes a la medianoche local", () => {
    const f = buildMoneyFlow({
      rows: rowsOf(
        // 30 sep 22:00 Colombia = 1 oct 03:00 UTC: sigue siendo septiembre
        raw({
          scheduled_at: "2026-09-30T20:00:00-05:00",
          completed_at: "2026-09-30T22:00:00-05:00",
        }),
        // 1 oct 00:30 Colombia: ya es octubre
        raw({
          scheduled_at: "2026-10-01T00:30:00-05:00",
          completed_at: "2026-10-01T00:30:00-05:00",
        }),
      ),
      now: NOW,
    });
    const sep = f.months.find((m) => m.key === "2026-09")!;
    const oct = f.months.find((m) => m.key === "2026-10")!;
    expect(sep.settled).toBe(150_000);
    expect(oct.settled).toBe(150_000);
  });

  it("el ritmo semanal pide al menos 2 servicios y proyecta un rango, nunca por debajo de lo seguro", () => {
    const one = buildMoneyFlow({ rows: rowsOf(doneOn(3)), now: NOW });
    expect(one.current.weeklyPace).toBeNull();
    expect(one.current.projectedHigh).toBe(one.current.projectedLow);

    const many = buildMoneyFlow({
      rows: rowsOf(doneOn(3), doneOn(8), doneOn(13), doneOn(20)),
      now: NOW,
    });
    // 4 servicios de 150.000 en los últimos 28 días (uno fue en septiembre) = 150.000 por semana
    expect(many.current.weeklyPace).toBe(150_000);
    // en octubre van 3 (450.000); quedan 17 días: 150.000 × 17 / 7 ≈ 364.286 más si sigue el ritmo
    expect(many.current.settledToDate).toBe(450_000);
    expect(many.current.projectedLow).toBe(450_000);
    expect(many.current.projectedHigh).toBe(450_000 + Math.round((150_000 * 17) / 7));
    expect(many.current.daysLeft).toBe(17);
  });

  it("si lo acordado supera al ritmo, el tope es lo acordado", () => {
    const f = buildMoneyFlow({
      rows: rowsOf(doneOn(3), doneOn(10), aheadOn(1), aheadOn(2), aheadOn(3), aheadOn(4)),
      now: NOW,
    });
    expect(f.current.committed).toBe(600_000);
    expect(f.current.projectedHigh).toBeGreaterThanOrEqual(f.current.projectedLow);
    expect(f.current.projectedLow).toBe(900_000);
  });

  it("compara con el mes pasado hasta el mismo día, no con el mes completo", () => {
    const f = buildMoneyFlow({
      rows: rowsOf(
        // este mes (día 10): 300.000
        doneOn(2),
        doneOn(4),
        // mes pasado: dos servicios hasta el día 14 (150.000 + 150.000) y uno el día 28 (que no cuenta)
        raw({
          scheduled_at: "2026-09-05T08:00:00-05:00",
          completed_at: "2026-09-05T14:00:00-05:00",
        }),
        raw({
          scheduled_at: "2026-09-12T08:00:00-05:00",
          completed_at: "2026-09-12T14:00:00-05:00",
        }),
        raw({
          scheduled_at: "2026-09-28T08:00:00-05:00",
          completed_at: "2026-09-28T14:00:00-05:00",
        }),
      ),
      now: NOW,
    });
    expect(f.vsLastMonth.settledToDate).toBe(300_000);
    expect(f.vsLastMonth.lastMonthSameSpan).toBe(300_000);
    expect(f.vsLastMonth.deltaPct).toBe(0);
  });

  it("el porcentaje frente al mes pasado se redondea y es null sin base de comparación", () => {
    const up = buildMoneyFlow({
      rows: rowsOf(
        doneOn(1),
        doneOn(2),
        doneOn(3),
        raw({
          scheduled_at: "2026-09-05T08:00:00-05:00",
          completed_at: "2026-09-05T14:00:00-05:00",
        }),
        raw({
          scheduled_at: "2026-09-06T08:00:00-05:00",
          completed_at: "2026-09-06T14:00:00-05:00",
        }),
      ),
      now: NOW,
    });
    expect(up.vsLastMonth.deltaPct).toBe(50);
    const none = buildMoneyFlow({ rows: rowsOf(doneOn(1)), now: NOW });
    expect(none.vsLastMonth.deltaPct).toBeNull();
  });

  it("horas por semana: las últimas 4 semanas frente a las 4 anteriores", () => {
    const f = buildMoneyFlow({
      rows: rowsOf(doneOn(3), doneOn(10), doneOn(40), doneOn(45)),
      now: NOW,
    });
    // últimas 4 semanas: 12 h → 3 h por semana; anteriores: 12 h → 3 h por semana
    expect(f.weeklyHours).toEqual({ last4: 3, prev4: 3, deltaPct: 0 });
  });

  it("los montos pueden ser de otro tipo: ganado en lugar de pagado", () => {
    const rows = [raw({ total_amount: 150_000, professional_payout: 132_000 })]
      .map((b) => normalizeBooking(b, "earned"))
      .filter((r): r is FlowRow => r !== null);
    const f = buildMoneyFlow({ rows, now: NOW });
    expect(f.current.settledToDate).toBe(132_000);
  });

  it("propiedad: con reservas al azar, los totales cuadran y la proyección es coherente", () => {
    const rnd = mulberry32(14102026);
    for (let i = 0; i < 200; i++) {
      const bookings = Array.from({ length: Math.floor(rnd() * 18) }, () => {
        const off = Math.floor((rnd() * 200 - 40) * DAY);
        const statuses = ["completed", "confirmed", "pending", "cancelled", "in_progress"];
        const status = statuses[Math.floor(rnd() * statuses.length)];
        const amount = Math.floor(rnd() * 400_000);
        return raw({
          status,
          scheduled_at: iso(off),
          completed_at: status === "completed" ? iso(off + 5 * HOUR) : null,
          total_amount: amount,
          professional_payout: amount,
          duration_hours: Math.floor(rnd() * 12),
        });
      });
      const rows = rowsOf(...bookings);
      const f = buildMoneyFlow({ rows, now: NOW });
      expect(f.months).toHaveLength(FLOW_MONTHS);
      const inWindow = new Set(f.months.map((m) => m.key));
      for (const m of f.months) {
        expect(m.settled).toBeGreaterThanOrEqual(0);
        expect(m.committed).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(m.hours)).toBe(true);
      }
      expect(f.current.projectedHigh).toBeGreaterThanOrEqual(f.current.projectedLow);
      expect(f.current.projectedLow).toBe(f.current.settledToDate + f.current.committed);
      // lo hecho en la serie no puede superar lo hecho en total
      const settledTotal = rows
        .filter((r) => r.status === "completed")
        .reduce((a, r) => a + r.amount, 0);
      const settledInSeries = f.months.reduce((a, m) => a + m.settled, 0);
      expect(settledInSeries).toBeLessThanOrEqual(settledTotal);
      expect(inWindow.size).toBe(FLOW_MONTHS);
      const json = JSON.stringify(f);
      expect(json).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});
