import { describe, expect, it } from "vitest";
import {
  applicationSla,
  assessShift,
  assessShifts,
  coverageHeadline,
  firstRunSteps,
  medianHours,
  nextBestActions,
  suggestRaise,
  summarizeCoverage,
  type CoverageShiftInput,
} from "./institutionCoverage";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

function shift(over: Partial<CoverageShiftInput> = {}): CoverageShiftInput {
  return {
    offerId: "o1",
    title: "Auxiliar UCI noches",
    serviceArea: "UCI adultos",
    specialty: "Auxiliar de enfermería",
    city: "Bogotá",
    modality: "shift",
    amount: 180_000,
    isUrgent: false,
    shiftId: "s1",
    startsAt: at(30),
    endsAt: at(42),
    positions: 1,
    filled: 0,
    applicants: 0,
    awaitingResponse: 0,
    oldestWaitingAt: null,
    ...over,
  };
}

describe("assessShift", () => {
  it("cubierto cuando no quedan cupos", () => {
    const s = assessShift(shift({ filled: 1 }), NOW)!;
    expect(s.risk).toBe("covered");
    expect(s.open).toBe(0);
  });

  it("ignora los turnos que ya terminaron", () => {
    expect(assessShift(shift({ startsAt: at(-20), endsAt: at(-8) }), NOW)).toBeNull();
    expect(assessShift(shift({ startsAt: "x", endsAt: "y" }), NOW)).toBeNull();
  });

  it("crítico: ya empezó, empieza en ≤ 12 h, o en ≤ 24 h sin postulantes", () => {
    expect(assessShift(shift({ startsAt: at(-1), endsAt: at(11) }), NOW)!.risk).toBe("critical");
    expect(assessShift(shift({ startsAt: at(10), endsAt: at(22), applicants: 3 }), NOW)!.risk).toBe(
      "critical",
    );
    const noCand = assessShift(shift({ startsAt: at(20), endsAt: at(32) }), NOW)!;
    expect(noCand.risk).toBe("critical");
    expect(noCand.reasons[0]).toContain("no tiene postulantes");
  });

  it("en riesgo: ≤ 24 h con postulantes esperando, ≤ 48 h sin postulantes o con respuesta atrasada", () => {
    expect(
      assessShift(
        shift({ startsAt: at(20), endsAt: at(32), applicants: 2, awaitingResponse: 2 }),
        NOW,
      )!.risk,
    ).toBe("high");
    expect(assessShift(shift({ startsAt: at(40), endsAt: at(52) }), NOW)!.risk).toBe("high");
    const late = assessShift(
      shift({
        startsAt: at(40),
        endsAt: at(52),
        applicants: 1,
        awaitingResponse: 1,
        oldestWaitingAt: at(-14),
      }),
      NOW,
    )!;
    expect(late.risk).toBe("high");
    expect(late.reasons[0]).toContain("sin respuesta");
  });

  it("vigilar: ≤ 96 h sin postulantes o una postulación de más de 24 h sin respuesta", () => {
    expect(assessShift(shift({ startsAt: at(80), endsAt: at(92) }), NOW)!.risk).toBe("watch");
    expect(
      assessShift(
        shift({
          startsAt: at(150),
          endsAt: at(162),
          applicants: 1,
          awaitingResponse: 1,
          oldestWaitingAt: at(-30),
        }),
        NOW,
      )!.risk,
    ).toBe("watch");
  });

  it("en orden: lejano o con postulantes atendidos", () => {
    expect(assessShift(shift({ startsAt: at(200), endsAt: at(212) }), NOW)!.risk).toBe("ok");
    expect(assessShift(shift({ startsAt: at(40), endsAt: at(52), applicants: 2 }), NOW)!.risk).toBe(
      "ok",
    );
  });

  it("ordena por riesgo y luego por hora de inicio", () => {
    const list = assessShifts(
      [
        shift({ shiftId: "far", startsAt: at(200), endsAt: at(212) }),
        shift({ shiftId: "crit", startsAt: at(5), endsAt: at(17) }),
        shift({ shiftId: "cov", filled: 1 }),
        shift({ shiftId: "high", startsAt: at(40), endsAt: at(52) }),
      ],
      NOW,
    );
    expect(list.map((s) => s.shiftId)).toEqual(["crit", "high", "far", "cov"]);
  });
});

describe("summarizeCoverage / coverageHeadline", () => {
  const list = assessShifts(
    [
      shift({ shiftId: "a", positions: 2, filled: 1, startsAt: at(5), endsAt: at(17) }),
      shift({ shiftId: "b", positions: 1, filled: 1 }),
      shift({
        shiftId: "c",
        positions: 1,
        filled: 0,
        applicants: 2,
        startsAt: at(100),
        endsAt: at(112),
      }),
    ],
    NOW,
  );

  it("cuenta cupos, porcentaje y riesgos", () => {
    const s = summarizeCoverage(list);
    expect(s).toMatchObject({
      totalPositions: 4,
      filledPositions: 2,
      openPositions: 2,
      coveragePct: 50,
    });
    expect(s.byRisk.critical).toBe(1);
    expect(s.byRisk.covered).toBe(1);
    expect(s.shiftsWithoutCandidates).toBe(1);
    expect(s.nextUncovered?.shiftId).toBe("a");
    expect(coverageHeadline(s)).toBe("Cubres 2 de 4 cupos (50 %)");
  });

  it("sin turnos no inventa un porcentaje", () => {
    const s = summarizeCoverage([]);
    expect(s.coveragePct).toBeNull();
    expect(coverageHeadline(s)).toBe("Aún no tienes turnos publicados");
  });

  it("todo cubierto", () => {
    const s = summarizeCoverage(assessShifts([shift({ filled: 1 })], NOW));
    expect(coverageHeadline(s)).toBe("Todos tus turnos están cubiertos");
    expect(s.nextUncovered).toBeNull();
  });
});

describe("applicationSla y medianHours", () => {
  it("clasifica cuánto lleva esperando una postulación", () => {
    expect(applicationSla(at(-1), NOW).level).toBe("fresh");
    expect(applicationSla(at(-6), NOW).level).toBe("watch");
    expect(applicationSla(at(-18), NOW)).toMatchObject({
      level: "late",
      label: "Espera hace 18 h: responde pronto",
    });
    expect(applicationSla(at(-30), NOW).level).toBe("overdue");
    expect(applicationSla("no-es-fecha", NOW).level).toBe("fresh");
  });

  it("mediana solo con muestra suficiente", () => {
    expect(medianHours([2, 4])).toBeNull();
    expect(medianHours([2, 4, 10])).toBe(4);
    expect(medianHours([2, 4, 6, 10])).toBe(5);
    expect(medianHours([2, Number.NaN, -1, 4, 10])).toBe(4);
  });
});

describe("suggestRaise", () => {
  it("sube ~12 % en pasos de $500 sin pasar la banda ni el techo", () => {
    expect(suggestRaise(180_000, "shift")).toBe(201_500);
    expect(suggestRaise(20_000, "hour")).toBe(22_500);
    expect(suggestRaise(250_000, "hour")).toBeNull();
    expect(suggestRaise(2_950_000, "shift")).toBe(3_000_000);
  });
});

describe("nextBestActions", () => {
  const base = {
    waitingApplications: [],
    unsignedContracts: [],
    favoritesCount: 0,
    supplyProfessionals: 12,
    now: NOW,
  };

  it("sin turnos: invita a publicar el primero", () => {
    const a = nextBestActions({ ...base, shifts: [] });
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("publish_first");
  });

  it("todo cubierto: lo celebra", () => {
    const a = nextBestActions({ ...base, shifts: assessShifts([shift({ filled: 1 })], NOW) });
    expect(a.map((x) => x.kind)).toEqual(["all_covered"]);
  });

  it("prioriza responder postulaciones atrasadas", () => {
    const a = nextBestActions({
      ...base,
      shifts: assessShifts(
        [shift({ startsAt: at(100), endsAt: at(112), applicants: 1, awaitingResponse: 1 })],
        NOW,
      ),
      waitingApplications: [
        { id: "a1", createdAt: at(-30), offerTitle: "x" },
        { id: "a2", createdAt: at(-2), offerTitle: "y" },
      ],
    });
    expect(a[0]).toMatchObject({ kind: "respond_applications", severity: "critical", count: 2 });
    expect(a[0].title).toBe("Responde a 2 postulaciones");
  });

  it("para un turno crítico sin postulantes sugiere urgente, valor y equipo de confianza", () => {
    const a = nextBestActions({
      ...base,
      favoritesCount: 4,
      shifts: assessShifts([shift({ startsAt: at(6), endsAt: at(18) })], NOW),
    });
    expect(a.map((x) => x.kind)).toEqual(
      expect.arrayContaining(["mark_urgent", "raise_rate", "invite_favorites"]),
    );
    const raise = a.find((x) => x.kind === "raise_rate")!;
    expect(raise.suggestedAmount).toBe(201_500);
    expect(raise.detail).toContain("+12 %");
    expect(a.every((x) => x.severity === "critical" || x.severity === "high")).toBe(true);
  });

  it("no pide marcar urgente lo que ya es urgente ni invita a un equipo vacío", () => {
    const a = nextBestActions({
      ...base,
      shifts: assessShifts([shift({ startsAt: at(6), endsAt: at(18), isUrgent: true })], NOW),
    });
    expect(a.map((x) => x.kind)).not.toContain("mark_urgent");
    expect(a.map((x) => x.kind)).not.toContain("invite_favorites");
  });

  it("avisa de contratos sin firmar, más fuerte si el turno es inminente", () => {
    const soon = nextBestActions({
      ...base,
      shifts: assessShifts([shift({ applicants: 1, startsAt: at(60), endsAt: at(72) })], NOW),
      unsignedContracts: [{ id: "c1", firstShiftAt: at(30) }],
    }).find((x) => x.kind === "sign_contracts")!;
    expect(soon.severity).toBe("high");
    const later = nextBestActions({
      ...base,
      shifts: assessShifts([shift({ applicants: 1, startsAt: at(60), endsAt: at(72) })], NOW),
      unsignedContracts: [{ id: "c1", firstShiftAt: at(300) }],
    }).find((x) => x.kind === "sign_contracts")!;
    expect(later.severity).toBe("medium");
  });

  it("con muestra de talento menor a 5 lo dice sin inventar cifras", () => {
    const a = nextBestActions({
      ...base,
      supplyProfessionals: null,
      shifts: assessShifts([shift({ startsAt: at(200), endsAt: at(212) })], NOW),
    });
    const w = a.find((x) => x.kind === "widen_supply")!;
    expect(w.detail).toContain("menos de 5");
  });

  it("devuelve como máximo 6 acciones, de más a menos graves", () => {
    const shifts = assessShifts(
      Array.from({ length: 8 }, (_, i) =>
        shift({ shiftId: `s${i}`, offerId: `o${i}`, startsAt: at(3 + i), endsAt: at(15 + i) }),
      ),
      NOW,
    );
    const a = nextBestActions({
      ...base,
      favoritesCount: 2,
      shifts,
      waitingApplications: [{ id: "a", createdAt: at(-13), offerTitle: "x" }],
      unsignedContracts: [{ id: "c", firstShiftAt: at(10) }],
    });
    expect(a.length).toBeLessThanOrEqual(6);
    const order = { critical: 0, high: 1, medium: 2, info: 3 } as const;
    for (let i = 1; i < a.length; i++)
      expect(order[a[i].severity]).toBeGreaterThanOrEqual(order[a[i - 1].severity]);
  });
});

describe("firstRunSteps", () => {
  it("marca avance y siguiente paso", () => {
    const r = firstRunSteps({
      profileComplete: true,
      verified: false,
      offersPublished: 0,
      applicationsReceived: 0,
      contractsSigned: 0,
    });
    expect(r.doneCount).toBe(1);
    expect(r.next?.id).toBe("verify");
    expect(r.steps).toHaveLength(5);
  });

  it("todo hecho: sin siguiente paso", () => {
    const r = firstRunSteps({
      profileComplete: true,
      verified: true,
      offersPublished: 2,
      applicationsReceived: 3,
      contractsSigned: 1,
    });
    expect(r.doneCount).toBe(5);
    expect(r.next).toBeNull();
  });
});
