import { describe, expect, it } from "vitest";
import {
  average,
  bogotaDayIndex,
  bogotaMonthKey,
  bogotaYmd,
  countdownEs,
  dateEs,
  dayLabelEs,
  daysInMonth,
  median,
  monthLabelEs,
  msOf,
  num,
  numOrNull,
  pctOf,
  plural,
  prevMonthKey,
  round1,
  timeLabelEs,
} from "./familyIntelShared";
import { DAY, HOUR, NOW } from "./familyIntel.fixture";

describe("números seguros", () => {
  it("num acepta texto numérico y descarta lo que no es finito", () => {
    expect(num("150000.50")).toBe(150000.5);
    expect(num(7)).toBe(7);
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "abc",
      "1,5",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      [],
      [7],
      true,
      false,
    ]) {
      expect(num(bad as never)).toBe(0);
      expect(num(bad as never, 5)).toBe(5);
    }
  });

  it("numOrNull distingue «cero» de «sin dato»", () => {
    expect(numOrNull(0)).toBe(0);
    expect(numOrNull("0")).toBe(0);
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull("x")).toBeNull();
    expect(numOrNull("  ")).toBeNull();
    expect(numOrNull([])).toBeNull();
    expect(numOrNull(true)).toBeNull();
    expect(numOrNull(" 12 ")).toBe(12);
    expect(numOrNull(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("msOf devuelve NaN con fechas faltantes o dañadas", () => {
    expect(msOf("2026-10-14T15:00:00Z")).toBe(NOW);
    expect(Number.isNaN(msOf(null))).toBe(true);
    expect(Number.isNaN(msOf(undefined))).toBe(true);
    expect(Number.isNaN(msOf("no-es-fecha"))).toBe(true);
  });

  it("plural y redondeo", () => {
    expect(plural(1, "hora", "horas")).toBe("1 hora");
    expect(plural(0, "hora", "horas")).toBe("0 horas");
    expect(plural(2, "hora", "horas")).toBe("2 horas");
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-0.04)).toBe(-0);
  });

  it("porcentaje entero, promedio y mediana", () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(2, 3)).toBe(67);
    expect(pctOf(0, 5)).toBe(0);
    expect(pctOf(3, 0)).toBeNull();
    expect(average([])).toBeNull();
    expect(average([1, 2, 6])).toBe(3);
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("fechas de Colombia (UTC-5, sin horario de verano)", () => {
  it("año, mes y día locales; el día cambia a las 05:00 UTC", () => {
    expect(bogotaYmd(NOW)).toEqual({ y: 2026, m: 10, d: 14 });
    expect(bogotaYmd(Date.parse("2026-10-15T04:59:00Z"))).toEqual({ y: 2026, m: 10, d: 14 });
    expect(bogotaYmd(Date.parse("2026-10-15T05:00:00Z"))).toEqual({ y: 2026, m: 10, d: 15 });
    expect(bogotaYmd(Date.parse("2027-01-01T04:59:00Z"))).toEqual({ y: 2026, m: 12, d: 31 });
  });

  it("mes, mes anterior y días del mes (incluye bisiesto)", () => {
    expect(bogotaMonthKey(NOW)).toBe("2026-10");
    expect(bogotaMonthKey(Date.parse("2026-11-01T04:59:00Z"))).toBe("2026-10");
    expect(bogotaMonthKey(Date.parse("2026-11-01T05:00:00Z"))).toBe("2026-11");
    expect(prevMonthKey("2026-10")).toBe("2026-09");
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("etiquetas en español sin depender del ICU del equipo", () => {
    expect(monthLabelEs("2026-10")).toBe("oct 2026");
    expect(monthLabelEs("2026-01")).toBe("ene 2026");
    expect(dayLabelEs(NOW)).toBe("mié 14 oct");
    expect(dateEs(NOW)).toBe("14 oct 2026");
    expect(timeLabelEs(NOW)).toBe("10:00");
    expect(timeLabelEs(Date.parse("2026-10-15T05:05:00Z"))).toBe("00:05");
  });

  it("índice de día: «hoy» y «mañana» según Colombia, no UTC", () => {
    expect(bogotaDayIndex(NOW + 5 * HOUR) - bogotaDayIndex(NOW)).toBe(0);
    expect(bogotaDayIndex(Date.parse("2026-10-15T05:00:00Z")) - bogotaDayIndex(NOW)).toBe(1);
    expect(bogotaDayIndex(NOW + 2 * DAY) - bogotaDayIndex(NOW)).toBe(2);
  });
});

describe("cuenta regresiva", () => {
  const left = (ms: number) => countdownEs(NOW + ms, NOW);

  it("minutos, horas con minutos cuando queda poco, horas y días", () => {
    expect(left(30_000)).toBe("en 1 min");
    expect(left(25 * 60_000)).toBe("en 25 min");
    expect(left(59 * 60_000)).toBe("en 59 min");
    expect(left(60 * 60_000)).toBe("en 1 h");
    expect(left(90 * 60_000)).toBe("en 1 h 30 min");
    expect(left(2 * HOUR + 5 * 60_000)).toBe("en 2 h 5 min");
    expect(left(3 * HOUR)).toBe("en 3 h");
    expect(left(3 * HOUR + 40 * 60_000)).toBe("en 3 h");
    expect(left(47 * HOUR)).toBe("en 47 h");
    expect(left(48 * HOUR)).toBe("en 2 días");
    expect(left(5 * DAY + 3 * HOUR)).toBe("en 5 días");
  });

  it("lo vencido o dañado nunca da negativos ni NaN", () => {
    expect(left(0)).toBe("ya venció");
    expect(left(-5 * HOUR)).toBe("ya venció");
    expect(countdownEs(Number.NaN, NOW)).toBe("");
    expect(countdownEs(Number.POSITIVE_INFINITY, NOW)).toBe("");
  });
});
