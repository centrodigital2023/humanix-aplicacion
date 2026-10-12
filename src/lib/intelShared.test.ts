import { describe, expect, it } from "vitest";
import {
  average,
  bogotaDayIndex,
  bogotaWeekday,
  bogotaMonthKey,
  bogotaYmd,
  chunk,
  countdownEs,
  dateEs,
  dayLabelEs,
  hoursEs,
  longDayLabelEs,
  daysInMonth,
  median,
  monthLabelEs,
  splitByBogotaDay,
  startOfBogotaDay,
  weekdayNameEs,
  whenEs,
  ageEs,
  inPeriod,
  joinEs,
  monthStartMs,
  periodPhrase,
  previousPeriod,
  resolvePeriod,
  msOf,
  num,
  numOrNull,
  pctOf,
  plural,
  prevMonthKey,
  round1,
  timeLabelEs,
} from "./intelShared";
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

describe("semana y días de Colombia", () => {
  const at = (local: string) => Date.parse(`${local}-05:00`);

  it("el lunes es el 0 y el domingo el 6, también cerca de la medianoche local", () => {
    expect(bogotaWeekday(at("2026-10-12T09:00:00"))).toBe(0); // lunes
    expect(bogotaWeekday(at("2026-10-14T09:00:00"))).toBe(2); // miércoles
    expect(bogotaWeekday(at("2026-10-18T23:59:59"))).toBe(6); // domingo, aunque en UTC ya sea lunes
    expect(bogotaWeekday(at("2026-10-19T00:00:00"))).toBe(0);
  });

  it("nombra los días y envuelve índices fuera de rango sin romper", () => {
    expect(weekdayNameEs(0)).toBe("lunes");
    expect(weekdayNameEs(2)).toBe("miércoles");
    expect(weekdayNameEs(6)).toBe("domingo");
    expect(weekdayNameEs(7)).toBe("lunes");
    expect(weekdayNameEs(-1)).toBe("domingo");
  });

  it("la medianoche de Colombia es a las 05:00 UTC", () => {
    expect(startOfBogotaDay(at("2026-10-14T15:30:00"))).toBe(at("2026-10-14T00:00:00"));
    expect(startOfBogotaDay(at("2026-10-14T00:00:00"))).toBe(at("2026-10-14T00:00:00"));
    expect(startOfBogotaDay(at("2026-10-14T23:59:59"))).toBe(at("2026-10-14T00:00:00"));
  });

  it("parte un turno de noche en dos tramos, uno por día", () => {
    const parts = splitByBogotaDay(at("2026-10-14T19:00:00"), at("2026-10-15T07:00:00"));
    expect(parts).toHaveLength(2);
    expect(parts[0].hours).toBe(5);
    expect(parts[1].hours).toBe(7);
    expect(parts[1].day - parts[0].day).toBe(1);
    expect(parts.reduce((n, p) => n + p.hours, 0)).toBe(12);
  });

  it("un turno dentro de un solo día es un solo tramo; uno de 24 h puede tocar dos días", () => {
    expect(splitByBogotaDay(at("2026-10-14T08:00:00"), at("2026-10-14T14:00:00"))).toHaveLength(1);
    const full = splitByBogotaDay(at("2026-10-14T08:00:00"), at("2026-10-15T08:00:00"));
    expect(full.map((p) => p.hours)).toEqual([16, 8]);
  });

  it("un turno que termina justo a medianoche no toca el día siguiente", () => {
    const parts = splitByBogotaDay(at("2026-10-14T18:00:00"), at("2026-10-15T00:00:00"));
    expect(parts).toHaveLength(1);
    expect(parts[0].hours).toBe(6);
  });

  it("intervalos inválidos no devuelven tramos", () => {
    expect(splitByBogotaDay(Number.NaN, 5)).toEqual([]);
    expect(splitByBogotaDay(10, 10)).toEqual([]);
    expect(splitByBogotaDay(20, 10)).toEqual([]);
  });
});

describe("día en frase corrida", () => {
  const at = (local: string) => Date.parse(`${local}-05:00`);

  it("nombra el día completo en hora de Colombia", () => {
    expect(longDayLabelEs(at("2026-10-18T12:00:00"))).toBe("domingo 18 de octubre");
    expect(longDayLabelEs(at("2026-01-01T00:30:00"))).toBe("jueves 1 de enero");
    expect(longDayLabelEs(at("2026-12-31T23:59:00"))).toBe("jueves 31 de diciembre");
  });

  it("a las 23:30 en Colombia sigue siendo ese día aunque en UTC ya sea el siguiente", () => {
    expect(longDayLabelEs(at("2026-10-14T23:30:00"))).toBe("miércoles 14 de octubre");
  });
});

describe("«cuándo» y «hace cuánto»", () => {
  const at = (local: string) => Date.parse(`${local}-05:00`);
  const now = at("2026-10-14T10:00:00");

  it("hoy, mañana y días siguientes, en hora de Colombia", () => {
    expect(whenEs(at("2026-10-14T15:00:00"), now)).toBe("hoy a las 15:00");
    expect(whenEs(at("2026-10-15T06:00:00"), now)).toBe("mañana a las 06:00");
    expect(whenEs(at("2026-10-16T10:00:00"), now)).toBe("vie 16 oct a las 10:00");
  });

  it("23:30 sigue siendo «hoy» y 00:30 ya es «mañana», aunque en UTC sea otro día", () => {
    expect(whenEs(at("2026-10-14T23:30:00"), now)).toBe("hoy a las 23:30");
    expect(whenEs(at("2026-10-15T00:30:00"), now)).toBe("mañana a las 00:30");
  });

  it("algo que ya pasó se dice «hoy» (no inventa un ayer)", () => {
    expect(whenEs(at("2026-10-14T08:00:00"), now)).toBe("hoy a las 08:00");
  });

  it("la edad usa horas hasta 48 h y días después, sin negativos", () => {
    expect(ageEs(now - 10 * 60_000, now)).toBe("hace menos de una hora");
    expect(ageEs(now - 3 * 3_600_000, now)).toBe("hace 3 h");
    expect(ageEs(now - 47 * 3_600_000, now)).toBe("hace 47 h");
    expect(ageEs(now - 72 * 3_600_000, now)).toBe("hace 3 días");
    expect(ageEs(now + 3_600_000, now)).toBe("hace menos de una hora");
  });
});

describe("periodos de informe", () => {
  const at = (local: string) => Date.parse(`${local}-05:00`);
  const now = at("2026-10-14T10:00:00");

  it("el inicio de un mes es la medianoche de Colombia, no la de UTC", () => {
    expect(monthStartMs("2026-10")).toBe(Date.parse("2026-10-01T00:00:00-05:00"));
    expect(monthStartMs("2026-10")).toBe(Date.parse("2026-10-01T05:00:00Z"));
    expect(monthStartMs("2026-01")).toBe(Date.parse("2026-01-01T05:00:00Z"));
  });

  it("30 y 90 días son ventanas móviles que terminan ahora", () => {
    expect(resolvePeriod("30d", now)).toEqual({
      key: "30d",
      from: now - 30 * DAY,
      to: now,
      label: "Últimos 30 días",
    });
    const p = resolvePeriod("90d", now);
    expect(p.to - p.from).toBe(90 * DAY);
    expect(p.label).toBe("Últimos 90 días");
  });

  it("«mes pasado» es el mes calendario anterior completo, en hora de Colombia", () => {
    const p = resolvePeriod("last_month", now);
    expect(p.from).toBe(Date.parse("2026-09-01T00:00:00-05:00"));
    expect(p.to).toBe(Date.parse("2026-10-01T00:00:00-05:00"));
    expect(p.label).toBe("Mes pasado (sep 2026)");
    expect(p.to - p.from).toBe(30 * DAY);
  });

  it("«mes pasado» cruza el cambio de año y respeta febrero", () => {
    const jan = resolvePeriod("last_month", at("2026-01-15T10:00:00"));
    expect(jan.from).toBe(Date.parse("2025-12-01T00:00:00-05:00"));
    expect(jan.to).toBe(Date.parse("2026-01-01T00:00:00-05:00"));
    expect(jan.label).toBe("Mes pasado (dic 2025)");
    const mar = resolvePeriod("last_month", at("2026-03-02T10:00:00"));
    expect(mar.to - mar.from).toBe(28 * DAY);
  });

  it("a las 23:30 del último día del mes el «mes pasado» todavía es el anterior, no el recién terminado", () => {
    const p = resolvePeriod("last_month", at("2026-10-31T23:30:00"));
    expect(p.label).toBe("Mes pasado (sep 2026)");
    // 00:30 del 1 de noviembre en Colombia ya es otro mes
    expect(resolvePeriod("last_month", at("2026-11-01T00:30:00")).label).toBe(
      "Mes pasado (oct 2026)",
    );
  });

  it("el periodo anterior tiene la misma duración y termina donde empieza el actual", () => {
    for (const key of ["30d", "90d"] as const) {
      const p = resolvePeriod(key, now);
      const prev = previousPeriod(p);
      expect(prev.to).toBe(p.from);
      expect(prev.to - prev.from).toBe(p.to - p.from);
    }
    expect(previousPeriod(resolvePeriod("30d", now)).label).toBe("Los 30 días anteriores");
  });

  it("el mes anterior al «mes pasado» es el mes calendario previo, con su propia duración", () => {
    const prev = previousPeriod(resolvePeriod("last_month", now));
    expect(prev.from).toBe(Date.parse("2026-08-01T00:00:00-05:00"));
    expect(prev.to).toBe(Date.parse("2026-09-01T00:00:00-05:00"));
    expect(prev.to - prev.from).toBe(31 * DAY);
    expect(prev.label).toBe("Mes anterior (ago 2026)");
    const jan = previousPeriod(resolvePeriod("last_month", at("2026-02-10T10:00:00")));
    expect(jan.from).toBe(Date.parse("2025-12-01T00:00:00-05:00"));
  });

  it("la duración del periodo anterior se redondea a días enteros", () => {
    const custom = { key: "30d" as const, from: now - 7.5 * DAY, to: now, label: "x" };
    expect(previousPeriod(custom).label).toBe("Los 8 días anteriores");
  });

  it("el inicio cuenta, el fin no, y un instante dañado nunca cuenta", () => {
    const p = resolvePeriod("last_month", now);
    expect(inPeriod(p.from, p)).toBe(true);
    expect(inPeriod(p.from - 1, p)).toBe(false);
    expect(inPeriod(p.to - 1, p)).toBe(true);
    expect(inPeriod(p.to, p)).toBe(false);
    expect(inPeriod(Number.NaN, p)).toBe(false);
    expect(inPeriod(Number.POSITIVE_INFINITY, p)).toBe(false);
  });
});

describe("unir frases", () => {
  it("una sola, dos y varias, con «y» antes de la última", () => {
    expect(joinEs([])).toBe("");
    expect(joinEs(["a"])).toBe("a");
    expect(joinEs(["a", "b"])).toBe("a y b");
    expect(joinEs(["a", "b", "c"])).toBe("a, b y c");
    expect(joinEs(["a", "b", "c", "d"])).toBe("a, b, c y d");
  });
});

describe("el periodo dentro de una frase", () => {
  const now = Date.parse("2026-10-14T15:00:00Z");
  it("las ventanas móviles son «los últimos…» y el mes pasado, «el mes pasado»", () => {
    expect(periodPhrase(resolvePeriod("30d", now))).toBe("los últimos 30 días");
    expect(periodPhrase(resolvePeriod("90d", now))).toBe("los últimos 90 días");
    expect(periodPhrase(resolvePeriod("last_month", now))).toBe("el mes pasado (sep 2026)");
  });
});

describe("horas en español", () => {
  it("usa coma decimal, como se escribe en Colombia", () => {
    expect(hoursEs(70.7)).toBe("70,7");
    expect(hoursEs(5.5)).toBe("5,5");
    expect(hoursEs(0.25)).toBe("0,25");
  });

  it("no agrega decimales que sobran", () => {
    expect(hoursEs(72)).toBe("72");
    expect(hoursEs(0)).toBe("0");
    expect(hoursEs(6.0)).toBe("6");
  });

  it("redondea a dos decimales y limpia el ruido de la coma flotante", () => {
    expect(hoursEs(5.583333333)).toBe("5,58");
    expect(hoursEs(0.1 + 0.2)).toBe("0,3");
    expect(hoursEs(2.005)).toBe("2,01");
    expect(hoursEs(0.004)).toBe("0");
  });

  it("deja los miles sin separador (es una cantidad de horas, no de pesos)", () => {
    expect(hoursEs(1234.5)).toBe("1234,5");
  });
});

describe("grupos de una lista", () => {
  it("parte en grupos del tamaño pedido y deja el resto en el último", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("una lista vacía no da grupos", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("un tamaño absurdo no cuelga ni pierde elementos", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2, 3], -4)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2, 3], 1.9)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2, 3], Number.NaN).flat()).toEqual([1, 2, 3]);
  });

  it("no cambia el orden ni modifica la lista original", () => {
    const xs = Array.from({ length: 250 }, (_, i) => i);
    const copy = [...xs];
    const groups = chunk(xs, 100);
    expect(groups.map((g) => g.length)).toEqual([100, 100, 50]);
    expect(groups.flat()).toEqual(xs);
    expect(xs).toEqual(copy);
  });
});
