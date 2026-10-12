import { describe, expect, it } from "vitest";
import {
  EARNINGS_WINDOW_DAYS,
  MIN_FAMILIES_FOR_REPEAT,
  MIN_SERVICES_FOR_HOURLY,
  MIN_SERVICES_FOR_RATE_ADVICE,
  MIN_SERVICES_FOR_WEEKDAY,
  buildEarningsReport,
  type EarningsBooking,
  type EarningsInsight,
} from "./proEarnings";
import { DAY, HOUR, NOW, aheadOn, bogota, doneOn, iso, mulberry32, raw } from "./intel.fixture";

const market = { n: 12, p25: 20_000, median: 24_000, p75: 28_000 };
/** Servicio terminado: 6 h a $25.000 = $150.000; con comisión de 12 % el neto es $132.000. */
const free = (daysAgo: number, over: Partial<EarningsBooking> = {}) =>
  doneOn(daysAgo, { professional_payout: 132_000, platform_fee_amount: 18_000, ...over });
const report = (
  bookings: EarningsBooking[],
  over: Partial<Parameters<typeof buildEarningsReport>[0]> = {},
) => buildEarningsReport({ bookings, now: NOW, ...over });
const ids = (xs: EarningsInsight[]) => xs.map((i) => i.id);
const find = (xs: EarningsInsight[], id: string) => xs.find((i) => i.id === id);

describe("sin servicios", () => {
  it("no inventa nada: explica qué verá cuando termine el primero", () => {
    const r = report([]);
    expect(r.hasData).toBe(false);
    expect(ids(r.insights)).toEqual(["no_data"]);
    expect(r.flow.current.settledToDate).toBe(0);
    expect(r.perHour).toEqual({ net: null, gross: null, services: 0 });
    expect(r.bestDay).toBeNull();
    expect(r.repeat.sharePct).toBeNull();
    expect(r.cancellations.pct).toBeNull();
    expect(r.rate.position).toBe("unknown");
    expect(r.weekdays).toHaveLength(7);
  });

  it("solo servicios por hacer ya cuentan como datos (hay proyección), pero sin promedios", () => {
    const r = report([aheadOn(2)]);
    expect(r.hasData).toBe(true);
    expect(r.flow.current.committed).toBe(150_000);
    expect(r.perHour.net).toBeNull();
    expect(ids(r.insights)).toContain("projection");
  });
});

describe("lo ganado es el neto que le queda", () => {
  it("el mes usa el neto, no lo que pagó la familia", () => {
    const r = report([free(2), free(4)]);
    expect(r.flow.current.settledToDate).toBe(264_000);
  });

  it("por hora: neto y bruto, solo con una muestra mínima", () => {
    const few = report([free(2), free(4)]);
    expect(few.perHour).toEqual({ net: null, gross: null, services: 2 });
    const r = report([free(2), free(4), free(6)]);
    expect(MIN_SERVICES_FOR_HOURLY).toBe(3);
    expect(r.perHour).toEqual({ net: 22_000, gross: 25_000, services: 3 });
  });

  it("una duración dañada (negativa) no reduce las horas ni distorsiona el promedio", () => {
    const r = report([free(2), free(4), free(6), free(8, { duration_hours: -50 })]);
    expect(r.perHour.net).toBe(Math.round((132_000 * 3 + 132_000) / 18));
  });

  it("los servicios fuera de los últimos 90 días no entran en el promedio por hora", () => {
    const r = report([
      free(2),
      free(4),
      free(6),
      free(EARNINGS_WINDOW_DAYS + 5, { professional_payout: 1 }),
    ]);
    expect(r.perHour.services).toBe(3);
    expect(r.perHour.net).toBe(22_000);
  });

  it("un servicio cancelado o pendiente no suma", () => {
    const r = report([
      free(2),
      raw({ status: "cancelled", scheduled_at: iso(-2 * DAY), completed_at: null }),
      raw({ status: "pending", scheduled_at: iso(2 * DAY), completed_at: null }),
    ]);
    expect(r.flow.current.settledToDate).toBe(132_000);
    expect(r.flow.current.committed).toBe(0);
  });
});

describe("comisión", () => {
  it("quien está en un plan sin comisión no ve nada de comisión", () => {
    const r = report([doneOn(2), doneOn(4), doneOn(6)]);
    expect(r.commission.paid90).toBe(0);
    expect(r.commission.effectivePct).toBeNull();
    expect(ids(r.insights)).not.toContain("commission_saving");
    expect(ids(r.insights)).not.toContain("commission_info");
  });

  it("la comisión efectiva lleva un decimal (11,7 %, no 12 %)", () => {
    const r = report([free(2, { platform_fee_amount: 17_500 })]);
    expect(r.commission.effectivePct).toBe(11.7);
  });

  it("suma la comisión de 90 días y la del mes por separado", () => {
    const r = report([free(2), free(4), free(30), free(120)]);
    expect(r.commission.paid90).toBe(18_000 * 3);
    // el mes actual (octubre) incluye los servicios de hace 2 y 4 días; el de hace 30 es de septiembre
    expect(r.commission.paidMonth).toBe(36_000);
    expect(r.commission.effectivePct).toBe(12);
  });

  it("con poco volumen el plan todavía no se paga solo y se dice con honestidad", () => {
    const r = report([free(2)]);
    expect(r.commission.savingWithEssential90).toBeNull();
    const i = find(r.insights, "commission_info")!;
    expect(i.severity).toBe("info");
    expect(i.detail).toMatch(/todavía no se paga solo/);
  });

  it("con volumen alto calcula el ahorro después de descontar el plan, y no hay empate falso", () => {
    // 3 meses de plan = 27.000; con 2 servicios de 18.000 (36.000) se ahorrarían 9.000
    const r = report([free(2), free(4)].map((b) => ({ ...b, platform_fee_amount: 30_000 })));
    expect(r.commission.paid90).toBe(60_000);
    expect(r.commission.savingWithEssential90).toBe(60_000 - 27_000);
    const i = find(r.insights, "commission_saving")!;
    expect(i.severity).toBe("warn");
    expect(i.detail).toMatch(/habrías conservado/);

    // exactamente igual al costo del plan: no ahorra nada
    const equal = report([free(2, { platform_fee_amount: 27_000 })]);
    expect(equal.commission.savingWithEssential90).toBeNull();
  });

  it("nunca habla de pagos por WhatsApp ni da instrucciones de pago", () => {
    const r = report([
      free(2, { platform_fee_amount: 40_000 }),
      free(4, { platform_fee_amount: 40_000 }),
    ]);
    const text = JSON.stringify(r.insights);
    expect(text).not.toMatch(/whatsapp/i);
    expect(text).toMatch(/página web/);
  });
});

describe("días de la semana", () => {
  // 14 oct 2026 es miércoles; hace 7 días fue miércoles, hace 8 martes, hace 9 lunes
  const wed = (daysAgo: number, over: Partial<EarningsBooking> = {}) => doneOn(daysAgo, over);

  it("con pocos servicios no hay día fuerte", () => {
    const r = report([wed(7), wed(14), wed(21)]);
    expect(r.bestDay).toBeNull();
    expect(ids(r.insights)).not.toContain("best_day");
  });

  it("con muestra suficiente señala el día que más deja", () => {
    const bookings = [
      ...[7, 14, 21, 28, 35].map((d) => wed(d)), // 5 miércoles
      ...[8, 15, 22].map((d) => doneOn(d, { professional_payout: 80_000, total_amount: 80_000 })), // 3 martes
    ];
    expect(bookings).toHaveLength(MIN_SERVICES_FOR_WEEKDAY);
    const r = report(bookings);
    expect(r.bestDay?.label).toBe("miércoles");
    expect(r.bestDay?.services).toBe(5);
    expect(r.weekdays[2].earned).toBe(5 * 150_000);
    expect(r.weekdays[1].earned).toBe(3 * 80_000);
    expect(find(r.insights, "best_day")?.title).toBe("Tu día más fuerte es el miércoles");
  });

  it("un turno de noche cuenta el día en que empezó, no el siguiente", () => {
    const night = raw({
      scheduled_at: "2026-10-06T19:00:00-05:00", // martes
      completed_at: "2026-10-07T07:00:00-05:00", // ya miércoles
      duration_hours: 12,
      total_amount: 300_000,
      professional_payout: 300_000,
    });
    const r = report([night]);
    expect(r.weekdays[1].earned).toBe(300_000);
    expect(r.weekdays[2].earned).toBe(0);
  });

  it("si dos días empatan, gana el primero de la semana, sin depender del orden de entrada", () => {
    // 4 lunes y 4 martes con lo mismo cada uno: 14 oct es miércoles → lunes = hace 2 + 7k, martes = hace 1 + 7k
    const mondays = [2, 9, 16, 23].map((d) => doneOn(d));
    const tuesdays = [1, 8, 15, 22].map((d) => doneOn(d));
    const a = [...mondays, ...tuesdays];
    expect(report(a).weekdays[0].earned).toBe(report(a).weekdays[1].earned);
    expect(report(a).bestDay?.label).toBe("lunes");
    expect(report([...a].reverse()).bestDay?.label).toBe("lunes");
  });

  it("propiedad: lo ganado por día suma lo ganado en 90 días", () => {
    const rnd = mulberry32(31);
    for (let i = 0; i < 100; i++) {
      const bookings = Array.from({ length: 5 + Math.floor(rnd() * 20) }, () =>
        doneOn(Math.floor(rnd() * 120), {
          professional_payout: Math.floor(rnd() * 300_000),
          total_amount: 300_000,
          duration_hours: 1 + Math.floor(rnd() * 12),
        }),
      );
      const r = report(bookings);
      const total = r.weekdays.reduce((n, d) => n + d.earned, 0);
      const inWindow = bookings
        .filter((b) => {
          const t = Date.parse(b.completed_at ?? b.scheduled_at);
          return t > NOW - EARNINGS_WINDOW_DAYS * DAY && t <= NOW;
        })
        .reduce((n, b) => n + Number(b.professional_payout), 0);
      expect(total).toBe(inWindow);
      if (r.bestDay) expect(r.bestDay.earned).toBe(Math.max(...r.weekdays.map((d) => d.earned)));
    }
  });
});

describe("familias que vuelven", () => {
  const withClient = (daysAgo: number, client: string) => doneOn(daysAgo, { client_id: client });

  it("con menos de 3 familias no habla de porcentajes", () => {
    const r = report([withClient(3, "a"), withClient(9, "a"), withClient(12, "b")]);
    expect(MIN_FAMILIES_FOR_REPEAT).toBe(3);
    expect(r.repeat).toEqual({ families: 2, repeatFamilies: 1, sharePct: null });
    expect(ids(r.insights)).not.toContain("repeat_good");
    expect(ids(r.insights)).not.toContain("repeat_low");
  });

  it("con exactamente 3 familias ya se puede hablar del porcentaje", () => {
    const r = report([
      withClient(3, "a"),
      withClient(9, "a"),
      withClient(10, "b"),
      withClient(20, "c"),
    ]);
    expect(r.repeat).toEqual({ families: 3, repeatFamilies: 1, sharePct: 33 });
  });

  it("cuenta las familias que contrataron 2 veces o más y lo celebra", () => {
    const r = report([
      withClient(3, "a"),
      withClient(9, "a"),
      withClient(10, "b"),
      withClient(16, "b"),
      withClient(20, "c"),
      withClient(25, "d"),
    ]);
    expect(r.repeat).toEqual({ families: 4, repeatFamilies: 2, sharePct: 50 });
    expect(find(r.insights, "repeat_good")?.severity).toBe("good");
  });

  it("si pocas vuelven, lo dice con calidez y sin culpar", () => {
    const r = report([
      withClient(3, "a"),
      withClient(10, "b"),
      withClient(20, "c"),
      withClient(25, "d"),
      withClient(30, "e"),
    ]);
    expect(r.repeat.sharePct).toBe(0);
    const i = find(r.insights, "repeat_low")!;
    expect(i.severity).toBe("info");
    expect(i.title).toMatch(/0 %/);
  });

  it("solo cuenta servicios terminados de los últimos 180 días", () => {
    const r = report([
      withClient(3, "a"),
      withClient(200, "a"), // fuera de la ventana
      raw({ status: "cancelled", client_id: "a", scheduled_at: iso(-5 * DAY), completed_at: null }),
    ]);
    expect(r.repeat).toEqual({ families: 1, repeatFamilies: 0, sharePct: null });
  });

  it("ignora reservas sin familia identificada", () => {
    const r = report([doneOn(3), doneOn(4), doneOn(5)]);
    expect(r.repeat.families).toBe(0);
  });
});

describe("cancelaciones", () => {
  it("exige un mínimo de servicios y avisa desde el 20 %", () => {
    const base = [free(2), free(4), free(6), free(8)];
    const few = report([
      ...base,
      raw({ status: "cancelled", scheduled_at: iso(-DAY), completed_at: null }),
    ]);
    // 1 de 5 = 20 %
    expect(few.cancellations).toEqual({ count: 1, total: 5, pct: 20 });
    expect(find(few.insights, "cancellations")?.severity).toBe("warn");

    const tiny = report([
      free(2),
      raw({ status: "cancelled", scheduled_at: iso(-DAY), completed_at: null }),
    ]);
    expect(tiny.cancellations.pct).toBeNull();
    expect(ids(tiny.insights)).not.toContain("cancellations");
  });

  it("por debajo del 20 % no se menciona", () => {
    const bookings = [
      ...Array.from({ length: 9 }, (_, i) => free(i + 1)),
      raw({ status: "cancelled", scheduled_at: iso(-DAY), completed_at: null }),
    ];
    const r = report(bookings);
    expect(r.cancellations.pct).toBe(10);
    expect(ids(r.insights)).not.toContain("cancellations");
  });
});

describe("tarifa frente al mercado", () => {
  const five = [1, 2, 3, 4, 5].map((d) => free(d));

  it("sin tarifa publicada o sin mercado no se compara", () => {
    expect(report(five).rate.position).toBe("unknown");
    expect(report(five, { publishedRate: 0, market }).rate.position).toBe("unknown");
    expect(report(five, { publishedRate: -5, market }).rate.position).toBe("unknown");
    expect(report(five, { publishedRate: 22_000, market: { ...market, n: 4 } }).rate.position).toBe(
      "unknown",
    );
  });

  it("por debajo del rango: sugiere el borde bajo y calcula lo que sumaría al mes", () => {
    const r = report(five, { publishedRate: 15_000, market });
    expect(MIN_SERVICES_FOR_RATE_ADVICE).toBe(5);
    expect(r.rate).toMatchObject({
      published: 15_000,
      position: "below",
      marketMedian: 24_000,
      diffPct: -37,
      suggested: 20_000,
    });
    // 5 servicios de 6 h en 90 días = 30 h → 10 h al mes × 5.000
    expect(r.rate.extraPerMonth).toBe(50_000);
    expect(find(r.insights, "rate_below")?.detail).toMatch(/borde bajo del rango/);
  });

  it("no sugiere «subir» a un valor igual al que ya publica (el borde se redondea a 500)", () => {
    const r = report(five, {
      publishedRate: 20_000,
      market: { n: 12, p25: 20_100, median: 24_000, p75: 28_000 },
    });
    expect(r.rate.position).toBe("below");
    expect(r.rate.suggested).toBeNull();
    expect(r.rate.extraPerMonth).toBeNull();
  });

  it("con pocos servicios no sugiere cambiar la tarifa", () => {
    const r = report(five.slice(0, 4), { publishedRate: 15_000, market });
    expect(r.rate.position).toBe("below");
    expect(r.rate.suggested).toBeNull();
    expect(r.rate.extraPerMonth).toBeNull();
  });

  it("dentro del rango se celebra; por encima se explica sin presionar", () => {
    expect(
      find(report(five, { publishedRate: 24_000, market }).insights, "rate_within")?.severity,
    ).toBe("good");
    const above = report(five, { publishedRate: 35_000, market });
    expect(above.rate.position).toBe("above");
    expect(above.rate.suggested).toBeNull();
    expect(find(above.insights, "rate_above")?.severity).toBe("info");
  });

  it("el borde del rango es «dentro»: p25 y p75 exactos no son «por debajo» ni «por encima»", () => {
    expect(report(five, { publishedRate: 20_000, market }).rate.position).toBe("within");
    expect(report(five, { publishedRate: 28_000, market }).rate.position).toBe("within");
    expect(report(five, { publishedRate: 19_999, market }).rate.position).toBe("below");
    expect(report(five, { publishedRate: 28_001, market }).rate.position).toBe("above");
  });
});

describe("ritmo del mes", () => {
  it("avisa con buen ánimo cuando va por encima del mes pasado", () => {
    const r = report([
      free(1),
      free(2),
      free(3),
      doneOn(0, {}),
      raw({
        scheduled_at: "2026-09-05T08:00:00-05:00",
        completed_at: "2026-09-05T14:00:00-05:00",
        professional_payout: 132_000,
      }),
      raw({
        scheduled_at: "2026-09-06T08:00:00-05:00",
        completed_at: "2026-09-06T14:00:00-05:00",
        professional_payout: 132_000,
      }),
    ]);
    expect(r.flow.vsLastMonth.deltaPct).toBeGreaterThanOrEqual(15);
    expect(find(r.insights, "pace_up")?.severity).toBe("good");
  });

  it("si va por debajo, lo dice sin dramatismo y lleva a «Mi semana»", () => {
    const r = report([
      free(1),
      raw({
        scheduled_at: "2026-09-02T08:00:00-05:00",
        completed_at: "2026-09-02T14:00:00-05:00",
        professional_payout: 132_000,
      }),
      raw({
        scheduled_at: "2026-09-03T08:00:00-05:00",
        completed_at: "2026-09-03T14:00:00-05:00",
        professional_payout: 132_000,
      }),
      raw({
        scheduled_at: "2026-09-04T08:00:00-05:00",
        completed_at: "2026-09-04T14:00:00-05:00",
        professional_payout: 132_000,
      }),
    ]);
    const i = find(r.insights, "pace_down")!;
    expect(i.severity).toBe("info");
    expect(i.action).toMatch(/Mi semana/);
  });

  it("no compara si el mes pasado fue casi nada (evita porcentajes absurdos)", () => {
    const r = report([
      free(1),
      raw({
        scheduled_at: "2026-09-02T08:00:00-05:00",
        completed_at: "2026-09-02T09:00:00-05:00",
        duration_hours: 1,
        total_amount: 25_000,
        professional_payout: 22_000,
      }),
    ]);
    expect(ids(r.insights)).not.toContain("pace_up");
    expect(ids(r.insights)).not.toContain("pace_down");
  });
});

describe("umbrales del ritmo del mes", () => {
  /** Septiembre: 300.000 netos hasta el día 14. Octubre: lo que se indique, repartido en servicios de $15.000. */
  const lastMonth = [
    raw({
      scheduled_at: "2026-09-03T08:00:00-05:00",
      completed_at: "2026-09-03T14:00:00-05:00",
      professional_payout: 150_000,
    }),
    raw({
      scheduled_at: "2026-09-10T08:00:00-05:00",
      completed_at: "2026-09-10T14:00:00-05:00",
      professional_payout: 150_000,
    }),
  ];
  const thisMonth = (net: number) => [doneOn(2, { professional_payout: net, total_amount: net })];
  const idsFor = (net: number) => ids(report([...lastMonth, ...thisMonth(net)]).insights);

  it("+10 % no es noticia; +20 % sí se celebra", () => {
    expect(idsFor(330_000)).not.toContain("pace_up");
    expect(idsFor(360_000)).toContain("pace_up");
  });

  it("−15 % no se señala; −30 % sí, con suavidad", () => {
    expect(idsFor(255_000)).not.toContain("pace_down");
    expect(idsFor(210_000)).toContain("pace_down");
  });
});

describe("horas por semana", () => {
  it("avisa si las horas cambian 25 % o más frente a las 4 semanas anteriores", () => {
    // últimas 4 semanas: 4 servicios de 6 h = 24 h (6 h por semana); anteriores: 2 servicios = 12 h (3 h por semana)
    const up = report([free(3), free(10), free(17), free(24), free(32), free(40)]);
    expect(up.flow.weeklyHours).toEqual({ last4: 6, prev4: 3, deltaPct: 100 });
    expect(find(up.insights, "hours_trend")?.title).toMatch(/subieron 100 %/);

    const down = report([free(3), free(30), free(33), free(40), free(45), free(50)]);
    expect(down.flow.weeklyHours.deltaPct).toBeLessThanOrEqual(-25);
    expect(find(down.insights, "hours_trend")?.title).toMatch(/bajaron/);
  });

  it("un cambio de 20 % (menor al umbral de 25 %) no es noticia", () => {
    // últimas 4 semanas: 24 h; anteriores: 20 h → +20 %
    const five = (d: number) => free(d, { duration_hours: 5 });
    const r = report([
      free(3),
      free(10),
      free(17),
      free(24),
      five(31),
      five(38),
      five(45),
      five(52),
    ]);
    expect(r.flow.weeklyHours).toEqual({ last4: 6, prev4: 5, deltaPct: 20 });
    expect(ids(r.insights)).not.toContain("hours_trend");
  });
});

describe("hallazgos", () => {
  it("van de lo que pide atención a lo que celebra, sin perder el orden interno", () => {
    const bookings = [
      ...Array.from({ length: 9 }, (_, i) => free(i + 1, { client_id: `c${i % 4}` })),
      raw({ status: "cancelled", scheduled_at: iso(-DAY), completed_at: null }),
      raw({ status: "cancelled", scheduled_at: iso(-2 * DAY), completed_at: null }),
      raw({ status: "cancelled", scheduled_at: iso(-3 * DAY), completed_at: null }),
    ];
    const r = report(bookings, { publishedRate: 24_000, market });
    const order = { warn: 0, info: 1, good: 2 } as const;
    for (let i = 1; i < r.insights.length; i++) {
      expect(order[r.insights[i - 1].severity]).toBeLessThanOrEqual(order[r.insights[i].severity]);
    }
    expect(new Set(ids(r.insights)).size).toBe(r.insights.length);
  });

  it("ninguna cifra sale rota (NaN, undefined, Infinity) con datos al azar", () => {
    const rnd = mulberry32(77);
    const statuses = ["completed", "confirmed", "pending", "cancelled", "in_progress"];
    for (let i = 0; i < 200; i++) {
      const bookings = Array.from({ length: Math.floor(rnd() * 25) }, () => {
        const off = Math.floor((rnd() * 220 - 30) * DAY);
        const status = statuses[Math.floor(rnd() * statuses.length)];
        const gross = Math.floor(rnd() * 400_000);
        return raw({
          status,
          client_id: `c${Math.floor(rnd() * 6)}`,
          scheduled_at: iso(off),
          completed_at: status === "completed" ? iso(off + 5 * HOUR) : null,
          total_amount: gross,
          professional_payout: Math.floor(gross * rnd()),
          platform_fee_amount: Math.floor(gross * rnd() * 0.2),
          duration_hours: Math.floor(rnd() * 14),
        });
      });
      const r = report(bookings, {
        publishedRate: rnd() < 0.2 ? null : Math.floor(8_000 + rnd() * 60_000),
        market: rnd() < 0.3 ? null : market,
      });
      const text = JSON.stringify(r);
      expect(text).not.toMatch(/NaN|Infinity|undefined|\[object/);
      for (const ins of r.insights) {
        expect(ins.title.length).toBeGreaterThan(0);
        expect(`${ins.title} ${ins.detail}`).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
  });
});

describe("fechas de Colombia", () => {
  it("un servicio terminado a las 23:30 del último día del mes cuenta en ese mes", () => {
    const now = bogota("2026-11-02T10:00:00");
    const r = buildEarningsReport({
      bookings: [
        raw({
          scheduled_at: "2026-10-31T21:00:00-05:00",
          completed_at: "2026-10-31T23:30:00-05:00",
          professional_payout: 100_000,
        }),
      ],
      now,
    });
    const oct = r.flow.months.find((m) => m.key === "2026-10")!;
    expect(oct.settled).toBe(100_000);
    expect(r.flow.current.settledToDate).toBe(0);
  });
});
