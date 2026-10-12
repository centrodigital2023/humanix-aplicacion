import { describe, expect, it } from "vitest";
import {
  COVERAGE_WINDOW_DAYS,
  RADAR_HORIZON_DAYS,
  buildCoverageRadar,
  type RadarNeed,
} from "./coverageRadar";
import {
  DAY,
  HOUR,
  NOW,
  iso,
  member,
  mulberry32,
  need,
  needBlock,
  proposal,
} from "./familyIntel.fixture";
import type { MarketStats } from "./negotiation";

const market = (over: Partial<MarketStats> = {}): MarketStats => ({
  n: 12,
  p25: 20_000,
  median: 24_000,
  p75: 28_000,
  ...over,
});

const radar = (
  needs: RadarNeed[],
  extra: Parameters<typeof buildCoverageRadar>[0] extends infer A ? Partial<A> : never = {},
) => buildCoverageRadar({ needs, now: NOW, ...extra });

describe("sin agenda", () => {
  it("no hay huecos, no hay riesgo y se invita a marcar las horas", () => {
    const r = radar([]);
    expect(r.gaps).toEqual([]);
    expect(r.nextGap).toBeNull();
    expect(r.risk).toBe("none");
    expect(r.summary).toEqual({
      windowDays: COVERAGE_WINDOW_DAYS,
      neededHours: 0,
      coveredHours: 0,
      openHours: 0,
      coveragePct: null,
    });
    expect(r.team.headline).toBe("Aún no tienes equipo de confianza.");
    expect(r.advice.map((a) => a.id)).toEqual(["no_needs"]);
  });
});

describe("huecos y urgencia", () => {
  it("un turno que empieza en 3 horas es crítico y se agrupa en un solo hueco", () => {
    const r = radar(needBlock(3 * HOUR, 6));
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({
      hours: 6,
      level: "critical",
      urgency: "now",
      startedAlready: false,
      rate: 20_000,
    });
    expect(r.gaps[0].needIds).toHaveLength(6);
    expect(r.risk).toBe("critical");
    expect(r.nextGap).toBe(r.gaps[0]);
  });

  it("la urgencia sube a medida que se acerca el turno", () => {
    expect(radar(needBlock(20 * HOUR, 4)).gaps[0]).toMatchObject({
      level: "high",
      urgency: "tomorrow",
    });
    expect(radar(needBlock(50 * HOUR, 2)).gaps[0]).toMatchObject({
      level: "medium",
      urgency: "week",
    });
    expect(radar(needBlock(100 * HOUR, 2)).gaps[0]).toMatchObject({
      level: "low",
      urgency: "week",
    });
  });

  it("las fronteras son exactas: 6 h, 24 h y 72 h", () => {
    const at = (offset: number) => radar(needBlock(offset, 1)).gaps[0].level;
    expect(at(6 * HOUR)).toBe("critical");
    expect(at(6 * HOUR + 1)).toBe("high");
    expect(at(24 * HOUR)).toBe("high");
    expect(at(24 * HOUR + 1)).toBe("medium");
    expect(at(72 * HOUR)).toBe("medium");
    expect(at(72 * HOUR + 1)).toBe("low");
  });

  it("un turno ya empezado sin profesional es crítico y se marca como tal", () => {
    const r = radar([need({ starts_at: iso(-HOUR), ends_at: iso(2 * HOUR) })]);
    expect(r.gaps[0]).toMatchObject({ startedAlready: true, level: "critical", urgency: "now" });
  });

  it("horas seguidas se unen; un hueco en medio las separa; nunca pasan de 24 h", () => {
    const joined = radar(needBlock(30 * HOUR, 10));
    expect(joined.gaps).toHaveLength(1);
    expect(joined.gaps[0].hours).toBe(10);

    const split = radar([...needBlock(40 * HOUR, 2), ...needBlock(30 * HOUR, 3)]);
    expect(split.gaps.map((g) => g.hours)).toEqual([3, 2]); // ordenados por inicio
    expect(split.gaps[0].startsAt < split.gaps[1].startsAt).toBe(true);

    const long = radar(needBlock(30 * HOUR, 30));
    expect(long.gaps.map((g) => g.hours)).toEqual([24, 6]);
  });

  it("el riesgo general es el del hueco más urgente", () => {
    const r = radar([
      ...needBlock(100 * HOUR, 2),
      ...needBlock(20 * HOUR, 2),
      ...needBlock(60 * HOUR, 2),
    ]);
    expect(r.gaps.map((g) => g.level)).toEqual(["high", "medium", "low"]);
    expect(r.risk).toBe("high");
  });

  it("ignora lo que ya pasó, lo que está más allá del horizonte y los horarios inválidos", () => {
    const r = radar([
      need({ starts_at: iso(-5 * HOUR), ends_at: iso(-4 * HOUR) }), // ya pasó
      need({
        starts_at: iso((RADAR_HORIZON_DAYS + 1) * DAY),
        ends_at: iso((RADAR_HORIZON_DAYS + 1) * DAY + HOUR),
      }),
      need({ starts_at: iso(5 * HOUR), ends_at: iso(4 * HOUR) }), // termina antes de empezar
      need({ starts_at: "no-es-fecha", ends_at: iso(4 * HOUR) }),
    ]);
    expect(r.gaps).toEqual([]);
    expect(r.advice.map((a) => a.id)).toEqual(["no_needs"]);
  });

  it("canceladas o vencidas no son huecos ni cuentan como horas necesitadas", () => {
    const r = radar([
      ...needBlock(30 * HOUR, 3, { status: "cancelled" }),
      ...needBlock(40 * HOUR, 3, { status: "expired" }),
    ]);
    expect(r.gaps).toEqual([]);
    expect(r.summary.neededHours).toBe(0);
  });
});

describe("tarifa frente al mercado", () => {
  it("por debajo del rango: sugiere la mediana y lo explica con números", () => {
    const r = radar(needBlock(30 * HOUR, 4, { hourly_rate: 15_000 }), { market: market() });
    const g = r.gaps[0];
    expect(g.position).toBe("below");
    expect(g.suggestedRate).toBe(24_000);
    expect(g.reasons[0]).toMatch(/por debajo del rango de tu ciudad/);
    expect(g.reasons[0]).toMatch(/15\.000/);
    expect(g.reasons[0]).toMatch(/20\.000.*28\.000/);
    expect(g.reasons[0]).toMatch(/24\.000/);
    const advice = r.advice.find((a) => a.id === "raise_rate");
    expect(advice?.severity).toBe("warn");
    expect(advice?.title).toMatch(/^Sube la tarifa a ~.*24\.000.*\/h en 1 turno$/);
  });

  it("dentro o por encima del rango no se sugiere nada", () => {
    for (const rate of [22_000, 30_000]) {
      const r = radar(needBlock(30 * HOUR, 2, { hourly_rate: rate }), { market: market() });
      expect(r.gaps[0].suggestedRate).toBeNull();
      expect(r.advice.some((a) => a.id === "raise_rate")).toBe(false);
    }
  });

  it("sin mercado, o con muestra pequeña, no compara", () => {
    for (const m of [
      null,
      undefined,
      market({ n: 2 }),
      market({ p25: null, median: null, p75: null }),
    ]) {
      const g = radar(needBlock(30 * HOUR, 2, { hourly_rate: 5_000 }), { market: m }).gaps[0];
      expect(g.position).toBe("unknown");
      expect(g.suggestedRate).toBeNull();
    }
  });

  it("la tarifa del turno es el promedio ponderado por horas", () => {
    const r = radar([
      ...needBlock(30 * HOUR, 2, { hourly_rate: 20_000 }),
      ...needBlock(32 * HOUR, 2, { hourly_rate: 30_000 }),
    ]);
    expect(r.gaps[0].rate).toBe(25_000);
  });

  it("una tarifa vacía, cero o ilegible no cuenta como tarifa", () => {
    for (const v of [null, 0, "abc", ""]) {
      const g = radar(needBlock(30 * HOUR, 2, { hourly_rate: v }), { market: market() }).gaps[0];
      expect(g.rate).toBeNull();
      expect(g.position).toBe("unknown");
    }
    expect(radar(needBlock(30 * HOUR, 1, { hourly_rate: "20000.00" })).gaps[0].rate).toBe(20_000);
  });

  it("sugiere la tarifa más alta entre varios turnos y cuenta cuántos", () => {
    const r = radar(
      [
        ...needBlock(30 * HOUR, 2, { hourly_rate: 15_000 }),
        ...needBlock(60 * HOUR, 2, { hourly_rate: 18_000 }),
      ],
      { market: market({ median: 24_300 }) },
    );
    expect(r.gaps.every((g) => g.suggestedRate === 24_500)).toBe(true); // redondea a pasos de $500
    expect(r.advice.find((a) => a.id === "raise_rate")?.title).toMatch(/en 2 turnos$/);
  });
});

describe("propuestas y tiempo sin respuesta", () => {
  const blocks = needBlock(30 * HOUR, 3);
  const ids = blocks.map((b) => b.id);

  it("cuenta solo las propuestas vigentes de un profesional para ese turno", () => {
    const r = radar(blocks, {
      proposals: [
        proposal({ family_need_id: ids[0] }), // vigente
        proposal({ family_need_id: ids[1] }), // vigente (otro bloque del mismo turno)
        proposal({ family_need_id: ids[0], proposed_by: "family" }), // la propia familia: no cuenta
        proposal({ family_need_id: ids[0], status: "rejected" }),
        proposal({ family_need_id: ids[0], status: "countered" }),
        proposal({ family_need_id: ids[0], expires_at: iso(-HOUR) }), // vencida
        proposal({ family_need_id: "otra-necesidad" }),
        proposal({ family_need_id: null }),
      ],
    });
    expect(r.gaps[0].proposalsPending).toBe(2);
    expect(r.gaps[0].reasons).toEqual([
      "Tienes 2 propuestas vigentes para este turno: revísalas en tu agenda.",
    ]);
    expect(r.advice.find((a) => a.id === "review_proposals")?.title).toBe(
      "Tienes 2 propuestas esperando respuesta",
    );
  });

  it("una propuesta sin fecha de vencimiento sigue vigente", () => {
    const r = radar(blocks, {
      proposals: [proposal({ family_need_id: ids[0], expires_at: null })],
    });
    expect(r.gaps[0].proposalsPending).toBe(1);
    expect(r.gaps[0].reasons[0]).toBe(
      "Tienes 1 propuesta vigente para este turno: revísala en tu agenda.",
    );
  });

  it("avisa cuando lleva horas publicado y nadie propone", () => {
    const old = needBlock(30 * HOUR, 2, { created_at: iso(-20 * HOUR) });
    expect(radar(old).gaps[0]).toMatchObject({ openForHours: 20, proposalsPending: 0 });
    expect(radar(old).gaps[0].reasons).toEqual(["Lleva 20 h publicado sin propuestas."]);
    const fresh = needBlock(30 * HOUR, 2, { created_at: iso(-5 * HOUR) });
    expect(radar(fresh).gaps[0].reasons).toEqual([]);
  });

  it("usa la necesidad más antigua del turno y no avisa de silencio si ya hay propuestas", () => {
    const mixed = [
      need({ starts_at: iso(30 * HOUR), ends_at: iso(31 * HOUR), created_at: iso(-30 * HOUR) }),
      need({ starts_at: iso(31 * HOUR), ends_at: iso(32 * HOUR), created_at: iso(-1 * HOUR) }),
    ];
    expect(radar(mixed).gaps[0].openForHours).toBe(30);
    const withProposal = radar(mixed, { proposals: [proposal({ family_need_id: mixed[1].id })] });
    expect(withProposal.gaps[0].reasons.join(" ")).not.toMatch(/Lleva/);
  });

  it("si no se sabe cuándo se publicó, no se inventa", () => {
    const g = radar(needBlock(30 * HOUR, 1, { created_at: null })).gaps[0];
    expect(g.openForHours).toBeNull();
    expect(g.reasons).toEqual([]);
  });
});

describe("cobertura de los próximos 7 días", () => {
  it("horas cubiertas, abiertas y porcentaje", () => {
    const r = radar([...needBlock(2 * DAY, 10, { status: "matched" }), ...needBlock(3 * DAY, 5)]);
    expect(r.summary).toMatchObject({
      neededHours: 15,
      coveredHours: 10,
      openHours: 5,
      coveragePct: 67,
    });
  });

  it("solo cuenta la parte que cae dentro de la ventana de 7 días", () => {
    const r = radar([
      need({ starts_at: iso(6.5 * DAY), ends_at: iso(7.5 * DAY), status: "matched" }),
    ]);
    expect(r.summary.coveredHours).toBe(12);
  });

  it("lo que ya pasó de un turno en curso no cuenta", () => {
    const r = radar([need({ starts_at: iso(-HOUR), ends_at: iso(2 * HOUR) })]);
    expect(r.summary.openHours).toBe(2);
  });

  it("todo cubierto: sin huecos, riesgo ninguno y un mensaje de tranquilidad", () => {
    const r = radar(needBlock(2 * DAY, 6, { status: "matched" }));
    expect(r.gaps).toEqual([]);
    expect(r.risk).toBe("none");
    expect(r.summary.coveragePct).toBe(100);
    expect(r.advice.map((a) => a.id)).toEqual(["all_covered"]);
    expect(r.advice[0].severity).toBe("good");
  });

  it("horas más allá de los 7 días entran en los huecos (14 días) pero no en el porcentaje", () => {
    const r = radar(needBlock(9 * DAY, 4));
    expect(r.gaps).toHaveLength(1);
    expect(r.summary.neededHours).toBe(0);
    expect(r.summary.coveragePct).toBeNull();
  });
});

describe("equipo de confianza y recomendaciones", () => {
  const urgent = needBlock(3 * HOUR, 4);

  it("con equipo disponible: avisar primero a quien más trabajó contigo (hasta 3 nombres)", () => {
    const team = [
      member({ display_name: "Ana", services_together: 1 }),
      member({ display_name: "Beatriz", services_together: 9 }),
      member({ display_name: "Carla", services_together: 5 }),
      member({ display_name: "Diana", services_together: 2 }),
      member({ display_name: "Elena", services_together: 7, available: false }),
    ];
    const r = radar(urgent, { team });
    expect(r.team.size).toBe(5);
    expect(r.team.available.map((m) => m.display_name)).toEqual([
      "Beatriz",
      "Carla",
      "Diana",
      "Ana",
    ]);
    expect(r.team.headline).toBe("4 de 5 de tu equipo están disponibles.");
    const a = r.advice[0];
    expect(a).toMatchObject({ id: "notify_team", kind: "team", severity: "alert" });
    expect(a.title).toBe("Avisa ya a tu equipo: Beatriz, Carla, Diana");
    expect(a.detail).toMatch(/1 turno sin cubrir en menos de 24 horas/);
  });

  it("una sola persona disponible se dice en singular", () => {
    const r = radar(urgent, { team: [member({ display_name: "Ana" })] });
    expect(r.team.headline).toBe("1 de 1 de tu equipo está disponible.");
  });

  it("con equipo pero nadie disponible: pide ayuda hoy y lo dice", () => {
    const r = radar(urgent, { team: [member({ available: false }), member({ available: false })] });
    expect(r.team.headline).toBe("Nadie de tu equipo (2) aparece disponible ahora.");
    expect(r.advice[0]).toMatchObject({ id: "publish_urgent", kind: "search", severity: "alert" });
    expect(r.advice.some((a) => a.id === "build_team")).toBe(false);
  });

  it("sin equipo: pide ayuda y sugiere armarlo", () => {
    const r = radar(urgent);
    expect(r.advice.map((a) => a.id)).toEqual(["publish_urgent", "build_team"]);
  });

  it("si el hueco es lejano no hay aviso urgente", () => {
    const r = radar(needBlock(100 * HOUR, 3), { team: [member()] });
    expect(r.advice.some((a) => a.id === "notify_team" || a.id === "publish_urgent")).toBe(false);
  });

  it("armar el equipo solo se sugiere cuando hay huecos y no hay equipo", () => {
    expect(radar(needBlock(100 * HOUR, 3)).advice.some((a) => a.id === "build_team")).toBe(true);
    expect(
      radar(needBlock(100 * HOUR, 3), { team: [member()] }).advice.some(
        (a) => a.id === "build_team",
      ),
    ).toBe(false);
    expect(radar([]).advice.some((a) => a.id === "build_team")).toBe(false);
  });

  it("las recomendaciones salen ordenadas: alerta, atención, información, bien", () => {
    const blocks = needBlock(3 * HOUR, 3, { hourly_rate: 12_000 });
    const r = radar(blocks, {
      market: market(),
      proposals: [proposal({ family_need_id: blocks[0].id })],
    });
    expect(r.advice.map((a) => a.id)).toEqual([
      "publish_urgent",
      "raise_rate",
      "review_proposals",
      "build_team",
    ]);
    expect(r.advice.map((a) => a.severity)).toEqual(["alert", "warn", "warn", "info"]);
  });
});

describe("invariantes (agendas aleatorias)", () => {
  for (const seed of [2, 8, 55, 2026, 777]) {
    it(`semilla ${seed}: nada sale NaN, los huecos van ordenados y las horas cuadran`, () => {
      const rnd = mulberry32(seed);
      const STATUS = ["open", "open", "open", "matched", "cancelled", "expired", "raro"];
      const needs: RadarNeed[] = Array.from({ length: 120 }, () => {
        const start = (rnd() * 20 * 24 - 12) * HOUR;
        const len = rnd() < 0.05 ? -HOUR : Math.ceil(rnd() * 3) * HOUR;
        return need({
          starts_at: rnd() < 0.03 ? "fecha-rota" : iso(Math.round(start / HOUR) * HOUR),
          ends_at: iso(Math.round(start / HOUR) * HOUR + len),
          hourly_rate: rnd() < 0.2 ? null : Math.round(rnd() * 40_000),
          status: STATUS[Math.floor(rnd() * STATUS.length)],
          created_at: rnd() < 0.2 ? null : iso(-rnd() * 40 * HOUR),
        });
      });
      const team = Array.from({ length: Math.floor(rnd() * 5) }, () =>
        member({ available: rnd() < 0.5, services_together: Math.floor(rnd() * 9) }),
      );
      const proposals = needs
        .slice(0, 30)
        .map((n) =>
          proposal({ family_need_id: n.id, status: rnd() < 0.5 ? "pending" : "rejected" }),
        );
      const r = radar(needs, { market: market(), team, proposals });

      for (let i = 1; i < r.gaps.length; i++)
        expect(r.gaps[i - 1].startsAt <= r.gaps[i].startsAt).toBe(true);
      for (const g of r.gaps) {
        expect(g.hours).toBeGreaterThan(0);
        expect(g.hours).toBeLessThanOrEqual(24);
        expect(g.proposalsPending).toBeGreaterThanOrEqual(0);
        expect(["critical", "high", "medium", "low"]).toContain(g.level);
        for (const t of g.reasons) expect(t).not.toMatch(/undefined|NaN|Infinity|\[object/);
      }
      const { summary: s } = r;
      expect(Math.abs(s.coveredHours + s.openHours - s.neededHours)).toBeLessThan(0.02);
      if (s.coveragePct !== null) {
        expect(s.coveragePct).toBeGreaterThanOrEqual(0);
        expect(s.coveragePct).toBeLessThanOrEqual(100);
      }
      expect(r.risk).toBe(
        r.gaps.length
          ? r.gaps
              .map((g) => g.level)
              .sort(
                (a, b) =>
                  ["critical", "high", "medium", "low"].indexOf(a) -
                  ["critical", "high", "medium", "low"].indexOf(b),
              )[0]
          : "none",
      );
      expect(new Set(r.advice.map((a) => a.id)).size).toBe(r.advice.length);
      for (const a of r.advice)
        expect(`${a.title} ${a.detail}`).not.toMatch(/undefined|NaN|Infinity|\[object/);
    });
  }

  it("el orden de la agenda no cambia el resultado", () => {
    const needs = [
      ...needBlock(3 * HOUR, 4),
      ...needBlock(40 * HOUR, 3, { hourly_rate: 12_000 }),
      ...needBlock(2 * DAY, 5, { status: "matched" }),
    ];
    const a = radar(needs, { market: market(), team: [member()] });
    const b = radar([...needs].reverse(), { market: market(), team: [member()] });
    expect(b.gaps.map((g) => [g.startsAt, g.hours, g.level])).toEqual(
      a.gaps.map((g) => [g.startsAt, g.hours, g.level]),
    );
    expect(b.summary).toEqual(a.summary);
    expect(b.advice.map((x) => x.id)).toEqual(a.advice.map((x) => x.id));
  });
});
