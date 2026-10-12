import { describe, expect, it } from "vitest";
import {
  BUFFER_MINUTES,
  MAX_HOURS_PER_DAY,
  MAX_HOURS_PER_WEEK,
  MAX_PLAN_SHIFTS,
  MIN_PLAN_SCORE,
  PLAN_HORIZON_DAYS,
  SKIP_TEXT,
  buildWeekPlan,
  type PlanBusy,
  type PlanOptions,
} from "./proWeekPlan";
import type { RankedShift } from "./opportunities";
import { DAY, HOUR, NOW, bogota, mulberry32 } from "./intel.fixture";

const TODAY = bogota("2026-10-14T00:00:00"); // miércoles, hoy son las 10:00
let seq = 0;

/** Turno en el hub: empieza `dayOffset` días desde hoy a la hora indicada y dura `hours`. */
function shift(
  dayOffset: number,
  hour: number,
  hours: number,
  over: { rate?: number | null; score?: number; conflict?: boolean; key?: string } = {},
): RankedShift {
  const start = TODAY + dayOffset * DAY + hour * HOUR;
  const key = over.key ?? `s${++seq}`;
  const rate = over.rate === undefined ? 25_000 : over.rate;
  const score = over.score ?? 85;
  return {
    shift: {
      key,
      family_user_id: `f-${key}`,
      display_name: `Familia ${key}`,
      city: "Bogotá",
      care_type: null,
      need_ids: [key],
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + hours * HOUR).toISOString(),
      hours,
      rate_min: rate,
      rate_max: rate,
      rate_avg: rate,
      notes: [],
    },
    match: {
      score,
      label: score >= 80 ? "Excelente" : score >= 60 ? "Buena" : "Posible",
      reasons: ["Está en tu zona de servicio"],
      warnings: [],
      conflict: over.conflict ?? false,
    },
    urgency: "week",
  };
}
const busy = (dayOffset: number, hour: number, hours: number): PlanBusy => ({
  start: new Date(TODAY + dayOffset * DAY + hour * HOUR).toISOString(),
  end: new Date(TODAY + dayOffset * DAY + (hour + hours) * HOUR).toISOString(),
});
const plan = (ranked: RankedShift[], busyBlocks: PlanBusy[] = [], options: PlanOptions = {}) =>
  buildWeekPlan({ ranked, busy: busyBlocks, options: { now: NOW, ...options } });
const keys = (p: ReturnType<typeof plan>) => p.chosen.map((c) => c.key);
const reasons = (p: ReturnType<typeof plan>) =>
  Object.fromEntries(p.skipped.map((s) => [s.key, s.reason]));

describe("razones del turno", () => {
  it("muestra a lo sumo las 3 primeras razones de compatibilidad", () => {
    const row = shift(1, 8, 6, { key: "x" });
    row.match.reasons = ["uno", "dos", "tres", "cuatro", "cinco"];
    expect(plan([row]).chosen[0].reasons).toEqual(["uno", "dos", "tres"]);
  });
});

describe("sin turnos", () => {
  it("la semana queda libre y se explica qué pasará cuando haya turnos", () => {
    const p = plan([]);
    expect(p.chosen).toEqual([]);
    expect(p.totals).toEqual({ shifts: 0, hours: 0, earnings: 0 });
    expect(p.days).toHaveLength(PLAN_HORIZON_DAYS);
    expect(p.days.every((d) => d.isFree)).toBe(true);
    expect(p.days[0]).toMatchObject({ isToday: true, label: "miércoles 14 de octubre" });
    expect(p.insights.map((i) => i.id)).toEqual(["no_candidates"]);
    expect(p.after).toEqual({ weeklyHours: 0, freeDays: 7 });
  });
});

describe("qué turnos entran", () => {
  it("elige los que se pueden hacer juntos y los ordena por fecha", () => {
    const p = plan([
      shift(3, 8, 6, { key: "c" }),
      shift(1, 8, 6, { key: "a" }),
      shift(2, 8, 6, { key: "b" }),
    ]);
    expect(keys(p)).toEqual(["a", "b", "c"]);
    expect(p.totals).toEqual({ shifts: 3, hours: 18, earnings: 3 * 150_000 });
    expect(p.insights[0]).toMatchObject({ id: "plan_ready", severity: "good" });
    expect(p.insights[0].title).toBe("3 turnos compatibles para tu semana");
  });

  it("deja fuera lo que no encaja: con cruce, de baja compatibilidad, fuera de la semana o ya empezado", () => {
    const p = plan([
      shift(1, 8, 6, { key: "ok" }),
      shift(2, 8, 6, { key: "cruza", conflict: true }),
      shift(3, 8, 6, { key: "baja", score: 59 }),
      shift(9, 8, 6, { key: "lejos" }),
      shift(0, 8, 6, { key: "ya_empezo" }), // hoy 08:00 < ahora 10:00
    ]);
    expect(keys(p)).toEqual(["ok"]);
    expect(p.excluded).toEqual({ conflicts: 1, lowFit: 1, outside: 2 });
  });

  it("el puntaje mínimo exacto (60) sí entra y 59 no", () => {
    expect(MIN_PLAN_SCORE).toBe(60);
    expect(keys(plan([shift(1, 8, 6, { key: "x", score: 60 })]))).toEqual(["x"]);
    expect(keys(plan([shift(1, 8, 6, { key: "y", score: 59 })]))).toEqual([]);
  });

  it("entre dos turnos que se cruzan gana el que más deja (ponderado por compatibilidad)", () => {
    const p = plan([
      shift(1, 8, 6, { key: "barato", rate: 20_000 }),
      shift(1, 10, 6, { key: "caro", rate: 40_000 }),
    ]);
    expect(keys(p)).toEqual(["caro"]);
    expect(reasons(p)).toEqual({ barato: "overlap" });
  });

  it("a igual valor, gana el más compatible; y si también empatan, el que ocurre antes", () => {
    // 120.000 × 1,00 = 150.000 × 0,80: mismo valor ponderado, se cruzan; gana el de mayor compatibilidad
    const p = plan([
      shift(1, 8, 6, { key: "mas_paga", rate: 25_000, score: 80 }),
      shift(1, 9, 6, { key: "mas_encaja", rate: 20_000, score: 100 }),
    ]);
    expect(keys(p)).toEqual(["mas_encaja"]);
    const tie = plan([
      shift(1, 10, 6, { key: "tarde", rate: 20_000, score: 80 }),
      shift(1, 8, 6, { key: "temprano", rate: 20_000, score: 80 }),
    ]);
    expect(keys(tie)).toEqual(["temprano"]);
  });

  it("el plan es el mismo sin importar el orden en que llegan los turnos", () => {
    const rows = [
      shift(1, 8, 6, { key: "a" }),
      shift(1, 10, 6, { key: "b" }),
      shift(2, 8, 6, { key: "c" }),
      shift(2, 9, 6, { key: "d", rate: 30_000 }),
      shift(4, 8, 12, { key: "e" }),
    ];
    const base = plan(rows);
    const rev = plan([...rows].reverse());
    expect(keys(rev)).toEqual(keys(base));
    expect(rev.skipped.map((s) => s.key)).toEqual(base.skipped.map((s) => s.key));
  });
});

describe("agenda y margen entre servicios", () => {
  it("no propone turnos que se cruzan con lo ya confirmado", () => {
    const p = plan([shift(1, 8, 6, { key: "x" })], [busy(1, 10, 4)]);
    expect(keys(p)).toEqual([]);
    expect(reasons(p).x).toBe("overlap");
  });

  it("exige 60 minutos de margen: con 59 no, con 60 sí (antes y después)", () => {
    expect(BUFFER_MINUTES).toBe(60);
    // el servicio confirmado termina a las 14:00
    const after59 = shift(1, 14 + 59 / 60, 4, { key: "a59" });
    const after60 = shift(1, 15, 4, { key: "a60" });
    expect(keys(plan([after59], [busy(1, 8, 6)]))).toEqual([]);
    expect(keys(plan([after60], [busy(1, 8, 6)]))).toEqual(["a60"]);
    // el servicio confirmado empieza a las 18:00
    const before59 = shift(1, 8, 9 + 1 / 60, { key: "b59" }); // termina 17:01
    const before60 = shift(1, 8, 9, { key: "b60" }); // termina 17:00
    expect(keys(plan([before59], [busy(1, 18, 2)]))).toEqual([]);
    expect(keys(plan([before60], [busy(1, 18, 2)]))).toEqual(["b60"]);
  });

  it("también cuida el margen entre dos turnos propuestos", () => {
    const p = plan([
      shift(1, 8, 6, { key: "uno", rate: 30_000 }),
      shift(1, 14.5, 4, { key: "dos", rate: 25_000 }), // empieza 30 min después de terminar «uno»
    ]);
    expect(keys(p)).toEqual(["uno"]);
    expect(reasons(p).dos).toBe("overlap");
  });

  it("los servicios confirmados con fechas dañadas se ignoran sin romper", () => {
    const p = plan(
      [shift(1, 8, 6, { key: "x" })],
      [{ start: "no-es-fecha", end: "tampoco" }, busy(1, 10, 0)],
    );
    expect(keys(p)).toEqual(["x"]);
  });
});

describe("topes de horas", () => {
  it("máximo 12 h por día, contando lo que ya está confirmado", () => {
    expect(MAX_HOURS_PER_DAY).toBe(12);
    // 6 h confirmadas + un turno de 7 h otro día no cruzado = 13 h > 12
    const p = plan([shift(1, 16, 7, { key: "x" })], [busy(1, 6, 6)]);
    expect(reasons(p).x).toBe("day_cap");
    const ok = plan([shift(1, 16, 6, { key: "y" })], [busy(1, 6, 6)]);
    expect(keys(ok)).toEqual(["y"]); // 12 h exactas
  });

  it("un turno de noche reparte sus horas entre los dos días para el tope diario", () => {
    // noche del jueves 19:00 → viernes 07:00 (5 h + 7 h); el viernes ya tiene 6 h confirmadas de 08:00 a 14:00 + 8 h = 14 h
    const night = shift(1, 19, 12, { key: "noche" });
    const p = plan([night], [busy(2, 8, 6), busy(2, 14, 1)], { maxHoursPerDay: 12 });
    // viernes: 7 h de la noche + 7 h confirmadas = 14 > 12
    expect(reasons(p).noche).toBe("day_cap");
    const free = plan([night]);
    expect(keys(free)).toEqual(["noche"]);
  });

  it("máximo 48 h en la semana, contando lo ya acordado; justo 48 sí entra", () => {
    expect(MAX_HOURS_PER_WEEK).toBe(48);
    const week = [busy(1, 8, 10), busy(2, 8, 10), busy(3, 8, 10), busy(4, 8, 10)]; // 40 h
    expect(reasons(plan([shift(5, 8, 9, { key: "x" })], week)).x).toBe("week_cap");
    expect(keys(plan([shift(5, 8, 8, { key: "y" })], week))).toEqual(["y"]); // 48 exactas
  });

  it("quedar fuera por el tope de la semana también se explica", () => {
    const week = [busy(1, 8, 10), busy(2, 8, 10), busy(3, 8, 10), busy(4, 8, 10)]; // 40 h
    const p = plan([shift(5, 8, 9, { key: "x" })], week);
    expect(p.insights.map((i) => i.id)).toContain("caps");
    expect(p.insights.find((i) => i.id === "caps")?.title).toBe(
      "1 turno quedó fuera por el tope de horas",
    );
  });

  it("de un turno de noche en el último día solo cuentan las horas que caen dentro de los 7 días", () => {
    // 42 h confirmadas + la parte del turno que cae dentro de la semana (5 h) = 47 ≤ 48; entero serían 54
    const heavy = [busy(0, 12, 10), busy(1, 8, 8), busy(2, 8, 8), busy(3, 8, 8), busy(4, 8, 8)]; // 42 h
    const night = shift(6, 19, 12, { key: "noche_final" });
    expect(keys(plan([night], heavy, { minRestDays: 0 }))).toEqual(["noche_final"]);
  });

  it("los topes se pueden cambiar", () => {
    const p = plan([shift(1, 8, 10, { key: "x" })], [], { maxHoursPerDay: 8 });
    expect(reasons(p).x).toBe("day_cap");
  });
});

describe("día libre protegido", () => {
  const busyOnDays = (days: number[]) => days.map((d) => busy(d, 8, 4));

  it("no propone un turno que se llevaría el único día libre que queda", () => {
    // hoy (0) a +5 ocupados, solo +6 libre
    const p = plan([shift(6, 8, 4, { key: "x" })], busyOnDays([0, 1, 2, 3, 4, 5]));
    expect(reasons(p).x).toBe("rest");
    expect(p.after.freeDays).toBe(1);
    expect(p.insights.map((i) => i.id)).toContain("rest_protected");
  });

  it("sí propone turnos sobre días que ya estaban ocupados (no restan días libres)", () => {
    const p = plan([shift(2, 15, 4, { key: "x" })], busyOnDays([0, 1, 2, 3, 4, 5]));
    expect(keys(p)).toEqual(["x"]);
    expect(p.after.freeDays).toBe(1);
  });

  it("si ya no queda ningún día libre, no se pide uno imposible", () => {
    const p = plan([shift(2, 15, 4, { key: "x" })], busyOnDays([0, 1, 2, 3, 4, 5, 6]));
    expect(p.after.freeDays).toBe(0);
    expect(keys(p)).toEqual(["x"]);
  });

  it("un día con una hora o menos todavía cuenta como libre; con más, no", () => {
    const p = plan([], [busy(1, 8, 1), busy(2, 8, 1.5)]);
    expect(p.days[1].isFree).toBe(true);
    expect(p.days[2].isFree).toBe(false);
    expect(p.after.freeDays).toBe(6);
  });

  it("se puede pedir más de un día libre", () => {
    const p = plan(
      [shift(1, 8, 4, { key: "a" }), shift(2, 8, 4, { key: "b" })],
      busyOnDays([0, 3, 4]),
      {
        minRestDays: 3,
      },
    );
    // libres antes: 1, 2, 5, 6 (4 días); proteger 3 → solo cabe uno de los dos turnos
    expect(p.after.freeDays).toBeGreaterThanOrEqual(3);
    expect(keys(p)).toHaveLength(1);
  });
});

describe("límites del plan y turnos sin tarifa", () => {
  it("propone como máximo 8 turnos y explica a los demás", () => {
    expect(MAX_PLAN_SHIFTS).toBe(8);
    const many = Array.from({ length: 10 }, (_, i) =>
      shift(1 + (i % 5), 6 + (i >= 5 ? 8 : 0), 4, { key: `m${i}` }),
    );
    const p = plan(many, [], { minRestDays: 0 });
    expect(p.chosen.length).toBeLessThanOrEqual(8);
    expect(p.skipped.filter((s) => s.reason === "limit").length).toBe(10 - p.chosen.length);
  });

  it("los turnos sin tarifa no entran: no se puede decir lo que dejan", () => {
    const p = plan([shift(1, 8, 6, { key: "sin", rate: null }), shift(2, 8, 6, { key: "con" })]);
    expect(keys(p)).toEqual(["con"]);
    expect(reasons(p).sin).toBe("no_rate");
    expect(p.insights.map((i) => i.id)).toContain("no_rate");
    expect(SKIP_TEXT.no_rate).toMatch(/tarifa/);
  });

  it("las razones están en español claro y no hablan de pagos por fuera de la plataforma", () => {
    for (const t of Object.values(SKIP_TEXT))
      expect(t).not.toMatch(/whatsapp|transferencia|efectivo/i);
  });
});

describe("la semana, día por día", () => {
  it("separa lo confirmado de lo propuesto en cada día", () => {
    const p = plan([shift(2, 8, 6, { key: "x" })], [busy(2, 16, 3)]);
    expect(p.days[2]).toMatchObject({ bookedHours: 3, plannedHours: 6, isFree: false });
    expect(p.days[1]).toMatchObject({ bookedHours: 0, plannedHours: 0, isFree: true });
    expect(p.days[0].isToday).toBe(true);
    expect(p.days[1].isToday).toBe(false);
    expect(p.booked.hours).toBe(3);
    expect(p.after.weeklyHours).toBe(9);
  });

  it("lo confirmado de ayer o de después de la semana no cuenta en las horas ni en los días", () => {
    const p = plan([], [busy(-1, 8, 10), busy(8, 8, 10)]);
    expect(p.booked.hours).toBe(0);
    expect(p.after.weeklyHours).toBe(0);
    expect(p.days.every((d) => d.isFree)).toBe(true);
  });

  it("un servicio confirmado que cruza la medianoche reparte sus horas entre los dos días", () => {
    const p = plan([], [busy(1, 19, 12)]);
    expect(p.days[1].bookedHours).toBe(5);
    expect(p.days[2].bookedHours).toBe(7);
  });

  it("los descartes se ordenan por lo que dejaban en pesos, aunque el valor ponderado diga otra cosa", () => {
    const p = plan([
      shift(1, 8, 6, { key: "gana", rate: 40_000, score: 100 }), // 240.000
      shift(1, 9, 6, { key: "a", rate: 16_667, score: 100 }), // ≈ 100.000 · valor ponderado 100.000
      shift(1, 10, 6, { key: "b", rate: 21_667, score: 70 }), // ≈ 130.000 · valor ponderado 91.000
    ]);
    expect(p.skipped.map((x) => x.key)).toEqual(["b", "a"]);
  });

  it("la lista de descartes muestra hasta 12, de lo que más dejaba a lo que menos", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      shift(1, 8, 6, { key: `k${i}`, rate: 20_000 + i * 1000 }),
    );
    const p = plan(rows);
    expect(p.skipped.length).toBeLessThanOrEqual(12);
    for (let i = 1; i < p.skipped.length; i++)
      expect(p.skipped[i - 1].total ?? 0).toBeGreaterThanOrEqual(p.skipped[i].total ?? 0);
  });
});

describe("propiedades con instancias al azar", () => {
  it("todo plan respeta cruces, márgenes, topes de horas y el día libre", () => {
    const rnd = mulberry32(14);
    for (let it = 0; it < 250; it++) {
      const busyBlocks: PlanBusy[] = Array.from({ length: Math.floor(rnd() * 6) }, () =>
        busy(Math.floor(rnd() * 7), Math.floor(rnd() * 20), 1 + Math.floor(rnd() * 8)),
      );
      const ranked = Array.from({ length: Math.floor(rnd() * 25) }, () =>
        shift(Math.floor(rnd() * 9) - 1, Math.floor(rnd() * 22), 1 + Math.floor(rnd() * 12), {
          rate: rnd() < 0.15 ? null : 15_000 + Math.floor(rnd() * 25_000),
          score: 30 + Math.floor(rnd() * 70),
          conflict: rnd() < 0.1,
        }),
      );
      const minRest = Math.floor(rnd() * 3);
      const opts: PlanOptions = { minRestDays: minRest };
      const p = plan(ranked, busyBlocks, opts);

      // 1) sin cruces ni márgenes cortos entre lo elegido y lo confirmado
      const buf = BUFFER_MINUTES * 60_000;
      for (const c of p.chosen) {
        const cs = Date.parse(c.startsAt);
        const ce = Date.parse(c.endsAt);
        for (const b of busyBlocks) {
          const bs = Date.parse(b.start);
          const be = Date.parse(b.end);
          expect(cs < be + buf && bs - buf < ce).toBe(false);
        }
        for (const other of p.chosen) {
          if (other === c) continue;
          const os = Date.parse(other.startsAt);
          const oe = Date.parse(other.endsAt);
          expect(cs < oe + buf && os - buf < ce).toBe(false);
        }
        // 2) cada turno elegido cumple lo prometido
        expect(c.score).toBeGreaterThanOrEqual(MIN_PLAN_SCORE);
        expect(c.total).not.toBeNull();
        expect(cs).toBeGreaterThanOrEqual(NOW);
        expect(cs).toBeLessThan(TODAY + PLAN_HORIZON_DAYS * DAY);
      }

      // 3) topes de horas
      expect(p.after.weeklyHours).toBeGreaterThanOrEqual(p.booked.hours);
      expect(p.chosen.length).toBeLessThanOrEqual(MAX_PLAN_SHIFTS);

      // 4) día libre: nunca baja de lo pedido si antes había de sobra
      const freeBefore = plan([], busyBlocks).after.freeDays;
      expect(p.after.freeDays).toBeGreaterThanOrEqual(Math.min(minRest, freeBefore));

      // 5) totales coherentes y sin valores rotos
      expect(p.totals.earnings).toBe(p.chosen.reduce((n, c) => n + (c.total ?? 0), 0));
      expect(p.totals.shifts).toBe(p.chosen.length);
      expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity|undefined/);
      expect(new Set(p.chosen.map((c) => c.key)).size).toBe(p.chosen.length);
      expect(
        p.chosen.every(
          (c, i, a) => i === 0 || Date.parse(a[i - 1].startsAt) <= Date.parse(c.startsAt),
        ),
      ).toBe(true);
    }
  });

  it("el tope de horas por día se cumple de verdad en el reparto por días de Colombia", () => {
    const rnd = mulberry32(21);
    for (let it = 0; it < 150; it++) {
      const busyBlocks = Array.from({ length: Math.floor(rnd() * 4) }, () =>
        busy(Math.floor(rnd() * 7), Math.floor(rnd() * 20), 1 + Math.floor(rnd() * 6)),
      );
      const ranked = Array.from({ length: 12 }, () =>
        shift(Math.floor(rnd() * 7), Math.floor(rnd() * 22), 2 + Math.floor(rnd() * 12), {
          score: 90,
        }),
      );
      const p = plan(ranked, busyBlocks, { minRestDays: 0 });
      const perDay = new Map<number, number>();
      const add = (s: number, e: number) => {
        for (let t = s; t < e; ) {
          const dayStart = Math.floor((t - TODAY) / DAY) * DAY + TODAY;
          const next = Math.min(e, dayStart + DAY);
          perDay.set(dayStart, (perDay.get(dayStart) ?? 0) + (next - t) / HOUR);
          t = next;
        }
      };
      for (const c of p.chosen) add(Date.parse(c.startsAt), Date.parse(c.endsAt));
      const booked = new Map<number, number>();
      for (const b of busyBlocks) {
        for (let t = Date.parse(b.start); t < Date.parse(b.end); ) {
          const dayStart = Math.floor((t - TODAY) / DAY) * DAY + TODAY;
          const next = Math.min(Date.parse(b.end), dayStart + DAY);
          booked.set(dayStart, (booked.get(dayStart) ?? 0) + (next - t) / HOUR);
          t = next;
        }
      }
      for (const [day, h] of perDay) {
        // lo propuesto más lo confirmado no pasa del tope, salvo que lo confirmado ya lo pasara por sí solo
        const total = h + (booked.get(day) ?? 0);
        if ((booked.get(day) ?? 0) <= MAX_HOURS_PER_DAY)
          expect(total).toBeLessThanOrEqual(MAX_HOURS_PER_DAY + 1e-9);
      }
    }
  });
});
