import { describe, expect, it } from "vitest";
import {
  HIGH_QUICK_TURNAROUNDS,
  HIGH_RUN_DAYS,
  HIGH_WEEK_HOURS,
  REFERENCE_WEEKLY_HOURS,
  WATCH_RUN_DAYS,
  WATCH_WEEK_HOURS,
  WORKLOAD_WEEKS,
  buildWorkloadReport,
  type WorkBooking,
  type WorkloadInsight,
} from "./proWorkload";
import { DAY, HOUR, NOW, bogota, mulberry32 } from "./intel.fixture";

const TODAY = bogota("2026-10-14T00:00:00"); // miércoles
let n = 0;
/** Servicio que empieza `dayOffset` días desde hoy a la hora indicada (Colombia) y dura `hours` horas. */
const shift = (dayOffset: number, hour = 8, hours = 6, status = "completed"): WorkBooking => ({
  id: `w${++n}`,
  status,
  scheduled_at: new Date(TODAY + dayOffset * DAY + hour * HOUR).toISOString(),
  duration_hours: hours,
});
const run = (days: number[], hour = 8, hours = 6, status = "completed") =>
  days.map((d) => shift(d, hour, hours, status));
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const report = (bookings: WorkBooking[], now = NOW) => buildWorkloadReport({ bookings, now });
const ids = (xs: WorkloadInsight[]) => xs.map((i) => i.id);
const find = (xs: WorkloadInsight[], id: string) => xs.find((i) => i.id === id);

describe("sin servicios", () => {
  it("todo en calma y hoy mismo es un buen día para descansar", () => {
    const r = report([]);
    expect(r.hasData).toBe(false);
    expect(r.level).toBe("ok");
    expect(ids(r.insights)).toEqual(["no_data"]);
    expect(r.run).toEqual({ length: 0, plannedDays: 0 });
    expect(r.nextRestDay).toMatchObject({ isToday: true, label: "miércoles 14 de octubre" });
    expect(r.weeks).toHaveLength(WORKLOAD_WEEKS);
    expect(r.weeks.every((w) => w.hours === 0 && w.services === 0)).toBe(true);
  });

  it("las solicitudes pendientes, canceladas o sin horas no pesan", () => {
    const r = report([
      shift(-1, 8, 6, "pending"),
      shift(-2, 8, 6, "cancelled"),
      shift(-3, 8, 0),
      { id: "x", status: "completed", scheduled_at: "no-es-fecha", duration_hours: 6 },
      { id: "y", status: "completed", scheduled_at: shift(-1).scheduled_at, duration_hours: "abc" },
    ]);
    expect(r.hasData).toBe(false);
    expect(r.last7Hours).toBe(0);
  });

  it("los servicios acordados (confirmado, en camino, en curso) sí cuentan", () => {
    const r = report([
      shift(1, 8, 6, "confirmed"),
      shift(2, 8, 6, "in_route"),
      shift(0, 6, 4, "in_progress"),
    ]);
    expect(r.hasData).toBe(true);
    expect(r.next7Hours).toBeGreaterThan(0);
  });

  it("lo que pasó hace más de 28 días ya no cuenta", () => {
    const r = report([shift(-40), shift(-35), shift(-29)]);
    expect(r.hasData).toBe(false);
  });
});

describe("semanas de lunes a domingo", () => {
  it("la semana actual incluye lo ya hecho y lo programado, y la serie son 5 semanas", () => {
    // lunes 12 (hecho), miércoles 14 hoy (en curso), viernes 16 (programado)
    const r = report([shift(-2), shift(0, 6, 6, "in_progress"), shift(2, 8, 6, "confirmed")]);
    const cur = r.weeks[r.weeks.length - 1];
    expect(cur.isCurrent).toBe(true);
    expect(cur.label).toBe("12 oct");
    expect(cur.services).toBe(3);
    expect(cur.hours).toBe(18);
    expect(r.weeks.slice(0, -1).every((w) => !w.isCurrent)).toBe(true);
  });

  it("las semanas anteriores cuentan solo lo que cae dentro de ellas", () => {
    const r = report([shift(-9), shift(-10), shift(-16)]); // lun 5 · dom 4 · sáb... semanas previas
    const labels = r.weeks.map((w) => w.label);
    expect(labels).toEqual(["14 sep", "21 sep", "28 sep", "5 oct", "12 oct"]);
    expect(r.weeks[3].hours).toBeGreaterThan(0);
  });

  it("alcanza para mostrar las semanas de hace casi un mes", () => {
    const r = report([shift(-24)]); // sábado 20 sep → semana del 14 sep
    expect(r.weeks[0].label).toBe("14 sep");
    expect(r.weeks[0].hours).toBe(6);
    expect(r.weeks[0].services).toBe(1);
  });

  it("un turno de noche que cruza al lunes reparte sus horas entre las dos semanas", () => {
    // domingo 11 oct 19:00 → lunes 12 oct 07:00: 5 h en la semana anterior, 7 h en la actual
    const r = report([
      {
        id: "n",
        status: "completed",
        scheduled_at: new Date(bogota("2026-10-11T19:00:00")).toISOString(),
        duration_hours: 12,
      },
    ]);
    expect(r.weeks[3].hours).toBe(5);
    expect(r.weeks[4].hours).toBe(7);
    expect(r.weeks[3].services + r.weeks[4].services).toBe(1);
  });
});

describe("días seguidos", () => {
  it("tres días seguidos no preocupan", () => {
    const r = report(run([-2, -1, 0]));
    expect(r.run.length).toBe(3);
    expect(r.level).toBe("ok");
    expect(ids(r.insights)).not.toContain("run_long");
  });

  it("5 días seguidos piden atención y 7 son «alto», con un día libre sugerido", () => {
    const five = report(run(range(-4, 0)));
    expect(WATCH_RUN_DAYS).toBe(5);
    expect(five.run.length).toBe(5);
    expect(five.level).toBe("watch");
    expect(find(five.insights, "run_long")?.severity).toBe("info");

    const seven = report(run(range(-6, 0)));
    expect(HIGH_RUN_DAYS).toBe(7);
    expect(seven.level).toBe("high");
    const i = find(seven.insights, "run_long")!;
    expect(i.severity).toBe("warn");
    expect(i.title).toBe("Llevas 7 días seguidos con servicios");
    expect(i.action).toMatch(/jueves 15 de octubre/);
  });

  it("si hoy no hay servicios, la racha se corta aunque ayer sí hubiera", () => {
    const r = report(run(range(-8, -1)));
    expect(r.run.length).toBe(0);
    expect(r.level).toBe("ok");
    expect(r.nextRestDay).toMatchObject({ isToday: true });
    expect(ids(r.insights)).not.toContain("run_long");
  });

  it("cuenta también los días programados hacia adelante y lo dice así", () => {
    const r = report(run(range(0, 6), 8, 6, "confirmed"));
    expect(r.run.length).toBe(7);
    expect(r.run.plannedDays).toBe(7);
    expect(find(r.insights, "run_long")?.title).toBe(
      "Tienes 7 días seguidos con servicios programados",
    );
    expect(r.level).toBe("high");
  });

  it("una visita de menos de una hora no convierte el día en día trabajado", () => {
    const short = run(range(-6, 0), 8, 0.5);
    const r = report(short);
    expect(r.run.length).toBe(0);
    expect(r.level).toBe("ok");
  });

  it("la racha se mide por días de Colombia: un turno de noche cuenta en los dos días que toca", () => {
    // noche de ayer a hoy (19:00 → 07:00) y otra de hoy a mañana
    const r = report([shift(-1, 19, 12), shift(0, 19, 12, "confirmed")]);
    expect(r.run.length).toBe(3); // ayer, hoy, mañana
  });

  it("el próximo día libre es el primero sin servicios y se nombra completo", () => {
    const r = report(run(range(0, 2), 8, 6, "confirmed"));
    expect(r.nextRestDay).toMatchObject({ isToday: false, label: "sábado 17 de octubre" });
  });

  it("si no hay ningún día libre en los próximos 7, se dice con claridad", () => {
    const r = report(run(range(0, 10), 8, 6, "confirmed"));
    expect(r.nextRestDay).toBeNull();
    expect(find(r.insights, "run_long")?.action).toMatch(/No tienes un día libre/);
  });

  it("un día libre hoy se celebra, no se pospone", () => {
    const r = report(run(range(-6, -1)));
    expect(r.nextRestDay?.isToday).toBe(true);
  });
});

describe("horas por semana", () => {
  it("arriba de 48 h en 7 días pide atención; arriba de 60 es «alto»", () => {
    const heavy = report(run(range(-6, -1), 6, 9)); // 6 × 9 = 54 h
    expect(heavy.last7Hours).toBe(54);
    expect(WATCH_WEEK_HOURS).toBe(48);
    expect(heavy.level).toBe("watch");
    const i = find(heavy.insights, "hours_week")!;
    expect(i.severity).toBe("info");
    expect(i.title).toBe("Trabajaste 54 h en los últimos 7 días");
    expect(i.detail).toContain(`${REFERENCE_WEEKLY_HOURS} h`);

    const brutal = report(run(range(-6, -1), 4, 11)); // 66 h
    expect(brutal.last7Hours).toBe(66);
    expect(HIGH_WEEK_HOURS).toBe(60);
    expect(brutal.level).toBe("high");
    expect(find(brutal.insights, "hours_week")?.severity).toBe("warn");
  });

  it("exactamente 60 h en 7 días piden atención, todavía no son «alto»", () => {
    const r = report(run(range(-6, -1), 6, 10)); // 6 × 10 = 60
    expect(r.last7Hours).toBe(60);
    expect(r.level).toBe("watch");
  });

  it("lo programado para mañana no cuenta como «trabajaste en los últimos 7 días»", () => {
    const r = report([...run(range(-3, -1), 6, 8), shift(1, 6, 10, "confirmed")]);
    expect(r.last7Hours).toBe(24);
    expect(r.next7Hours).toBe(10);
  });

  it("exactamente 48 h no cruza el umbral", () => {
    const r = report(run(range(-6, -1), 6, 8)); // 6 × 8 = 48
    expect(r.last7Hours).toBe(48);
    expect(ids(r.insights)).not.toContain("hours_week");
    expect(r.level).toBe("ok");
  });

  it("las horas programadas de los próximos 7 días pesan aparte y piden atención, no «alto»", () => {
    // 7 servicios de 10 h a las 04:00; el último solo cuenta hasta las 10:00 de hoy+7 (6 h): 6 × 10 + 6 = 66 h
    const r = report(run(range(1, 7), 4, 10, "confirmed"));
    expect(r.next7Hours).toBe(66);
    expect(r.run.length).toBe(0); // hoy no hay servicios: la racha empieza mañana
    expect(r.level).toBe("watch");
    const i = find(r.insights, "week_ahead")!;
    expect(i.title).toBe("Tienes 66 h programadas para los próximos 7 días");
    expect(i.severity).toBe("info");
  });

  it("exactamente 60 h programadas no cruzan el umbral", () => {
    const r = report(run(range(1, 6), 4, 10, "confirmed")); // 6 × 10 = 60 h
    expect(r.next7Hours).toBe(60);
    expect(ids(r.insights)).not.toContain("week_ahead");
    expect(r.level).toBe("ok");
  });
});

describe("descansos cortos y noches", () => {
  const pair = (day: number, gapH: number): WorkBooking[] => [
    shift(day, 6, 6), // 06:00–12:00
    shift(day, 12 + gapH, 4), // empieza `gapH` horas después de terminar el primero
  ];

  it("menos de 8 h entre turnos cuenta; exactamente 8 h no", () => {
    expect(report(pair(-3, 7.5)).quickTurnarounds).toBe(1);
    expect(report(pair(-3, 8)).quickTurnarounds).toBe(0);
    expect(report(pair(-3, 0)).quickTurnarounds).toBe(1); // turnos corridos
    expect(report(pair(-3, 12)).quickTurnarounds).toBe(0);
  });

  it("los descansos cortos de más de 7 días adelante todavía no se cuentan", () => {
    const far = (day: number) => pair(day, 4).map((b) => ({ ...b, status: "confirmed" }));
    expect(report([...far(9), ...far(10)]).quickTurnarounds).toBe(0);
    expect(report([...far(5), ...far(6)]).quickTurnarounds).toBe(2);
  });

  it("2 descansos cortos piden atención y 4 son «alto»", () => {
    const two = report([...pair(-5, 4), ...pair(-3, 4)]);
    expect(two.quickTurnarounds).toBe(2);
    expect(two.level).toBe("watch");
    expect(find(two.insights, "quick_turnarounds")?.severity).toBe("info");

    const four = report([...pair(-6, 4), ...pair(-5, 4), ...pair(-4, 4), ...pair(-3, 4)]);
    expect(four.quickTurnarounds).toBe(HIGH_QUICK_TURNAROUNDS);
    expect(four.level).toBe("high");
    expect(find(four.insights, "quick_turnarounds")?.severity).toBe("warn");
    expect(find(four.insights, "quick_turnarounds")?.title).toBe(
      "4 descansos de menos de 8 h entre turnos",
    );
  });

  it("un servicio largo que contiene a otro corto no esconde el descanso del siguiente", () => {
    const r = report([
      shift(-2, 6, 14), // 06:00–20:00
      shift(-2, 9, 2), // dentro del anterior (se cruza, pasado)
      shift(-2, 22, 4), // 22:00: solo 2 h después de que terminó el largo
    ]);
    expect(r.quickTurnarounds).toBe(1);
  });

  it("un turno de noche cuenta si pasa al menos 4 h entre las 19:00 y las 07:00", () => {
    const nights = (k: number) => range(-k, -1).map((d) => shift(d, 19, 12));
    expect(report(nights(3)).nightShifts7).toBe(3);
    expect(report(nights(3)).level).toBe("ok");
    const four = report(nights(4));
    expect(four.nightShifts7).toBe(4);
    expect(four.level).toBe("watch");
    expect(find(four.insights, "nights")?.title).toBe("4 turnos de noche en los últimos 7 días");
  });

  it("las noches programadas todavía no cuentan como «últimos 7 días»", () => {
    const r = report(range(1, 5).map((d) => shift(d, 19, 12, "confirmed")));
    expect(r.nightShifts7).toBe(0);
    expect(r.level).toBe("ok");
  });

  it("un turno de día no es de noche, y uno que solo roza la noche tampoco", () => {
    expect(report(run(range(-4, -1), 8, 10)).nightShifts7).toBe(0);
    // 17:00–21:00 pasa solo 2 h dentro de la noche
    expect(report(run(range(-4, -1), 17, 4)).nightShifts7).toBe(0);
    // 15:00–23:00 pasa 4 h dentro de la noche: cuenta
    expect(report(run(range(-4, -1), 15, 8)).nightShifts7).toBe(4);
  });

  it("los turnos de noche de hace más de 7 días no cuentan en «últimos 7 días»", () => {
    const r = report(range(-12, -8).map((d) => shift(d, 19, 12)));
    expect(r.nightShifts7).toBe(0);
  });
});

describe("cruces en la agenda", () => {
  it("avisa de servicios futuros que se cruzan, pero no de cruces del pasado", () => {
    const future = report([shift(1, 8, 6, "confirmed"), shift(1, 10, 6, "confirmed")]);
    expect(future.overlapsAhead).toBe(1);
    expect(find(future.insights, "overlap")?.severity).toBe("warn");
    expect(find(future.insights, "overlap")?.title).toBe(
      "1 servicio se cruza con otro en tu agenda",
    );

    const past = report([shift(-3, 8, 6), shift(-3, 10, 6)]);
    expect(past.overlapsAhead).toBe(0);
    expect(ids(past.insights)).not.toContain("overlap");
  });

  it("dos servicios consecutivos sin cruce no son un cruce", () => {
    const r = report([shift(2, 8, 4, "confirmed"), shift(2, 12, 4, "confirmed")]);
    expect(r.overlapsAhead).toBe(0);
  });

  it("varios cruces se cuentan en plural", () => {
    const r = report([
      shift(1, 8, 6, "confirmed"),
      shift(1, 10, 6, "confirmed"),
      shift(3, 8, 6, "confirmed"),
      shift(3, 11, 6, "confirmed"),
    ]);
    expect(r.overlapsAhead).toBe(2);
    expect(find(r.insights, "overlap")?.title).toBe("2 servicios se cruzan con otro en tu agenda");
  });
});

describe("buen equilibrio y turnos largos", () => {
  it("quien descansa se lo escucha: «buen equilibrio» con su promedio", () => {
    const r = report([...run([-12, -9, -5], 8, 6), ...run([-1], 8, 6)]);
    expect(r.level).toBe("ok");
    expect(r.restDays14).toBeGreaterThanOrEqual(3);
    const i = find(r.insights, "balanced")!;
    expect(i.severity).toBe("good");
    expect(i.title).toMatch(/descansaste \d+ de los últimos 14 días/);
  });

  it("no se felicita a quien está en atención o en alto", () => {
    const r = report(run(range(-6, 0)));
    expect(ids(r.insights)).not.toContain("balanced");
  });

  it("un turno de 16 h o más merece un recordatorio de descanso", () => {
    const r = report([shift(-2, 6, 24)]);
    expect(r.longestShiftHours).toBe(24);
    expect(find(r.insights, "long_shift")?.title).toBe("Tienes turnos de 24 h");
  });

  it("un turno de exactamente 16 h ya merece el recordatorio; uno de 15 h no", () => {
    expect(find(report([shift(-2, 6, 16)]).insights, "long_shift")?.title).toBe(
      "Tienes turnos de 16 h",
    );
    expect(ids(report([shift(-2, 6, 15)]).insights)).not.toContain("long_shift");
  });

  it("con solo 2 días de descanso en 14 todavía no se felicita el equilibrio", () => {
    // 4 días de trabajo, descanso, 4 de trabajo, descanso, 4 de trabajo: ninguna racha pasa de 4 días
    const days = [-14, -13, -12, -11, -9, -8, -7, -6, -4, -3, -2, -1];
    const r = report(run(days));
    expect(r.level).toBe("ok");
    expect(r.restDays14).toBe(2);
    expect(ids(r.insights)).not.toContain("balanced");
    // con un tercer día libre sí
    const three = report(run([-14, -13, -12, -11, -9, -8, -6, -5, -4, -2, -1]));
    expect(three.restDays14).toBe(3);
    expect(ids(three.insights)).toContain("balanced");
  });

  it("las horas de un servicio se limitan a 24 aunque el dato diga más", () => {
    const r = report([shift(-2, 6, 99)]);
    expect(r.longestShiftHours).toBe(24);
  });
});

describe("orden y forma de los hallazgos", () => {
  it("van de lo que preocupa a lo que alegra y sin repetirse", () => {
    const r = report([
      ...run(range(-6, 0)),
      shift(1, 8, 6, "confirmed"),
      shift(1, 10, 6, "confirmed"),
    ]);
    const order = { warn: 0, info: 1, good: 2 } as const;
    for (let i = 1; i < r.insights.length; i++)
      expect(order[r.insights[i - 1].severity]).toBeLessThanOrEqual(order[r.insights[i].severity]);
    expect(new Set(ids(r.insights)).size).toBe(r.insights.length);
  });

  it("con avisos de distinta gravedad, lo grave va primero", () => {
    // 7 noches seguidas: racha larga (warn) y muchos turnos de noche (info)
    const r = report(run(range(-6, 0), 19, 12));
    expect(ids(r.insights)).toEqual(expect.arrayContaining(["run_long", "nights"]));
    expect(r.insights[0].severity).toBe("warn");
    const firstInfo = r.insights.findIndex((i) => i.severity === "info");
    const lastWarn = r.insights.map((i) => i.severity).lastIndexOf("warn");
    expect(firstInfo).toBeGreaterThan(lastWarn);
  });

  it("el tono es de cuidado: sin culpa ni órdenes, y nunca habla de pagos ni de WhatsApp", () => {
    const r = report([
      ...run(range(-6, 0), 8, 11),
      ...range(-6, -1).map((d) => shift(d, 19, 12)),
      shift(1, 8, 6, "confirmed"),
      shift(1, 10, 6, "confirmed"),
    ]);
    const text = JSON.stringify(r.insights);
    expect(text).not.toMatch(/whatsapp|pago|pagar|cobr|debes|tienes que|culpa|irresponsable/i);
    expect(text).toMatch(/guía de bienestar|descans/i);
  });
});

describe("propiedades con datos al azar", () => {
  it("las cifras siempre son finitas, los niveles coherentes y el día libre realmente está libre", () => {
    const rnd = mulberry32(2026);
    const statuses = ["completed", "confirmed", "pending", "cancelled", "in_progress", "in_route"];
    for (let i = 0; i < 300; i++) {
      const bookings: WorkBooking[] = Array.from({ length: Math.floor(rnd() * 30) }, () => ({
        id: `r${++n}`,
        status: statuses[Math.floor(rnd() * statuses.length)],
        scheduled_at: new Date(NOW + (rnd() * 60 - 35) * DAY).toISOString(),
        duration_hours: rnd() < 0.05 ? -2 : Math.floor(rnd() * 30 * 10) / 10,
      }));
      const r = report(bookings);
      const text = JSON.stringify(r);
      expect(text).not.toMatch(/NaN|Infinity|undefined|\[object/);
      expect(r.weeks).toHaveLength(WORKLOAD_WEEKS);
      for (const w of r.weeks) {
        expect(w.hours).toBeGreaterThanOrEqual(0);
        expect(w.services).toBeGreaterThanOrEqual(0);
      }
      expect(r.last7Hours).toBeGreaterThanOrEqual(0);
      expect(r.next7Hours).toBeGreaterThanOrEqual(0);
      expect(r.run.length).toBeGreaterThanOrEqual(0);
      expect(r.run.plannedDays).toBeLessThanOrEqual(r.run.length);
      expect(r.restDays14).toBeLessThanOrEqual(14);
      expect(new Set(ids(r.insights)).size).toBe(r.insights.length);
      if (r.level === "high") expect(ids(r.insights).length).toBeGreaterThan(0);
      if (r.nextRestDay) {
        expect(r.nextRestDay.dayMs).toBeGreaterThanOrEqual(TODAY);
        expect(r.nextRestDay.dayMs).toBeLessThan(TODAY + 7 * DAY);
        // ese día no tiene ≥ 1 h de servicios
        const dayStart = r.nextRestDay.dayMs;
        let hours = 0;
        for (const b of bookings) {
          if (!["completed", "confirmed", "in_route", "in_progress"].includes(b.status)) continue;
          const dur = Math.min(24, Math.max(0, Number(b.duration_hours)));
          const s = Date.parse(b.scheduled_at);
          const e = s + dur * HOUR;
          hours += Math.max(0, Math.min(e, dayStart + DAY) - Math.max(s, dayStart)) / HOUR;
        }
        expect(hours).toBeLessThan(1 + 1e-9);
      }
    }
  });
});
