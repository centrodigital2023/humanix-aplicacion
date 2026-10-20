import { describe, expect, it } from "vitest";
import { addDays, type DayKey } from "./famCareDays";
import {
  SOON_DAYS,
  dueLabelEs,
  isStepKind,
  shortDateEs,
  sortSteps,
  stepState,
  stepsOverview,
  type StepRow,
} from "./famCareSteps";
import { STEP_KINDS } from "./famCareTypes";

const TODAY: DayKey = "2026-10-14";
const off = (n: number): DayKey => addDays(TODAY, n);

let seq = 0;
const step = (over: Partial<StepRow> & { due_on: string }): StepRow => ({
  id: `s${++seq}`,
  recipient_id: "r1",
  title: "Control",
  kind: "appointment",
  done_at: null,
  ...over,
});

describe("isStepKind", () => {
  it("acepta solo los tipos del vocabulario", () => {
    for (const k of STEP_KINDS) expect(isStepKind(k)).toBe(true);
    expect(isStepKind("surgery")).toBe(false);
    expect(isStepKind(null)).toBe(false);
    expect(isStepKind(3)).toBe(false);
  });
});

describe("stepState", () => {
  it("clasifica por cuánto falta", () => {
    expect(stepState(step({ due_on: off(-1) }), TODAY)).toBe("overdue");
    expect(stepState(step({ due_on: off(0) }), TODAY)).toBe("today");
    expect(stepState(step({ due_on: off(1) }), TODAY)).toBe("soon");
    expect(stepState(step({ due_on: off(SOON_DAYS) }), TODAY)).toBe("soon");
    expect(stepState(step({ due_on: off(SOON_DAYS + 1) }), TODAY)).toBe("later");
  });

  it("lo hecho es hecho aunque esté atrasado", () => {
    expect(stepState(step({ due_on: off(-5), done_at: "2026-10-10T12:00:00Z" }), TODAY)).toBe(
      "done",
    );
  });

  it("una fecha dañada no se marca como atrasada", () => {
    expect(stepState(step({ due_on: "mañana" }), TODAY)).toBe("later");
  });
});

describe("sortSteps", () => {
  it("abiertos por fecha (lo atrasado arriba) y después lo hecho, lo más reciente primero", () => {
    const a = step({ id: "a", due_on: off(3) });
    const b = step({ id: "b", due_on: off(-2) });
    const c = step({ id: "c", due_on: off(0) });
    const d1 = step({ id: "d1", due_on: off(-9), done_at: "2026-10-01T10:00:00Z" });
    const d2 = step({ id: "d2", due_on: off(-8), done_at: "2026-10-12T10:00:00Z" });
    expect(sortSteps([a, d1, b, d2, c], TODAY).map((s) => s.id)).toEqual([
      "b",
      "c",
      "a",
      "d2",
      "d1",
    ]);
  });

  it("desempata por título y luego por id, y no muta la entrada", () => {
    const x = step({ id: "x", due_on: off(1), title: "Vacuna" });
    const y = step({ id: "y", due_on: off(1), title: "Examen" });
    const z = step({ id: "z", due_on: off(1), title: "Examen" });
    const input = [x, z, y];
    expect(sortSteps(input, TODAY).map((s) => s.id)).toEqual(["y", "z", "x"]);
    expect(input.map((s) => s.id)).toEqual(["x", "z", "y"]);
  });
});

describe("stepsOverview", () => {
  it("cuenta lo abierto y elige el siguiente paso", () => {
    const steps = [
      step({ id: "late", due_on: off(-3) }),
      step({ id: "today", due_on: off(0) }),
      step({ id: "soon", due_on: off(2) }),
      step({ id: "later", due_on: off(30) }),
      step({ id: "done", due_on: off(-10), done_at: "2026-10-05T10:00:00Z" }),
    ];
    const o = stepsOverview(steps, TODAY);
    expect(o).toMatchObject({ open: 4, overdue: 1, today: 1, soon: 1 });
    expect(o.next?.id).toBe("late");
  });

  it("sin pasos abiertos no hay siguiente", () => {
    expect(stepsOverview([], TODAY)).toEqual({
      open: 0,
      overdue: 0,
      today: 0,
      soon: 0,
      next: null,
    });
    const o = stepsOverview([step({ due_on: off(1), done_at: "2026-10-13T10:00:00Z" })], TODAY);
    expect(o.open).toBe(0);
    expect(o.next).toBeNull();
  });
});

describe("textos de fecha", () => {
  it("shortDateEs", () => {
    expect(shortDateEs("2026-10-20")).toBe("20 de oct");
    expect(shortDateEs("2026-01-05")).toBe("5 de ene");
    expect(shortDateEs("no es fecha")).toBe("");
  });

  it("dueLabelEs habla en días cerca y en fecha lejos", () => {
    expect(dueLabelEs(off(0), TODAY)).toBe("Hoy");
    expect(dueLabelEs(off(1), TODAY)).toBe("Mañana");
    expect(dueLabelEs(off(-1), TODAY)).toBe("Ayer");
    expect(dueLabelEs(off(3), TODAY)).toBe("En 3 días");
    expect(dueLabelEs(off(-4), TODAY)).toBe("Hace 4 días");
    expect(dueLabelEs(off(-30), TODAY)).toBe("Hace 30 días");
    expect(dueLabelEs(off(SOON_DAYS + 1), TODAY)).toBe(`El ${shortDateEs(off(SOON_DAYS + 1))}`);
    expect(dueLabelEs(off(-31), TODAY)).toBe(`El ${shortDateEs(off(-31))}`);
    expect(dueLabelEs("2026-13-40", TODAY)).toBe("");
  });
});
