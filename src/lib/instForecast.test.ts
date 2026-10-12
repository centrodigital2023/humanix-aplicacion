import { describe, expect, it } from "vitest";
import {
  HISTORY_DAYS,
  HORIZON_DAYS,
  PART_LABEL,
  PATTERN_MIN_GAPS,
  PATTERN_MIN_WEEKS,
  URGENT_HOURS,
  buildForecast,
  forecastHeadline,
  pluralWeekday,
  shiftPart,
  type ForecastInput,
} from "./instForecast";
import type { CoverageShiftInput } from "./institutionCoverage";
import { DAY, HOUR, NOW, bogota, mulberry32 } from "./intel.fixture";

const TODAY = bogota("2026-10-14T00:00:00"); // miércoles; son las 10:00
let seq = 0;

/** Turno que empieza `dayOffset` días desde hoy a la hora dada y dura `hours`. */
function shift(
  dayOffset: number,
  hour: number,
  hours: number,
  over: Partial<CoverageShiftInput> = {},
): CoverageShiftInput {
  const start = TODAY + dayOffset * DAY + hour * HOUR;
  const id = `s${++seq}`;
  return {
    offerId: "o1",
    title: "Auxiliar UCI",
    serviceArea: null,
    specialty: null,
    city: "Bogotá",
    modality: "shift",
    amount: 180_000,
    isUrgent: false,
    shiftId: id,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + hours * HOUR).toISOString(),
    positions: 1,
    filled: 0,
    applicants: 0,
    awaitingResponse: 0,
    oldestWaitingAt: null,
    ...over,
  };
}
const run = (inputs: CoverageShiftInput[], over: Partial<ForecastInput> = {}) =>
  buildForecast({ inputs, now: NOW, ...over });
const ids = (r: ReturnType<typeof run>) => r.insights.map((i) => i.id);

describe("franjas del día y nombres de días", () => {
  it("noche de 19:00 a 06:59, mañana hasta las 12:59 y tarde hasta las 18:59, en hora de Colombia", () => {
    const at = (h: string) => bogota(`2026-10-14T${h}:00`);
    expect(shiftPart(at("18:59"))).toBe("afternoon");
    expect(shiftPart(at("19:00"))).toBe("night");
    expect(shiftPart(at("06:59"))).toBe("night");
    expect(shiftPart(at("07:00"))).toBe("morning");
    expect(shiftPart(at("12:59"))).toBe("morning");
    expect(shiftPart(at("13:00"))).toBe("afternoon");
    expect(shiftPart(at("00:00"))).toBe("night");
  });

  it("en plural, los días que ya terminan en «s» no cambian", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(pluralWeekday)).toEqual([
      "los lunes",
      "los martes",
      "los miércoles",
      "los jueves",
      "los viernes",
      "los sábados",
      "los domingos",
    ]);
  });

  it("cada franja tiene su texto", () => {
    expect(PART_LABEL).toEqual({
      morning: "por la mañana",
      afternoon: "por la tarde",
      night: "por la noche",
    });
  });
});

describe("calendario de los próximos 14 días", () => {
  it("siempre hay 14 días, empezando hoy a la medianoche de Colombia", () => {
    const r = run([]);
    expect(r.days).toHaveLength(HORIZON_DAYS);
    expect(r.days[0]).toMatchObject({ dayMs: TODAY, label: "mié 14 oct", isToday: true });
    expect(r.days[1]).toMatchObject({ label: "jue 15 oct", isToday: false });
    expect(r.days[13].label).toBe("mar 27 oct");
    expect(r.days.every((d) => d.risk === "none" && d.shifts === 0)).toBe(true);
  });

  it("reparte los turnos por el día de Colombia en que empiezan", () => {
    const r = run([shift(1, 8, 6), shift(1, 20, 12, { positions: 2, filled: 1 }), shift(3, 8, 6)]);
    expect(r.days[1]).toMatchObject({ shifts: 2, positions: 3, filled: 1, open: 2 });
    expect(r.days[1].openHours).toBe(6 + 12); // 1 cupo de 6 h + 1 cupo de 12 h
    expect(r.days[1].totalHours).toBe(6 + 24);
    expect(r.days[3].shifts).toBe(1);
    expect(r.days[2].shifts).toBe(0);
  });

  it("un turno de noche que cruza la medianoche cuenta en el día en que empieza", () => {
    const r = run([shift(1, 19, 12)]); // 19:00 → 07:00 del día siguiente
    expect(r.days[1].shifts).toBe(1);
    expect(r.days[2].shifts).toBe(0);
  });

  it("un turno que empezó ayer y sigue hoy cuenta hoy; uno ya terminado, no", () => {
    const running = shift(-1, 20, 18, { positions: 1 }); // ayer 20:00 → hoy 14:00
    const r = run([running, shift(-1, 8, 6)]);
    expect(r.days[0].shifts).toBe(1);
    expect(r.totals.shifts).toBe(1);
  });

  it("lo que empieza después del día 14 no entra", () => {
    const r = run([shift(HORIZON_DAYS - 1, 8, 6), shift(HORIZON_DAYS, 8, 6)]);
    expect(r.totals.shifts).toBe(1);
    expect(r.days[13].shifts).toBe(1);
  });

  it("un cupo cubierto de más no suma cubiertos por encima de los cupos", () => {
    const r = run([shift(2, 8, 6, { positions: 1, filled: 3 })]);
    expect(r.days[2]).toMatchObject({ positions: 1, filled: 1, open: 0 });
  });

  it("horas dañadas no rompen el calendario", () => {
    const r = run([shift(2, 8, 6, { startsAt: "x", endsAt: "y" }), shift(2, 8, 0)]);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});

describe("bordes del calendario", () => {
  it("un turno que empieza justo a la medianoche del día 15 ya no entra; un minuto antes, sí", () => {
    const edge = (offset: number) =>
      shift(0, 0, 6, {
        startsAt: new Date(TODAY + HORIZON_DAYS * DAY + offset).toISOString(),
        endsAt: new Date(TODAY + HORIZON_DAYS * DAY + offset + 6 * HOUR).toISOString(),
      });
    expect(run([edge(0)]).totals.shifts).toBe(0);
    const before = run([edge(-60_000)]);
    expect(before.totals.shifts).toBe(1);
    expect(before.days[HORIZON_DAYS - 1].shifts).toBe(1);
  });

  it("con otro horizonte las semanas se nombran hasta el último día", () => {
    const r = run([shift(1, 8, 6), shift(8, 8, 6)], { horizonDays: 10 });
    expect(r.days).toHaveLength(10);
    expect(r.weeks.map((w) => w.label)).toEqual(["Próximos 7 días", "Días 8 al 10"]);
    expect(r.weeks[1].shifts).toBe(1);
    expect(forecastHeadline(r, 10)).toContain("Próximos 10 días");
  });
});

describe("historial: bordes", () => {
  it("un turno que terminó justo ahora ya es historia; uno que termina un instante después, todavía no", () => {
    const ends = (offset: number) =>
      shift(0, 0, 6, {
        startsAt: new Date(NOW - 6 * HOUR + offset).toISOString(),
        endsAt: new Date(NOW + offset).toISOString(),
        positions: 1,
        filled: 0,
      });
    expect(run([ends(0)]).history.shifts).toBe(1);
    expect(run([ends(1)]).history.shifts).toBe(0);
  });

  it("un turno que empezó justo hace 8 semanas todavía cuenta; un instante antes, no", () => {
    const starts = (offset: number) =>
      shift(0, 0, 6, {
        startsAt: new Date(NOW - HISTORY_DAYS * DAY + offset).toISOString(),
        endsAt: new Date(NOW - HISTORY_DAYS * DAY + offset + 6 * HOUR).toISOString(),
      });
    expect(run([starts(0)]).history.shifts).toBe(1);
    expect(run([starts(-1)]).history.shifts).toBe(0);
  });

  it("lo que viene no entra al historial", () => {
    const r = run([shift(3, 8, 6), shift(10, 20, 10)]);
    expect(r.history).toMatchObject({ shifts: 0, positions: 0, unfilled: 0 });
  });

  it("un turno con más cubiertos que cupos no resta cupos libres a los demás", () => {
    const rows = [
      shift(-3, 8, 6, { positions: 1, filled: 3 }), // cubierto de más
      shift(-4, 8, 6, { positions: 2, filled: 0 }),
    ];
    expect(run(rows).history).toMatchObject({ positions: 3, unfilled: 2 });
  });

  it("el patrón no mezcla franjas ni días distintos", () => {
    const sat = (i: number, hour: number, filled: number) =>
      shift(-4 - 7 * i, hour, 6, { positions: 1, filled });
    // sábados por la noche: 3 sin cubrir de 3; sábados por la mañana: 3 cubiertos; domingos por la noche: 3 cubiertos
    const rows = [
      ...[0, 1, 2].map((i) => sat(i, 20, 0)),
      ...[0, 1, 2].map((i) => sat(i, 8, 1)),
      ...[0, 1, 2].map((i) => shift(-3 - 7 * i, 20, 6, { positions: 1, filled: 1 })),
    ];
    const r = run(rows);
    expect(r.pattern).toMatchObject({ weekday: 5, part: "night", gapShifts: 3, totalShifts: 3 });
  });

  it("a igual número de turnos sin cubrir en el mismo día, gana la franja más temprana", () => {
    const sat = (i: number, hour: number) => shift(-4 - 7 * i, hour, 6, { positions: 1 });
    const rows = [...[0, 1, 2].map((i) => sat(i, 20)), ...[0, 1, 2].map((i) => sat(i, 8))];
    expect(run(rows).pattern).toMatchObject({ weekday: 5, part: "morning" });
  });
});

describe("riesgo de cada día", () => {
  it("toma el peor riesgo entre los turnos con cupos libres", () => {
    // mañana a las 08:00: empieza en 22 h sin postulantes → crítico (≤ 24 h sin postulantes)
    const r = run([shift(1, 8, 6), shift(1, 16, 6, { applicants: 2 })]);
    expect(r.days[1].risk).toBe("critical");
  });

  it("un día con todo cubierto es «covered» y uno sin turnos, «none»", () => {
    const r = run([shift(2, 8, 6, { filled: 1 })]);
    expect(r.days[2].risk).toBe("covered");
    expect(r.days[3].risk).toBe("none");
  });

  it("un turno cubierto no oculta el riesgo de otro del mismo día", () => {
    const r = run([shift(1, 8, 6, { filled: 1 }), shift(1, 16, 6)]);
    expect(r.days[1].risk).toBe("high"); // mañana 16:00: en 30 h y sin postulantes
  });

  it("más lejos, con cupo libre y sin alertas, el día queda «ok» (abierto pero sin urgencia)", () => {
    const r = run([shift(8, 8, 6)]);
    expect(r.days[8].risk).toBe("ok");
    expect(r.days[8].open).toBe(1);
  });

  it("en 3 días sin postulantes es «vigilar»", () => {
    const r = run([shift(4, 8, 6)]); // ~94 h
    expect(r.days[4].risk).toBe("watch");
  });
});

describe("próximas 48 horas", () => {
  it("suma las horas de los cupos libres que empiezan en menos de 48 h", () => {
    const r = run([shift(1, 8, 6), shift(1, 20, 12, { positions: 2 }), shift(5, 8, 6)]);
    expect(r.next48).toEqual({ shifts: 2, openHours: 6 + 24 });
  });

  it("el límite es de 48 h exactas", () => {
    expect(URGENT_HOURS).toBe(48);
    const exactly = shift(0, 0, 6, {
      startsAt: new Date(NOW + 48 * HOUR).toISOString(),
      endsAt: new Date(NOW + 54 * HOUR).toISOString(),
    });
    const justAfter = shift(0, 0, 6, {
      startsAt: new Date(NOW + 48 * HOUR + 60_000).toISOString(),
      endsAt: new Date(NOW + 54 * HOUR).toISOString(),
    });
    expect(run([exactly]).next48.shifts).toBe(1);
    expect(run([justAfter]).next48.shifts).toBe(0); // un minuto después de las 48 h
  });

  it("un turno en curso con cupos libres cuenta como urgente", () => {
    const r = run([shift(0, 8, 8)]); // empezó a las 08:00, ahora 10:00
    expect(r.next48.shifts).toBe(1);
  });

  it("lo cubierto no cuenta", () => {
    expect(run([shift(1, 8, 6, { filled: 1 })]).next48).toEqual({ shifts: 0, openHours: 0 });
  });
});

describe("semanas y totales", () => {
  it("dos semanas, cada una con su cobertura", () => {
    const r = run([
      shift(1, 8, 6, { positions: 2, filled: 2 }),
      shift(2, 8, 6, { positions: 2, filled: 0 }),
      shift(9, 8, 6, { positions: 4, filled: 1 }),
    ]);
    expect(r.weeks).toHaveLength(2);
    expect(r.weeks[0]).toMatchObject({
      label: "Próximos 7 días",
      shifts: 2,
      positions: 4,
      filled: 2,
      coveragePct: 50,
    });
    expect(r.weeks[1]).toMatchObject({
      label: "Días 8 al 14",
      shifts: 1,
      positions: 4,
      filled: 1,
      coveragePct: 25,
    });
    expect(r.totals).toMatchObject({
      shifts: 3,
      positions: 8,
      filled: 3,
      open: 5,
      coveragePct: 38,
    });
  });

  it("sin cupos no hay porcentaje", () => {
    const r = run([]);
    expect(r.weeks.map((w) => w.coveragePct)).toEqual([null, null]);
    expect(r.totals.coveragePct).toBeNull();
    expect(r.hasData).toBe(false);
  });

  it("el último día de la primera semana es el 7 y el primero de la segunda, el 8", () => {
    const r = run([shift(6, 8, 6), shift(7, 8, 6)]);
    expect(r.weeks[0].shifts).toBe(1);
    expect(r.weeks[1].shifts).toBe(1);
  });
});

describe("horarios que se repiten sin cubrir", () => {
  /** Turnos de los sábados por la noche de las últimas `n` semanas; `gap` de ellos terminaron con cupos libres. */
  const saturdays = (n: number, gap: number) =>
    Array.from({ length: n }, (_, i) => {
      // el último sábado antes de hoy (miércoles 14): 10 oct, y así hacia atrás cada 7 días
      const offset = -4 - 7 * i;
      return shift(offset, 20, 10, { positions: 1, filled: i < gap ? 0 : 1 });
    });

  it("encuentra el horario con al menos 3 turnos sin cubrir, la mitad de los de esa franja y 3 semanas distintas", () => {
    const r = run(saturdays(6, 4));
    expect(r.pattern).toMatchObject({
      weekday: 5,
      part: "night",
      label: "los sábados por la noche",
      gapShifts: 4,
      totalShifts: 6,
      weeks: 4,
    });
    const i = r.insights.find((x) => x.id === "recurring_gap")!;
    expect(i.title).toBe("Los sábados por la noche suelen quedar sin cubrir");
    expect(i.detail).toBe(
      "4 de 6 turnos de ese horario terminaron con cupos libres en las últimas 8 semanas (4 semanas distintas).",
    );
    expect(i.severity).toBe("warn");
  });

  it("con 2 turnos sin cubrir todavía no es un patrón", () => {
    expect(PATTERN_MIN_GAPS).toBe(3);
    expect(run(saturdays(6, 2)).pattern).toBeNull();
    expect(run(saturdays(6, 3)).pattern).not.toBeNull();
  });

  it("si menos de la mitad de los turnos de esa franja quedaron sin cubrir, tampoco", () => {
    expect(run(saturdays(8, 3)).pattern).toBeNull(); // 3 de 8: 37 %
    expect(run(saturdays(7, 4)).pattern).not.toBeNull(); // 4 de 7: 57 %
    expect(run(saturdays(6, 3)).pattern).not.toBeNull(); // 3 de 6: 50 % exacto
  });

  it("exige que ocurra en 3 semanas distintas", () => {
    expect(PATTERN_MIN_WEEKS).toBe(3);
    // 3 turnos sin cubrir pero en solo 2 semanas distintas (dos sábados de la misma semana no existen: se usan sábado y domingo)
    const sameWeek = [
      shift(-4, 20, 10, { positions: 1 }),
      shift(-4, 21, 10, { positions: 1 }), // mismo sábado, misma franja
      shift(-11, 20, 10, { positions: 1 }),
    ];
    expect(run(sameWeek).pattern).toBeNull();
  });

  it("no mira más allá de 8 semanas", () => {
    const old = Array.from({ length: 4 }, (_, i) => shift(-(HISTORY_DAYS + 1) - 7 * i, 20, 10));
    expect(run(old).pattern).toBeNull();
    expect(run(old).history.shifts).toBe(0);
  });

  it("los turnos por venir no cuentan como historia", () => {
    expect(run([shift(3, 20, 10), shift(10, 20, 10), shift(17, 20, 10)]).pattern).toBeNull();
  });

  it("elige el horario con más turnos sin cubrir", () => {
    const sundays = Array.from({ length: 5 }, (_, i) => shift(-3 - 7 * i, 8, 6, { positions: 1 })); // domingos por la mañana
    const r = run([...saturdays(6, 3), ...sundays]);
    expect(r.pattern).toMatchObject({ weekday: 6, part: "morning", gapShifts: 5 });
  });

  it("a igual número de turnos sin cubrir, gana el día más temprano de la semana y luego la franja", () => {
    const sundays = Array.from({ length: 3 }, (_, i) => shift(-3 - 7 * i, 8, 6, { positions: 1 }));
    const r = run([...saturdays(3, 3), ...sundays]);
    expect(r.pattern?.weekday).toBe(5); // sábado antes que domingo
  });
});

describe("historial sin cubrir", () => {
  it("con menos de 10 cupos no hay porcentaje", () => {
    const rows = Array.from({ length: 9 }, (_, i) => shift(-1 - i, 8, 6));
    expect(run(rows).history.gapPct).toBeNull();
  });

  it("20 % o más sin cubrir se avisa (cuando no hay un patrón más específico)", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      shift(-1 - i, 8, 6, { positions: 1, filled: i < 2 ? 0 : 1 }),
    );
    const r = run(rows);
    expect(r.history).toMatchObject({ shifts: 10, positions: 10, unfilled: 2, gapPct: 20 });
    const i = r.insights.find((x) => x.id === "history_gap")!;
    expect(i.title).toBe("El 20 % de los cupos de las últimas 8 semanas terminó sin cubrir");
    const fewer = Array.from({ length: 10 }, (_, k) =>
      shift(-1 - k, 8, 6, { positions: 1, filled: k < 1 ? 0 : 1 }),
    );
    expect(ids(run(fewer))).not.toContain("history_gap");
  });

  it("si hay un patrón, se menciona el patrón y no el porcentaje general", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      shift(-4 - 7 * i, 20, 10, { positions: 1, filled: i < 5 ? 0 : 1 }),
    );
    const r = run(rows);
    expect(ids(r)).toContain("recurring_gap");
    expect(ids(r)).not.toContain("history_gap");
  });
});

describe("hallazgos", () => {
  it("sin turnos publicados lo dice y propone publicar", () => {
    const r = run([]);
    expect(ids(r)).toEqual(["no_shifts"]);
    expect(r.insights[0].detail).toContain("Cuando publiques turnos");
    const withHistory = run([shift(-3, 8, 6)]);
    expect(withHistory.insights.find((x) => x.id === "no_shifts")!.detail).toContain("más margen");
  });

  it("avisa lo urgente con las horas y los turnos", () => {
    const r = run([shift(1, 8, 6), shift(1, 16, 6)]);
    const i = r.insights.find((x) => x.id === "urgent_open")!;
    expect(i.title).toBe("12 h sin cubrir en las próximas 48 horas");
    expect(i.detail).toBe("2 turnos con cupos libres empiezan pronto.");
    expect(i.severity).toBe("warn");
  });

  it("los próximos 7 días por debajo de 70 % avisan, con al menos 4 cupos", () => {
    const rows = (filled: number) => [shift(2, 8, 6, { positions: 10, filled })];
    expect(ids(run(rows(6)))).toContain("week1_low"); // 60 %
    expect(ids(run(rows(7)))).not.toContain("week1_low"); // 70 %
    expect(ids(run([shift(2, 8, 6, { positions: 3, filled: 0 })]))).not.toContain("week1_low");
    expect(ids(run([shift(2, 8, 6, { positions: 4, filled: 0 })]))).toContain("week1_low");
  });

  it("la segunda semana por debajo de 50 % se menciona como información", () => {
    const r = run([shift(9, 8, 6, { positions: 10, filled: 4 })]);
    const i = r.insights.find((x) => x.id === "week2_low")!;
    expect(i.severity).toBe("info");
    expect(i.title).toBe("La segunda semana va por el 40 % cubierta");
    expect(ids(run([shift(9, 8, 6, { positions: 10, filled: 5 })]))).not.toContain("week2_low");
  });

  it("la segunda semana con exactamente 4 cupos ya se evalúa; con 3, no", () => {
    expect(ids(run([shift(9, 8, 6, { positions: 4, filled: 0 })]))).toContain("week2_low");
    expect(ids(run([shift(9, 8, 6, { positions: 3, filled: 0 })]))).not.toContain("week2_low");
  });

  it("con un solo cupo libre todavía no se dice que todo está cubierto", () => {
    const r = run([shift(2, 8, 6, { positions: 2, filled: 1 })]);
    expect(ids(r)).not.toContain("all_covered");
  });

  it("los textos cuentan bien: un turno urgente en singular y los cupos que faltan, no los totales", () => {
    const one = run([shift(1, 8, 6)]).insights.find((x) => x.id === "urgent_open")!;
    expect(one.detail).toBe("1 turno con cupos libres empieza pronto.");
    const week = run([shift(2, 8, 6, { positions: 10, filled: 6 })]).insights.find(
      (x) => x.id === "week1_low",
    )!;
    expect(week.title).toBe("Los próximos 7 días van por el 60 % cubiertos");
    expect(week.detail).toBe("Faltan 24 h por cubrir en 4 cupos.");
    const rows = Array.from({ length: 10 }, (_, i) =>
      shift(-1 - i, 8, 6, { positions: 1, filled: i < 2 ? 0 : 1 }),
    );
    expect(run(rows).insights.find((x) => x.id === "history_gap")!.detail).toBe(
      "2 cupos quedaron libres de 10.",
    );
  });

  it("aunque no haya turnos por venir, el patrón del historial va antes que el aviso informativo", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      shift(-4 - 7 * i, 20, 10, { positions: 1, filled: i < 5 ? 0 : 1 }),
    );
    expect(ids(run(rows))).toEqual(["recurring_gap", "no_shifts"]);
  });

  it("todo cubierto es una buena noticia y no hay avisos de falta", () => {
    const r = run([shift(2, 8, 6, { filled: 1 }), shift(9, 8, 6, { filled: 1 })]);
    expect(ids(r)).toEqual(["all_covered"]);
    expect(r.insights[0].severity).toBe("good");
  });

  it("los avisos van primero; lo bueno, al final", () => {
    const r = run([shift(1, 8, 6), shift(9, 8, 6, { positions: 10, filled: 2 })]);
    const sev = r.insights.map((i) => i.severity);
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) => ["warn", "info", "good"].indexOf(a) - ["warn", "info", "good"].indexOf(b),
      ),
    );
  });
});

describe("titular", () => {
  it("sin turnos, cubierto y con faltantes", () => {
    expect(forecastHeadline(run([]))).toBe("Sin turnos publicados para los próximos 14 días.");
    expect(forecastHeadline(run([shift(2, 8, 6, { filled: 1 })]))).toBe(
      "Los próximos 14 días están cubiertos.",
    );
    expect(forecastHeadline(run([shift(2, 8, 6, { positions: 2, filled: 1 })]))).toBe(
      "Próximos 14 días: 50 % cubierto, 6 h por cubrir.",
    );
  });
});

describe("propiedades con datos al azar", () => {
  it("no hay NaN, los días suman los totales y el riesgo es coherente", () => {
    const rand = mulberry32(5);
    for (let round = 0; round < 80; round++) {
      const n = Math.floor(rand() * 40);
      const inputs = Array.from({ length: n }, () => {
        const positions = 1 + Math.floor(rand() * 4);
        const hours = [0, 4, 6, 8, 12][Math.floor(rand() * 5)];
        return shift(Math.floor(rand() * 90) - 60, Math.floor(rand() * 24), hours, {
          positions,
          filled: Math.floor(rand() * (positions + 2)),
          applicants: Math.floor(rand() * 3),
          startsAt: rand() < 0.05 ? "x" : undefined,
        } as Partial<CoverageShiftInput>);
      }).map((s) => (s.startsAt === "x" ? { ...s, startsAt: "x" } : s));
      const r = buildForecast({ inputs, now: NOW });
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined/);
      expect(r.days).toHaveLength(HORIZON_DAYS);
      expect(r.days.reduce((s, d) => s + d.shifts, 0)).toBe(r.totals.shifts);
      expect(r.days.reduce((s, d) => s + d.positions, 0)).toBe(r.totals.positions);
      expect(r.totals.open).toBe(r.totals.positions - r.totals.filled);
      for (const d of r.days) {
        expect(d.open).toBeGreaterThanOrEqual(0);
        expect(d.filled).toBeLessThanOrEqual(d.positions);
        if (d.shifts === 0) expect(d.risk).toBe("none");
        if (d.shifts > 0 && d.open === 0) expect(d.risk).toBe("covered");
        if (d.open > 0) expect(["critical", "high", "watch", "ok"]).toContain(d.risk);
      }
      if (r.totals.coveragePct !== null) {
        expect(r.totals.coveragePct).toBeGreaterThanOrEqual(0);
        expect(r.totals.coveragePct).toBeLessThanOrEqual(100);
      }
      expect(r.next48.openHours).toBeLessThanOrEqual(r.totals.openHours + 0.1);
    }
  });
});

describe("horas con coma decimal", () => {
  it("el titular dice las horas por cubrir con coma", () => {
    expect(forecastHeadline(run([shift(2, 8, 5.5)]))).toBe(
      "Próximos 14 días: 0 % cubierto, 5,5 h por cubrir.",
    );
  });

  it("las horas sin cubrir de las próximas 48 h llevan coma", () => {
    const r = run([shift(1, 8, 5.5)]);
    expect(r.insights.find((i) => i.id === "urgent_open")!.title).toBe(
      "5,5 h sin cubrir en las próximas 48 horas",
    );
  });

  it("las horas por cubrir de cada semana llevan coma", () => {
    const first = run([shift(2, 8, 5.5, { positions: 5, filled: 2 })]); // 40 %: faltan 3 cupos
    expect(first.insights.find((i) => i.id === "week1_low")!.detail).toBe(
      "Faltan 16,5 h por cubrir en 3 cupos.",
    );
    const second = run([shift(9, 8, 5.5, { positions: 4, filled: 1 })]); // 25 %
    expect(second.insights.find((i) => i.id === "week2_low")!.detail).toContain(
      "Faltan 16,5 h por cubrir.",
    );
  });
});
