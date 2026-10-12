import { describe, expect, it } from "vitest";
import {
  CANDIDATE_WINDOW_DAYS,
  HIGH_CONCENTRATION_PCT,
  IDLE_DAYS,
  LIST_LIMIT,
  MIN_ARRIVALS,
  MIN_HOURS_CONCENTRATION,
  MIN_SERVICES_CONCENTRATION,
  MIN_SERVICES_TRUSTED,
  MODERATE_CONCENTRATION_PCT,
  RELIABILITY_LABEL,
  buildTeamReport,
  reliabilityOf,
  type TeamInput,
  type TeamTally,
} from "./instTeam";
import type { InstBooking } from "./instData";
import { ahead, cancelled, ib, late } from "./instIntel.fixture";
import { DAY, HOUR, NOW, mulberry32 } from "./intel.fixture";
import { resolvePeriod } from "./intelShared";
import { CANCEL_REASONS } from "./serviceCancel";

const period = resolvePeriod("90d", NOW);
const iso = (ms: number) => new Date(ms).toISOString();
const PRO_CANCEL = CANCEL_REASONS.professional[1].label;

const run = (over: Partial<TeamInput> = {}) =>
  buildTeamReport({ bookings: [], pros: null, teamIds: [], period, now: NOW, ...over });
const by = (
  id: string,
  n: number,
  start = 1,
  make: (d: number, id: string) => InstBooking = (d, p) => ib(d, { professional_id: p }),
) => Array.from({ length: n }, (_, i) => make(start + i, id));
const member = (r: ReturnType<typeof run>, id: string) => r.members.find((m) => m.id === id)!;
const ids = (r: ReturnType<typeof run>) => r.insights.map((i) => i.id);
const tally = (over: Partial<TeamTally> = {}): TeamTally => ({
  id: "p",
  services: 0,
  hours: 0,
  spend: 0,
  arrivals: 0,
  onTime: 0,
  cancelledByProfessional: 0,
  unstarted: 0,
  ...over,
});

describe("etiqueta de confiabilidad", () => {
  it("sin servicios ni incidentes es «sin servicios»", () => {
    expect(reliabilityOf(tally())).toBe("new");
  });

  it("muy confiable exige 3 servicios, sin incidentes y puntualidad conocida de 90 % o más", () => {
    expect(reliabilityOf(tally({ services: 3, arrivals: 3, onTime: 3 }))).toBe("excellent");
    expect(reliabilityOf(tally({ services: 2, arrivals: 3, onTime: 3 }))).toBe("solid");
    // sin llegadas registradas no se puede afirmar que sea puntual
    expect(reliabilityOf(tally({ services: 5, arrivals: 2, onTime: 2 }))).toBe("solid");
    expect(reliabilityOf(tally({ services: 10, arrivals: 10, onTime: 9 }))).toBe("excellent");
    expect(reliabilityOf(tally({ services: 10, arrivals: 10, onTime: 8 }))).toBe("solid"); // 80 %
  });

  it("una cancelación o un turno sin iniciar es «para observar»; dos, «para revisar»", () => {
    expect(
      reliabilityOf(tally({ services: 8, arrivals: 8, onTime: 8, cancelledByProfessional: 1 })),
    ).toBe("watch");
    expect(reliabilityOf(tally({ services: 8, arrivals: 8, onTime: 8, unstarted: 1 }))).toBe(
      "watch",
    );
    expect(
      reliabilityOf(
        tally({ services: 8, arrivals: 8, onTime: 8, cancelledByProfessional: 1, unstarted: 1 }),
      ),
    ).toBe("review");
    expect(reliabilityOf(tally({ services: 0, cancelledByProfessional: 2 }))).toBe("review");
  });

  it("la puntualidad baja la etiqueta solo con 3 llegadas o más", () => {
    expect(reliabilityOf(tally({ services: 2, arrivals: 2, onTime: 0 }))).toBe("solid");
    expect(reliabilityOf(tally({ services: 3, arrivals: 3, onTime: 2 }))).toBe("watch"); // 67 %
    expect(reliabilityOf(tally({ services: 10, arrivals: 10, onTime: 5 }))).toBe("review"); // 50 %
    expect(reliabilityOf(tally({ services: 4, arrivals: 4, onTime: 3 }))).toBe("solid"); // 75 %
  });

  it("los cortes son exactos: menos de 60 % revisar, menos de 75 % observar, desde 90 % muy confiable", () => {
    const at = (onTime: number) => reliabilityOf(tally({ services: 100, arrivals: 100, onTime }));
    expect(at(59)).toBe("review");
    expect(at(60)).toBe("watch");
    expect(at(74)).toBe("watch");
    expect(at(75)).toBe("solid");
    expect(at(89)).toBe("solid");
    expect(at(90)).toBe("excellent");
  });

  it("todas las etiquetas tienen su texto", () => {
    for (const k of ["excellent", "solid", "watch", "review", "new"] as const) {
      expect(RELIABILITY_LABEL[k].length).toBeGreaterThan(3);
    }
  });
});

describe("ficha por profesional", () => {
  it("suma servicios, horas, gasto y puntualidad solo de lo terminado en el periodo", () => {
    const rows = [
      ...by("p1", 4),
      late(ib(5, { professional_id: "p1" }), 40),
      ib(200, { professional_id: "p1" }), // fuera del periodo
      ahead(2, { professional_id: "p1" }), // por venir
    ];
    const r = run({ bookings: rows, pros: { p1: { name: "Marta Ruiz", rethusVerified: true } } });
    expect(r.members).toHaveLength(1);
    expect(member(r, "p1")).toMatchObject({
      name: "Marta Ruiz",
      services: 5,
      hours: 30,
      spend: 750_000,
      arrivals: 5,
      onTimePct: 80,
      rethusVerified: true,
      reliability: "solid",
    });
  });

  it("la puntualidad necesita 3 llegadas registradas", () => {
    const rows = [
      ...by("p1", MIN_ARRIVALS - 1),
      ib(10, { professional_id: "p1", arrived_at: null, started_at: null }),
    ];
    expect(member(run({ bookings: rows }), "p1").onTimePct).toBeNull();
    expect(member(run({ bookings: by("p1", MIN_ARRIVALS) }), "p1").onTimePct).toBe(100);
  });

  it("solo se le atribuyen las cancelaciones con motivo de profesional y los turnos sin iniciar", () => {
    const rows = [
      ...by("p2", 3),
      cancelled(10, PRO_CANCEL, { professional_id: "p2" }),
      cancelled(11, CANCEL_REASONS.client[0].label, { professional_id: "p2" }),
      cancelled(12, "Otro", { professional_id: "p2" }),
      ahead(0, { professional_id: "p2", scheduled_at: iso(NOW - 3 * HOUR) }),
    ];
    const m = member(run({ bookings: rows }), "p2");
    expect(m.cancelledByProfessional).toBe(1);
    expect(m.unstarted).toBe(1);
    expect(m.reliability).toBe("review");
  });

  it("ordena por horas y, a igualdad, por servicios y por id", () => {
    const rows = [...by("pb", 2), ...by("pa", 2, 3), ...by("pc", 5, 6)];
    expect(run({ bookings: rows }).members.map((m) => m.id)).toEqual(["pc", "pa", "pb"]);
  });

  it("recuerda el último servicio terminado de cada uno, aunque sea anterior al periodo", () => {
    const old = ib(150, { professional_id: "p7" });
    const r = run({ bookings: [old, ...by("p1", 1)], teamIds: ["p7"] });
    expect(r.bench.idle[0]).toMatchObject({ id: "p7", lastServiceAt: old.completed_at });
    expect(member(r, "p1").lastServiceAt).not.toBeNull();
  });

  it("sin perfiles cargados no hay nombres ni verificación inventada", () => {
    const m = member(run({ bookings: by("p1", 3), pros: null }), "p1");
    expect(m.name).toBeNull();
    expect(m.rethusVerified).toBeNull();
    const withPros = member(run({ bookings: by("p1", 3), pros: {} }), "p1");
    expect(withPros.rethusVerified).toBeNull();
  });
});

describe("dependencia de una persona", () => {
  it("con una sola persona que presta todo, el riesgo es «single»", () => {
    const r = run({ bookings: by("p1", 5), pros: { p1: { name: "Marta" } } });
    expect(r.concentration).toMatchObject({
      topProfessionalId: "p1",
      topShare: 100,
      risk: "single",
    });
    expect(ids(r)).toContain("single");
    expect(r.insights.find((i) => i.id === "single")!.professionalId).toBe("p1");
  });

  it("desde 60 % de las horas hay dependencia; desde 40 %, vigilancia; debajo, sano", () => {
    const mk = (a: number, b: number, c = 0) =>
      run({ bookings: [...by("p1", a), ...by("p2", b, 30), ...by("p3", c, 60)] }).concentration;
    expect(mk(6, 4).risk).toBe("high"); // 60 %
    expect(mk(6, 4).topShare).toBe(HIGH_CONCENTRATION_PCT);
    expect(mk(5, 5).risk).toBe("moderate"); // 50 %
    expect(mk(4, 3, 3).risk).toBe("moderate"); // 40 %
    expect(mk(3, 3, 4).topShare).toBe(40);
    expect(mk(3, 3, 3).risk).toBe("healthy"); // 33 %
  });

  it("con pocas horas o pocos servicios no se habla de concentración", () => {
    expect(run({ bookings: by("p1", 2) }).concentration.risk).toBe("none"); // 2 servicios
    expect(
      run({
        bookings: by("p1", 3, 1, (d, p) =>
          ib(d, { professional_id: p, duration_hours: 2, completed_at: iso(NOW - d * DAY) }),
        ),
      }).concentration.risk,
    ).toBe("none"); // 6 h
    expect(run().concentration).toEqual({ topProfessionalId: null, topShare: null, risk: "none" });
  });

  it("el aviso de dependencia nombra a la persona y propone sumar al equipo", () => {
    const r = run({
      bookings: [...by("p1", 7), ...by("p2", 3, 30)],
      pros: { p1: { name: "Marta Ruiz" } },
    });
    const i = r.insights.find((x) => x.id === "dependency")!;
    expect(i.title).toBe("Dependes de Marta Ruiz: prestó el 70 % de las horas");
    expect(i.action).toContain("equipo de confianza");
  });

  it("sin nombre conocido dice «un profesional»", () => {
    const r = run({ bookings: [...by("p1", 7), ...by("p2", 3, 30)] });
    expect(r.insights.find((x) => x.id === "dependency")!.title).toBe(
      "Dependes de un profesional: prestó el 70 % de las horas",
    );
    const single = run({ bookings: by("p1", 5) });
    expect(
      single.insights.find((x) => x.id === "single")!.detail.startsWith("Un profesional"),
    ).toBe(true);
  });
});

describe("equipo de confianza", () => {
  it("separa a quienes trabajaron hace menos de 30 días de los que no", () => {
    const rows = [
      ...by("p1", 3),
      ib(IDLE_DAYS + 5, { professional_id: "p2" }),
      ib(IDLE_DAYS - 5, { professional_id: "p3" }),
    ];
    const r = run({ bookings: rows, teamIds: ["p1", "p2", "p3", "p4"] });
    expect(r.bench.teamSize).toBe(4);
    expect(r.bench.active).toBe(2);
    expect(r.bench.idle.map((x) => x.id)).toEqual(["p2", "p4"]); // p4 nunca trabajó: al final
    expect(r.bench.idle[1].lastServiceAt).toBeNull();
    expect(ids(r)).toContain("team_idle");
    const i = r.insights.find((x) => x.id === "team_idle")!;
    expect(i.title).toBe("2 de 4 personas de tu equipo no trabajan contigo hace más de 30 días");
  });

  it("solo lista a tres de las quietas, pero cuenta todas", () => {
    const r = run({ bookings: by("p1", 3), teamIds: ["a", "b", "c", "d", "e"] });
    expect(r.bench.idle).toHaveLength(LIST_LIMIT);
    expect(r.bench.active).toBe(0);
    expect(r.insights.find((x) => x.id === "team_idle")!.title).toContain("5 de 5");
  });

  it("sin equipo y con servicios suficientes, invita a armarlo; con pocos servicios, no", () => {
    expect(ids(run({ bookings: by("p1", 3) }))).toContain("team_empty");
    expect(ids(run({ bookings: by("p1", 2) }))).not.toContain("team_empty");
  });

  it("un equipo activo no genera avisos de quietud", () => {
    const r = run({ bookings: by("p1", 4), teamIds: ["p1"] });
    expect(ids(r)).not.toContain("team_idle");
    expect(ids(r)).not.toContain("team_empty");
  });
});

describe("a quién sumar", () => {
  it("propone a quien cumplió 3 o más turnos sin fallar, puntual y fuera del equipo", () => {
    const rows = [
      ...by("p1", 4),
      ...by("p2", 3, 20),
      ...by("p3", 5, 30, (d, p) => late(ib(d, { professional_id: p }), 40)),
    ];
    const r = run({ bookings: rows, teamIds: ["p2"], pros: { p1: { name: "Marta" } } });
    expect(r.candidates.map((c) => c.id)).toEqual(["p1"]); // p2 ya está; p3 llegó tarde siempre
    expect(r.candidates[0]).toMatchObject({ name: "Marta", services: 4, onTimePct: 100 });
    const i = r.insights.find((x) => x.id === "add_candidate")!;
    expect(i.title).toBe("Marta podría sumarse a tu equipo de confianza");
    expect(i.detail).toBe("Cumplió 4 turnos y llegó a tiempo el 100 % de las veces.");
    expect(i.professionalId).toBe("p1");
  });

  it("no propone a quien canceló o dejó un turno sin iniciar, ni a quien tiene menos de 3 turnos", () => {
    const rows = [
      ...by("p1", 4),
      cancelled(20, PRO_CANCEL, { professional_id: "p1" }),
      ...by("p2", 2, 30),
      ...by("p3", 4, 40),
      ahead(0, { professional_id: "p3", scheduled_at: iso(NOW - 3 * HOUR) }),
    ];
    expect(run({ bookings: rows }).candidates).toEqual([]);
  });

  it("exige puntualidad conocida de 90 % o más", () => {
    expect(
      run({
        bookings: by("p1", 5, 1, (d, p) =>
          ib(d, { professional_id: p, arrived_at: null, started_at: null }),
        ),
      }).candidates,
    ).toEqual([]);
    const ninety = [...by("p1", 9), late(ib(10, { professional_id: "p1" }), 30)];
    expect(run({ bookings: ninety }).candidates).toHaveLength(1); // 9 de 10 = 90 %
    const eightyNine = [
      ...by("p1", 8),
      late(ib(9, { professional_id: "p1" }), 30),
      late(ib(10, { professional_id: "p1" }), 30),
    ];
    expect(run({ bookings: eightyNine }).candidates).toEqual([]); // 80 %
  });

  it("mira los últimos 90 días, no el periodo elegido, y propone como máximo tres", () => {
    const rows = [
      ...by("pa", 3, 100, (d, p) => ib(d, { professional_id: p })), // 100-102 días: fuera de la ventana
      ...by("p1", 6),
      ...by("p2", 5, 10),
      ...by("p3", 4, 20),
      ...by("p4", 3, 30),
    ];
    const last = resolvePeriod("last_month", NOW);
    const r = run({ bookings: rows, period: last });
    expect(r.candidates.map((c) => c.id)).toEqual(["p1", "p2", "p3"]);
    expect(CANDIDATE_WINDOW_DAYS).toBe(90);
  });
});

describe("avisos de revisión y agradecimiento", () => {
  it("«para revisar» explica los hechos y no acusa", () => {
    const rows = [
      ...by("p1", 4),
      cancelled(10, PRO_CANCEL, { professional_id: "p1" }),
      cancelled(11, PRO_CANCEL, { professional_id: "p1" }),
    ];
    const r = run({ bookings: rows, pros: { p1: { name: "Luis Soto" } } });
    const i = r.insights.find((x) => x.id === "review:p1")!;
    expect(i.title).toBe("Revisa con Luis Soto cómo van los turnos");
    expect(i.detail).toBe("Luis Soto canceló 2 turnos. Hablarlo a tiempo suele resolverlo.");
    expect(i.severity).toBe("warn");
  });

  it("mezcla cancelaciones, turnos sin iniciar y puntualidad en una frase", () => {
    const rows = [
      ...by("p1", 5, 1, (d, p) => late(ib(d, { professional_id: p }), 40)),
      cancelled(10, PRO_CANCEL, { professional_id: "p1" }),
      ahead(0, { professional_id: "p1", scheduled_at: iso(NOW - 3 * HOUR) }),
    ];
    const i = run({ bookings: rows }).insights.find((x) => x.id === "review:p1")!;
    expect(i.detail).toBe(
      "Un profesional canceló 1 turno, dejó 1 turno sin iniciar y llegó a tiempo solo el 0 % de las veces (5 llegadas). Hablarlo a tiempo suele resolverlo.",
    );
  });

  it("revisa a lo sumo a dos personas", () => {
    const rows = ["p1", "p2", "p3"].flatMap((p, i) => [
      cancelled(10 + i, PRO_CANCEL, { professional_id: p }),
      cancelled(20 + i, PRO_CANCEL, { professional_id: p }),
    ]);
    expect(ids(run({ bookings: rows })).filter((x) => x.startsWith("review:"))).toHaveLength(2);
  });

  it("agradece a quien cumplió sin fallar y fue puntual", () => {
    const r = run({
      bookings: [...by("p1", 5), ...by("p2", 5, 10)],
      pros: { p1: { name: "Marta" }, p2: { name: "Luis" } },
    });
    const i = r.insights.find((x) => x.id === "thank")!;
    expect(i.severity).toBe("good");
    expect(i.title).toBe("Agradece a Marta");
    expect(i.detail).toContain("5 turnos cumplidos");
    expect(ids(run({ bookings: by("p1", 2) }))).not.toContain("thank");
  });

  it("los avisos van primero; lo bueno, al final; y son seis como máximo", () => {
    const rows = [
      ...by("p1", 8),
      ...by("p2", 3, 20),
      cancelled(40, PRO_CANCEL, { professional_id: "p3" }),
      cancelled(41, PRO_CANCEL, { professional_id: "p3" }),
      cancelled(42, PRO_CANCEL, { professional_id: "p4" }),
      cancelled(43, PRO_CANCEL, { professional_id: "p4" }),
    ];
    const r = run({ bookings: rows, teamIds: ["x", "y"] });
    const sev = r.insights.map((i) => i.severity);
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) => ["warn", "info", "good"].indexOf(a) - ["warn", "info", "good"].indexOf(b),
      ),
    );
    expect(r.insights.length).toBeLessThanOrEqual(6);
  });
});

describe("puntualidad por persona", () => {
  it("10 min de margen es puntual; 11 min, tarde", () => {
    const rows = [
      ...by("p1", 3),
      late(ib(10, { professional_id: "p1" }), 10),
      late(ib(11, { professional_id: "p1" }), 11),
    ];
    const m = member(run({ bookings: rows }), "p1");
    expect(m.arrivals).toBe(5);
    expect(m.onTimePct).toBe(80); // 4 de 5
  });

  it("un servicio en curso con llegada registrada también cuenta", () => {
    const rows = [
      ...by("p1", 2),
      ib(5, { professional_id: "p1", status: "in_progress", completed_at: null }),
    ];
    const m = member(run({ bookings: rows }), "p1");
    expect(m.arrivals).toBe(3);
    expect(m.onTimePct).toBe(100);
    expect(m.services).toBe(2);
  });
});

describe("orden, último servicio y reparto", () => {
  it("ordena por horas aunque otra persona tenga más servicios", () => {
    const rows = [
      ...by("pa", 2, 1, (d, p) =>
        ib(d, { professional_id: p, duration_hours: 12, total_amount: 300_000 }),
      ),
      ...by("pb", 3, 10, (d, p) =>
        ib(d, { professional_id: p, duration_hours: 4, total_amount: 100_000 }),
      ),
    ];
    expect(run({ bookings: rows }).members.map((m) => m.id)).toEqual(["pa", "pb"]);
  });

  it("con las mismas horas gana quien hizo más servicios, antes que el orden por id", () => {
    const rows = [
      ...by("pz", 2, 1, (d, p) => ib(d, { professional_id: p, duration_hours: 6 })),
      ib(10, { professional_id: "pa", duration_hours: 12 }),
    ];
    expect(run({ bookings: rows }).members.map((m) => m.id)).toEqual(["pz", "pa"]);
  });

  it("el último servicio es el más reciente, venga como venga la lista", () => {
    const recent = ib(40, { professional_id: "p7" });
    const older = ib(80, { professional_id: "p7" });
    for (const rows of [
      [recent, older],
      [older, recent],
    ]) {
      const r = run({ bookings: rows, teamIds: ["p7"] });
      expect(r.bench.idle[0].lastServiceAt).toBe(recent.completed_at);
    }
  });

  it("el porcentaje de la persona con más horas se redondea, no se corta", () => {
    const rows = [...by("p1", 4), ...by("p2", 2, 30)]; // 24 h de 36 h = 66,67 %
    const r = run({ bookings: rows });
    expect(r.concentration.topShare).toBe(67);
    expect(r.concentration.risk).toBe("high");
  });

  it("tres servicios y 24 h bastan para hablar de dependencia; menos no", () => {
    const eight = (n: number, hours: number) =>
      by("p1", n, 1, (d, p) =>
        ib(d, { professional_id: p, duration_hours: hours, completed_at: iso(NOW - d * DAY) }),
      );
    expect(run({ bookings: eight(3, 8) }).concentration.risk).toBe("single");
    expect(run({ bookings: eight(2, 12) }).concentration.risk).toBe("none"); // 24 h pero 2 servicios
    expect(run({ bookings: eight(3, 7) }).concentration.risk).toBe("none"); // 3 servicios pero 21 h
  });

  it("los cortes de reparto están escritos a propósito", () => {
    expect(MIN_HOURS_CONCENTRATION).toBe(24);
    expect(MIN_SERVICES_CONCENTRATION).toBe(3);
    expect(HIGH_CONCENTRATION_PCT).toBe(60);
    expect(MODERATE_CONCENTRATION_PCT).toBe(40);
    expect(MIN_ARRIVALS).toBe(3);
    expect(MIN_SERVICES_TRUSTED).toBe(3);
    expect(IDLE_DAYS).toBe(30);
    expect(CANDIDATE_WINDOW_DAYS).toBe(90);
    expect(LIST_LIMIT).toBe(3);
  });
});

describe("equipo quieto: el límite de 30 días", () => {
  it("quien trabajó exactamente hace 30 días todavía está activo; un instante antes, quieto", () => {
    const at = (offset: number) =>
      ib(5, {
        professional_id: "p5",
        scheduled_at: iso(NOW - IDLE_DAYS * DAY + offset - 6 * HOUR),
        completed_at: iso(NOW - IDLE_DAYS * DAY + offset),
      });
    expect(run({ bookings: [at(0)], teamIds: ["p5"] }).bench.idle).toEqual([]);
    expect(run({ bookings: [at(-1)], teamIds: ["p5"] }).bench.idle.map((x) => x.id)).toEqual([
      "p5",
    ]);
  });
});

describe("candidatos: casos de borde", () => {
  it("con exactamente 3 servicios ya se propone", () => {
    expect(run({ bookings: by("p1", 3) }).candidates.map((c) => c.id)).toEqual(["p1"]);
  });

  it("la ventana es de 90 días: antes de eso no cuenta, aunque haya muchos servicios", () => {
    const rows = [
      ...by("old", 8, 95), // 95–102 días: fuera de la ventana
      ...by("p1", 3),
    ];
    expect(run({ bookings: rows }).candidates.map((c) => c.id)).toEqual(["p1"]);
  });

  it("un servicio de hace exactamente 90 días todavía cuenta; uno de un instante antes, no", () => {
    const exact = (i: number, offset: number) => {
      const start = NOW - CANDIDATE_WINDOW_DAYS * DAY + offset;
      return ib(0, {
        id: `ex${i}-${offset}`,
        professional_id: "p1",
        scheduled_at: iso(start),
        arrived_at: iso(start),
        started_at: iso(start),
        completed_at: iso(start + 6 * HOUR),
      });
    };
    expect(run({ bookings: [0, 1, 2].map((i) => exact(i, 0)) }).candidates).toHaveLength(1);
    expect(run({ bookings: [0, 1, 2].map((i) => exact(i, -1)) }).candidates).toHaveLength(0);
  });

  it("con igual número de servicios gana quien tiene más horas; con más servicios gana quien tiene más", () => {
    const rows = [
      ...by("pa", 4, 1, (d, p) =>
        ib(d, { professional_id: p, duration_hours: 4, total_amount: 100_000 }),
      ),
      ...by("pb", 3, 10, (d, p) =>
        ib(d, { professional_id: p, duration_hours: 12, total_amount: 300_000 }),
      ),
    ];
    // pa: 4 servicios y 16 h; pb: 3 servicios y 36 h → por servicios, pa primero
    expect(run({ bookings: rows }).candidates.map((c) => c.id)).toEqual(["pa", "pb"]);
  });

  it("una cancelación del profesional en una fecha por venir también lo deja fuera", () => {
    const rows = [
      ...by("p1", 4),
      cancelled(-3, CANCEL_REASONS.professional[0].label, { professional_id: "p1" }),
    ];
    expect(run({ bookings: rows }).candidates).toEqual([]);
  });
});

describe("«para revisar»: qué dice cada caso", () => {
  it("solo turnos sin iniciar: no inventa cancelaciones", () => {
    const stuck = (i: number) =>
      ahead(0, { professional_id: "p1", scheduled_at: iso(NOW - (3 + i) * HOUR), id: `st${i}` });
    const r = run({ bookings: [stuck(0), stuck(1)] });
    expect(r.insights.find((x) => x.id === "review:p1")!.detail).toBe(
      "Un profesional dejó 2 turnos sin iniciar. Hablarlo a tiempo suele resolverlo.",
    );
  });

  it("con dos cancelaciones y puntualidad de exactamente 60 %, no se menciona la puntualidad", () => {
    const rows = [
      ...by("p1", 3),
      ...by("p1", 2, 10, (d, p) => late(ib(d, { professional_id: p }), 40)), // 3 de 5 puntuales = 60 %
      cancelled(20, CANCEL_REASONS.professional[0].label, { professional_id: "p1" }),
      cancelled(21, CANCEL_REASONS.professional[0].label, { professional_id: "p1" }),
    ];
    const r = run({ bookings: rows });
    expect(member(r, "p1").onTimePct).toBe(60);
    expect(r.insights.find((x) => x.id === "review:p1")!.detail).toBe(
      "Un profesional canceló 2 turnos. Hablarlo a tiempo suele resolverlo.",
    );
  });

  it("revisa de más de dos solo a dos y nunca más de seis avisos en total", () => {
    const rows = ["p1", "p2", "p3"].flatMap((p, i) => [
      cancelled(10 + i, CANCEL_REASONS.professional[0].label, { professional_id: p }),
      cancelled(20 + i, CANCEL_REASONS.professional[0].label, { professional_id: p }),
    ]);
    expect(run({ bookings: rows, teamIds: ["x"] }).insights.length).toBeLessThanOrEqual(6);
  });
});

describe("sin datos", () => {
  it("lo explica y no inventa nada", () => {
    const r = run();
    expect(r.hasData).toBe(false);
    expect(r.members).toEqual([]);
    expect(r.totals).toEqual({ professionals: 0, services: 0, hours: 0, spend: 0 });
    expect(r.candidates).toEqual([]);
    expect(ids(r)).toEqual(["no_data"]);
  });

  it("con equipo de confianza pero sin servicios, se explica el equipo quieto", () => {
    const r = run({ teamIds: ["p1", "p2"] });
    expect(r.hasData).toBe(false);
    expect(ids(r)).toEqual(["team_idle"]);
    expect(r.bench).toMatchObject({ teamSize: 2, active: 0 });
  });

  it("un profesional con solo cancelaciones aparece en la lista pero no cuenta como horas prestadas", () => {
    const r = run({ bookings: [cancelled(5, PRO_CANCEL, { professional_id: "p9" })] });
    expect(r.members).toHaveLength(1);
    expect(r.totals.professionals).toBe(0);
    expect(r.concentration.risk).toBe("none");
  });
});

describe("propiedades con datos al azar", () => {
  it("no hay NaN, los porcentajes están entre 0 y 100 y las horas cuadran", () => {
    const rand = mulberry32(77);
    const statuses = [
      "completed",
      "completed",
      "completed",
      "cancelled",
      "confirmed",
      "in_progress",
      "pending",
    ];
    for (let round = 0; round < 60; round++) {
      const n = Math.floor(rand() * 40);
      const rows: InstBooking[] = Array.from({ length: n }, (_, i) => {
        const status = statuses[Math.floor(rand() * statuses.length)];
        const b = ib(Math.floor(rand() * 120) - 3, {
          professional_id: `p${Math.floor(rand() * 5)}`,
          status,
        });
        const start = new Date(b.scheduled_at).getTime();
        return {
          ...b,
          id: `t${round}-${i}`,
          arrived_at: rand() < 0.2 ? null : iso(start + Math.floor(rand() * 70 - 10) * 60_000),
          cancel_reason:
            status === "cancelled" ? [PRO_CANCEL, null, "otro"][Math.floor(rand() * 3)] : null,
          duration_hours: rand() < 0.1 ? "x" : 6,
        };
      });
      const team = ["p0", "p1", "p2", "p9"].filter(() => rand() < 0.5);
      const r = buildTeamReport({
        bookings: rows,
        pros: rand() < 0.5 ? { p0: { name: "A" } } : null,
        teamIds: team,
        period,
        now: NOW,
      });
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined/);
      for (const m of r.members) {
        if (m.onTimePct !== null) {
          expect(m.onTimePct).toBeGreaterThanOrEqual(0);
          expect(m.onTimePct).toBeLessThanOrEqual(100);
          expect(m.arrivals).toBeGreaterThanOrEqual(MIN_ARRIVALS);
        }
      }
      const hours = r.members.reduce((s, m) => s + m.hours, 0);
      expect(Math.abs(hours - r.totals.hours)).toBeLessThan(0.11);
      expect(r.bench.active + (r.bench.teamSize - r.bench.active)).toBe(r.bench.teamSize);
      expect(r.bench.idle.length).toBeLessThanOrEqual(LIST_LIMIT);
      expect(r.candidates.length).toBeLessThanOrEqual(LIST_LIMIT);
      expect(r.insights.length).toBeLessThanOrEqual(6);
    }
  });
});
