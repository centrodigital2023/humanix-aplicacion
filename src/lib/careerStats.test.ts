import { describe, it, expect } from "vitest";
import {
  careerLevel,
  careerShareText,
  computeBadges,
  documentationRatio,
  emptyCareerStats,
  gratitudeRows,
  nextBadge,
  nextBadgeHint,
  parseCareerStats,
  publicHighlights,
  streakWeeks,
  tierName,
  weekStartOf,
  type CareerStats,
} from "./careerStats";

const stats = (o: Partial<CareerStats> = {}): CareerStats => ({ ...emptyCareerStats(), ...o });

// 2026-10-09 es viernes. Lunes de esa semana: 2026-10-05.
const NOW = new Date("2026-10-09T15:00:00Z");

describe("normalización de la respuesta del servidor", () => {
  it("completo", () => {
    const s = parseCareerStats({
      completed_services: 4,
      hours_total: "22.0",
      clients_total: 2,
      repeat_clients: 1,
      first_service_at: "2026-09-18T13:00:00Z",
      last_service_at: null,
      week_starts: ["2026-09-14", "2026-09-28", 3],
      rated_services: "3",
      avg_stars: "4.80",
      kudos_total: 1,
      kudos_by_kind: { caring: 1, punctual: "2" },
      logged_services: 1,
      alerts_reported: 2,
    })!;
    expect(s).toMatchObject({
      completedServices: 4,
      hoursTotal: 22,
      clientsTotal: 2,
      repeatClients: 1,
      lastServiceAt: null,
      ratedServices: 3,
      avgStars: 4.8,
      kudosTotal: 1,
      loggedServices: 1,
      alertsReported: 2,
    });
    expect(s.weekStarts).toEqual(["2026-09-14", "2026-09-28"]);
    expect(s.kudosByKind).toEqual({ caring: 1, punctual: 2 });
  });
  it("la versión pública no trae cifras internas", () => {
    const s = parseCareerStats({ completed_services: 4 })!;
    expect(s.clientsTotal).toBeNull();
    expect(s.alertsReported).toBeNull();
  });
  it("nulo / vacío", () => {
    expect(parseCareerStats(null)).toBeNull();
    expect(parseCareerStats("x")).toBeNull();
    expect(emptyCareerStats().completedServices).toBe(0);
  });
});

describe("semana y racha (hora de Colombia)", () => {
  it("lunes de la semana", () => {
    expect(weekStartOf("2026-10-09T15:00:00Z")).toBe("2026-10-05"); // viernes
    expect(weekStartOf("2026-10-05T04:59:00Z")).toBe("2026-09-28"); // domingo 23:59 en Bogotá
    expect(weekStartOf("2026-10-05T05:00:00Z")).toBe("2026-10-05"); // lunes 00:00 en Bogotá
    expect(weekStartOf("2026-10-11T20:00:00Z")).toBe("2026-10-05"); // domingo
  });
  it("sin semanas no hay racha", () => {
    expect(streakWeeks([], NOW)).toBe(0);
  });
  it("cuenta semanas seguidas incluyendo la actual", () => {
    expect(streakWeeks(["2026-10-05", "2026-09-28", "2026-09-21"], NOW)).toBe(3);
  });
  it("no pierde la racha si esta semana aún no hay servicio", () => {
    expect(streakWeeks(["2026-09-28", "2026-09-21"], NOW)).toBe(2);
  });
  it("se corta si falta una semana", () => {
    expect(streakWeeks(["2026-10-05", "2026-09-21"], NOW)).toBe(1);
    expect(streakWeeks(["2026-09-14"], NOW)).toBe(0);
  });
  it("cruza el cambio de año", () => {
    expect(
      streakWeeks(["2026-01-05", "2025-12-29", "2025-12-22"], new Date("2026-01-08T15:00:00Z")),
    ).toBe(3);
  });
});

describe("nivel", () => {
  it("umbrales", () => {
    expect(careerLevel(0)).toMatchObject({ level: 1, label: "Primeros pasos", remaining: 5 });
    expect(careerLevel(4).level).toBe(1);
    expect(careerLevel(5)).toMatchObject({ level: 2, label: "Cuidador/a de confianza" });
    expect(careerLevel(20).level).toBe(3);
    expect(careerLevel(50).level).toBe(4);
    expect(careerLevel(150)).toMatchObject({ level: 5, next: null, progress: 1, remaining: 0 });
  });
  it("progreso dentro del nivel", () => {
    expect(careerLevel(12).progress).toBeCloseTo((12 - 5) / 15, 5);
    expect(careerLevel(12).next).toEqual({ level: 3, label: "Referente", at: 20 });
  });
  it("valores raros", () => {
    expect(careerLevel(-3).level).toBe(1);
    expect(careerLevel(7.9).level).toBe(2);
  });
});

describe("sellos", () => {
  it("sin actividad no hay sellos ganados", () => {
    const badges = computeBadges(emptyCareerStats(), NOW);
    expect(badges.every((b) => !b.earned && b.tier === 0)).toBe(true);
    expect(badges).toHaveLength(7);
  });
  it("tiers por umbral", () => {
    const b = computeBadges(
      stats({ completedServices: 25, hoursTotal: 210.5, repeatClients: 3, kudosTotal: 5 }),
      NOW,
    );
    const by = Object.fromEntries(b.map((x) => [x.id, x]));
    expect(by.constancia).toMatchObject({ tier: 2, earned: true, target: 100, current: 25 });
    expect(by.horas).toMatchObject({ tier: 2, current: 210 });
    expect(by.vuelven.tier).toBe(2);
    expect(by.corazon.tier).toBe(2);
    expect(by.excelencia.tier).toBe(0);
  });
  it("máximo: progreso completo", () => {
    const by = Object.fromEntries(
      computeBadges(stats({ completedServices: 300 }), NOW).map((x) => [x.id, x]),
    );
    expect(by.constancia).toMatchObject({ tier: 4, maxTier: 4, progress: 1, target: 250 });
  });
  it("excelencia exige promedio ≥ 4,7", () => {
    const low = Object.fromEntries(
      computeBadges(stats({ avgStars: 4.6, ratedServices: 30 }), NOW).map((x) => [x.id, x]),
    );
    const high = Object.fromEntries(
      computeBadges(stats({ avgStars: 4.8, ratedServices: 30 }), NOW).map((x) => [x.id, x]),
    );
    expect(low.excelencia.tier).toBe(0);
    expect(high.excelencia.tier).toBe(2);
  });
  it("la racha viene de las semanas", () => {
    const by = Object.fromEntries(
      computeBadges(
        stats({ weekStarts: ["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14"] }),
        NOW,
      ).map((x) => [x.id, x]),
    );
    expect(by.racha).toMatchObject({ tier: 2, current: 4 });
  });
  it("nombres de tier", () => {
    expect([0, 1, 2, 3, 4, 9].map(tierName)).toEqual([
      "",
      "Bronce",
      "Plata",
      "Oro",
      "Diamante",
      "Diamante",
    ]);
  });
});

describe("próximo sello", () => {
  it("el más cercano al siguiente tier", () => {
    const badges = computeBadges(
      stats({ completedServices: 4, kudosTotal: 4, hoursTotal: 10 }),
      NOW,
    );
    const nb = nextBadge(badges)!;
    // constancia 4/5 = 0.8, corazón: tier 1 (1 ≤ 4) → 4/5 = 0.8; empata por meta menor y por orden estable
    expect(["constancia", "corazon"]).toContain(nb.badge.id);
    expect(nb.missing).toBe(1);
  });
  it("sin nada: propone el primero", () => {
    const hint = nextBadgeHint(computeBadges(emptyCareerStats(), NOW));
    expect(hint).toContain("Te faltan 5 servicios para «Constancia · Bronce»");
  });
  it("singular", () => {
    const hint = nextBadgeHint(computeBadges(stats({ completedServices: 4 }), NOW))!;
    expect(hint).toContain("Te falta 1 servicio para «Constancia · Bronce»");
  });
  it("sustantivos en singular y plural", () => {
    expect(nextBadgeHint(computeBadges(stats({ kudosTotal: 4 }), NOW))).toContain(
      "Te falta 1 gracia para «Corazón Humanix · Plata»",
    );
    expect(nextBadgeHint(computeBadges(stats({ avgStars: 4.9, ratedServices: 4 }), NOW))).toContain(
      "Te falta 1 calificación para «Excelencia · Bronce»",
    );
  });
  it("todo al máximo: nada que proponer", () => {
    const max = stats({
      completedServices: 999,
      hoursTotal: 9999,
      repeatClients: 99,
      kudosTotal: 999,
      loggedServices: 999,
      avgStars: 5,
      ratedServices: 999,
      weekStarts: Array.from({ length: 20 }, (_, i) =>
        new Date(new Date("2026-10-05T00:00:00Z").getTime() - i * 7 * 86_400_000)
          .toISOString()
          .slice(0, 10),
      ),
    });
    expect(nextBadge(computeBadges(max, NOW))).toBeNull();
    expect(nextBadgeHint(computeBadges(max, NOW))).toBeNull();
  });
});

describe("perfil público y compartir", () => {
  it("destacados solo con cifras reales", () => {
    expect(publicHighlights(emptyCareerStats(), NOW)).toEqual([]);
    const h = publicHighlights(
      stats({
        completedServices: 42,
        hoursTotal: 310.4,
        repeatClients: 6,
        loggedServices: 38,
        weekStarts: ["2026-10-05", "2026-09-28"],
      }),
      NOW,
    );
    expect(h).toEqual([
      "42 servicios completados",
      "310 horas de cuidado",
      "6 clientes volvieron a contratar",
      "Racha de 2 semanas",
      "Parte del turno en 38 servicios",
    ]);
  });
  it("singular", () => {
    expect(publicHighlights(stats({ completedServices: 1, repeatClients: 1 }), NOW)).toEqual([
      "1 servicio completado",
      "1 cliente volvió a contratar",
    ]);
  });
  it("texto para compartir sin datos personales", () => {
    const t = careerShareText(
      stats({ completedServices: 42, hoursTotal: 310, repeatClients: 6 }),
      "https://humanix.lat/profesional/p1",
    );
    expect(t).toBe(
      "Llevo 42 servicios y 310 horas de cuidado cuidando con Humanix · 6 clientes volvieron a contratarme 💛 Mira mi perfil verificado: https://humanix.lat/profesional/p1",
    );
    expect(careerShareText(emptyCareerStats(), "https://x.co")).toBe(
      "Cuido con Humanix 💛 Mira mi perfil verificado: https://x.co",
    );
  });
  it("filas de gracias desde el mapa", () => {
    expect(gratitudeRows(stats({ kudosByKind: { caring: 3 } }))).toEqual([
      { kind: "caring", givers: 3 },
    ]);
  });
  it("proporción documentada", () => {
    expect(documentationRatio(stats({ completedServices: 10, loggedServices: 8 }))).toBe(0.8);
    expect(documentationRatio(stats({ completedServices: 2, loggedServices: 5 }))).toBe(1);
    expect(documentationRatio(emptyCareerStats())).toBe(0);
  });
});
