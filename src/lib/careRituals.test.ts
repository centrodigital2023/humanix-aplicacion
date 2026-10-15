import { describe, expect, it } from "vitest";
import { CARE_ROUTES } from "./careJourney";
import {
  ACTIONS,
  CUES,
  IF_THEN_ROUTES,
  MAX_PLANS,
  RITUALS,
  RITUALS_SIGNATURE,
  RITUAL_HISTORY_MAX,
  actionsFor,
  addPlan,
  hasIfThen,
  nextRitual,
  planSentence,
  plansShareText,
  removePlan,
  ritualInvite,
  ritualOfDay,
  ritualSummary,
  sanitizePlans,
  sanitizeRitualDays,
  toggleRitualToday,
} from "./careRituals";
import { bogotaDayIndex } from "./intelShared";
import { DAY, HOUR, NOW, bogota } from "./intel.fixture";

const TODAY = bogotaDayIndex(NOW);

describe("rituales: catálogo", () => {
  it("cada ruta tiene una semana completa de rituales, con id único", () => {
    const ids = new Set<string>();
    for (const r of CARE_ROUTES) {
      expect(RITUALS[r].length).toBeGreaterThanOrEqual(7);
      for (const x of RITUALS[r]) {
        expect(ids.has(x.id)).toBe(false);
        ids.add(x.id);
        expect(x.minutes).toBeGreaterThan(0);
        expect(x.minutes).toBeLessThanOrEqual(30);
        expect(x.title.length).toBeGreaterThan(3);
        expect(x.remote.length).toBeGreaterThan(10);
      }
    }
  });

  it("ningún ritual es clínico: sin dosis, medicamentos por nombre ni diagnósticos", () => {
    const all = CARE_ROUTES.flatMap((r) =>
      RITUALS[r].map((x) => `${x.title} ${x.body} ${x.remote}`),
    ).join(" ");
    expect(all).not.toMatch(/\bmg\b|dosis|pastilla|acetaminof|ibuprof|diagn|síntoma/i);
  });

  it("si algo depende del médico, el texto lo dice", () => {
    const movement = CARE_ROUTES.flatMap((r) => RITUALS[r]).filter((x) =>
      /paseo|estir|paso pequeño/i.test(x.body),
    );
    expect(movement.length).toBeGreaterThan(0);
    for (const x of movement) expect(x.body).toMatch(/médic|cirugía|equipo/i);
  });

  it("la ruta de enfermedad no tiene tono de logro", () => {
    const text = RITUALS.illness.map((x) => `${x.title} ${x.body}`).join(" ");
    expect(text).not.toMatch(/celebr|logr|victoria|!|¡/i);
  });
});

describe("rituales: el del día", () => {
  it("es el mismo durante todo el día de Colombia y cambia al siguiente", () => {
    const morning = bogota("2026-10-14T00:05:00");
    const night = bogota("2026-10-14T23:55:00");
    const tomorrow = bogota("2026-10-15T00:05:00");
    for (const r of CARE_ROUTES) {
      expect(ritualOfDay(r, morning).id).toBe(ritualOfDay(r, night).id);
      expect(ritualOfDay(r, tomorrow).id).not.toBe(ritualOfDay(r, night).id);
      expect(nextRitual(r, night).id).toBe(ritualOfDay(r, tomorrow).id);
    }
  });

  it("en una semana se ven siete rituales distintos de la ruta", () => {
    for (const r of CARE_ROUTES) {
      const week = new Set(Array.from({ length: 7 }, (_, i) => ritualOfDay(r, NOW + i * DAY).id));
      expect(week.size).toBe(7);
      for (const id of week) expect(RITUALS[r].some((x) => x.id === id)).toBe(true);
    }
  });

  it("no depende de la hora UTC: las 23:00 en Colombia ya son mañana en UTC y sigue siendo hoy", () => {
    const lateBogota = bogota("2026-10-14T23:00:00");
    expect(ritualOfDay("elder", lateBogota).id).toBe(ritualOfDay("elder", NOW).id);
  });
});

describe("rituales: lo compartido solo suma", () => {
  it("limpia lo guardado: solo enteros positivos, únicos y ordenados", () => {
    expect(sanitizeRitualDays(null)).toEqual([]);
    expect(sanitizeRitualDays("x")).toEqual([]);
    expect(sanitizeRitualDays([5, 3, 3, -1, 1.5, "7", 0, 9])).toEqual([3, 5, 9]);
  });

  it("guarda como mucho un poco más de un año", () => {
    const many = Array.from({ length: RITUAL_HISTORY_MAX + 50 }, (_, i) => i + 1);
    const out = sanitizeRitualDays(many);
    expect(out).toHaveLength(RITUAL_HISTORY_MAX);
    expect(out[out.length - 1]).toBe(RITUAL_HISTORY_MAX + 50);
  });

  it("marcar y desmarcar solo toca el día de hoy", () => {
    const past = [TODAY - 3, TODAY - 1];
    const on = toggleRitualToday(past, NOW);
    expect(on).toEqual([TODAY - 3, TODAY - 1, TODAY]);
    expect(toggleRitualToday(on, NOW)).toEqual(past);
  });

  it("el total cuenta todos los días y no se reinicia con huecos", () => {
    const seguidos = ritualSummary([TODAY - 2, TODAY - 1, TODAY], NOW, "warm").total;
    const conHuecos = ritualSummary([TODAY - 40, TODAY - 20, TODAY], NOW, "warm").total;
    expect(conHuecos).toBe(seguidos);
  });

  it("ignora días futuros (un reloj adelantado no suma)", () => {
    expect(ritualSummary([TODAY, TODAY + 5], NOW, "warm").total).toBe(1);
  });

  it("dice si el de hoy ya se hizo, con frases amables", () => {
    expect(ritualSummary([], NOW, "warm").line).toMatch(/márcalo/);
    expect(ritualSummary([TODAY], NOW, "warm")).toMatchObject({ doneToday: true, total: 1 });
    expect(ritualSummary([TODAY], NOW, "warm").line).toMatch(/Primer ritual/);
    expect(ritualSummary([TODAY - 1, TODAY], NOW, "warm").line).toMatch(/2 rituales/);
    expect(ritualSummary([TODAY - 1], NOW, "warm").line).toMatch(/1 ritual compartido/);
    expect(ritualSummary([TODAY - 2, TODAY - 1], NOW, "warm").line).toMatch(/2 rituales.*espera/);
  });

  it("en tono sobrio agradece el momento y no cuenta logros", () => {
    for (const days of [[], [TODAY], [TODAY - 5, TODAY - 1]]) {
      const s = ritualSummary(days, NOW, "sober");
      expect(s.line).not.toMatch(/\d|!|¡|colecci/);
    }
  });

  it("ningún mensaje usa lenguaje de racha o de pérdida", () => {
    const texts = [
      [],
      [TODAY],
      [TODAY - 1],
      [TODAY - 9, TODAY - 1],
      [TODAY - 2, TODAY - 1, TODAY],
    ].flatMap((d) => [ritualSummary(d, NOW, "warm").line, ritualSummary(d, NOW, "sober").line]);
    expect(texts.join(" ")).not.toMatch(/racha|perdi|rompi|reinici|volv\w+ a cero|seguidos|falt/i);
  });
});

describe("rituales: invitación al círculo", () => {
  it("lleva el ritual, cómo sumarse a distancia y la firma", () => {
    const r = ritualOfDay("elder", NOW);
    const text = ritualInvite(r, "warm");
    expect(text).toContain(r.title);
    expect(text).toContain(r.remote.slice(1));
    expect(text).toMatch(/Desde donde estés: [a-zñáéíóú]/);
    expect(text.endsWith(RITUALS_SIGNATURE)).toBe(true);
  });

  it("no habla de pagos, salud ni contacto", () => {
    for (const route of CARE_ROUTES) {
      for (let i = 0; i < 7; i++) {
        const text = ritualInvite(
          ritualOfDay(route, NOW + i * DAY),
          route === "illness" ? "sober" : "warm",
        );
        expect(text).not.toMatch(
          /\$|cop\b|pago|tarifa|precio|\d{7,}|dirección|presión|glucosa|diagn/i,
        );
      }
    }
  });

  it("en tono sobrio no usa signos de celebración", () => {
    const text = ritualInvite(ritualOfDay("illness", NOW), "sober");
    expect(text).not.toMatch(/encantaría|!|¡/);
  });
});

describe("plan «cuando… entonces…»", () => {
  it("existe solo en adulto mayor, posoperatorio y crónicos", () => {
    expect([...IF_THEN_ROUTES].sort()).toEqual(["chronic", "elder", "postop"]);
    expect(hasIfThen("child")).toBe(false);
    expect(hasIfThen("illness")).toBe(false);
    expect(hasIfThen(null)).toBe(false);
    for (const r of IF_THEN_ROUTES) {
      expect(hasIfThen(r)).toBe(true);
      expect(actionsFor(r).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("las acciones no son clínicas: organizan y registran lo que ya indicó el equipo de salud", () => {
    const all = ACTIONS.map((a) => a.text).join(" ");
    expect(all).not.toMatch(/\bmg\b|dosis|pastilla|tom[ae] (el|la|un)|aument|suspend|cambi/i);
    for (const a of ACTIONS) {
      if (/paseo|líquidos|herida|cifras/.test(a.text)) expect(a.text).toMatch(/médic|cirugía/);
    }
  });

  it("arma una frase natural en español", () => {
    expect(planSentence({ cue: "breakfast", action: "meds_logged" })).toBe(
      "Después del desayuno, revisamos que la toma de medicamentos quede anotada.",
    );
    expect(planSentence({ cue: "tinto", action: "call" })).toBe(
      "A la hora del tinto, hacemos una llamada a alguien querido.",
    );
    expect(planSentence({ cue: "nope", action: "call" })).toBeNull();
    expect(planSentence({ cue: "tinto", action: "nope" })).toBeNull();
  });

  it("todas las combinaciones válidas dan una frase que empieza en mayúscula y termina en punto", () => {
    for (const c of CUES) {
      for (const a of ACTIONS) {
        const s = planSentence({ cue: c.id, action: a.id })!;
        expect(s).toMatch(/^[A-ZÁÉÍÓÚ].*\.$/);
        expect(s).not.toMatch(/\.\./);
      }
    }
  });

  it("limpia lo guardado: ids válidos, acción permitida para la ruta, sin repetidos y como mucho tres", () => {
    expect(sanitizePlans("elder", null)).toEqual([]);
    expect(sanitizePlans("elder", [{ cue: "wake", action: "wound_look" }])).toEqual([]);
    expect(sanitizePlans("postop", [{ cue: "wake", action: "wound_look" }])).toEqual([
      { cue: "wake", action: "wound_look" },
    ]);
    const raw = [
      { cue: "wake", action: "walk" },
      { cue: "wake", action: "walk" },
      { cue: 3, action: "walk" },
      "x",
      { cue: "lunch", action: "fluids" },
      { cue: "dinner", action: "call" },
      { cue: "bedtime", action: "meds_logged" },
    ];
    const out = sanitizePlans("chronic", raw);
    expect(out).toHaveLength(MAX_PLANS);
    expect(out[0]).toEqual({ cue: "wake", action: "walk" });
  });

  it("agregar respeta el tope y quitar elimina por posición", () => {
    let plans = addPlan("chronic", [], { cue: "wake", action: "walk" });
    plans = addPlan("chronic", plans, { cue: "wake", action: "walk" });
    expect(plans).toHaveLength(1);
    plans = addPlan("chronic", plans, { cue: "lunch", action: "numbers" });
    plans = addPlan("chronic", plans, { cue: "dinner", action: "call" });
    plans = addPlan("chronic", plans, { cue: "bedtime", action: "questions" });
    expect(plans).toHaveLength(MAX_PLANS);
    expect(removePlan(plans, 0).map((p) => p.cue)).toEqual(["lunch", "dinner"]);
  });

  it("el texto para compartir lista los planes con la firma, y queda vacío sin planes", () => {
    expect(plansShareText("elder", [])).toBe("");
    const text = plansShareText("elder", [
      { cue: "breakfast", action: "meds_logged" },
      { cue: "tinto", action: "call" },
    ]);
    expect(text).toContain("• Después del desayuno");
    expect(text).toContain("• A la hora del tinto");
    expect(text.endsWith(RITUALS_SIGNATURE)).toBe(true);
  });

  it("el texto para compartir descarta lo que no es válido para la ruta", () => {
    expect(plansShareText("elder", [{ cue: "wake", action: "wound_look" }])).toBe("");
  });
});

// Sanidad del reloj de pruebas: NOW es de día en Colombia.
it("fixture: NOW es 10:00 en Colombia", () => {
  expect((NOW - bogota("2026-10-14T00:00:00")) / HOUR).toBe(10);
});
