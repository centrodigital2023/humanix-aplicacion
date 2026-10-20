import { describe, expect, it } from "vitest";
import {
  DAY_MILESTONES,
  REST_SPACING_DAYS,
  achievedMilestones,
  addDays,
  bestStreak,
  buildCells,
  computeStreak,
  dayIndex,
  dayKeyOf,
  daysBetween,
  isDayKey,
  keyFromIndex,
  litInLast,
  mergeDays,
  nextDayMilestone,
  nextUnseen,
  type CheckinRow,
  type DayKey,
} from "./famCareDays";

const TODAY: DayKey = "2026-10-14";
/** Fechas relativas a hoy: off(0) = hoy, off(-1) = ayer. */
const off = (n: number): DayKey => addDays(TODAY, n);
const litSet = (...offsets: number[]) => new Set(offsets.map(off));

let seq = 0;
const row = (over: Partial<CheckinRow> & { day: string }): CheckinRow => ({
  id: `c${++seq}`,
  recipient_id: "r1",
  author_id: "u1",
  mood: 4,
  items: [],
  signals: [],
  note: null,
  created_at: `2026-10-14T10:00:${String(seq % 60).padStart(2, "0")}Z`,
  ...over,
});

describe("días de Colombia", () => {
  it("la fecha es la de Colombia (UTC-5), no la de Greenwich", () => {
    expect(dayKeyOf(Date.UTC(2026, 9, 15, 4, 59, 59))).toBe("2026-10-14");
    expect(dayKeyOf(Date.UTC(2026, 9, 15, 5, 0, 0))).toBe("2026-10-15");
    expect(dayKeyOf(Date.UTC(2026, 0, 1, 0, 30))).toBe("2025-12-31");
  });

  it("suma días cruzando meses y años", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-14")).toBe(13);
    expect(daysBetween("2026-10-14", "2026-10-01")).toBe(-13);
  });

  it("el índice y la clave son inversos", () => {
    for (const k of ["1970-01-01", "2024-02-29", "2026-10-14", "2099-12-31"]) {
      expect(keyFromIndex(dayIndex(k))).toBe(k);
    }
  });

  it("solo acepta fechas reales", () => {
    expect(isDayKey("2026-10-14")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("14/10/2026")).toBe(false);
    expect(isDayKey(20261014)).toBe(false);
    expect(isDayKey(null)).toBe(false);
  });
});

describe("mergeDays", () => {
  it("une lo marcado por varias personas el mismo día", () => {
    const m = mergeDays([
      row({
        day: TODAY,
        author_id: "ana",
        mood: 3,
        items: ["meds"],
        signals: ["pain"],
        note: "  Tomó el desayuno ",
      }),
      row({
        day: TODAY,
        author_id: "luis",
        mood: 5,
        items: ["food", "meds"],
        signals: [],
        note: "",
      }),
    ]);
    const d = m.get(TODAY)!;
    expect(d.items).toEqual(["meds", "food"]);
    expect(d.signals).toEqual(["pain"]);
    expect(d.authors).toEqual(["ana", "luis"]);
    expect(d.entries).toBe(2);
    expect(d.notes).toEqual([{ author: "ana", text: "Tomó el desayuno" }]);
  });

  it("el ánimo del día es el de la última anotación", () => {
    const m = mergeDays([
      row({ day: TODAY, mood: 5, created_at: "2026-10-14T09:00:00Z" }),
      row({ day: TODAY, mood: 2, created_at: "2026-10-14T18:00:00Z", author_id: "luis" }),
    ]);
    expect(m.get(TODAY)!.mood).toBe(2);
    expect(m.get(TODAY)!.lastAt).toBe("2026-10-14T18:00:00Z");
  });

  it("no depende del orden en que llegan las filas", () => {
    const a = row({ day: TODAY, mood: 5, created_at: "2026-10-14T09:00:00Z", author_id: "ana" });
    const b = row({ day: TODAY, mood: 2, created_at: "2026-10-14T18:00:00Z", author_id: "luis" });
    expect(mergeDays([a, b]).get(TODAY)).toEqual(mergeDays([b, a]).get(TODAY));
  });

  it("descarta claves desconocidas, ánimos inválidos y días dañados", () => {
    const m = mergeDays([
      row({
        day: TODAY,
        mood: 9,
        items: ["meds", "teletransporte"],
        signals: ["pain", "gripe_marciana"],
      }),
      row({ day: "no-es-fecha" }),
      row({ day: "2026-02-30" }),
    ]);
    expect([...m.keys()]).toEqual([TODAY]);
    const d = m.get(TODAY)!;
    expect(d.mood).toBeNull();
    expect(d.items).toEqual(["meds"]);
    expect(d.signals).toEqual(["pain"]);
  });

  it("tolera listas ausentes", () => {
    const m = mergeDays([row({ day: TODAY, items: null, signals: null })]);
    expect(m.get(TODAY)!.items).toEqual([]);
    expect(m.get(TODAY)!.signals).toEqual([]);
  });
});

describe("racha amable", () => {
  it("sin anotaciones no hay racha", () => {
    const s = computeStreak(new Set(), TODAY);
    expect(s).toMatchObject({
      count: 0,
      alive: false,
      pendingToday: false,
      litToday: false,
      lastLit: null,
    });
  });

  it("solo hoy: racha de 1", () => {
    const s = computeStreak(litSet(0), TODAY);
    expect(s).toMatchObject({
      count: 1,
      alive: true,
      litToday: true,
      pendingToday: false,
      rests: 0,
    });
  });

  it("solo ayer: sigue viva y hoy todavía se puede anotar", () => {
    const s = computeStreak(litSet(-1), TODAY);
    expect(s).toMatchObject({ count: 1, alive: true, litToday: false, pendingToday: true });
  });

  it("cuenta los días seguidos", () => {
    expect(computeStreak(litSet(0, -1, -2), TODAY).count).toBe(3);
    expect(computeStreak(litSet(-1, -2, -3, -4), TODAY).count).toBe(4);
  });

  it("un día de descanso no la rompe y no suma", () => {
    const s = computeStreak(litSet(0, -2), TODAY);
    expect(s.count).toBe(2);
    expect(s.rests).toBe(1);
    expect(s.restDays).toEqual([off(-1)]);
    expect(s.alive).toBe(true);
  });

  it("dos días seguidos sin anotar la rompen", () => {
    const s = computeStreak(litSet(0, -3), TODAY);
    expect(s.count).toBe(1);
    expect(s.rests).toBe(0);
  });

  it("dos descansos con menos de una semana de por medio: el segundo ya la corta", () => {
    // hoy, descanso, -2, descanso, -4
    const s = computeStreak(litSet(0, -2, -4), TODAY);
    expect(s.count).toBe(2);
    expect(s.rests).toBe(1);
  });

  it("dos descansos separados por una semana sí se perdonan", () => {
    // hoy, descanso(-1), -2..-7 seguidos, descanso(-8), -9
    const s = computeStreak(litSet(0, -2, -3, -4, -5, -6, -7, -9), TODAY);
    expect(REST_SPACING_DAYS).toBe(7);
    expect(s.rests).toBe(2);
    expect(s.count).toBe(8);
    expect(s.restDays).toEqual([off(-8), off(-1)]);
  });

  it("ayer fue el descanso y hoy aún no se anota: viva pero en riesgo", () => {
    const s = computeStreak(litSet(-2, -3), TODAY);
    expect(s).toMatchObject({ count: 2, alive: true, pendingToday: true, rests: 1 });
    expect(s.restDays).toEqual([off(-1)]);
  });

  it("con ese descanso ya usado, un segundo descanso cercano no se perdona", () => {
    // ayer (descanso) y antes de -2 otro hueco: -2 lit, -3 vacío, -4 lit
    const s = computeStreak(litSet(-2, -4), TODAY);
    expect(s.count).toBe(1);
    expect(s.rests).toBe(1);
  });

  it("si pasaron tres días sin anotar, se acabó (pero se recuerda el último día)", () => {
    const s = computeStreak(litSet(-3), TODAY);
    expect(s).toMatchObject({ count: 0, alive: false, lastLit: off(-3) });
  });

  it("ignora anotaciones de días futuros", () => {
    const s = computeStreak(litSet(1, 2), TODAY);
    expect(s).toMatchObject({ count: 0, alive: false, lastLit: null });
  });

  it("la mejor racha de la historia", () => {
    expect(bestStreak(litSet(-20, -19, -18, -17, -16, 0, -1, -2))).toBe(5);
    expect(bestStreak(new Set())).toBe(0);
    expect(bestStreak(litSet(0))).toBe(1);
  });

  it("cuenta cuántos de los últimos n días tienen anotación", () => {
    expect(litInLast(litSet(0, -1, -3, -10), TODAY, 7)).toBe(3);
    expect(litInLast(litSet(0, -1, -3, -10), TODAY, 14)).toBe(4);
    expect(litInLast(new Set(), TODAY, 7)).toBe(0);
  });
});

describe("constelación", () => {
  const summaries = (...offsets: number[]) =>
    mergeDays(offsets.map((o) => row({ day: off(o), mood: 4 })));

  it("dibuja los últimos 30 días, de más antiguo a más reciente", () => {
    const cells = buildCells(summaries(0, -1), TODAY);
    expect(cells).toHaveLength(30);
    expect(cells[0].day).toBe(off(-29));
    expect(cells[29].day).toBe(TODAY);
  });

  it("estados: encendida, descanso, apagada y hoy pendiente", () => {
    const cells = buildCells(summaries(-1, -3), TODAY, { days: 5 });
    const by = Object.fromEntries(cells.map((c) => [c.day, c.state]));
    expect(by[off(-1)]).toBe("lit");
    expect(by[off(-2)]).toBe("rest"); // descanso perdonado de la racha vigente
    expect(by[off(-3)]).toBe("lit");
    expect(by[off(-4)]).toBe("dark");
    expect(by[TODAY]).toBe("today");
  });

  it("hoy encendida aparece como encendida, no como pendiente", () => {
    const cells = buildCells(summaries(0), TODAY, { days: 3 });
    expect(cells[cells.length - 1]).toMatchObject({ day: TODAY, state: "lit" });
  });

  it("los días anteriores al inicio de la ruta no se dibujan", () => {
    const cells = buildCells(summaries(0), TODAY, { days: 30, startedOn: off(-4) });
    expect(cells).toHaveLength(5);
    expect(cells[0].day).toBe(off(-4));
  });

  it("marca los días con señales de urgencia, sin revelar cuáles", () => {
    const m = mergeDays([
      row({ day: off(-1), signals: ["chest_pain"] }),
      row({ day: TODAY, signals: ["no_appetite"] }),
    ]);
    const cells = buildCells(m, TODAY, {
      days: 2,
      urgentSignals: new Set(["chest_pain", "breathing"]),
    });
    expect(cells.map((c) => c.flagged)).toEqual([true, false]);
    expect(Object.keys(cells[0]).sort()).toEqual(["day", "flagged", "mood", "people", "state"]);
  });

  it("cuenta cuántas personas anotaron cada día", () => {
    const m = mergeDays([
      row({ day: TODAY, author_id: "a" }),
      row({ day: TODAY, author_id: "b" }),
      row({ day: TODAY, author_id: "a" }),
    ]);
    expect(buildCells(m, TODAY, { days: 1 })[0].people).toBe(2);
  });
});

describe("hitos", () => {
  const days = (n: number, start = -40) =>
    mergeDays(Array.from({ length: n }, (_, i) => row({ day: off(start + i) })));

  it("sin días no hay hitos", () => {
    expect(achievedMilestones(new Map(), TODAY)).toEqual([]);
  });

  it("el primer día, el tercero y la primera semana", () => {
    const ids = achievedMilestones(days(7), TODAY).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["days-1", "days-3", "days-7"]));
    expect(ids).not.toContain("days-14");
  });

  it("el día del hito es el de la anotación que lo completó", () => {
    const list = achievedMilestones(days(7, -20), TODAY);
    expect(list.find((m) => m.id === "days-7")?.day).toBe(off(-14));
    expect(list.find((m) => m.id === "days-1")?.day).toBe(off(-20));
  });

  it("cuidado en equipo: el primer día con dos personas distintas", () => {
    const m = mergeDays([
      row({ day: off(-5), author_id: "a" }),
      row({ day: off(-2), author_id: "a" }),
      row({ day: off(-2), author_id: "b" }),
    ]);
    const team = achievedMilestones(m, TODAY).find((x) => x.id === "team-2");
    expect(team?.day).toBe(off(-2));
  });

  it("semana completa solo si los últimos siete días tienen anotación", () => {
    const full = mergeDays(Array.from({ length: 7 }, (_, i) => row({ day: off(-i) })));
    expect(achievedMilestones(full, TODAY).some((m) => m.id === "week-full")).toBe(true);
    const gap = mergeDays(
      Array.from({ length: 7 }, (_, i) => row({ day: off(-i - (i === 3 ? 20 : 0)) })),
    );
    expect(achievedMilestones(gap, TODAY).some((m) => m.id === "week-full")).toBe(false);
  });

  it("devuelve el más reciente primero", () => {
    const list = achievedMilestones(days(8, -7), TODAY);
    const sorted = [...list].sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
    expect(list.map((m) => m.id)).toEqual(sorted.map((m) => m.id));
  });

  it("el siguiente hito sin celebrar", () => {
    const list = achievedMilestones(days(7), TODAY);
    expect(nextUnseen(list, new Set())?.id).toBeDefined();
    expect(nextUnseen(list, new Set(list.map((m) => m.id)))).toBeNull();
    const seen = new Set(list.filter((m) => m.id !== "days-3").map((m) => m.id));
    expect(nextUnseen(list, seen)?.id).toBe("days-3");
  });

  it("cuánto falta para el siguiente hito de días", () => {
    expect(nextDayMilestone(0)).toMatchObject({ n: 1, remaining: 1 });
    expect(nextDayMilestone(5)).toMatchObject({ n: 7, remaining: 2 });
    expect(nextDayMilestone(7)).toMatchObject({ n: 14, remaining: 7 });
    expect(nextDayMilestone(365)).toBeNull();
    expect(DAY_MILESTONES.map((m) => m.n)).toEqual([1, 3, 7, 14, 30, 60, 100, 180, 365]);
  });
});
