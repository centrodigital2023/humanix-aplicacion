import { describe, expect, it } from "vitest";
import {
  CONCENTRATION_PCT,
  DRIVERS_SHOWN,
  MIN_SERVICES_FOR_RATE,
  PACE_MIN_BASE,
  PACE_PCT,
  RATE_TREND_PCT,
  buildCostReport,
  costHeadline,
  type CostInput,
  type CostOffer,
} from "./instCost";
import type { InstBooking } from "./instData";
import { ahead, cancelled, ib } from "./instIntel.fixture";
import { DAY, HOUR, NOW, mulberry32 } from "./intel.fixture";
import { resolvePeriod } from "./intelShared";
import { formatCOP } from "./pricing";

const p30 = resolvePeriod("30d", NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const MARKET = { n: 12, p25: 20_000, median: 24_000, p75: 28_000 };

const run = (over: Partial<CostInput> = {}) =>
  buildCostReport({ bookings: [], offers: {}, market: null, period: p30, now: NOW, ...over });
const ids = (r: ReturnType<typeof run>) => r.insights.map((i) => i.id);
/** Servicio terminado hace `d` días de 6 h a la tarifa por hora dada (total = tarifa × 6). */
const at = (d: number, rate = 25_000, over: Partial<InstBooking> = {}) =>
  ib(d, { hourly_rate: rate, total_amount: rate * 6, ...over });
const many = (n: number, rate = 25_000, start = 1, over: Partial<InstBooking> = {}) =>
  Array.from({ length: n }, (_, i) => at(start + i, rate, over));

describe("sin servicios", () => {
  it("lo explica y no inventa cifras", () => {
    const r = run();
    expect(r.hasData).toBe(false);
    expect(r.spent).toBe(0);
    expect(r.avgPerHour).toBeNull();
    expect(r.months).toHaveLength(6);
    expect(r.drivers).toEqual([]);
    expect(ids(r)).toEqual(["no_data"]);
    expect(costHeadline(r)).toBe("Aún no hay servicios para calcular costos.");
  });
});

describe("totales del periodo", () => {
  it("suma solo lo terminado dentro del periodo", () => {
    const rows = [
      ...many(5),
      at(60), // anterior al periodo
      ahead(2), // acordado, aún no se gasta
      cancelled(3, null), // cancelado
      ib(4, { status: "in_progress", completed_at: null }),
    ];
    const r = run({ bookings: rows });
    expect(r.services).toBe(5);
    expect(r.spent).toBe(750_000);
    expect(r.hours).toBe(30);
    expect(r.avgPerHour).toBe(25_000);
  });

  it("el costo por hora pondera por horas y necesita 3 servicios", () => {
    const two = run({ bookings: many(MIN_SERVICES_FOR_RATE - 1) });
    expect(two.avgPerHour).toBeNull();
    const three = run({ bookings: many(MIN_SERVICES_FOR_RATE) });
    expect(three.avgPerHour).toBe(25_000);
    // 6 h a 20.000 y 2 h a 40.000 → (120.000 + 80.000) / 8 = 25.000
    const weighted = run({
      bookings: [
        at(1, 20_000),
        at(2, 20_000, { duration_hours: 2, total_amount: 40_000, hourly_rate: 20_000 }),
        at(3, 20_000, { duration_hours: 2, total_amount: 80_000, hourly_rate: 40_000 }),
      ],
    });
    expect(weighted.avgPerHour).toBe(Math.round((120_000 + 40_000 + 80_000) / 10));
  });

  it("si el servidor no trae el total, se reconstruye con tarifa × horas", () => {
    const r = run({ bookings: many(3, 20_000, 1, { total_amount: null }) });
    expect(r.spent).toBe(360_000);
  });

  it("con el mes pasado como periodo solo cuenta ese mes", () => {
    const last = resolvePeriod("last_month", NOW);
    const rows = [...many(5, 25_000, 20), ...many(3, 25_000, 1)]; // 20–24 días atrás = septiembre; 1–3 = octubre
    const r = run({ bookings: rows, period: last });
    expect(r.services).toBe(5);
  });
});

describe("periodo anterior", () => {
  it("compara el costo por hora con el mismo tramo anterior", () => {
    const rows = [...many(5, 22_000), ...many(5, 20_000, 35)];
    const r = run({ bookings: rows });
    expect(r.previous.services).toBe(5);
    expect(r.previous.avgPerHour).toBe(20_000);
    expect(r.previous.perHourDeltaPct).toBe(10);
    expect(r.previous.spent).toBe(5 * 120_000);
  });

  it("sin 3 servicios en alguno de los dos periodos no hay variación", () => {
    expect(
      run({ bookings: [...many(5), ...many(2, 20_000, 35)] }).previous.perHourDeltaPct,
    ).toBeNull();
    expect(
      run({ bookings: [...many(2), ...many(5, 20_000, 35)] }).previous.perHourDeltaPct,
    ).toBeNull();
  });
});

describe("costo por hora frente al mercado", () => {
  it("dentro del rango, por encima y por debajo", () => {
    expect(run({ bookings: many(5, 25_000), market: MARKET }).rate.position).toBe("within");
    expect(run({ bookings: many(5, 28_000), market: MARKET }).rate.position).toBe("within"); // justo el p75
    expect(run({ bookings: many(5, 29_000), market: MARKET }).rate.position).toBe("above");
    expect(run({ bookings: many(5, 20_000), market: MARKET }).rate.position).toBe("within"); // justo el p25
    expect(run({ bookings: many(5, 19_000), market: MARKET }).rate.position).toBe("below");
  });

  it("sin mercado, con muestra pequeña o sin costo por hora propio, no hay comparación", () => {
    expect(run({ bookings: many(5), market: null }).rate.position).toBe("unknown");
    expect(run({ bookings: many(5), market: { ...MARKET, n: 4 } }).rate.position).toBe("unknown");
    expect(run({ bookings: many(2), market: MARKET }).rate.position).toBe("unknown");
    expect(run({ bookings: many(5), market: MARKET }).rate.marketMedian).toBe(24_000);
    expect(run({ bookings: many(5), market: null }).rate.marketMedian).toBeNull();
  });

  it("por encima: diferencia con la mediana y ahorro mensual con las horas del periodo", () => {
    const r = run({ bookings: many(5, 35_000), market: MARKET });
    expect(r.rate.diffPct).toBe(46); // (35.000 − 24.000) / 24.000
    // 30 h en 30 días → 30 h al mes × 11.000
    expect(r.rate.savingsPerMonth).toBe(330_000);
    const long = run({
      bookings: many(5, 35_000),
      market: MARKET,
      period: resolvePeriod("90d", NOW),
    });
    expect(long.rate.savingsPerMonth).toBe(110_000); // 30 h en 90 días → 10 h al mes
  });

  it("solo hay ahorro si se paga por encima del rango", () => {
    expect(run({ bookings: many(5, 26_000), market: MARKET }).rate.savingsPerMonth).toBeNull();
    expect(run({ bookings: many(5, 10_000), market: MARKET }).rate.savingsPerMonth).toBeNull();
  });
});

describe("en qué se va el dinero", () => {
  const offers: Record<string, CostOffer> = {
    o1: { title: "UCI nocturno", specialty: "Enfermería" },
    o2: { title: "Terapia en casa", specialty: "Fisioterapia" },
    o3: { title: "  ", specialty: "Enfermería" },
  };

  it("agrupa por oferta, ordena por gasto y da el porcentaje de cada una", () => {
    const rows = [
      ...many(3, 25_000, 1, { job_offer_id: "o1" }),
      ...many(1, 25_000, 10, { job_offer_id: "o2" }),
    ];
    const r = run({ bookings: rows, offers });
    expect(r.drivers.map((d) => [d.label, d.services, d.share])).toEqual([
      ["UCI nocturno", 3, 75],
      ["Terapia en casa", 1, 25],
    ]);
    expect(r.drivers[0]).toMatchObject({ spent: 450_000, hours: 18 });
  });

  it("una oferta sin título o desconocida y los servicios sin oferta tienen su propia etiqueta", () => {
    const rows = [
      ...many(1, 25_000, 1, { job_offer_id: "o3" }),
      ...many(1, 25_000, 2, { job_offer_id: "zzz" }),
      ...many(1, 25_000, 3, { job_offer_id: null }),
    ];
    const labels = run({ bookings: rows, offers })
      .drivers.map((d) => d.label)
      .sort();
    expect(labels).toEqual(["Servicios sin turno publicado", "Turno sin título"]);
  });

  it("muestra los 4 mayores y suma el resto aparte", () => {
    const titled = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`x${i}`, { title: `Oferta ${i}` }]),
    );
    const rows = Array.from({ length: 6 }, (_, i) =>
      at(i + 1, 25_000, { job_offer_id: `x${i}`, total_amount: (i + 1) * 100_000 }),
    );
    const r = run({ bookings: rows, offers: titled });
    expect(r.drivers).toHaveLength(DRIVERS_SHOWN);
    expect(r.drivers.map((d) => d.spent)).toEqual([600_000, 500_000, 400_000, 300_000]);
    expect(r.otherSpent).toBe(300_000);
    expect(r.drivers.reduce((s, d) => s + d.spent, 0) + r.otherSpent).toBe(r.spent);
  });

  it("las ofertas sin título se juntan en un solo renglón", () => {
    const rows = Array.from({ length: 3 }, (_, i) => at(i + 1, 25_000, { job_offer_id: `x${i}` }));
    const r = run({ bookings: rows, offers: { x0: { title: " " } } });
    expect(r.drivers.map((d) => [d.label, d.services])).toEqual([["Turno sin título", 3]]);
  });

  it("agrupa también por especialidad", () => {
    const rows = [
      ...many(2, 25_000, 1, { job_offer_id: "o1" }),
      ...many(1, 25_000, 5, { job_offer_id: "o3" }),
      ...many(1, 25_000, 8, { job_offer_id: "o2" }),
      ...many(1, 25_000, 9, { job_offer_id: null }),
    ];
    const r = run({ bookings: rows, offers });
    expect(r.specialties.map((d) => [d.label, d.services])).toEqual([
      ["Enfermería", 3],
      ["Fisioterapia", 1],
      ["Sin especialidad indicada", 1],
    ]);
  });
});

describe("lo acordado para los próximos 30 días", () => {
  it("cuenta solo lo confirmado, en camino o en curso que cae en los próximos 30 días", () => {
    const rows = [
      ahead(2),
      ahead(10),
      ahead(30), // 30 días a las 08:00: aún cabe (son menos de 30 días y 22 h)
      ahead(31, { scheduled_at: iso(NOW + 31 * DAY) }),
      ahead(3, { status: "pending" }),
      ahead(0, { scheduled_at: iso(NOW - 3 * HOUR) }), // ya pasó: no es «próximo»
    ];
    const r = run({ bookings: rows });
    expect(r.upcoming30.services).toBe(3);
    expect(r.upcoming30.amount).toBe(450_000);
    expect(r.upcoming30.hours).toBe(18);
  });
});

describe("meses y proyección", () => {
  it("usa la cuenta común: 6 meses, lo gastado a la fecha y lo acordado suman la proyección mínima", () => {
    const rows = [...many(3), ahead(2), ahead(5)];
    const r = run({ bookings: rows });
    expect(r.months).toHaveLength(6);
    expect(r.current.label).toBe("oct 2026");
    expect(r.current.settledToDate).toBe(450_000);
    expect(r.current.committed).toBe(300_000);
    expect(r.current.projectedLow).toBe(750_000);
  });
});

describe("hallazgos", () => {
  const octSpend = (n: number) => many(n); // octubre: 1–13 días atrás
  const sepSpend = (n: number) => many(n, 25_000, 35); // septiembre, antes del día 14

  it("proyección: dice el rango y de dónde sale", () => {
    const r = run({ bookings: [...many(3), ahead(2)] });
    const i = r.insights.find((x) => x.id === "projection")!;
    expect(i.title).toContain("oct 2026");
    expect(i.detail).toContain(formatCOP(450_000));
    expect(i.detail).toContain(formatCOP(150_000));
  });

  it("más de 25 % por encima del mes pasado a esta altura es aviso; con menos de $500.000 de base, no", () => {
    const up = run({ bookings: [...octSpend(6), ...sepSpend(4)] }); // 900.000 vs 600.000: +50 %
    expect(up.insights.find((x) => x.id === "pace_up")!.title).toBe(
      "Vas 50 % por encima del mes pasado a esta altura",
    );
    expect(up.insights.find((x) => x.id === "pace_up")!.severity).toBe("warn");
    expect(up.insights.find((x) => x.id === "pace_up")!.detail).toBe(
      `A la misma fecha llevabas ${formatCOP(600_000)} y ahora ${formatCOP(900_000)}.`,
    );
    const small = run({ bookings: [...octSpend(6), ...sepSpend(3)] }); // base 450.000 (< 500.000)
    expect(ids(small)).not.toContain("pace_up");
  });

  it("25 % por debajo es una buena noticia", () => {
    const r = run({ bookings: [...octSpend(3), ...sepSpend(4)] }); // 450.000 vs 600.000: −25 %
    const i = r.insights.find((x) => x.id === "pace_down")!;
    expect(i.severity).toBe("good");
    expect(i.title).toBe("Vas 25 % por debajo del mes pasado a esta altura");
    expect(i.detail).toBe(
      `A la misma fecha llevabas ${formatCOP(600_000)} y ahora ${formatCOP(450_000)}.`,
    );
  });

  it("entre −25 % y +25 % no hay aviso de ritmo", () => {
    const r = run({ bookings: [...octSpend(4), ...sepSpend(4)] });
    expect(ids(r)).not.toContain("pace_up");
    expect(ids(r)).not.toContain("pace_down");
  });

  it("por encima del mercado avisa con el ahorro y aclara que no distingue especialidades", () => {
    const r = run({ bookings: many(5, 35_000), market: MARKET });
    const i = r.insights.find((x) => x.id === "above_market")!;
    expect(i.title).toBe("Pagas 46 % más que la mediana de tu ciudad");
    expect(i.detail).toContain(formatCOP(330_000));
    expect(i.detail).toContain("no distingue especialidades");
    expect(i.severity).toBe("warn");
  });

  it("por debajo del rango lo dice sin alarma y recuerda los horarios difíciles", () => {
    const r = run({ bookings: many(5, 18_000), market: MARKET });
    const i = r.insights.find((x) => x.id === "below_market")!;
    expect(i.severity).toBe("info");
    expect(i.detail).toContain("noches y fines de semana");
    expect(ids(r)).not.toContain("above_market");
  });

  it("el costo por hora sube o baja desde 10 % frente al periodo anterior", () => {
    const up = run({ bookings: [...many(5, 22_000), ...many(5, 20_000, 35)] });
    expect(up.insights.find((x) => x.id === "rate_up")!.title).toBe(
      "Tu costo por hora subió 10 % frente al periodo anterior",
    );
    const near = run({ bookings: [...many(5, 21_800), ...many(5, 20_000, 35)] });
    expect(ids(near)).not.toContain("rate_up");
    const down = run({ bookings: [...many(5, 18_000), ...many(5, 20_000, 35)] });
    expect(down.insights.find((x) => x.id === "rate_down")!.severity).toBe("good");
  });

  it("avisa cuando una sola oferta concentra la mitad o más del gasto", () => {
    const offers = { o1: { title: "UCI" }, o2: { title: "Casa" }, o3: { title: "Clínica" } };
    const mk = (a: number, b: number, c = 0) =>
      run({
        bookings: [
          at(1, 25_000, { job_offer_id: "o1", total_amount: a }),
          at(2, 25_000, { job_offer_id: "o2", total_amount: b }),
          ...(c ? [at(3, 25_000, { job_offer_id: "o3", total_amount: c })] : []),
        ],
        offers,
      });
    const title = (r: ReturnType<typeof run>) =>
      r.insights.find((x) => x.id === "concentration")?.title;
    expect(CONCENTRATION_PCT).toBe(50);
    expect(title(mk(500_000, 500_000))).toBe("El 50 % del gasto está en «UCI»"); // empate: gana el orden por nombre interno
    expect(title(mk(490_000, 510_000))).toBe("El 51 % del gasto está en «Casa»");
    expect(title(mk(499_000, 501_000))).toBe("El 50 % del gasto está en «Casa»"); // 50,1 % redondea a 50
    expect(title(mk(400_000, 330_000, 270_000))).toBeUndefined(); // 40 %
    expect(title(mk(330_000, 330_000, 340_000))).toBeUndefined(); // 34 %
    expect(title(mk(490_000, 310_000, 200_000))).toBeUndefined(); // 49 %
  });

  it("con una sola oferta no hay «concentración»", () => {
    expect(ids(run({ bookings: many(5, 25_000, 1, { job_offer_id: "o1" }) }))).not.toContain(
      "concentration",
    );
  });

  it("lo acordado a 30 días se menciona con el dinero ya comprometido", () => {
    const r = run({ bookings: [...many(3), ahead(2), ahead(3)] });
    const i = r.insights.find((x) => x.id === "upcoming")!;
    expect(i.title).toBe(`Ya tienes ${formatCOP(300_000)} acordados para los próximos 30 días`);
    expect(i.detail).toContain("2 servicios y 12 h");
  });

  it("los avisos van primero; lo bueno, al final", () => {
    const r = run({ bookings: [...many(5, 35_000), ...sepSpend(4), ahead(2)], market: MARKET });
    const sev = r.insights.map((i) => i.severity);
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) => ["warn", "info", "good"].indexOf(a) - ["warn", "info", "good"].indexOf(b),
      ),
    );
  });

  it("los textos no hablan de pagos por fuera ni de WhatsApp", () => {
    const r = run({ bookings: [...many(5, 35_000), ...sepSpend(4), ahead(2)], market: MARKET });
    expect(JSON.stringify(r.insights)).not.toMatch(
      /whatsapp|efectivo|transferencia|nequi|daviplata/i,
    );
  });
});

describe("cuentas con decimales y bordes", () => {
  it("el costo por hora se redondea al peso, no se corta", () => {
    const r = run({ bookings: many(3, 25_000, 1, { total_amount: 100_000 }) }); // 100.000 / 6 h = 16.666,67
    expect(r.avgPerHour).toBe(16_667);
  });

  it("sin horas registradas no hay costo por hora (no se divide entre cero)", () => {
    const r = run({ bookings: many(3, 25_000, 1, { duration_hours: 0, total_amount: 50_000 }) });
    expect(r.avgPerHour).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it("las horas conservan decimales en el periodo y en cada renglón", () => {
    const r = run({
      bookings: many(3, 25_000, 1, {
        duration_hours: 2.5,
        total_amount: 62_500,
        job_offer_id: "o1",
      }),
      offers: { o1: { title: "UCI" } },
    });
    expect(r.hours).toBe(7.5);
    expect(r.drivers[0].hours).toBe(7.5);
  });

  it("el porcentaje de cada renglón se redondea (2 de 3 es 67 %, no 66 %)", () => {
    const rows = [
      at(1, 25_000, { job_offer_id: "o1", total_amount: 200_000 }),
      at(2, 25_000, { job_offer_id: "o2", total_amount: 100_000 }),
    ];
    const r = run({ bookings: rows, offers: { o1: { title: "A" }, o2: { title: "B" } } });
    expect(r.drivers.map((d) => d.share)).toEqual([67, 33]);
  });

  it("a igual gasto gana el renglón con más servicios, y a igualdad total, el orden por nombre interno", () => {
    const offers = { oa: { title: "Uno" }, ob: { title: "Dos" } };
    const rows = [
      at(1, 25_000, { job_offer_id: "oa", total_amount: 300_000 }),
      at(2, 25_000, { job_offer_id: "ob", total_amount: 150_000 }),
      at(3, 25_000, { job_offer_id: "ob", total_amount: 150_000 }),
    ];
    expect(run({ bookings: rows, offers }).drivers.map((d) => d.label)).toEqual(["Dos", "Uno"]);
    const tie = [
      at(1, 25_000, { job_offer_id: "ob", total_amount: 100_000 }),
      at(2, 25_000, { job_offer_id: "oa", total_amount: 100_000 }),
    ];
    expect(run({ bookings: tie, offers }).drivers.map((d) => d.label)).toEqual(["Uno", "Dos"]);
  });

  it("la variación del costo por hora se redondea: 9,5 % cuenta como 10 %", () => {
    const r = run({ bookings: [...many(5, 21_900), ...many(5, 20_000, 35)] });
    expect(r.previous.perHourDeltaPct).toBe(10);
    expect(ids(r)).toContain("rate_up");
  });

  it("la mediana del mercado solo se muestra cuando hay comparación posible", () => {
    expect(run({ bookings: many(2), market: MARKET }).rate.marketMedian).toBeNull();
    expect(run({ bookings: many(5), market: { ...MARKET, n: 4 } }).rate.marketMedian).toBeNull();
    expect(run({ bookings: many(5), market: MARKET }).rate.marketMedian).toBe(24_000);
  });

  it("lo acordado: justo ahora no cuenta como «próximo»; justo a 30 días, sí", () => {
    const exact = (offset: number) => ahead(1, { scheduled_at: iso(NOW + offset) });
    expect(run({ bookings: [exact(0)] }).upcoming30.services).toBe(0);
    expect(run({ bookings: [exact(1)] }).upcoming30.services).toBe(1);
    expect(run({ bookings: [exact(30 * DAY)] }).upcoming30.services).toBe(1);
    expect(run({ bookings: [exact(30 * DAY + 1)] }).upcoming30.services).toBe(0);
  });

  it("solo con servicios acordados (sin nada terminado) también hay datos, proyección y aviso", () => {
    const r = run({ bookings: [ahead(2), ahead(3)] });
    expect(r.hasData).toBe(true);
    expect(r.current.settledToDate).toBe(0);
    expect(r.current.committed).toBe(300_000);
    expect(ids(r)).toEqual(expect.arrayContaining(["projection", "upcoming"]));
    expect(costHeadline(r)).toBe(
      `En oct 2026 tienes ${formatCOP(300_000)} acordados; todavía no hay servicios terminados.`,
    );
  });

  it("si la proyección es una sola cifra, no se explica un «tope» que no existe", () => {
    const rows = [...many(3), ...[2, 3, 4, 5, 6, 7].map((d) => ahead(d))];
    const i = run({ bookings: rows }).insights.find((x) => x.id === "projection")!;
    expect(i.title).toBe(`Proyectamos ${formatCOP(1_350_000)} para oct 2026`);
    expect(i.detail).not.toContain("El tope");
    const range = run({ bookings: [...many(3), ahead(2)] }).insights.find(
      (x) => x.id === "projection",
    )!;
    expect(range.detail).toContain("El tope supone que mantienes el ritmo");
  });

  it("los cortes del ritmo están escritos a propósito", () => {
    expect(PACE_PCT).toBe(25);
    expect(PACE_MIN_BASE).toBe(500_000);
    expect(RATE_TREND_PCT).toBe(10);
    expect(MIN_SERVICES_FOR_RATE).toBe(3);
    expect(DRIVERS_SHOWN).toBe(4);
  });

  it("el ritmo se compara desde una base de $500.000 y con exactamente 25 % de diferencia", () => {
    const sep = (total: number) => at(35, 25_000, { total_amount: total });
    const oct = (total: number) => at(2, 25_000, { total_amount: total });
    expect(ids(run({ bookings: [oct(625_000), sep(500_000)] }))).toContain("pace_up"); // +25 % sobre 500.000
    expect(ids(run({ bookings: [oct(622_000), sep(500_000)] }))).not.toContain("pace_up"); // +24,4 % → 24
  });

  it("con una base de $499.999 no se compara el ritmo, aunque la diferencia sea enorme", () => {
    const rows = [
      at(2, 25_000, { total_amount: 2_000_000 }),
      at(35, 25_000, { total_amount: 499_999 }),
    ];
    expect(ids(run({ bookings: rows }))).not.toContain("pace_up");
    const exact = [
      at(2, 25_000, { total_amount: 2_000_000 }),
      at(35, 25_000, { total_amount: 500_000 }),
    ];
    expect(ids(run({ bookings: exact }))).toContain("pace_up");
  });

  it("dentro del rango del mercado no hay aviso de «por encima» ni de «por debajo»", () => {
    for (const rate of [24_000, 25_000, 28_000, 20_000]) {
      const r = run({ bookings: many(5, rate), market: MARKET });
      expect(r.rate.position).toBe("within");
      expect(ids(r)).not.toContain("above_market");
      expect(ids(r)).not.toContain("below_market");
    }
  });

  it("un ahorro estimado de $0 no se anuncia", () => {
    // 3 servicios de 0,00001 h con $1 en total: el costo por hora es altísimo, pero lo que se ahorraría rondaría 28 centavos
    const tiny = [0, 0, 1].map((total, i) =>
      at(i + 1, 25_000, { duration_hours: 0.00001, total_amount: total }),
    );
    const r = run({ bookings: tiny, market: MARKET });
    expect(r.rate.position).toBe("above");
    expect(r.rate.savingsPerMonth).toBe(0);
    expect(r.insights.find((i) => i.id === "above_market")!.detail).not.toContain("ahorraría");
  });

  it("sin servicios acordados no hay aviso de lo acordado", () => {
    expect(ids(run({ bookings: many(5) }))).not.toContain("upcoming");
  });
});

describe("titular", () => {
  it("con movimiento este mes habla del mes y de la proyección, como rango si el ritmo da más", () => {
    const r = run({ bookings: [...many(3), ahead(2)] });
    expect(r.current.projectedHigh).toBeGreaterThan(r.current.projectedLow);
    expect(costHeadline(r)).toBe(
      `Llevas ${formatCOP(450_000)} en oct 2026 y proyectamos entre ${formatCOP(r.current.projectedLow)} y ${formatCOP(r.current.projectedHigh)}.`,
    );
  });

  it("si lo acordado ya supera el ritmo, la proyección es una sola cifra", () => {
    const rows = [...many(3), ...[2, 3, 4, 5, 6, 7].map((d) => ahead(d))];
    const r = run({ bookings: rows });
    expect(r.current.projectedHigh).toBe(r.current.projectedLow);
    expect(costHeadline(r)).toBe(
      `Llevas ${formatCOP(450_000)} en oct 2026 y proyectamos ${formatCOP(1_350_000)}.`,
    );
  });

  it("sin movimiento este mes pero con servicios en el periodo, habla del periodo", () => {
    const r = run({ bookings: many(4, 25_000, 20), period: resolvePeriod("last_month", NOW) });
    expect(costHeadline(r)).toBe(
      `En el mes pasado (sep 2026) invertiste ${formatCOP(600_000)} en 4 servicios.`,
    );
  });

  it("con la ventana móvil dice «los últimos 30 días»", () => {
    const inWindow = run({ bookings: many(2, 25_000, 14) }); // 14–15 días atrás: septiembre, dentro de 30 días
    expect(costHeadline(inWindow)).toBe(
      `En los últimos 30 días invertiste ${formatCOP(300_000)} en 2 servicios.`,
    );
  });

  it("sin nada este mes ni en el periodo, lo dice", () => {
    const r = run({ bookings: many(4, 25_000, 100) });
    expect(r.hasData).toBe(true);
    expect(costHeadline(r)).toBe("Sin movimiento este mes: lo acordado aparecerá aquí.");
  });
});

describe("propiedades con datos al azar", () => {
  it("no hay NaN, los renglones suman el gasto y los porcentajes son coherentes", () => {
    const rand = mulberry32(31);
    const statuses = [
      "completed",
      "completed",
      "completed",
      "cancelled",
      "confirmed",
      "in_progress",
    ];
    for (let round = 0; round < 60; round++) {
      const n = Math.floor(rand() * 50);
      const rows: InstBooking[] = Array.from({ length: n }, (_, i) => {
        const b = at(Math.floor(rand() * 130) - 10, 15_000 + Math.floor(rand() * 20_000), {
          status: statuses[Math.floor(rand() * statuses.length)],
          job_offer_id: rand() < 0.2 ? null : `o${Math.floor(rand() * 7)}`,
          duration_hours: rand() < 0.1 ? "x" : [2, 4, 6, 12][Math.floor(rand() * 4)],
        });
        return { ...b, id: `c${round}-${i}`, total_amount: rand() < 0.1 ? null : b.total_amount };
      });
      const r = buildCostReport({
        bookings: rows,
        offers: { o1: { title: "A", specialty: "X" }, o2: { title: "B" } },
        market: rand() < 0.5 ? MARKET : null,
        period: rand() < 0.5 ? p30 : resolvePeriod("last_month", NOW),
        now: NOW,
      });
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined/);
      expect(r.drivers.reduce((s, d) => s + d.spent, 0) + r.otherSpent).toBe(r.spent);
      for (const d of r.drivers) {
        expect(d.share).toBeGreaterThanOrEqual(0);
        expect(d.share).toBeLessThanOrEqual(100);
      }
      const spents = r.drivers.map((d) => d.spent);
      expect(spents).toEqual([...spents].sort((a, b) => b - a));
      expect(r.spent).toBeGreaterThanOrEqual(0);
      if (r.avgPerHour !== null) expect(r.services).toBeGreaterThanOrEqual(MIN_SERVICES_FOR_RATE);
      expect(r.drivers.length).toBeLessThanOrEqual(DRIVERS_SHOWN);
    }
  });
});

describe("horas con coma decimal", () => {
  it("las horas acordadas para los próximos 30 días se escriben con coma", () => {
    const r = run({ bookings: [ahead(3, { duration_hours: 6.5, total_amount: 162_500 })] });
    expect(r.insights.find((x) => x.id === "upcoming")!.detail).toContain("1 servicio y 6,5 h.");
  });
});
