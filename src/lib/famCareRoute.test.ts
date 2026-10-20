import { describe, expect, it } from "vitest";
import { addDays, mergeDays, type CheckinRow, type DayKey } from "./famCareDays";
import {
  FOLLOWUP_DAYS,
  eventLine,
  journeyLine,
  pillarsOf,
  prepProgress,
  routeDay,
  routePhase,
  tipOf,
  type RouteRecipient,
} from "./famCareRoute";
import { FAM_KINDS, PREP_ITEMS, PREP_KEYS } from "./famCareTypes";

const TODAY: DayKey = "2026-10-14";
const NOW = Date.UTC(2026, 9, 14, 15, 0, 0);
const off = (n: number): DayKey => addDays(TODAY, n);

const rec = (over: Partial<RouteRecipient> = {}): RouteRecipient => ({
  kind: "surgery",
  event_on: null,
  event_label: null,
  prep_done: [],
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});

let seq = 0;
const days = (rows: Array<Partial<CheckinRow> & { day: string }>) =>
  mergeDays(
    rows.map((r) => ({
      id: `c${++seq}`,
      recipient_id: "r1",
      author_id: "u1",
      mood: 4,
      items: [],
      signals: [],
      note: null,
      created_at: `2026-10-14T10:00:${String(seq % 60).padStart(2, "0")}Z`,
      ...r,
    })),
  );

describe("día de la ruta", () => {
  it("cirugía: días desde la fecha, negativos antes de operar", () => {
    expect(routeDay(rec({ event_on: TODAY }), TODAY)).toBe(0);
    expect(routeDay(rec({ event_on: off(-5) }), TODAY)).toBe(5);
    expect(routeDay(rec({ event_on: off(3) }), TODAY)).toBe(-3);
  });

  it("enfermedad: si la fecha no ha llegado, no hay día de ruta", () => {
    expect(routeDay(rec({ kind: "illness", event_on: off(-2) }), TODAY)).toBe(2);
    expect(routeDay(rec({ kind: "illness", event_on: off(2) }), TODAY)).toBeNull();
  });

  it("los demás tipos no tienen día de ruta, aunque traigan fecha", () => {
    for (const kind of ["elder", "child", "chronic"] as const) {
      expect(routeDay(rec({ kind, event_on: off(-2) }), TODAY)).toBeNull();
    }
  });

  it("sin fecha o con fecha dañada: nada", () => {
    expect(routeDay(rec({ event_on: null }), TODAY)).toBeNull();
    expect(routeDay(rec({ event_on: "ayer" }), TODAY)).toBeNull();
  });
});

describe("fase de la ruta", () => {
  it("cirugía, con sus fronteras", () => {
    expect(routePhase("surgery", -3)).toMatchObject({
      id: "pre",
      label: "Faltan 3 días para la cirugía",
    });
    expect(routePhase("surgery", -1)?.label).toBe("Faltan 1 día para la cirugía");
    expect(routePhase("surgery", 0)).toMatchObject({ id: "day0", label: "Día de la cirugía" });
    expect(routePhase("surgery", 1)).toMatchObject({ id: "first", label: "Primeros días · día 1" });
    expect(routePhase("surgery", 3)?.id).toBe("first");
    expect(routePhase("surgery", 4)).toMatchObject({
      id: "early",
      label: "Recuperación temprana · día 4",
    });
    expect(routePhase("surgery", 14)?.id).toBe("early");
    expect(routePhase("surgery", 15)).toMatchObject({
      id: "recovery",
      label: "Recuperación · día 15",
    });
    expect(routePhase("surgery", 42)?.id).toBe("recovery");
    expect(routePhase("surgery", 43)).toMatchObject({
      id: "back",
      label: "Retomando la rutina · día 43",
    });
  });

  it("enfermedad, con sus fronteras (el primer día es el día 1)", () => {
    expect(routePhase("illness", 0)).toMatchObject({ id: "start", label: "Primeros días · día 1" });
    expect(routePhase("illness", 2)?.label).toBe("Primeros días · día 3");
    expect(routePhase("illness", 3)).toMatchObject({ id: "mid", label: "Día 4 del episodio" });
    expect(routePhase("illness", 7)?.id).toBe("mid");
    expect(routePhase("illness", 8)).toMatchObject({ id: "long", label: "Día 9 del episodio" });
  });

  it("sin día o en otros tipos: sin fase", () => {
    expect(routePhase("surgery", null)).toBeNull();
    expect(routePhase("elder", 3)).toBeNull();
    expect(routePhase("chronic", 3)).toBeNull();
  });

  it("siempre recuerda que manda el equipo médico en las fases de cirugía", () => {
    for (const d of [-2, 0, 2, 8, 20, 60]) {
      const p = routePhase("surgery", d)!;
      expect(p.label.length + p.detail.length).toBeGreaterThan(20);
    }
  });
});

describe("línea del viaje", () => {
  it("usa la fase cuando la hay y los días de cuidado si no", () => {
    expect(journeyLine(rec({ event_on: off(-5) }), 0, TODAY)).toBe("Recuperación temprana · día 5");
    expect(journeyLine(rec({ kind: "elder" }), 0, TODAY)).toBe("Empieza hoy");
    expect(journeyLine(rec({ kind: "elder" }), 1, TODAY)).toBe("1 día de cuidado");
    expect(journeyLine(rec({ kind: "chronic" }), 12, TODAY)).toBe("12 días de cuidado");
  });
});

describe("consejo del día", () => {
  it("es el mismo para el mismo día y cambia con los días", () => {
    expect(tipOf("elder", null, TODAY)).toBe(tipOf("elder", null, TODAY));
    const seen = new Set(Array.from({ length: 12 }, (_, i) => tipOf("elder", null, off(i))));
    expect(seen.size).toBeGreaterThan(3);
  });

  it("las fases de cirugía tienen sus propios consejos", () => {
    const pre = new Set(Array.from({ length: 6 }, (_, i) => tipOf("surgery", "pre", off(i))));
    expect([...pre].some((t) => /hospital|cirugía|recuperación/i.test(t))).toBe(true);
    expect(tipOf("surgery", "recovery", TODAY)).toBe(tipOf("surgery", null, TODAY));
  });

  it("todos los tipos tienen consejo y ninguno promete curas", () => {
    for (const kind of FAM_KINDS) {
      for (let i = 0; i < 8; i++) {
        const t = tipOf(kind, null, off(i));
        expect(t.length).toBeGreaterThan(15);
        expect(t).not.toMatch(/cura|garantiza|siempre funciona|milagro/i);
      }
    }
  });
});

describe("lista de preparación", () => {
  it("cuenta lo hecho y el porcentaje", () => {
    const p = prepProgress("elder", ["rugs", "light"]);
    expect(p).toMatchObject({ done: 2, total: 8, pct: 25 });
    expect(p.items.filter((i) => i.done).map((i) => i.key)).toEqual(["rugs", "light"]);
  });

  it("ignora claves que no son de ese tipo o que no existen", () => {
    const p = prepProgress("child", ["rugs", "card", "no_existe"]);
    expect(p.done).toBe(1);
  });

  it("sin nada hecho: 0 %; todo hecho: 100 %", () => {
    expect(prepProgress("chronic", null).pct).toBe(0);
    expect(prepProgress("chronic", undefined).done).toBe(0);
    const all = PREP_ITEMS.chronic.map((i) => i.key);
    expect(prepProgress("chronic", all)).toMatchObject({ pct: 100, done: all.length });
  });

  it("todas las claves del vocabulario se usan y ninguna lista repite una", () => {
    const used = new Set<string>();
    for (const kind of FAM_KINDS) {
      const keys = PREP_ITEMS[kind].map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
      keys.forEach((k) => used.add(k));
    }
    expect([...used].sort()).toEqual([...PREP_KEYS].sort());
  });
});

describe("cuatro pilares", () => {
  const base = { prepDone: [], summaries: new Map(), steps: [], today: TODAY };

  it("solo para cirugía, enfermedad y crónico", () => {
    expect(pillarsOf({ ...base, kind: "elder" })).toBeNull();
    expect(pillarsOf({ ...base, kind: "child" })).toBeNull();
    expect(pillarsOf({ ...base, kind: "surgery" })?.map((p) => p.id)).toEqual([
      "meds",
      "folder",
      "followup",
      "signs",
    ]);
  });

  it("sin nada hecho, ningún pilar está listo", () => {
    expect(pillarsOf({ ...base, kind: "chronic" })!.every((p) => !p.ok)).toBe(true);
  });

  it("las medicinas: por la lista o porque casi siempre quedaron marcadas", () => {
    expect(pillarsOf({ ...base, kind: "chronic", prepDone: ["meds_list"] })![0].ok).toBe(true);
    const routine = days([
      { day: off(0), items: ["meds"] },
      { day: off(-1), items: ["meds"] },
      { day: off(-2), items: [] },
    ]);
    expect(pillarsOf({ ...base, kind: "chronic", summaries: routine })![0].ok).toBe(true);
    const spotty = days([
      { day: off(0), items: ["meds"] },
      { day: off(-1), items: [] },
      { day: off(-2), items: [] },
    ]);
    expect(pillarsOf({ ...base, kind: "chronic", summaries: spotty })![0].ok).toBe(false);
    const one = days([{ day: off(0), items: ["meds"] }]);
    expect(pillarsOf({ ...base, kind: "chronic", summaries: one })![0].ok).toBe(false);
  });

  it("las citas: una cita abierta en los próximos 30 días, o la lista marcada", () => {
    const open = { due_on: off(10), done_at: null };
    expect(pillarsOf({ ...base, kind: "surgery", steps: [open] })![2].ok).toBe(true);
    expect(
      pillarsOf({
        ...base,
        kind: "surgery",
        steps: [{ ...open, done_at: "2026-10-10T00:00:00Z" }],
      })![2].ok,
    ).toBe(false);
    expect(
      pillarsOf({ ...base, kind: "surgery", steps: [{ due_on: off(-1), done_at: null }] })![2].ok,
    ).toBe(false);
    expect(
      pillarsOf({
        ...base,
        kind: "surgery",
        steps: [{ due_on: off(FOLLOWUP_DAYS), done_at: null }],
      })![2].ok,
    ).toBe(true);
    expect(
      pillarsOf({
        ...base,
        kind: "surgery",
        steps: [{ due_on: off(FOLLOWUP_DAYS + 1), done_at: null }],
      })![2].ok,
    ).toBe(false);
    expect(pillarsOf({ ...base, kind: "surgery", prepDone: ["followup"] })![2].ok).toBe(true);
  });

  it("carpeta y señales salen de la lista de preparación", () => {
    const p = pillarsOf({ ...base, kind: "illness", prepDone: ["docs", "signs"] })!;
    expect(p.map((x) => x.ok)).toEqual([false, true, false, true]);
  });
});

describe("línea del evento", () => {
  it("la etiqueta, y cuándo fue", () => {
    expect(eventLine({ kind: "surgery", event_on: off(-5), event_label: "Cadera" }, NOW)).toBe(
      "Cadera · hace 5 días",
    );
    expect(eventLine({ kind: "surgery", event_on: TODAY, event_label: null }, NOW)).toBe(
      "Cirugía · hoy",
    );
    expect(eventLine({ kind: "surgery", event_on: off(1), event_label: " Rodilla " }, NOW)).toBe(
      "Rodilla · en 1 día",
    );
    expect(eventLine({ kind: "surgery", event_on: null, event_label: "x" }, NOW)).toBeNull();
  });
});
