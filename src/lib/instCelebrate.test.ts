import { describe, expect, it } from "vitest";
import {
  MILESTONES,
  MILESTONE_KEYS,
  MIN_ALERTS_FOR_PCT,
  STREAK_STEPS,
  ackLabel,
  careCompass,
  celebrationPlan,
  greetingFor,
  impactShareText,
  impactSummary,
  milestoneStates,
  newlyUnlocked,
  nextGoal,
  parseSeen,
  seenStorageKey,
  serializeSeen,
  streakInfo,
  type MilestoneContext,
} from "./instCelebrate";
import { EMPTY_OVERVIEW, type CareOverview } from "./instCare";

type Patch = {
  [K in keyof CareOverview]?: CareOverview[K] extends object
    ? Partial<CareOverview[K]>
    : CareOverview[K];
};

/** Un resumen del servidor a partir del vacío, cambiando solo lo que importa a la prueba. */
function ov(p: Patch = {}): CareOverview {
  const base = EMPTY_OVERVIEW;
  return {
    ...base,
    ...p,
    patients: { ...base.patients, ...p.patients },
    cases: { ...base.cases, ...p.cases },
    tasks: { ...base.tasks, ...p.tasks },
    monitoring: { ...base.monitoring, ...p.monitoring },
    alerts: { ...base.alerts, ...p.alerts },
    impact: { ...base.impact, ...p.impact },
    usage: { ...base.usage, ...p.usage },
    limits: { ...base.limits, ...p.limits },
  } as CareOverview;
}

const ctx = (p: Patch = {}, extra: Omit<MilestoneContext, "overview"> = {}): MilestoneContext => ({
  overview: ov(p),
  ...extra,
});
const earned = (c: MilestoneContext) =>
  milestoneStates(c)
    .filter((m) => m.earned)
    .map((m) => m.key);

describe("tiempo de atención", () => {
  it("segundos, minutos y horas", () => {
    expect(ackLabel(0)).toBe("0 s");
    expect(ackLabel(45)).toBe("45 s");
    expect(ackLabel(59.6)).toBe("1 min");
    expect(ackLabel(60)).toBe("1 min");
    expect(ackLabel(130)).toBe("2 min 10 s");
    expect(ackLabel(600)).toBe("10 min");
    expect(ackLabel(725)).toBe("12 min");
    expect(ackLabel(3600)).toBe("1 h");
    expect(ackLabel(3900)).toBe("1 h 5 min");
  });

  it("sin dato, negativo o no numérico: vacío", () => {
    for (const v of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(ackLabel(v)).toBe("");
  });
});

describe("catálogo de hitos", () => {
  it("claves únicas, textos completos y ningún hito ganado en un tablero vacío", () => {
    expect(new Set(MILESTONE_KEYS).size).toBe(MILESTONES.length);
    for (const m of MILESTONES) {
      expect(m.title.length).toBeGreaterThan(2);
      expect(m.message.endsWith(".")).toBe(true);
      expect(m.weight).toBeGreaterThan(0);
    }
    expect(earned(ctx())).toEqual([]);
  });

  it("los escalones de racha del catálogo son los de la racha", () => {
    expect(
      MILESTONE_KEYS.filter((k) => k.startsWith("streak_")).map((k) => Number(k.slice(7))),
    ).toEqual([...STREAK_STEPS]);
  });
});

describe("cuándo se gana cada hito", () => {
  it("pacientes: 1, 5, 25 y 100 según el total registrado", () => {
    expect(earned(ctx({ patients: { total: 1 } }))).toEqual(["first_patient"]);
    expect(earned(ctx({ patients: { total: 4 } }))).toEqual(["first_patient"]);
    expect(earned(ctx({ patients: { total: 5 } }))).toEqual(["first_patient", "patients_5"]);
    expect(earned(ctx({ patients: { total: 25 } }))).toContain("patients_25");
    expect(earned(ctx({ patients: { total: 24 } }))).not.toContain("patients_25");
    expect(earned(ctx({ patients: { total: 99 } }))).not.toContain("patients_100");
    expect(earned(ctx({ patients: { total: 100 } }))).toContain("patients_100");
  });

  it("primer caso: cualquiera cuenta (hasta uno cancelado)", () => {
    expect(earned(ctx({ cases: { cancelled: 1 } }))).toEqual(["first_case"]);
    expect(earned(ctx({ cases: { pending: 1 } }))).toEqual(["first_case"]);
  });

  it("monitoreo: por pacientes monitoreados o por el tablero en vivo", () => {
    expect(earned(ctx({ patients: { monitored: 1 } }))).toContain("first_monitored");
    expect(earned(ctx({ monitoring: { total: 1 } }))).toContain("first_monitored");
    expect(earned(ctx({ monitoring: { total: 0 } }))).not.toContain("first_monitored");
  });

  it("primer control: el dato de «alguna vez» manda sobre el resumen de 7 días", () => {
    expect(earned(ctx({ impact: { manualControls: 1 } }))).toContain("first_control");
    expect(earned(ctx({ impact: { deviceReadings: 2 } }))).toContain("first_control");
    expect(earned(ctx({}, { hasControl: true }))).toContain("first_control");
    expect(earned(ctx({ impact: { manualControls: 9 } }, { hasControl: false }))).not.toContain(
      "first_control",
    );
  });

  it("dispositivo: uno activo, o el dato de «alguna vez»", () => {
    expect(earned(ctx({ usage: { devices: 1 } }))).toContain("first_device");
    expect(earned(ctx({}, { hasDevice: true }))).toContain("first_device");
    expect(earned(ctx({ usage: { devices: 3 } }, { hasDevice: false }))).not.toContain(
      "first_device",
    );
  });

  it("calidad: caso cerrado, primera valoración y familias satisfechas (5 o más valoraciones y 4,5 o más)", () => {
    expect(earned(ctx({ cases: { completed: 1 } }))).toEqual(["first_case", "first_completed"]);
    expect(earned(ctx({ cases: { rated: 1 } }))).toEqual(["first_rating"]);
    const happy = (rated: number, avg: number | null) =>
      earned(ctx({ cases: { rated, avgSatisfaction: avg } })).includes("happy_families");
    expect(happy(5, 4.5)).toBe(true);
    expect(happy(5, 4.4)).toBe(false);
    expect(happy(4, 5)).toBe(false);
    expect(happy(5, null)).toBe(false);
  });

  it("rachas: 3, 5, 10, 25, 50 y 100", () => {
    const at = (n: number) =>
      earned(ctx({}, {}))
        .concat(earned(ctx({ ontimeStreak: n })))
        .filter((k) => k.startsWith("streak_"));
    expect(at(2)).toEqual([]);
    expect(at(3)).toEqual(["streak_3"]);
    expect(at(10)).toEqual(["streak_3", "streak_5", "streak_10"]);
    expect(at(100)).toHaveLength(6);
  });

  it("un hito ya celebrado se queda ganado aunque la cifra baje (la racha se rompe)", () => {
    const c = ctx({ ontimeStreak: 0 });
    expect(earned(c)).not.toContain("streak_10");
    const states = milestoneStates(c, new Set(["streak_10"]));
    expect(states.find((s) => s.key === "streak_10")!.earned).toBe(true);
    expect(states.find((s) => s.key === "streak_25")!.earned).toBe(false);
  });

  it("el avance de los hitos que se miden con un número", () => {
    const states = milestoneStates(
      ctx({ patients: { total: 3 }, ontimeStreak: 7, cases: { rated: 9 } }),
    );
    expect(states.find((s) => s.key === "patients_5")!.progress).toEqual({ current: 3, target: 5 });
    expect(states.find((s) => s.key === "patients_25")!.progress).toEqual({
      current: 3,
      target: 25,
    });
    expect(states.find((s) => s.key === "streak_10")!.progress).toEqual({ current: 7, target: 10 });
    expect(states.find((s) => s.key === "streak_5")!.progress).toEqual({ current: 5, target: 5 });
    expect(states.find((s) => s.key === "happy_families")!.progress).toEqual({
      current: 5,
      target: 5,
    });
    expect(states.find((s) => s.key === "first_patient")!.progress).toBeNull();
  });
});

describe("desbloqueo y fiesta", () => {
  it("primera visita al navegador: lo ya ganado se marca como visto, sin fiesta", () => {
    const r = newlyUnlocked(ctx({ patients: { total: 7 }, cases: { completed: 2 } }), null);
    expect(r.baseline).toBe(true);
    expect(r.fresh).toEqual([]);
    expect(r.seen).toEqual(
      ["first_patient", "first_case", "patients_5", "first_completed"].sort(
        (a, b) => MILESTONE_KEYS.indexOf(a) - MILESTONE_KEYS.indexOf(b),
      ),
    );
  });

  it("una institución nueva parte de cero: su primer paciente sí se celebra", () => {
    const empty = newlyUnlocked(ctx(), null);
    expect(empty).toEqual({ fresh: [], seen: [], baseline: true });
    const r = newlyUnlocked(ctx({ patients: { total: 1 } }), new Set(empty.seen));
    expect(r.baseline).toBe(false);
    expect(r.fresh.map((m) => m.key)).toEqual(["first_patient"]);
    expect(r.seen).toEqual(["first_patient"]);
  });

  it("solo se celebra lo nuevo, lo más importante primero, y no se repite", () => {
    const c = ctx({ patients: { total: 5 }, cases: { completed: 1, rated: 1 }, ontimeStreak: 3 });
    const first = newlyUnlocked(c, new Set(["first_patient"]));
    expect(first.fresh.map((m) => m.key)).toEqual([
      "first_completed",
      "first_rating",
      "first_case",
      "patients_5",
      "streak_3",
    ]);
    expect(first.fresh.map((m) => m.weight)).toEqual(
      [...first.fresh.map((m) => m.weight)].sort((a, b) => b - a),
    );
    const again = newlyUnlocked(c, new Set(first.seen));
    expect(again.fresh).toEqual([]);
    expect(again.seen).toEqual(first.seen);
  });

  it("lo guardado que ya no existe o es basura no se arrastra; lo visto no se olvida aunque la cifra baje", () => {
    const r = newlyUnlocked(
      ctx({ patients: { total: 1 } }),
      new Set(["streak_10", "ya-no-existe", "first_patient"]),
    );
    expect(r.fresh).toEqual([]);
    expect(r.seen).toEqual(["first_patient", "streak_10"]);
  });

  it("el plan de la fiesta: manda el más importante, cuenta los demás y pone confeti si alguno es grande", () => {
    expect(celebrationPlan([])).toBeNull();
    const fresh = newlyUnlocked(ctx({ patients: { total: 5 }, ontimeStreak: 3 }), new Set()).fresh;
    const plan = celebrationPlan(fresh)!;
    expect(plan.headline.key).toBe("first_patient");
    expect(plan.more).toBe(fresh.length - 1);
    expect(plan.confetti).toBe(true);
    const small = celebrationPlan(newlyUnlocked(ctx({ ontimeStreak: 3 }), new Set()).fresh)!;
    expect(small.headline.key).toBe("streak_3");
    expect(small.more).toBe(0);
    expect(small.confetti).toBe(false);
  });
});

describe("próxima meta", () => {
  it("a quien empieza no le pone una meta lejana: se guía por los primeros pasos", () => {
    expect(nextGoal(ctx())).toBeNull();
  });

  it("la más cercana en proporción", () => {
    const g = nextGoal(ctx({ patients: { total: 3 }, ontimeStreak: 1, cases: { rated: 1 } }))!;
    expect(g.milestone.key).toBe("patients_5");
    expect(g).toMatchObject({ current: 3, target: 5, remaining: 2, pct: 60 });
  });

  it("a igual proporción gana la meta más pequeña", () => {
    const g = nextGoal(ctx({ patients: { total: 1 }, ontimeStreak: 0 }))!;
    expect(g.milestone.key).toBe("patients_5");
    expect(g.pct).toBe(20);
    const tie = nextGoal(ctx({ patients: { total: 1 }, ontimeStreak: 1, cases: { rated: 1 } }))!;
    expect(tie.milestone.key).toBe("streak_3"); // 33 % le gana a 20 %
  });

  it("no ofrece lo que ya se tiene ni lo que está completo pero le falta otra condición", () => {
    const g = nextGoal(ctx({ patients: { total: 5 } }))!;
    expect(g.milestone.key).toBe("patients_25");
    const stuck = nextGoal(ctx({ cases: { rated: 5, avgSatisfaction: 4.0 } }));
    expect(stuck).toBeNull();
    // con la racha de 5 y todos los escalones mayores ya celebrados, no queda meta
    const all = new Set(["streak_10", "streak_25", "streak_50", "streak_100"]);
    expect(nextGoal(ctx({ ontimeStreak: 5 }), all)).toBeNull();
    // lo ya celebrado no se ofrece, pero la siguiente meta sí
    expect(nextGoal(ctx({ ontimeStreak: 5 }), new Set(["streak_10"]))!.milestone.key).toBe(
      "streak_25",
    );
  });
});

describe("lo ya celebrado, guardado en el navegador", () => {
  it("la clave es por persona", () => {
    expect(seenStorageKey("u1")).toBe("hx:inst-care:milestones:u1");
    expect(seenStorageKey("u1")).not.toBe(seenStorageKey("u2"));
  });

  it("nada guardado o dañado se trata como primera visita", () => {
    for (const raw of [null, undefined, "", "no es json", '{"a":1}', "42", '"x"'])
      expect(parseSeen(raw)).toBeNull();
  });

  it("solo claves conocidas; un arreglo vacío es un navegador ya iniciado, no una primera visita", () => {
    expect(parseSeen("[]")).toEqual(new Set());
    expect(parseSeen(JSON.stringify(["first_patient", 7, null, "otra", "streak_3"]))).toEqual(
      new Set(["first_patient", "streak_3"]),
    );
  });

  it("ida y vuelta: ordenado, sin repetidos y sin claves desconocidas", () => {
    const raw = serializeSeen(["streak_3", "first_patient", "streak_3", "x"]);
    expect(raw).toBe('["first_patient","streak_3"]');
    expect(parseSeen(raw)).toEqual(new Set(["first_patient", "streak_3"]));
    expect(serializeSeen([])).toBe("[]");
  });
});

describe("racha de alertas urgentes atendidas a tiempo", () => {
  it("sin racha y sin alertas vencidas: se invita a empezar", () => {
    const s = streakInfo(ov());
    expect(s).toMatchObject({ count: 0, next: 3, toNext: 3, pct: 0, hot: false, tone: "muted" });
    expect(s.headline).toBe("Aún sin racha");
    expect(s.hint).toBe("Atiende a tiempo la próxima alerta urgente y empieza una.");
  });

  it("sin racha por alertas pasadas de plazo: lo dice y pide atenderlas", () => {
    const s = streakInfo(ov({ alerts: { overdue: 2 } }));
    expect(s.headline).toBe("Racha en pausa: hay alertas pasadas de plazo");
    expect(s.hint).toBe("Atiende las alertas pendientes para empezar de nuevo.");
    expect(s.tone).toBe("warn");
  });

  it("singular, plural y avance hacia el siguiente escalón", () => {
    expect(streakInfo(ov({ ontimeStreak: 1 })).headline).toBe("1 alerta urgente atendida a tiempo");
    const s = streakInfo(ov({ ontimeStreak: 4 }));
    expect(s.headline).toBe("4 alertas urgentes seguidas atendidas a tiempo");
    expect(s).toMatchObject({ next: 5, toNext: 1, pct: 50, hot: true, tone: "copper" });
    expect(s.hint).toBe("Te faltan 1 para el escalón de 5.");
    expect(streakInfo(ov({ ontimeStreak: 3 }))).toMatchObject({ next: 5, pct: 0 });
    expect(streakInfo(ov({ ontimeStreak: 24 }))).toMatchObject({ next: 25, toNext: 1, pct: 93 });
  });

  it("con racha pero con una alerta vencida, avisa para no perderla", () => {
    const s = streakInfo(ov({ ontimeStreak: 6, alerts: { overdue: 1 } }));
    expect(s.tone).toBe("warn");
    expect(s.hint).toBe("1 alerta pasada de plazo: atiéndela para no perder la racha.");
    expect(streakInfo(ov({ ontimeStreak: 6, alerts: { overdue: 3 } })).hint).toContain(
      "3 alertas pasadas de plazo",
    );
  });

  it("después del último escalón no hay siguiente", () => {
    const s = streakInfo(ov({ ontimeStreak: 150 }));
    expect(s).toMatchObject({ next: null, toNext: 0, pct: 100, hot: true });
    expect(s.hint).toBe("Superaste todos los escalones. Sigue así.");
  });

  it("valores raros no rompen nada", () => {
    expect(streakInfo(ov({ ontimeStreak: -4 })).count).toBe(0);
    expect(streakInfo(ov({ ontimeStreak: Number.NaN })).count).toBe(0);
    expect(streakInfo(ov({ ontimeStreak: 4.9 })).count).toBe(4);
  });

  it("la definición de la racha se explica con honestidad", () => {
    expect(streakInfo(ov()).hint).not.toContain("clínic");
  });
});

describe("impacto de la semana", () => {
  const week = {
    manualControls: 30,
    deviceReadings: 12,
    alerts: 5,
    alertsOnTime: 4,
    medianAckSeconds: 130,
    tasksDone: 12,
    notes: 9,
    casesCompleted: 2,
  };

  it("sin actividad no hay nada que presentar (ni ceros disfrazados de logro)", () => {
    const s = impactSummary(ov());
    expect(s).toEqual({ empty: true, lines: [], headline: "", onTimePct: null });
    expect(impactShareText(ov())).toBe("");
  });

  it("cada línea con su valor; los controles distinguen manuales y de dispositivos", () => {
    const s = impactSummary(ov({ impact: week }));
    expect(s.empty).toBe(false);
    expect(s.lines.map((l) => [l.key, l.value])).toEqual([
      ["controls", "42"],
      ["alerts", "4/5"],
      ["response", "2 min 10 s"],
      ["tasks", "12"],
      ["notes", "9"],
      ["cases", "2"],
    ]);
    expect(s.lines[0]!.sub).toBe("30 manuales · 12 de dispositivos");
    expect(s.lines[0]!.label).toBe("controles de signos");
  });

  it("singular y sin dispositivos: no se inventa el desglose", () => {
    const s = impactSummary(
      ov({ impact: { manualControls: 1, tasksDone: 1, notes: 1, casesCompleted: 1 } }),
    );
    expect(s.lines.map((l) => l.label)).toEqual([
      "control de signos",
      "tarea cumplida",
      "nota firmada",
      "caso cerrado",
    ]);
    expect(s.lines[0]).not.toHaveProperty("sub");
  });

  it("el porcentaje a tiempo solo desde 5 alertas: con menos, un 100 % engaña", () => {
    expect(MIN_ALERTS_FOR_PCT).toBe(5);
    expect(impactSummary(ov({ impact: { alerts: 4, alertsOnTime: 4 } })).onTimePct).toBeNull();
    expect(impactSummary(ov({ impact: { alerts: 5, alertsOnTime: 4 } })).onTimePct).toBe(80);
    expect(impactSummary(ov({ impact: { alerts: 7, alertsOnTime: 5 } })).onTimePct).toBe(71);
  });

  it("la frase principal: casos, alertas y controles (hasta tres), con singular y plural", () => {
    expect(impactSummary(ov({ impact: week })).headline).toBe(
      "2 casos cerrados, 5 alertas y 42 controles de signos",
    );
    expect(impactSummary(ov({ impact: { casesCompleted: 1 } })).headline).toBe("1 caso cerrado");
    expect(impactSummary(ov({ impact: { notes: 3, tasksDone: 2 } })).headline).toBe(
      "2 tareas cumplidas y 3 notas firmadas",
    );
    expect(impactSummary(ov({ impact: { alerts: 1, alertsOnTime: 1 } })).headline).toBe("1 alerta");
  });

  it("el tiempo típico solo aparece si hay dato", () => {
    const s = impactSummary(ov({ impact: { alerts: 2, alertsOnTime: 2, medianAckSeconds: null } }));
    expect(s.lines.map((l) => l.key)).toEqual(["alerts"]);
  });
});

describe("texto para compartir", () => {
  const impact = {
    manualControls: 30,
    deviceReadings: 12,
    alerts: 5,
    alertsOnTime: 4,
    medianAckSeconds: 130,
    tasksDone: 12,
    notes: 9,
    casesCompleted: 2,
  };

  it("cifras reales de la semana, con el nombre de la institución y el enlace de Humanix", () => {
    const text = impactShareText(ov({ impact }), { institution: "Clínica Norte" });
    expect(text.split("\n")).toEqual([
      "Esta semana en Clínica Norte, con Humanix:",
      "• 42 controles de signos (12 llegaron solos desde dispositivos)",
      "• 5 alertas, 4 atendidas a tiempo (80 %)",
      "• Tiempo típico en ver una alerta: 2 min 10 s",
      "• 12 tareas cumplidas · 9 notas firmadas",
      "• 2 casos cerrados",
      "",
      "Cuidado coordinado, a tiempo y con trazabilidad. https://humanix.lat",
    ]);
  });

  it("sin nombre, sin porcentaje con pocas alertas y sin líneas vacías", () => {
    const text = impactShareText(ov({ impact: { manualControls: 3, alerts: 2, alertsOnTime: 2 } }));
    expect(text.split("\n")[0]).toBe("Esta semana, con Humanix:");
    expect(text).toContain("• 2 alertas, 2 atendidas a tiempo\n");
    expect(text).not.toContain("%");
    expect(text).not.toContain("dispositivos");
    expect(text).not.toContain("tarea");
    expect(text).not.toContain("caso");
  });

  it("la valoración histórica va aparte y solo con 3 casos valorados o más", () => {
    const o = (rated: number) => ov({ impact, cases: { rated, avgSatisfaction: 4.6 } });
    expect(impactShareText(o(2))).not.toContain("valoran");
    const t = impactShareText(o(3));
    expect(t).toContain("En total, las familias nos valoran con 4,6 de 5 (3 casos valorados).");
    expect(t.indexOf("En total")).toBeGreaterThan(t.indexOf("• 2 casos cerrados"));
  });

  it("no contiene nada que identifique a una persona, y el enlace puede cambiarse", () => {
    const text = impactShareText(ov({ impact }), { url: "https://humanix.lat/ips" });
    expect(text).toContain("https://humanix.lat/ips");
    expect(text).not.toMatch(/\d{7,}/);
    expect(text).not.toMatch(/@/);
  });

  it("un nombre en blanco se ignora", () => {
    expect(impactShareText(ov({ impact }), { institution: "   " }).split("\n")[0]).toBe(
      "Esta semana, con Humanix:",
    );
  });
});

describe("saludo", () => {
  const at = (hhmmBogota: string) => Date.parse(`2026-10-14T${hhmmBogota}:00-05:00`);

  it("por la hora de Colombia, no por la del equipo", () => {
    expect(greetingFor(at("04:59"))).toBe("Buenas noches");
    expect(greetingFor(at("05:00"))).toBe("Buenos días");
    expect(greetingFor(at("11:59"))).toBe("Buenos días");
    expect(greetingFor(at("12:00"))).toBe("Buenas tardes");
    expect(greetingFor(at("18:59"))).toBe("Buenas tardes");
    expect(greetingFor(at("19:00"))).toBe("Buenas noches");
    expect(greetingFor(at("00:30"))).toBe("Buenas noches");
  });

  it("con el primer nombre; un nombre vacío no deja una coma suelta", () => {
    expect(greetingFor(at("08:00"), "Marta Lucía Gómez")).toBe("Buenos días, Marta");
    expect(greetingFor(at("08:00"), "   ")).toBe("Buenos días");
    expect(greetingFor(at("08:00"), null)).toBe("Buenos días");
    expect(greetingFor(new Date(at("08:00")))).toBe("Buenos días");
  });
});

describe("brújula del día", () => {
  const now = Date.parse("2026-10-14T16:00:00Z");

  it("sin pacientes: invita a empezar, sin inventar tareas", () => {
    const c = careCompass(ov(), now);
    expect(c).toMatchObject({
      headline: "Tu tablero está listo para el primer paciente",
      tone: "trust",
      items: [],
      allClear: false,
    });
    expect(c.greeting).toBe("Buenos días");
  });

  it("los dados de alta no cuentan como pacientes abiertos", () => {
    expect(careCompass(ov({ patients: { total: 3, discharged: 3, open: 0 } }), now).allClear).toBe(
      false,
    );
  });

  it("si todos tienen alta: reconoce el cierre en vez de decir que apenas empieza", () => {
    const c = careCompass(ov({ patients: { total: 3, discharged: 3, open: 0 } }), now);
    expect(c).toMatchObject({
      headline: "Todos tus pacientes tienen alta",
      tone: "ok",
      items: [],
      allClear: false,
    });
    expect(c.sub).toMatch(/Cuando llegue el siguiente/);
  });

  it("todo al día: con pacientes y nada pendiente", () => {
    const c = careCompass(ov({ patients: { open: 3, total: 3 } }), now, "Marta Gómez");
    expect(c).toMatchObject({ headline: "Todo al día", tone: "ok", allClear: true, items: [] });
    expect(c.greeting).toBe("Buenos días, Marta");
    expect(c.sub).toBe("Sin alertas por ver, controles ni tareas vencidas. Buen trabajo, equipo.");
  });

  it("lo pendiente, en orden de urgencia, con singular y plural", () => {
    const c = careCompass(
      ov({
        patients: { open: 5 },
        alerts: { unacked: 2, overdue: 1, critical: 1 },
        monitoring: { overdue: 3, highRisk: 1 },
        tasks: { overdue: 1 },
      }),
      now,
    );
    expect(c.items.map((i) => [i.key, i.count, i.label, i.target])).toEqual([
      ["alerts", 2, "alertas sin ver", "alerts"],
      ["monitoring_overdue", 3, "controles de signos vencidos", "monitoring"],
      ["tasks_overdue", 1, "tarea vencida", "tasks"],
      ["high_risk", 1, "paciente con riesgo urgente o crítico", "monitoring"],
    ]);
    expect(c.items[0]!.detail).toBe("1 pasada de plazo");
    expect(c.items[1]).not.toHaveProperty("detail");
    expect(c.headline).toBe("2 alertas sin ver y 3 controles de signos vencidos");
    expect(c.tone).toBe("sos");
    expect(c.allClear).toBe(false);
    expect(c.sub).toBe("Empieza por las alertas: son lo más urgente.");
  });

  it("sin alertas urgentes el tono baja a atención y el texto cambia", () => {
    const c = careCompass(ov({ patients: { open: 2 }, tasks: { overdue: 2 } }), now);
    expect(c.tone).toBe("warn");
    expect(c.headline).toBe("2 tareas vencidas");
    expect(c.sub).toBe("Esto es lo que hoy pide tu atención.");
  });

  it("una alerta sin ver (no crítica ni vencida) es atención; vencida plural en el detalle", () => {
    const one = careCompass(ov({ patients: { open: 1 }, alerts: { unacked: 1 } }), now);
    expect(one.tone).toBe("warn");
    expect(one.items[0]).toMatchObject({ label: "alerta sin ver", tone: "warn" });
    const many = careCompass(
      ov({ patients: { open: 1 }, alerts: { unacked: 3, overdue: 2 } }),
      now,
    );
    expect(many.items[0]!.detail).toBe("2 pasadas de plazo");
    expect(many.items[0]!.tone).toBe("sos");
  });
});
