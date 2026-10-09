import { describe, expect, it } from "vitest";
import {
  buildShift,
  buildShiftBatch,
  estimateBudget,
  expandPattern,
  findDuplicateShifts,
  parseRequirements,
  type ShiftDraft,
} from "./institutionShifts";

// 2026-10-09 10:00 en Colombia = 15:00 UTC.
const NOW = Date.parse("2026-10-09T15:00:00Z");
const draft = (over: Partial<ShiftDraft> = {}): ShiftDraft => ({
  date: "2026-10-12",
  start: "07:00",
  end: "19:00",
  positions: 1,
  ...over,
});

describe("buildShift", () => {
  it("convierte la hora de Colombia (UTC-5) a instantes exactos", () => {
    const r = buildShift(draft(), NOW);
    expect(r).toMatchObject({
      ok: true,
      shift: {
        starts_at: "2026-10-12T12:00:00.000Z",
        ends_at: "2026-10-13T00:00:00.000Z",
        hours: 12,
        overnight: false,
        positions: 1,
      },
    });
  });

  it("el turno de noche termina al día siguiente", () => {
    const r = buildShift(draft({ start: "19:00", end: "07:00" }), NOW);
    expect(r).toMatchObject({
      ok: true,
      shift: {
        starts_at: "2026-10-13T00:00:00.000Z",
        ends_at: "2026-10-13T12:00:00.000Z",
        hours: 12,
        overnight: true,
      },
    });
  });

  it("el turno de noche cruza el fin de mes", () => {
    const r = buildShift(draft({ date: "2026-10-31", start: "22:00", end: "06:00" }), NOW);
    expect(r).toMatchObject({
      ok: true,
      shift: {
        starts_at: "2026-11-01T03:00:00.000Z",
        ends_at: "2026-11-01T11:00:00.000Z",
        hours: 8,
      },
    });
  });

  it("rechaza fechas y horas mal formadas", () => {
    expect(buildShift(draft({ date: "" }), NOW)).toEqual({ ok: false, reason: "bad_date" });
    expect(buildShift(draft({ date: "2026-02-30" }), NOW)).toEqual({
      ok: false,
      reason: "bad_date",
    });
    expect(buildShift(draft({ date: "12/10/2026" }), NOW)).toEqual({
      ok: false,
      reason: "bad_date",
    });
    expect(buildShift(draft({ start: "7:00" }), NOW)).toEqual({ ok: false, reason: "bad_time" });
    expect(buildShift(draft({ end: "24:00" }), NOW)).toEqual({ ok: false, reason: "bad_time" });
    expect(buildShift(draft({ end: "" }), NOW)).toEqual({ ok: false, reason: "bad_time" });
  });

  it("rechaza inicio y fin iguales", () => {
    expect(buildShift(draft({ start: "08:00", end: "08:00" }), NOW)).toEqual({
      ok: false,
      reason: "same_time",
    });
  });

  it("no admite turnos que empezaron hace más de una hora ni a más de un año", () => {
    expect(buildShift(draft({ date: "2026-10-09", start: "08:30", end: "14:00" }), NOW)).toEqual({
      ok: false,
      reason: "past",
    });
    // Empezó hace 30 min: el servidor lo tolera (1 h).
    expect(buildShift(draft({ date: "2026-10-09", start: "09:30", end: "14:00" }), NOW).ok).toBe(
      true,
    );
    expect(buildShift(draft({ date: "2028-01-01" }), NOW)).toEqual({
      ok: false,
      reason: "too_far",
    });
  });

  it("valida el cupo", () => {
    for (const positions of [0, -1, 51, 1.5, Number.NaN]) {
      expect(buildShift(draft({ positions }), NOW)).toEqual({ ok: false, reason: "positions" });
    }
    expect(buildShift(draft({ positions: 50 }), NOW).ok).toBe(true);
  });
});

describe("expandPattern", () => {
  it("genera un turno por cada día elegido, de lunes a viernes", () => {
    const out = expandPattern({
      from: "2026-10-12",
      to: "2026-10-18",
      weekdays: [1, 2, 3, 4, 5],
      start: "07:00",
      end: "19:00",
      positions: 2,
    });
    expect(out.map((d) => d.date)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
    ]);
    expect(out.every((d) => d.positions === 2 && d.start === "07:00")).toBe(true);
  });

  it("cuenta bien fines de semana y cambios de mes", () => {
    const out = expandPattern({
      from: "2026-10-29",
      to: "2026-11-02",
      weekdays: [0, 6],
      start: "08:00",
      end: "16:00",
      positions: 1,
    });
    expect(out.map((d) => d.date)).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("devuelve vacío con rangos inválidos o sin días", () => {
    const base = { start: "07:00", end: "19:00", positions: 1 };
    expect(expandPattern({ ...base, from: "2026-10-12", to: "2026-10-10", weekdays: [1] })).toEqual(
      [],
    );
    expect(expandPattern({ ...base, from: "2026-10-12", to: "2026-10-20", weekdays: [] })).toEqual(
      [],
    );
    expect(expandPattern({ ...base, from: "nada", to: "2026-10-20", weekdays: [1] })).toEqual([]);
    expect(expandPattern({ ...base, from: "2026-01-01", to: "2026-12-31", weekdays: [1] })).toEqual(
      [],
    );
  });

  it("respeta el máximo de turnos por oferta", () => {
    const out = expandPattern({
      from: "2026-10-12",
      to: "2027-02-01",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: "07:00",
      end: "19:00",
      positions: 1,
    });
    expect(out).toHaveLength(60);
  });
});

describe("buildShiftBatch", () => {
  it("ordena, suma horas y cupos y reporta lo inválido y lo repetido", () => {
    const batch = buildShiftBatch(
      [
        draft({ date: "2026-10-14", positions: 2 }),
        draft({ date: "2026-10-12" }),
        draft({ date: "2026-10-12" }),
        draft({ date: "2026-02-30" }),
      ],
      NOW,
    );
    expect(batch.shifts.map((s) => s.starts_at.slice(0, 10))).toEqual([
      "2026-10-12",
      "2026-10-12",
      "2026-10-14",
    ]);
    expect(batch.totalPositions).toBe(4);
    expect(batch.totalHours).toBe(48);
    expect(batch.errors).toEqual([{ index: 3, reason: "bad_date" }]);
    expect(batch.duplicates).toEqual([2]);
    expect(batch.firstStart).toBe("2026-10-12T12:00:00.000Z");
  });

  it("un lote vacío no inventa datos", () => {
    expect(buildShiftBatch([], NOW)).toMatchObject({
      shifts: [],
      totalHours: 0,
      totalPositions: 0,
      firstStart: null,
    });
  });
});

describe("findDuplicateShifts", () => {
  it("marca desde la segunda repetición", () => {
    const a = draft();
    expect(findDuplicateShifts([a, { ...a }, draft({ date: "2026-10-13" }), { ...a }])).toEqual([
      1, 3,
    ]);
  });
});

describe("estimateBudget", () => {
  const two = buildShiftBatch([draft({ positions: 2 }), draft({ date: "2026-10-13" })], NOW).shifts;

  it("por turno: cada cupo vale el valor del turno", () => {
    expect(estimateBudget("shift", 200_000, two)).toBe(3 * 200_000);
  });

  it("por hora: valor × horas × cupos", () => {
    expect(estimateBudget("hour", 20_000, two)).toBe(3 * 12 * 20_000);
  });

  it("por mes o paquete: el valor se reparte entre los turnos del lote", () => {
    expect(estimateBudget("month", 2_400_000, two)).toBe(3 * 1_200_000);
  });

  it("sin turnos o sin valor es cero", () => {
    expect(estimateBudget("shift", 200_000, [])).toBe(0);
    expect(estimateBudget("shift", 0, two)).toBe(0);
    expect(estimateBudget("shift", Number.NaN, two)).toBe(0);
  });
});

describe("parseRequirements", () => {
  it("separa por comas, punto y coma o líneas y quita repetidos", () => {
    expect(parseRequirements("RETHUS vigente, BLS;  Experiencia en UCI\nbls\n\n")).toEqual([
      "RETHUS vigente",
      "BLS",
      "Experiencia en UCI",
    ]);
    expect(parseRequirements("   ")).toEqual([]);
  });
});
