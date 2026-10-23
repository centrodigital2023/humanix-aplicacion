import { describe, expect, it } from "vitest";
import {
  AGENDA_DAYS,
  NEW_PRO,
  STATUS_LABEL,
  agendaCsv,
  agendaIcs,
  agendaStatus,
  buildAgenda,
  csvCell,
  needsReminder,
  proReliability,
  reliabilityFor,
  reminderText,
  utilizationReport,
  type AgendaOfferShift,
} from "./instAgenda";
import type { InstBooking } from "./instData";
import { DAY, HOUR, NOW, bogota, iso } from "./intel.fixture";

// NOW: miércoles 14 de octubre de 2026, 10:00 en Colombia.
let seq = 0;
const bk = (over: Partial<InstBooking> & { at: number }): InstBooking => {
  const { at, ...rest } = over;
  return {
    id: `b${++seq}`,
    status: "confirmed",
    scheduled_at: new Date(at).toISOString(),
    duration_hours: 8,
    professional_id: "p1",
    ...rest,
  };
};
const shift = (over: Partial<AgendaOfferShift> & { at: number }): AgendaOfferShift => {
  const { at, ...rest } = over;
  return {
    id: `s${++seq}`,
    title: "Enfermería UCI",
    starts_at: new Date(at).toISOString(),
    ends_at: new Date(at + 8 * HOUR).toISOString(),
    positions: 2,
    filled: 0,
    status: "open",
    ...rest,
  };
};

describe("la semana en hora de Colombia", () => {
  it("son 7 días desde hoy, con hoy marcado", () => {
    const v = buildAgenda({ bookings: [], now: NOW });
    expect(v.days).toHaveLength(AGENDA_DAYS);
    expect(v.days[0]).toMatchObject({ isToday: true, label: "mié 14 oct" });
    expect(v.days[6].label).toBe("mar 20 oct");
    expect(v.days.slice(1).every((d) => !d.isToday)).toBe(true);
  });

  it("un turno de las 21:00 en Colombia es de ese día aunque en UTC ya sea el siguiente", () => {
    const v = buildAgenda({ bookings: [bk({ at: bogota("2026-10-14T21:00:00") })], now: NOW });
    expect(v.days[0].shifts).toHaveLength(1);
    expect(v.days[1].shifts).toHaveLength(0);
  });

  it("lo de ayer y lo de dentro de 7 días queda fuera", () => {
    const v = buildAgenda({
      bookings: [
        bk({ at: bogota("2026-10-13T23:00:00"), status: "completed" }),
        bk({ at: bogota("2026-10-21T08:00:00") }),
        bk({ at: bogota("2026-10-20T23:30:00") }),
      ],
      now: NOW,
    });
    expect(v.kpis.total).toBe(1);
    expect(v.days[6].shifts).toHaveLength(1);
  });

  it("ordena los turnos del día por hora y no repite filas", () => {
    const late = bk({ at: bogota("2026-10-15T19:00:00") });
    const early = bk({ at: bogota("2026-10-15T07:00:00") });
    const v = buildAgenda({ bookings: [late, early, late], now: NOW });
    expect(v.days[1].shifts.map((s) => s.id)).toEqual([early.id, late.id]);
  });
});

describe("estados reales y contadores (antes todo salía en cero)", () => {
  it("cuenta programados, en curso, completados, sin iniciar y cancelados por separado", () => {
    const v = buildAgenda({
      bookings: [
        bk({ at: bogota("2026-10-14T06:00:00"), status: "completed", completed_at: iso(-HOUR) }),
        bk({ at: bogota("2026-10-14T09:00:00"), status: "in_progress", started_at: iso(-HOUR) }),
        bk({ at: bogota("2026-10-14T07:00:00"), status: "confirmed" }), // 3 h sin iniciar
        bk({ at: bogota("2026-10-15T08:00:00"), status: "pending" }),
        bk({ at: bogota("2026-10-16T08:00:00"), status: "confirmed" }),
        bk({ at: bogota("2026-10-17T08:00:00"), status: "cancelled" }),
      ],
      now: NOW,
    });
    expect(v.kpis).toMatchObject({
      total: 5,
      scheduled: 2,
      inProgress: 1,
      completed: 1,
      noShows: 1,
      cancelled: 1,
    });
  });

  it("las horas del día no suman los cancelados", () => {
    const v = buildAgenda({
      bookings: [
        bk({ at: bogota("2026-10-15T08:00:00"), duration_hours: 6 }),
        bk({ at: bogota("2026-10-15T14:00:00"), duration_hours: 4, status: "cancelled" }),
      ],
      now: NOW,
    });
    expect(v.days[1].hours).toBe(6);
  });

  it("muestra «sin iniciar» y «sin cerrar» cuando ya se sabe, y si no el estado de la base de datos", () => {
    expect(agendaStatus(bk({ at: NOW - 3 * HOUR }), NOW)).toBe("no_show");
    expect(agendaStatus(bk({ at: NOW - HOUR }), NOW)).toBe("confirmed");
    expect(
      agendaStatus(bk({ at: NOW - 30 * HOUR, status: "in_progress", duration_hours: 8 }), NOW),
    ).toBe("unclosed");
    expect(agendaStatus(bk({ at: NOW, status: "raro" }), NOW)).toBe("pending");
    for (const s of Object.keys(STATUS_LABEL))
      expect(STATUS_LABEL[s as keyof typeof STATUS_LABEL]).toBeTruthy();
  });
});

describe("alertas que explican su motivo", () => {
  it("sin iniciar (no-show) es crítica y nombra a la persona", () => {
    const v = buildAgenda({
      bookings: [bk({ at: bogota("2026-10-14T07:00:00"), professional_id: "ana" })],
      names: { ana: "Ana María" },
      now: NOW,
    });
    expect(v.alerts[0]).toMatchObject({
      kind: "no_show",
      severity: "critical",
      title: "Turno de las 07:00 sin iniciar",
    });
    expect(v.alerts[0].detail).toContain("Ana María");
    expect(v.headline).toMatch(/sin iniciar: conviene actuar ya/);
  });

  it("si ya marcó llegada no es no-show", () => {
    const v = buildAgenda({
      bookings: [bk({ at: bogota("2026-10-14T07:00:00"), arrived_at: iso(-3 * HOUR) })],
      now: NOW,
    });
    expect(v.alerts).toHaveLength(0);
  });

  it("confirmado que empieza en menos de una hora y nadie va en camino", () => {
    const v = buildAgenda({ bookings: [bk({ at: NOW + 40 * 60_000 })], now: NOW });
    expect(v.alerts[0]).toMatchObject({
      kind: "not_on_way",
      severity: "high",
      title: "Empieza en 40 min y nadie va en camino",
    });
    const onWay = buildAgenda({
      bookings: [bk({ at: NOW + 40 * 60_000, status: "in_route" })],
      now: NOW,
    });
    expect(onWay.alerts).toHaveLength(0);
    // A más de una hora todavía no se avisa.
    expect(
      buildAgenda({ bookings: [bk({ at: NOW + 90 * 60_000 })], now: NOW }).alerts,
    ).toHaveLength(0);
  });

  it("sin confirmar a menos de 24 h es alerta; a más de 24 h todavía no", () => {
    const soon = buildAgenda({
      bookings: [bk({ at: NOW + 5 * HOUR, status: "pending" })],
      now: NOW,
    });
    expect(soon.alerts[0]).toMatchObject({
      kind: "unconfirmed_soon",
      title: "Sin confirmar y empieza en 5 h",
    });
    const later = buildAgenda({
      bookings: [bk({ at: NOW + 30 * HOUR, status: "pending" })],
      now: NOW,
    });
    expect(later.alerts).toHaveLength(0);
  });

  it("un turno que sigue «en curso» muy después de su fin pide cerrarlo", () => {
    const v = buildAgenda({
      bookings: [
        bk({
          at: bogota("2026-10-14T00:30:00"),
          status: "in_progress",
          duration_hours: 1,
          started_at: iso(-9 * HOUR),
        }),
      ],
      now: NOW + 4 * HOUR,
    });
    expect(v.alerts.map((a) => a.kind)).toEqual(["unclosed"]);
  });

  it("posiciones sin cubrir: urgentes a menos de 48 h, en observación después; llenas o pasadas no cuentan", () => {
    const v = buildAgenda({
      bookings: [],
      openShifts: [
        shift({ at: NOW + 20 * HOUR, positions: 3, filled: 1 }),
        shift({ at: NOW + 4 * DAY }),
        shift({ at: NOW + 2 * DAY, positions: 2, filled: 2 }),
        shift({ at: NOW - HOUR }),
        shift({ at: NOW + DAY, status: "cancelled" }),
      ],
      now: NOW,
    });
    expect(v.kpis.openPositions).toBe(4);
    expect(v.alerts.map((a) => [a.kind, a.severity])).toEqual([
      ["uncovered", "high"],
      ["uncovered", "watch"],
    ]);
    expect(v.alerts[0].title).toBe("2 posiciones sin cubrir · Enfermería UCI");
    expect(v.days[1].openPositions).toBe(2);
  });

  it("ordena por gravedad y luego por hora", () => {
    const v = buildAgenda({
      bookings: [
        bk({ at: NOW + 5 * HOUR, status: "pending" }),
        bk({ at: bogota("2026-10-14T07:00:00") }),
        bk({ at: NOW + 2 * HOUR, status: "pending" }),
      ],
      now: NOW,
    });
    expect(v.alerts.map((a) => a.kind)).toEqual([
      "no_show",
      "unconfirmed_soon",
      "unconfirmed_soon",
    ]);
    expect(v.alerts[1].at).toBeLessThan(v.alerts[2].at);
  });

  it("frases tranquilas cuando todo va bien", () => {
    expect(buildAgenda({ bookings: [], now: NOW }).headline).toBe(
      "Semana tranquila: no hay turnos en los próximos 7 días.",
    );
    expect(
      buildAgenda({ bookings: [bk({ at: NOW + 3 * HOUR, status: "in_route" })], now: NOW })
        .headline,
    ).toBe("Hoy hay 1 turno y todo va en orden.");
    expect(buildAgenda({ bookings: [bk({ at: NOW + 3 * DAY })], now: NOW }).headline).toBe(
      "Todo en orden para esta semana.",
    );
  });

  it("los títulos salen de la oferta y el riesgo solo si se pasa (plan)", () => {
    const b = bk({ at: NOW + 3 * DAY, job_offer_id: "o1" });
    const free = buildAgenda({ bookings: [b], titles: { o1: "Cuidado nocturno" }, now: NOW });
    expect(free.days[3].shifts[0]).toMatchObject({ title: "Cuidado nocturno", risk: null });
    const paid = buildAgenda({
      bookings: [b],
      reliability: reliabilityFor(["p1"], {}),
      now: NOW,
    });
    expect(paid.days[3].shifts[0].risk?.level).toBe("new");
  });
});

describe("confiabilidad por profesional (Institucional)", () => {
  const past = (daysAgo: number, over: Partial<InstBooking> = {}) =>
    bk({ at: NOW - daysAgo * DAY, status: "completed", ...over });

  it("un turno sin iniciar en 60 días es riesgo", () => {
    const r = proReliability([past(3, { status: "confirmed" }), past(5), past(6)], NOW);
    expect(r.p1).toMatchObject({ level: "risk", noShows: 1, completed: 2, due: 3 });
    expect(r.p1.reason).toBe("1 turno sin iniciar en 60 días.");
  });

  it("cancelaciones tardías del profesional: una es observación, dos son riesgo", () => {
    const lateCancel = (d: number) =>
      past(d, {
        status: "cancelled",
        cancel_reason: "Se me cruzó el horario",
        cancelled_at: new Date(NOW - d * DAY - 2 * HOUR).toISOString(),
      });
    expect(proReliability([lateCancel(2), past(4)], NOW).p1.level).toBe("watch");
    expect(proReliability([lateCancel(2), lateCancel(9)], NOW).p1.level).toBe("risk");
  });

  it("una cancelación con aviso amplio o una de la institución no cuenta en su contra", () => {
    const early = past(2, {
      status: "cancelled",
      cancel_reason: "Se me cruzó el horario",
      cancelled_at: new Date(NOW - 5 * DAY).toISOString(),
    });
    const byClient = past(3, { status: "cancelled", cancel_reason: "Cambió el horario" });
    const r = proReliability([early, byClient, past(4), past(5), past(6)], NOW);
    expect(r.p1).toMatchObject({ level: "reliable", lateCancels: 0, due: 4 });
  });

  it("puntualidad baja con suficientes registros es observación", () => {
    const late = (d: number) =>
      past(d, { arrived_at: new Date(NOW - d * DAY + 40 * 60_000).toISOString() });
    const r = proReliability(
      [late(1), late(2), late(3), past(4, { arrived_at: new Date(NOW - 4 * DAY).toISOString() })],
      NOW,
    );
    expect(r.p1).toMatchObject({ level: "watch", punctualPct: 25 });
  });

  it("con menos de 3 llegadas registradas no se juzga la puntualidad", () => {
    const late = (d: number) =>
      past(d, { arrived_at: new Date(NOW - d * DAY + 40 * 60_000).toISOString() });
    const r = proReliability([late(1), late(2), past(3), past(4)], NOW);
    expect(r.p1).toMatchObject({ punctualPct: null, level: "reliable" });
  });

  it("poco historial es «nuevo», y quien no tiene historial también", () => {
    expect(proReliability([past(2)], NOW).p1.level).toBe("new");
    expect(reliabilityFor(["zz"], {}).zz).toEqual({ proId: "zz", ...NEW_PRO });
  });

  it("lo de hace más de 60 días, lo futuro y lo sin confirmar no cuenta", () => {
    const r = proReliability(
      [past(61, { status: "confirmed" }), bk({ at: NOW + DAY }), past(2, { status: "pending" })],
      NOW,
    );
    expect(r.p1).toBeUndefined();
  });
});

describe("reporte de utilización de 30 días (Institucional)", () => {
  const past = (daysAgo: number, over: Partial<InstBooking> = {}) =>
    bk({ at: NOW - daysAgo * DAY, status: "completed", ...over });

  it("sin turnos lo dice, sin inventar porcentajes", () => {
    const r = utilizationReport([], NOW);
    expect(r).toMatchObject({
      committed: 0,
      completionPct: null,
      utilizationPct: null,
      busiestWeekday: null,
    });
    expect(r.insights).toEqual(["Aún no hay turnos para medir en los últimos 30 días."]);
  });

  it("cumplimiento, inasistencias y cancelaciones de cada parte", () => {
    const r = utilizationReport(
      [
        past(1),
        past(2),
        past(3),
        past(4, { status: "confirmed" }),
        past(5, { status: "cancelled", cancel_reason: "No puedo llegar (transporte)" }),
        past(6, { status: "cancelled", cancel_reason: "Ya no necesito el servicio" }),
        past(31),
        past(2, { status: "pending" }),
      ],
      NOW,
    );
    expect(r).toMatchObject({
      committed: 5,
      completed: 3,
      noShows: 1,
      proCancels: 1,
      clientCancels: 1,
      completionPct: 60,
      noShowPct: 20,
    });
    expect(r.insights[0]).toBe("Se cumplieron 3 de 5 turnos (60 %).");
    expect(r.insights[1]).toMatch(/inasistencias llegan al 20 %/);
  });

  it("horas registradas frente a contratadas, solo con ambos datos", () => {
    const worked = (d: number, h: number) =>
      past(d, {
        duration_hours: 8,
        started_at: new Date(NOW - d * DAY).toISOString(),
        completed_at: new Date(NOW - d * DAY + h * HOUR).toISOString(),
      });
    const r = utilizationReport([worked(1, 8), worked(2, 6), past(3)], NOW);
    expect(r).toMatchObject({ contractedHours: 16, workedHours: 14, utilizationPct: 88 });
    expect(r.insights.join(" ")).toMatch(/88 % de las horas contratadas: revisa los cierres/);
  });

  it("la puntualidad necesita al menos 3 llegadas registradas", () => {
    const arrived = (d: number, min: number) =>
      past(d, { arrived_at: new Date(NOW - d * DAY + min * 60_000).toISOString() });
    expect(utilizationReport([arrived(1, 40), arrived(2, 0)], NOW).punctualPct).toBeNull();
    expect(utilizationReport([arrived(1, 40), arrived(2, 0), arrived(3, 5)], NOW).punctualPct).toBe(
      67,
    );
  });

  it("el día con más turnos cumplidos (lunes = 0)", () => {
    // NOW es miércoles: hace 2 días fue lunes; hace 9, también.
    const r = utilizationReport([past(2), past(9), past(1)], NOW);
    expect(r.byWeekday[0]).toBe(2);
    expect(r.busiestWeekday).toBe(0);
    expect(r.insights.at(-1)).toBe("El día con más turnos cumplidos es el lunes.");
  });
});

describe("exportar y recordar", () => {
  const view = () =>
    buildAgenda({
      bookings: [
        bk({ at: bogota("2026-10-15T07:00:00"), professional_id: "ana", job_offer_id: "o1" }),
        bk({ at: bogota("2026-10-16T19:00:00"), status: "cancelled" }),
      ],
      names: { ana: "Ana, María" },
      titles: { o1: '=HYPERLINK("x")' },
      now: NOW,
    });

  it("CSV con encabezado, sin fórmulas peligrosas y con comillas escapadas", () => {
    const csv = agendaCsv(view());
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"Día","Hora","Fin","Turno","Profesional","Horas","Estado"');
    expect(lines[1]).toBe(
      '"jue 15 oct","07:00","15:00","\'=HYPERLINK(""x"")","Ana, María","8","Confirmado"',
    );
    expect(lines).toHaveLength(3);
    expect(csvCell("-5")).toBe(`"'-5"`);
    expect(csvCell(12)).toBe('"12"');
  });

  it("iCal válido: solo turnos activos, en UTC y con el texto escapado", () => {
    const ics = agendaIcs(view(), NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261015T120000Z");
    expect(ics).toContain("DTEND:20261015T200000Z");
    expect(ics).toContain('SUMMARY:=HYPERLINK("x") · Ana\\, María');
    expect(ics).not.toMatch(/tel|phone|direcci/i);
  });

  it("el recordatorio dice cuándo, usa solo el primer nombre y no habla de pagos", () => {
    const base = { title: "Enfermería UCI", professionalName: "Ana María Pérez" };
    expect(reminderText({ ...base, startsAt: bogota("2026-10-15T07:00:00") }, NOW)).toBe(
      "Hola Ana, te recordamos tu turno de Enfermería UCI mañana a las 07:00. Si algo cambia, avísanos por Humanix. ¡Gracias!",
    );
    expect(reminderText({ ...base, startsAt: bogota("2026-10-14T18:00:00") }, NOW)).toContain(
      "hoy a las 18:00",
    );
    expect(
      reminderText(
        { ...base, startsAt: bogota("2026-10-17T07:00:00"), professionalName: null },
        NOW,
      ),
    ).toMatch(/^Hola, te recordamos tu turno de Enfermería UCI el sáb 17 oct a las 07:00/);
    expect(reminderText({ ...base, startsAt: NOW + DAY }, NOW)).not.toMatch(
      /pago|\$|cop|transfer/i,
    );
  });

  it("se sugiere recordar solo lo que viene en las próximas 48 h y aún no arranca", () => {
    expect(needsReminder({ status: "confirmed", startsAt: NOW + 20 * HOUR }, NOW)).toBe(true);
    expect(needsReminder({ status: "pending", startsAt: NOW + 47 * HOUR }, NOW)).toBe(true);
    expect(needsReminder({ status: "confirmed", startsAt: NOW + 49 * HOUR }, NOW)).toBe(false);
    expect(needsReminder({ status: "in_route", startsAt: NOW + HOUR }, NOW)).toBe(false);
    expect(needsReminder({ status: "confirmed", startsAt: NOW - HOUR }, NOW)).toBe(false);
  });
});
