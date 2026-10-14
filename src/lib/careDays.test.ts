import { describe, expect, it } from "vitest";
import { CARE_DAY_MILESTONES, careDaySet, careDaysReport } from "./careDays";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

const done = (daysAgo: number) => ({ status: "completed", scheduled_at: iso(-daysAgo * DAY) });
const days = (...ago: number[]) => ago.map(done);

describe("días con cuidado: qué cuenta", () => {
  it("sin nada: empieza la historia, sin números tristes", () => {
    const r = careDaysReport({ bookings: [], now: NOW });
    expect(r.total).toBe(0);
    expect(r.thisWeek).toBe(0);
    expect(r.reached).toBeNull();
    expect(r.next).toBe(7);
    expect(r.toNext).toBe(7);
    expect(r.headline).toBe("Aquí empieza su historia de cuidado");
  });

  it("cuentan los servicios terminados y en curso; no los pendientes, cancelados ni futuros", () => {
    const set = careDaySet(
      [
        done(1),
        { status: "in_progress", scheduled_at: iso(-HOUR) },
        { status: "confirmed", scheduled_at: iso(-2 * DAY) },
        { status: "cancelled", scheduled_at: iso(-3 * DAY) },
        { status: "completed", scheduled_at: iso(2 * DAY) },
        { status: "pending", scheduled_at: iso(-4 * DAY) },
      ],
      [],
      NOW,
    );
    expect(set.size).toBe(2);
  });

  it("varios servicios el mismo día cuentan un día", () => {
    expect(careDaysReport({ bookings: [done(2), done(2), done(2)], now: NOW }).total).toBe(1);
  });

  it("un servicio que cruza la medianoche cubre los dos días", () => {
    // 13/oct 20:00 → 14/oct 05:00 (hora de Colombia)
    const night = {
      status: "completed",
      scheduled_at: iso(-14 * HOUR),
      completed_at: iso(-5 * HOUR),
    };
    expect(careDaysReport({ bookings: [night], now: NOW }).total).toBe(2);
  });

  it("un turno larguísimo o dañado no infla el contador (tope de 3 días)", () => {
    const long = { status: "completed", scheduled_at: iso(-10 * DAY), completed_at: iso(-HOUR) };
    expect(careDaysReport({ bookings: [long], now: NOW }).total).toBe(3);
  });

  it("una hora de fin anterior al inicio no resta ni rompe", () => {
    const odd = { status: "completed", scheduled_at: iso(-2 * DAY), completed_at: iso(-5 * DAY) };
    expect(careDaysReport({ bookings: [odd], now: NOW }).total).toBe(1);
  });

  it("los partes escritos por una persona suman su día; los del sistema no", () => {
    const set = careDaySet(
      [],
      [
        { created_at: iso(-DAY) },
        { created_at: iso(-2 * DAY), system_generated: true },
        { created_at: iso(-3 * DAY), system_generated: false },
        { created_at: iso(2 * HOUR) },
        { created_at: "no es fecha" },
      ],
      NOW,
    );
    expect(set.size).toBe(2);
  });

  it("el día es el de Colombia, no el de UTC", () => {
    // 14/oct 03:00 UTC = 13/oct 22:00 en Colombia: no es el mismo día que NOW (14/oct 10:00).
    const r = careDaysReport({
      bookings: [done(0), { status: "completed", scheduled_at: "2026-10-14T03:00:00Z" }],
      now: NOW,
    });
    expect(r.total).toBe(2);
  });
});

describe("días con cuidado: esta semana y umbrales", () => {
  it("esta semana son los últimos 7 días, contando hoy", () => {
    const r = careDaysReport({ bookings: days(0, 6, 7, 20), now: NOW });
    expect(r.total).toBe(4);
    expect(r.thisWeek).toBe(2);
  });

  it("cruzar el 7 se celebra una vez, en la semana en que ocurre", () => {
    const week = careDaysReport({ bookings: days(0, 1, 2, 3, 4, 5, 6), now: NOW });
    expect(week.total).toBe(7);
    expect(week.reached).toBe(7);
    expect(week.next).toBe(14);
    expect(week.toNext).toBe(7);
    expect(week.crossedThisWeek).toBe(7);
    expect(week.line).toContain("7 días con cuidado");

    // Una semana después ya no se vuelve a celebrar.
    const later = careDaysReport({ bookings: days(0, 1, 2, 3, 4, 5, 6), now: NOW + 8 * DAY });
    expect(later.crossedThisWeek).toBeNull();
    expect(later.reached).toBe(7);
  });

  it("avisa cuando faltan 3 días o menos para el siguiente umbral", () => {
    expect(careDaysReport({ bookings: days(0, 1, 2, 3, 4), now: NOW }).line).toBe(
      "Faltan 2 días para llegar a 7.",
    );
    expect(careDaysReport({ bookings: days(0, 1, 2, 3, 4, 5), now: NOW }).line).toBe(
      "Falta 1 día para llegar a 7.",
    );
  });

  it("la frontera del aviso: a 3 días del umbral sí avisa, a 4 todavía no", () => {
    expect(careDaysReport({ bookings: days(0, 1, 2, 3), now: NOW }).line).toBe(
      "Faltan 3 días para llegar a 7.",
    );
    expect(careDaysReport({ bookings: days(0, 1, 2), now: NOW }).line).toBe(
      "3 días con cuidado esta semana. Esto solo suma.",
    );
  });

  it("con pocos días, el mensaje habla de esta semana", () => {
    expect(careDaysReport({ bookings: days(0, 1), now: NOW }).line).toBe(
      "2 días con cuidado esta semana. Esto solo suma.",
    );
  });

  it("si esta semana no hubo servicio, el mensaje no regaña", () => {
    const r = careDaysReport({ bookings: days(20, 21, 22, 23, 24, 25, 26, 27, 28, 29), now: NOW });
    expect(r.total).toBe(10);
    expect(r.thisWeek).toBe(0);
    expect(r.line).toBe("Esto solo suma: ningún día sin servicio le quita nada a los anteriores.");
  });

  it("no es una racha: un hueco no resta nada", () => {
    const seguidos = careDaysReport({ bookings: days(0, 1, 2, 3, 4), now: NOW }).total;
    const conHuecos = careDaysReport({ bookings: days(0, 2, 4, 6, 8), now: NOW }).total;
    expect(conHuecos).toBe(seguidos);
  });

  it("agregar datos nunca baja el total (monótono)", () => {
    let prev = 0;
    for (const extra of [[0], [0, 5], [0, 5, 9], [0, 5, 9, 30], [0, 5, 9, 30, 31]]) {
      const t = careDaysReport({ bookings: days(...extra), now: NOW }).total;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it("pasado el último umbral, no hay siguiente", () => {
    const many = Array.from({ length: 366 }, (_, i) => i);
    const r = careDaysReport({ bookings: days(...many), now: NOW });
    expect(r.reached).toBe(365);
    expect(r.next).toBeNull();
    expect(r.toNext).toBeNull();
  });

  it("los umbrales están ordenados y son crecientes", () => {
    expect([...CARE_DAY_MILESTONES]).toEqual([...CARE_DAY_MILESTONES].sort((a, b) => a - b));
  });
});

describe("días con cuidado: tono sobrio", () => {
  it("sin celebraciones ni umbrales a la vista", () => {
    const r = careDaysReport({ bookings: days(0, 1, 2, 3, 4, 5, 6), now: NOW, tone: "sober" });
    expect(r.celebrate).toBe(false);
    expect(r.crossedThisWeek).toBeNull();
    expect(r.headline).toBe("Han estado acompañados 7 días");
    expect(r.line).toBe("Cada día de compañía cuenta, sin metas ni presión.");
  });

  it("el tono cálido es el predeterminado", () => {
    expect(careDaysReport({ bookings: days(0), now: NOW }).celebrate).toBe(true);
  });

  it("el singular se escribe bien", () => {
    expect(careDaysReport({ bookings: days(0), now: NOW }).headline).toBe("1 día con cuidado");
    expect(careDaysReport({ bookings: days(0), now: NOW, tone: "sober" }).headline).toBe(
      "Han estado acompañados 1 día",
    );
  });

  it("ningún mensaje usa lenguaje de racha o de pérdida", () => {
    const texts = [
      careDaysReport({ bookings: [], now: NOW }),
      careDaysReport({ bookings: days(0), now: NOW }),
      careDaysReport({ bookings: days(0, 1, 2, 3, 4), now: NOW }),
      careDaysReport({ bookings: days(20, 21), now: NOW }),
      careDaysReport({ bookings: days(0, 1, 2, 3, 4, 5, 6), now: NOW, tone: "sober" }),
    ]
      .map((r) => `${r.headline} ${r.line}`)
      .join(" ");
    expect(texts).not.toMatch(/racha|perdi|rompi|reinici|volv\w+ a cero|seguidos/i);
  });
});
