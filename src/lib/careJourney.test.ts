import { describe, expect, it } from "vitest";
import {
  CARE_ROUTES,
  EMERGENCY_LINE,
  EPISODE_GAP_DAYS,
  ROUTES,
  episodeDay,
  goalLine,
  goalProgress,
  inferRoutes,
  journeyStage,
  normalizeText,
  pickRoute,
  routeFromText,
  type JourneyLog,
} from "./careJourney";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

const log = (over: Partial<JourneyLog> & { ago?: number }): JourneyLog => ({
  event_type: "note",
  created_at: iso(-(over.ago ?? 0)),
  ...over,
});

describe("rutas: definiciones", () => {
  it("las cinco rutas existen y cada una tiene preguntas para el médico y señales para llamar", () => {
    expect([...CARE_ROUTES]).toEqual(["elder", "child", "postop", "illness", "chronic"]);
    for (const r of CARE_ROUTES) {
      expect(ROUTES[r].id).toBe(r);
      expect(ROUTES[r].visitQuestions.length).toBeGreaterThanOrEqual(3);
      expect(ROUTES[r].callSameDay.length).toBeGreaterThanOrEqual(3);
      expect(ROUTES[r].watch.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("la ruta de enfermedad es sobria: sin metas que celebrar", () => {
    expect(ROUTES.illness.tone).toBe("sober");
    expect(ROUTES.illness.goals).toEqual([]);
    for (const r of CARE_ROUTES.filter((x) => x !== "illness")) expect(ROUTES[r].tone).toBe("warm");
  });

  it("ningún texto fijo recomienda medicamentos, dosis ni diagnostica", () => {
    const all = CARE_ROUTES.flatMap((r) => [
      ...ROUTES[r].watch,
      ...ROUTES[r].visitQuestions,
      ...ROUTES[r].callSameDay,
      ...ROUTES[r].goals.flatMap((g) => [g.label, g.hint]),
    ]).join(" ");
    expect(all).not.toMatch(/\b\d+\s?(mg|ml|mcg|gotas|tabletas?|pastillas?)\b/i);
    expect(all).not.toMatch(
      /\b(tienes|tiene|padece|sufre de)\b.*\b(diabetes|c[aá]ncer|infecci[oó]n)\b/i,
    );
    expect(all).not.toMatch(/\b(tome|dale|administra|inyecta)\b/i);
  });

  it("las metas pertenecen a una ruta y sus objetivos caben en una semana", () => {
    const ids = new Set<string>();
    for (const r of CARE_ROUTES)
      for (const g of ROUTES[r].goals) {
        expect(ids.has(g.id)).toBe(false);
        ids.add(g.id);
        expect(g.target).toBeGreaterThanOrEqual(1);
        expect(g.target).toBeLessThanOrEqual(7);
      }
  });

  it("el aviso de emergencia nombra el 123", () => {
    expect(EMERGENCY_LINE).toContain("123");
  });

  it("ningún texto de la ruta habla de pagos ni de WhatsApp", () => {
    const all = JSON.stringify(ROUTES) + EMERGENCY_LINE;
    expect(all).not.toMatch(/\b(pago|pagar|COP)\b|\$|whatsapp|precio/i);
  });
});

describe("reconocer la ruta desde el texto de la agenda", () => {
  it.each([
    ["Cuidado adulto mayor", "elder"],
    ["cuidado de mi abuela", "elder"],
    ["Cuidado pediátrico", "child"],
    ["niña de 4 años", "child"],
    ["Cuidado postoperatorio", "postop"],
    ["recuperación de cirugía de cadera", "postop"],
    ["Cuidado paliativo", "illness"],
    ["quimioterapia en casa", "illness"],
    ["paciente con diabetes", "chronic"],
    ["EPOC y oxígeno", "chronic"],
  ])("«%s» → %s", (text, route) => {
    expect(routeFromText(text)).toBe(route);
  });

  it("sin pistas claras devuelve null", () => {
    expect(routeFromText("Enfermería domiciliaria 24/7")).toBeNull();
    expect(routeFromText("")).toBeNull();
    expect(routeFromText(null)).toBeNull();
    expect(routeFromText(undefined)).toBeNull();
  });

  it("la cirugía gana sobre lo general y la niñez sobre lo crónico", () => {
    expect(routeFromText("adulto mayor, postoperatorio de cadera")).toBe("postop");
    expect(routeFromText("niño con asma")).toBe("child");
  });

  it("una condición crónica gana sobre «adulto mayor» (la ruta más específica)", () => {
    expect(routeFromText("adulto mayor con diabetes")).toBe("chronic");
  });

  it("ignora tildes y mayúsculas", () => {
    expect(normalizeText("Pediátrico ÑOÑO")).toBe("pediatrico nono");
    expect(routeFromText("PEDIÁTRICO")).toBe("child");
  });

  it("«niño» no se activa dentro de otra palabra", () => {
    expect(routeFromText("hay un huerto de pinos")).toBeNull();
  });
});

describe("inferRoutes y pickRoute", () => {
  it("ordena por frecuencia y, en empate, por el orden de las rutas", () => {
    expect(inferRoutes(["adulto mayor", "adulto mayor", "pediátrico"])).toEqual(["elder", "child"]);
    expect(inferRoutes(["pediátrico", "adulto mayor"])).toEqual(["elder", "child"]);
  });

  it("ignora vacíos y textos sin pista", () => {
    expect(inferRoutes([null, undefined, "", "algo"])).toEqual([]);
    expect(inferRoutes([])).toEqual([]);
  });

  it("la elección de la familia gana si es válida; si no, la más probable", () => {
    expect(pickRoute(["elder"], "child")).toBe("child");
    expect(pickRoute(["elder"], "inventada")).toBe("elder");
    expect(pickRoute(["elder"], undefined)).toBe("elder");
    expect(pickRoute([], undefined)).toBeNull();
    expect(pickRoute([], 42)).toBeNull();
  });
});

describe("episodio y etapa", () => {
  const done = (daysAgo: number) => ({ status: "completed", scheduled_at: iso(-daysAgo * DAY) });

  it("sin servicios no hay episodio", () => {
    expect(episodeDay([], NOW)).toBeNull();
  });

  it("el primer día del episodio es el 1", () => {
    expect(episodeDay([done(0)], NOW)).toBe(1);
  });

  it("cuenta desde el primer servicio del episodio", () => {
    expect(episodeDay([done(0), done(2), done(5)], NOW)).toBe(6);
  });

  it("un hueco de más de 14 días parte el episodio en dos", () => {
    expect(EPISODE_GAP_DAYS).toBe(14);
    // 3 y 20 días atrás: hueco de 17 → el episodio actual empieza hace 3 días.
    expect(episodeDay([done(3), done(20)], NOW)).toBe(4);
    // hueco de exactamente 14 días: sigue siendo el mismo episodio.
    expect(episodeDay([done(3), done(17)], NOW)).toBe(18);
  });

  it("si el último servicio fue hace más de 14 días, no hay episodio en curso", () => {
    expect(episodeDay([done(15)], NOW)).toBeNull();
    expect(episodeDay([done(14)], NOW)).toBe(15);
  });

  it("los servicios cancelados, pendientes o futuros no cuentan", () => {
    expect(
      episodeDay(
        [
          { status: "cancelled", scheduled_at: iso(-DAY) },
          { status: "confirmed", scheduled_at: iso(-DAY) },
          { status: "completed", scheduled_at: iso(2 * DAY) },
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("varios servicios el mismo día cuentan un solo día", () => {
    expect(
      episodeDay([done(1), { status: "in_progress", scheduled_at: iso(-1 * DAY + HOUR) }], NOW),
    ).toBe(2);
  });

  it("usa el día calendario de Colombia, no el de UTC", () => {
    // 2026-10-14 03:00 UTC = 13/oct 22:00 en Colombia; NOW = 14/oct 10:00 → ayer.
    const lateNight = { status: "completed", scheduled_at: "2026-10-14T03:00:00Z" };
    expect(episodeDay([lateNight], NOW)).toBe(2);
  });

  it("las fechas dañadas se ignoran", () => {
    expect(episodeDay([{ status: "completed", scheduled_at: "no es fecha" }], NOW)).toBeNull();
  });

  it("etapas del posoperatorio con sus fronteras", () => {
    expect(journeyStage("postop", 1).label).toBe("Primeros días");
    expect(journeyStage("postop", 3).label).toBe("Primeros días");
    expect(journeyStage("postop", 4).label).toBe("Primeras dos semanas");
    expect(journeyStage("postop", 14).label).toBe("Primeras dos semanas");
    expect(journeyStage("postop", 15).label).toBe("Recuperación");
    expect(journeyStage("postop", 42).label).toBe("Recuperación");
    expect(journeyStage("postop", 43).label).toBe("Seguimiento");
    expect(journeyStage("postop", 400).index).toBe(3);
    expect(journeyStage("postop", 400).total).toBe(4);
  });

  it("el posoperatorio recuerda que mandan los tiempos del equipo de cirugía", () => {
    expect(journeyStage("postop", 5).note).toMatch(/equipo de cirug/);
    expect(journeyStage("elder", 5).note).not.toMatch(/cirug/);
  });

  it("etapas generales", () => {
    expect(journeyStage("elder", 1).label).toBe("Primera semana");
    expect(journeyStage("elder", 7).label).toBe("Primera semana");
    expect(journeyStage("elder", 8).label).toBe("Primer mes");
    expect(journeyStage("elder", 30).label).toBe("Primer mes");
    expect(journeyStage("elder", 31).index).toBe(2);
  });

  it("un día inválido se trata como el primero", () => {
    expect(journeyStage("elder", 0).index).toBe(0);
    expect(journeyStage("elder", -5).index).toBe(0);
    expect(journeyStage("elder", 2.9).index).toBe(0);
  });
});

describe("metas de la semana", () => {
  it("cuenta días distintos, no registros", () => {
    const logs = [
      log({ event_type: "meal", ago: 0 }),
      log({ event_type: "meal", ago: 1 * HOUR }),
      log({ event_type: "meal", ago: 1 * DAY }),
    ];
    const meals = goalProgress("elder", logs, NOW).find((g) => g.id === "elder_meals")!;
    expect(meals.days).toBe(2);
    expect(meals.met).toBe(false);
  });

  it("alcanza la meta con el objetivo de días", () => {
    const logs = [0, 1, 2, 3, 4].map((d) => log({ event_type: "meal", ago: d * DAY }));
    const meals = goalProgress("elder", logs, NOW).find((g) => g.id === "elder_meals")!;
    expect(meals.days).toBe(5);
    expect(meals.met).toBe(true);
  });

  it("la ventana son 7 días: el octavo ya no cuenta", () => {
    const edge = goalProgress("elder", [log({ event_type: "meal", ago: 6 * DAY })], NOW);
    expect(edge.find((g) => g.id === "elder_meals")!.days).toBe(1);
    const out = goalProgress("elder", [log({ event_type: "meal", ago: 7 * DAY })], NOW);
    expect(out.find((g) => g.id === "elder_meals")!.days).toBe(0);
  });

  it("los registros del sistema (llegada, salida) no cuentan", () => {
    const logs = [log({ event_type: "meal", system_generated: true })];
    expect(goalProgress("elder", logs, NOW).every((g) => g.days === 0)).toBe(true);
  });

  it("«días tranquilos» mira el ánimo (contento o tranquilo) y no cuenta el cansancio", () => {
    const logs = [
      log({ event_type: "note", mood: "calm", ago: 0 }),
      log({ event_type: "note", mood: "happy", ago: 1 * DAY }),
      log({ event_type: "note", mood: "tired", ago: 2 * DAY }),
      log({ event_type: "note", mood: "otro", ago: 3 * DAY }),
    ];
    expect(goalProgress("elder", logs, NOW).find((g) => g.id === "elder_calm")!.days).toBe(2);
  });

  it("los registros futuros no cuentan", () => {
    expect(
      goalProgress("elder", [log({ event_type: "meal", ago: -2 * HOUR })], NOW).every(
        (g) => g.days === 0,
      ),
    ).toBe(true);
  });

  it("los controles se miden con los signos vitales", () => {
    const logs = [
      log({ event_type: "vital_signs", ago: 0 }),
      log({ event_type: "vital_signs", ago: 1 * DAY }),
    ];
    expect(goalProgress("postop", logs, NOW).find((g) => g.id === "postop_vitals")!.days).toBe(2);
  });

  it("la ruta de enfermedad no tiene metas", () => {
    expect(goalProgress("illness", [log({ event_type: "meal" })], NOW)).toEqual([]);
  });

  it("sin partes, todas las metas están en cero y ninguna cumplida", () => {
    for (const r of CARE_ROUTES) {
      const gp = goalProgress(r, [], NOW);
      expect(gp.every((g) => g.days === 0 && !g.met)).toBe(true);
    }
  });

  it("la línea de la meta anima y nunca regaña", () => {
    expect(goalLine({ days: 2, target: 4 })).toBe("2 de 4 días");
    expect(goalLine({ days: 6, target: 4 })).toBe("4 de 4 días");
    for (const r of CARE_ROUTES) {
      const text = goalProgress(r, [], NOW)
        .map((g) => `${g.label} ${g.hint} ${goalLine(g)}`)
        .join(" ");
      expect(text).not.toMatch(/falt|fall|incumpl|perdi|racha/i);
    }
  });
});
