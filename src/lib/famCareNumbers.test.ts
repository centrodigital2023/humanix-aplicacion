import { describe, expect, it } from "vitest";
import {
  LOW_GLUCOSE,
  buildNumbers,
  formatMeasure,
  isMeasureKind,
  normalizeTargets,
  parseNumberEs,
  targetState,
  toReadings,
  usedKinds,
  validateMeasure,
  type MeasureRow,
} from "./famCareNumbers";
import { DAY_MS, HOUR_MS } from "./intelShared";
import { MEASURE_KINDS, type MeasureKind } from "./famCareTypes";

const NOW = Date.parse("2026-10-14T15:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

let seq = 0;
const row = (
  kind: MeasureKind | string,
  v1: number | string,
  hoursAgo: number,
  v2: number | string | null = null,
): MeasureRow => ({
  id: `m${++seq}`,
  recipient_id: "r1",
  author_id: "u1",
  kind,
  v1,
  v2,
  measured_at: iso(NOW - hoursAgo * HOUR_MS),
  note: null,
});

describe("isMeasureKind", () => {
  it("acepta solo el vocabulario", () => {
    for (const k of MEASURE_KINDS) expect(isMeasureKind(k)).toBe(true);
    expect(isMeasureKind("sugar")).toBe(false);
    expect(isMeasureKind(undefined)).toBe(false);
  });
});

describe("parseNumberEs", () => {
  it("acepta coma o punto decimal", () => {
    expect(parseNumberEs("7,2")).toBe(7.2);
    expect(parseNumberEs(" 36.8 ")).toBe(36.8);
    expect(parseNumberEs("120")).toBe(120);
    expect(parseNumberEs(98)).toBe(98);
  });

  it("descarta lo que no es un número limpio", () => {
    expect(parseNumberEs("")).toBeNull();
    expect(parseNumberEs("12abc")).toBeNull();
    expect(parseNumberEs("1e3")).toBeNull();
    expect(parseNumberEs(null)).toBeNull();
    expect(parseNumberEs(undefined)).toBeNull();
    expect(parseNumberEs(Number.NaN)).toBeNull();
    expect(parseNumberEs(Infinity)).toBeNull();
  });
});

describe("validateMeasure", () => {
  it("valida el rango posible y redondea según el tipo", () => {
    expect(validateMeasure("temp", "37,46")).toEqual({ ok: true, v1: 37.5, v2: null });
    expect(validateMeasure("glucose", "110.6")).toEqual({ ok: true, v1: 111, v2: null });
    expect(validateMeasure("weight", 70.04)).toEqual({ ok: true, v1: 70, v2: null });
  });

  it("explica qué falta o qué está fuera de rango", () => {
    const empty = validateMeasure("glucose", "");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("glucosa");
    const out = validateMeasure("spo2", "120");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("entre 50 y 100");
  });

  it("la presión pide ambos valores y la alta mayor que la baja", () => {
    expect(validateMeasure("bp", "128", "82")).toEqual({ ok: true, v1: 128, v2: 82 });
    expect(validateMeasure("bp", "128").ok).toBe(false);
    expect(validateMeasure("bp", "128", "200").ok).toBe(false);
    const inverted = validateMeasure("bp", "80", "90");
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error).toContain("mayor");
  });
});

describe("formatMeasure", () => {
  it("muestra cada tipo con su unidad y coma decimal", () => {
    expect(formatMeasure("bp", 128, 82)).toBe("128/82 mmHg");
    expect(formatMeasure("bp", "128", null)).toBe("128/? mmHg");
    expect(formatMeasure("temp", "37.5")).toBe("37,5 °C");
    expect(formatMeasure("temp", 37)).toBe("37 °C");
    expect(formatMeasure("glucose", 110)).toBe("110 mg/dL");
    expect(formatMeasure("pain", 6)).toBe("6/10");
    expect(formatMeasure("weight", "no")).toBe("");
  });
});

describe("normalizeTargets", () => {
  it("se queda solo con claves conocidas y valores posibles", () => {
    expect(
      normalizeTargets({ glucose_min: "80", glucose_max: 180, foo: 1, spo2_min: 30, temp_max: 38 }),
    ).toEqual({
      glucose_min: 80,
      glucose_max: 180,
      temp_max: 38,
    });
  });

  it("descarta un par con el mínimo mayor que el máximo", () => {
    expect(normalizeTargets({ sys_min: 140, sys_max: 110, dia_max: 85 })).toEqual({ dia_max: 85 });
  });

  it("tolera entradas vacías o raras", () => {
    expect(normalizeTargets(null)).toEqual({});
    expect(normalizeTargets("x")).toEqual({});
  });
});

describe("targetState", () => {
  it("compara contra la meta de cada tipo", () => {
    const t = { glucose_min: 80, glucose_max: 180, spo2_min: 92, temp_max: 37.8 };
    expect(targetState("glucose", 120, null, t)).toBe("in");
    expect(targetState("glucose", 200, null, t)).toBe("above");
    expect(targetState("glucose", 70, null, t)).toBe("below");
    expect(targetState("spo2", 90, null, t)).toBe("below");
    expect(targetState("temp", 38.2, null, t)).toBe("above");
    expect(targetState("weight", 70, null, t)).toBe("none");
    expect(targetState("pain", 9, null, t)).toBe("none");
  });

  it("en presión manda el valor fuera de meta", () => {
    const t = { sys_max: 130, dia_max: 80 };
    expect(targetState("bp", 125, 75, t)).toBe("in");
    expect(targetState("bp", 125, 85, t)).toBe("above");
    expect(targetState("bp", 140, null, t)).toBe("above");
    expect(targetState("bp", 125, 75, {})).toBe("none");
  });
});

describe("toReadings", () => {
  it("filtra por tipo, descarta lo dañado y ordena de la más reciente a la más antigua", () => {
    const rows = [
      row("glucose", 100, 10),
      row("glucose", "120", 1),
      row("bp", 120, 2, 80),
      row("glucose", "x", 0),
      { ...row("glucose", 90, 0), measured_at: "dañada" },
    ];
    const r = toReadings(rows, "glucose", { glucose_max: 110 });
    expect(r.map((x) => x.v1)).toEqual([120, 100]);
    expect(r.map((x) => x.state)).toEqual(["above", "in"]);
  });
});

describe("buildNumbers", () => {
  const base = { targets: {}, recipientKind: "elder" as const, now: NOW };

  it("sin lecturas no hay nada que decir", () => {
    const r = buildNumbers({ ...base, rows: [], kind: "glucose" });
    expect(r).toMatchObject({
      last: null,
      count7: 0,
      inRangePct: null,
      trend: null,
      concern: null,
      hasTarget: false,
    });
  });

  it("cuenta la semana y el porcentaje en meta", () => {
    const rows = [
      row("glucose", 120, 1),
      row("glucose", 200, 24),
      row("glucose", 150, 48),
      row("glucose", 130, 72),
      row("glucose", 300, 24 * 10), // fuera de la semana
    ];
    const r = buildNumbers({
      ...base,
      rows,
      kind: "glucose",
      targets: { glucose_min: 80, glucose_max: 180 },
    });
    expect(r.count7).toBe(4);
    expect(r.inRangePct).toBe(75);
    expect(r.hasTarget).toBe(true);
    expect(r.last?.v1).toBe(120);
  });

  it("habla de tendencia solo con 4 lecturas o más y un cambio que importe", () => {
    const up = [140, 150, 160, 100, 100, 100].map((v, i) => row("glucose", v, i));
    expect(buildNumbers({ ...base, rows: up, kind: "glucose" }).trend).toBe("up");
    const flat = [105, 100, 98, 100].map((v, i) => row("glucose", v, i));
    expect(buildNumbers({ ...base, rows: flat, kind: "glucose" }).trend).toBe("flat");
    const down = [70.5, 71, 71, 73].map((v, i) => row("weight", v, i * 24));
    expect(buildNumbers({ ...base, rows: down, kind: "weight" }).trend).toBe("down");
    const few = [200, 100, 100].map((v, i) => row("glucose", v, i));
    expect(buildNumbers({ ...base, rows: few, kind: "glucose" }).trend).toBeNull();
  });

  it("avisa cuando 2 de las 3 últimas lecturas salen de la meta", () => {
    const rows = [190, 120, 200].map((v, i) => row("glucose", v, i));
    const r = buildNumbers({ ...base, rows, kind: "glucose", targets: { glucose_max: 180 } });
    expect(r.concern).toMatchObject({ level: "watch", title: "Fuera de tu meta" });
  });

  it("la glucosa baja es urgente aunque esté dentro de la meta anotada", () => {
    const rows = [row("glucose", LOW_GLUCOSE - 10, 0)];
    const r = buildNumbers({ ...base, rows, kind: "glucose", targets: { glucose_min: 50 } });
    expect(r.concern).toMatchObject({ level: "urgent", title: "Glucosa baja" });
  });

  it("usa los rangos generales de adultos en oxígeno, fiebre, presión y pulso", () => {
    expect(buildNumbers({ ...base, rows: [row("spo2", 88, 0)], kind: "spo2" }).concern?.level).toBe(
      "urgent",
    );
    expect(buildNumbers({ ...base, rows: [row("spo2", 92, 0)], kind: "spo2" }).concern?.level).toBe(
      "watch",
    );
    expect(
      buildNumbers({ ...base, rows: [row("temp", 38.3, 0)], kind: "temp" }).concern?.level,
    ).toBe("watch");
    expect(
      buildNumbers({ ...base, rows: [row("bp", 185, 0, 100)], kind: "bp" }).concern?.level,
    ).toBe("urgent");
    expect(buildNumbers({ ...base, rows: [row("hr", 130, 0)], kind: "hr" }).concern?.level).toBe(
      "urgent",
    );
    expect(buildNumbers({ ...base, rows: [row("bp", 120, 0, 78)], kind: "bp" }).concern).toBeNull();
  });

  it("en niños no aplica los rangos de adulto a presión y pulso, pero sí a fiebre y oxígeno", () => {
    const child = { ...base, recipientKind: "child" as const };
    expect(buildNumbers({ ...child, rows: [row("hr", 130, 0)], kind: "hr" }).concern).toBeNull();
    expect(buildNumbers({ ...child, rows: [row("bp", 95, 0, 60)], kind: "bp" }).concern).toBeNull();
    expect(
      buildNumbers({ ...child, rows: [row("temp", 39.2, 0)], kind: "temp" }).concern?.level,
    ).toBe("urgent");
    expect(
      buildNumbers({ ...child, rows: [row("spo2", 89, 0)], kind: "spo2" }).concern?.level,
    ).toBe("urgent");
  });

  it("el dolor intenso pide vigilar", () => {
    expect(
      buildNumbers({ ...base, rows: [row("pain", 8, 0)], kind: "pain" }).concern,
    ).toMatchObject({
      level: "watch",
      title: "Dolor intenso",
    });
    expect(buildNumbers({ ...base, rows: [row("pain", 4, 0)], kind: "pain" }).concern).toBeNull();
  });

  it("una alerta general urgente gana sobre la de la meta", () => {
    const rows = [row("spo2", 85, 0), row("spo2", 89, 1), row("spo2", 96, 2)];
    const r = buildNumbers({ ...base, rows, kind: "spo2", targets: { spo2_min: 92 } });
    expect(r.concern?.level).toBe("urgent");
  });

  it("no cuenta en la semana lo anotado en el futuro lejano", () => {
    const future = { ...row("temp", 37, 0), measured_at: iso(NOW + 3 * DAY_MS) };
    expect(buildNumbers({ ...base, rows: [future], kind: "temp" }).count7).toBe(0);
  });
});

describe("usedKinds", () => {
  it("devuelve los tipos con lecturas en el orden del vocabulario", () => {
    expect(
      usedKinds([
        row("pain", 3, 0),
        row("glucose", 100, 0),
        row("raro", 1, 0),
        row("bp", 120, 0, 80),
      ]),
    ).toEqual(["glucose", "bp", "pain"]);
  });
});
