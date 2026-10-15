import { describe, expect, it } from "vitest";
import {
  PULSE_WEEKS,
  STORM_SUPPORT,
  WEATHERS,
  WEATHER_META,
  bogotaWeekIndex,
  isWeather,
  pulseSummary,
  recordPulse,
  sanitizePulse,
} from "./caregiverPulse";
import { DAY, NOW, bogota } from "./intel.fixture";

const WEEK = bogotaWeekIndex(NOW);

describe("clima de quien cuida: semanas", () => {
  it("la semana va de lunes a domingo en hora de Colombia", () => {
    const monday = bogota("2026-10-12T00:01:00");
    const sunday = bogota("2026-10-18T23:59:00");
    const nextMonday = bogota("2026-10-19T00:01:00");
    expect(bogotaWeekIndex(monday)).toBe(bogotaWeekIndex(sunday));
    expect(bogotaWeekIndex(nextMonday)).toBe(bogotaWeekIndex(sunday) + 1);
    expect(bogotaWeekIndex(bogota("2026-10-11T23:59:00"))).toBe(bogotaWeekIndex(monday) - 1);
  });

  it("reconoce solo los cuatro climas", () => {
    for (const w of WEATHERS) expect(isWeather(w)).toBe(true);
    expect(isWeather("hail")).toBe(false);
    expect(isWeather(1)).toBe(false);
  });
});

describe("clima de quien cuida: lo guardado", () => {
  it("limpia lo que no sirve y deja una entrada por semana (gana la última)", () => {
    expect(sanitizePulse(null)).toEqual([]);
    expect(
      sanitizePulse([
        { week: 10, weather: "sunny" },
        { week: 10, weather: "rainy" },
        { week: -1, weather: "sunny" },
        { week: 11, weather: "hail" },
        { week: 1.5, weather: "sunny" },
        "x",
      ]),
    ).toEqual([{ week: 10, weather: "rainy" }]);
  });

  it("guarda solo las últimas semanas", () => {
    const many = Array.from({ length: PULSE_WEEKS + 4 }, (_, i) => ({
      week: i + 1,
      weather: "sunny",
    }));
    const out = sanitizePulse(many);
    expect(out).toHaveLength(PULSE_WEEKS);
    expect(out[0].week).toBe(5);
  });

  it("marcar esta semana reemplaza lo de esta semana y conserva lo anterior", () => {
    let e = recordPulse([{ week: WEEK - 1, weather: "cloudy" }], NOW, "sunny");
    e = recordPulse(e, NOW + DAY, "rainy");
    expect(e).toEqual([
      { week: WEEK - 1, weather: "cloudy" },
      { week: WEEK, weather: "rainy" },
    ]);
  });
});

describe("clima de quien cuida: respuesta", () => {
  it("sin marcar invita con un toque", () => {
    const s = pulseSummary([], NOW);
    expect(s.thisWeek).toBeNull();
    expect(s.line).toMatch(/Un toque/);
    expect(s.suggestHelp).toBe(false);
    expect(s.strip).toHaveLength(PULSE_WEEKS);
    expect(s.strip.every((x) => x === null)).toBe(true);
  });

  it("la franja va de la semana más antigua a esta", () => {
    const s = pulseSummary(
      [
        { week: WEEK - 7, weather: "sunny" },
        { week: WEEK, weather: "cloudy" },
      ],
      NOW,
    );
    expect(s.strip[0]).toBe("sunny");
    expect(s.strip[PULSE_WEEKS - 1]).toBe("cloudy");
  });

  it("una semana despejada, nublada o lluviosa responde con su texto y no sugiere relevo", () => {
    for (const w of ["sunny", "cloudy", "rainy"] as const) {
      const s = pulseSummary([{ week: WEEK, weather: w }], NOW);
      expect(s.line).toBe(WEATHER_META[w].reply);
      expect(s.suggestHelp).toBe(false);
      expect(s.showSupport).toBe(false);
    }
  });

  it("tormenta sugiere relevo y muestra apoyo con el 123", () => {
    const s = pulseSummary([{ week: WEEK, weather: "stormy" }], NOW);
    expect(s.suggestHelp).toBe(true);
    expect(s.showSupport).toBe(true);
    expect(STORM_SUPPORT).toContain("123");
  });

  it("dos semanas difíciles seguidas sugieren relevo", () => {
    const s = pulseSummary(
      [
        { week: WEEK - 1, weather: "stormy" },
        { week: WEEK, weather: "rainy" },
      ],
      NOW,
    );
    expect(s.suggestHelp).toBe(true);
    expect(s.showSupport).toBe(false);
    expect(s.line).toMatch(/dos semanas/);
  });

  it("una semana difícil aislada, o con un hueco en medio, no insiste", () => {
    expect(
      pulseSummary(
        [
          { week: WEEK - 2, weather: "rainy" },
          { week: WEEK, weather: "rainy" },
        ],
        NOW,
      ).suggestHelp,
    ).toBe(false);
    expect(
      pulseSummary(
        [
          { week: WEEK - 1, weather: "rainy" },
          { week: WEEK, weather: "sunny" },
        ],
        NOW,
      ).suggestHelp,
    ).toBe(false);
  });

  it("una semana lluviosa después de una buena no insiste", () => {
    const s = pulseSummary(
      [
        { week: WEEK - 1, weather: "sunny" },
        { week: WEEK, weather: "rainy" },
      ],
      NOW,
    );
    expect(s.suggestHelp).toBe(false);
    expect(s.line).toBe(WEATHER_META.rainy.reply);
  });

  it("nunca regaña, puntúa ni diagnostica", () => {
    const texts = [...Object.values(WEATHER_META).map((m) => m.reply), STORM_SUPPORT].join(" ");
    expect(texts).not.toMatch(
      /deberías|(?<!no )tienes que|culpa|puntaje|\/10|depresi|ansiedad|burnout|diagn|trastorno/i,
    );
  });
});
