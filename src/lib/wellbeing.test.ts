import { describe, expect, it } from "vitest";
import {
  averageText,
  buildWellbeingReport,
  doctorSummary,
  type VitalSummary,
  type WellbeingBooking,
  type WellbeingLog,
} from "./wellbeing";
import type { CareMood } from "./careLog";
import {
  DAY,
  HOUR,
  NOW,
  bundle,
  careLog,
  iso,
  mulberry32,
  service,
  wBooking,
} from "./familyIntel.fixture";

const report = (
  data: { bookings: WellbeingBooking[]; logs: WellbeingLog[] },
  extra: { windowDays?: number; logsTruncated?: boolean } = {},
) => buildWellbeingReport({ ...data, now: NOW, ...extra });
const vital = (r: ReturnType<typeof report>, key: string): VitalSummary =>
  r.vitals.find((v) => v.key === key)!;

/** Cinco servicios en 20 días: un ánimo que baja, presión que sube y una alerta reciente. */
const week = () =>
  bundle(
    service(20, { id: "s1", mood: "calm", meds: 2, sys: 118, dia: 76, hr: 70 }),
    service(15, { id: "s2", mood: "calm", meds: 2, sys: 126, dia: 80, hr: 72 }),
    service(10, { id: "s3", mood: "tired", meds: 2, sys: 142, dia: 88, hr: 78 }),
    service(6, {
      id: "s4",
      mood: "pain",
      pro: "pro-2",
      proName: "Marta",
      sys: 150,
      dia: 92,
      hr: 84,
    }),
    service(3, {
      id: "s5",
      mood: "sad",
      meds: 2,
      pro: "pro-2",
      proName: "Marta",
      sys: 182,
      dia: 96,
      hr: 92,
      alert: "Presión muy alta",
    }),
  );

describe("sin servicios", () => {
  it("un solo mensaje que explica qué esperar", () => {
    const r = report({ bookings: [], logs: [] });
    expect(r.services.count).toBe(0);
    expect(r.highlights.map((h) => h.id)).toEqual(["no_services"]);
    expect(r.confidence).toBe("low");
    expect(r.vitals).toEqual([]);
    expect(r.moods.trend).toBe("unknown");
    expect(doctorSummary(r)).toMatch(/No hubo servicios con parte en este periodo/);
  });
});

describe("qué servicios entran", () => {
  it("terminados y en curso dentro del periodo; no los cancelados, los viejos ni los de más adelante", () => {
    const inRange = service(5, { id: "ok1" });
    const running = service(0, { id: "run", status: "in_progress" });
    const cancelled = service(4, { id: "can", status: "cancelled" });
    const pending = service(4, { id: "pen", status: "pending" });
    const old = service(45, { id: "old" });
    const future = service(-3, { id: "fut" }); // dentro de 3 días
    const soon = service(-0.2, { id: "soon", status: "in_progress" }); // empieza en ~5 h: ya puede estar en camino
    const r = report(bundle(inRange, running, cancelled, pending, old, future, soon));
    expect(r.services.count).toBe(3);
    expect(r.services.completed).toBe(1);
    expect(r.services.inProgress).toBe(2);
    expect(r.services.hours).toBe(18);
  });

  it("el periodo se puede acortar (7, 30 o 90 días) y se limita a valores razonables", () => {
    const data = bundle(
      service(3, { id: "a" }),
      service(20, { id: "b" }),
      service(60, { id: "c" }),
    );
    expect(report(data, { windowDays: 7 }).services.count).toBe(1);
    expect(report(data, { windowDays: 30 }).services.count).toBe(2);
    expect(report(data, { windowDays: 90 }).services.count).toBe(3);
    expect(report(data).period.days).toBe(30);
    expect(report(data, { windowDays: Number.NaN }).period.days).toBe(30);
    expect(report(data, { windowDays: 0 }).period.days).toBe(1);
    expect(report(data, { windowDays: 4000 }).period.days).toBe(365);
  });

  it("los registros de servicios fuera del periodo no cuentan", () => {
    const inRange = service(5, { id: "a", mood: "calm" });
    const outside = service(60, { id: "b", mood: "pain", alert: "Caída" });
    const r = report(bundle(inRange, outside));
    expect(r.moods.counts.pain).toBe(0);
    expect(r.alerts.total).toBe(0);
  });
});

describe("ánimo", () => {
  it("toma el último ánimo registrado de cada servicio y calcula porcentajes", () => {
    const r = report(week());
    expect(r.moods.withMood).toBe(5);
    expect(r.moods.counts).toMatchObject({
      calm: 2,
      tired: 1,
      pain: 1,
      sad: 1,
      happy: 0,
      agitated: 0,
    });
    expect(r.moods.positive).toBe(2);
    expect(r.moods.positivePct).toBe(40);
    expect(r.moods.negativePct).toBe(60);
    expect(r.moods.byService.map((m) => m.mood)).toEqual(["calm", "calm", "tired", "pain", "sad"]);
  });

  it("si un servicio tiene varios ánimos, vale el más reciente", () => {
    const s = service(5, { id: "a", mood: "calm" });
    s.logs.push(
      careLog({
        booking_id: "a",
        mood: "agitated",
        created_at: iso(-5 * DAY + 5.5 * HOUR),
        description: "Cierre",
      }),
    );
    const r = report(bundle(s));
    expect(r.moods.byService.map((m) => m.mood)).toEqual(["agitated"]);
  });

  it("el ánimo que viene en el registro automático de salida también cuenta", () => {
    const s = service(5, { id: "a" });
    const departure = s.logs.find((l) => l.event_type === "departure")!;
    departure.mood = "happy";
    expect(report(bundle(s)).moods.counts.happy).toBe(1);
  });

  const series = (moods: CareMood[]) =>
    bundle(...moods.map((m, i) => service(moods.length - i + 1, { id: `m${i}`, mood: m })));

  it("tendencia: mejora, empeora, se mantiene o no hay con qué decir", () => {
    expect(report(series(["pain", "pain", "tired", "calm", "happy", "happy"])).moods.trend).toBe(
      "better",
    );
    expect(report(series(["happy", "happy", "calm", "tired", "pain", "pain"])).moods.trend).toBe(
      "worse",
    );
    expect(report(series(["calm", "calm", "calm", "calm"])).moods.trend).toBe("stable");
    expect(report(series(["pain", "happy", "calm"])).moods.trend).toBe("unknown");
  });

  it("la frontera de la tendencia es exacta: medio punto", () => {
    // mitad antigua [calm, tired] = 0; mitad reciente [happy, tired] = 0,5 → mejora
    expect(report(series(["calm", "tired", "happy", "tired"])).moods.trend).toBe("better");
    // mitad reciente [calm, tired] = 0 → igual
    expect(report(series(["calm", "tired", "calm", "tired"])).moods.trend).toBe("stable");
    // mitad antigua [happy, tired] = 0,5; mitad reciente [calm, tired] = 0 → −0,5 exacto → empeora
    expect(report(series(["happy", "tired", "calm", "tired"])).moods.trend).toBe("worse");
    // mitad reciente [tired, tired] = −1 contra [calm, tired] = 0 → empeora
    expect(report(series(["calm", "tired", "tired", "tired"])).moods.trend).toBe("worse");
  });

  it("estados desconocidos y vacíos se ignoran", () => {
    const s = service(5, { id: "a", mood: "calm" });
    s.logs.push(
      careLog({ booking_id: "a", mood: "furioso", created_at: iso(-5 * DAY + 5.8 * HOUR) }),
    );
    s.logs.push(careLog({ booking_id: "a", mood: "", created_at: iso(-5 * DAY + 5.9 * HOUR) }));
    expect(report(bundle(s)).moods.byService.map((m) => m.mood)).toEqual(["calm"]);
  });
});

describe("signos vitales", () => {
  const r = report(week());

  it("presión arterial: promedio, extremos, última lectura y cuántas quedaron fuera de lo esperado", () => {
    expect(vital(r, "bp")).toMatchObject({
      label: "Presión arterial",
      unit: "mmHg",
      readings: 5,
      avg: 144,
      avg2: 86,
      min: 118,
      max: 182,
      watch: 2, // 142/88 y 150/92
      alert: 1, // 182/96
      trend: "up",
      concerning: true,
    });
    expect(vital(r, "bp").last).toMatchObject({ value: 182, value2: 96, level: "alert" });
    expect(vital(r, "bp").lastAlert).toMatchObject({ value: 182, value2: 96 });
    expect(averageText(vital(r, "bp"))).toBe("144/86 mmHg");
  });

  it("guarda la evolución de cada signo, de la lectura más antigua a la más reciente", () => {
    expect(vital(r, "bp").series).toEqual([118, 126, 142, 150, 182]);
    expect(vital(r, "heartRate").series).toEqual([70, 72, 78, 84, 92]);
  });

  it("la evolución guarda solo las últimas 24 lecturas", () => {
    const many = bundle(
      ...Array.from({ length: 30 }, (_, i) =>
        service(29 - i * 0.9, { id: `v${i}`, sys: 100 + i, dia: 70 }),
      ),
    );
    const s = vital(report(many, { windowDays: 90 }), "bp");
    expect(s.readings).toBe(30);
    expect(s.series).toHaveLength(24);
    expect(s.series[23]).toBe(129);
    expect(s.series[0]).toBe(106);
  });

  it("el pulso va al alza sin salirse de rango", () => {
    expect(vital(r, "heartRate")).toMatchObject({
      readings: 5,
      avg: 79,
      watch: 0,
      alert: 0,
      trend: "up",
      concerning: true,
    });
    expect(averageText(vital(r, "heartRate"))).toBe("79 lpm");
  });

  it("solo salen los signos que tienen lecturas", () => {
    expect(r.vitals.map((v) => v.key)).toEqual(["bp", "heartRate"]);
    expect(r.vitalReadings).toBe(10);
  });

  it("temperatura con un decimal; oxígeno bajando preocupa, subiendo no", () => {
    const down = report(
      bundle(
        service(12, { id: "a", temp: 36.4, spo2: 97 }),
        service(9, { id: "b", temp: 36.6, spo2: 96 }),
        service(6, { id: "c", temp: 36.8, spo2: 94 }),
        service(3, { id: "d", temp: 38.1, spo2: 92 }),
      ),
    );
    expect(vital(down, "temperature")).toMatchObject({
      avg: 37.0,
      watch: 1,
      alert: 0,
      trend: "up",
      concerning: true,
    });
    expect(vital(down, "oxygen")).toMatchObject({ trend: "down", concerning: true, watch: 1 }); // solo 92 % queda bajo 94
    const up = report(
      bundle(
        service(12, { id: "a", spo2: 92 }),
        service(9, { id: "b", spo2: 93 }),
        service(6, { id: "c", spo2: 96 }),
        service(3, { id: "d", spo2: 98 }),
      ),
    );
    expect(vital(up, "oxygen")).toMatchObject({ trend: "up", concerning: false });
  });

  it("con menos de 4 lecturas no hay tendencia", () => {
    const few = report(
      bundle(
        service(9, { id: "a", sys: 120, dia: 80 }),
        service(5, { id: "b", sys: 180, dia: 100 }),
        service(2, { id: "c", sys: 190, dia: 110 }),
      ),
    );
    expect(vital(few, "bp").trend).toBe("unknown");
    expect(vital(few, "bp").concerning).toBe(false);
  });

  it("una sola lectura a vigilar, sin tendencia, no genera hallazgo", () => {
    const r1 = report(
      bundle(
        service(9, { id: "a", sys: 120, dia: 78 }),
        service(5, { id: "b", sys: 150, dia: 92 }),
        service(2, { id: "c", sys: 121, dia: 79 }),
      ),
    );
    expect(vital(r1, "bp")).toMatchObject({ watch: 1, alert: 0, trend: "unknown" });
    expect(r1.highlights.some((h) => h.id === "vitals_bp")).toBe(false);
  });

  it("un cambio pequeño es «estable»", () => {
    const flat = report(
      bundle(
        service(12, { id: "a", sys: 120, dia: 78 }),
        service(9, { id: "b", sys: 124, dia: 80 }),
        service(6, { id: "c", sys: 121, dia: 79 }),
        service(3, { id: "d", sys: 125, dia: 80 }),
      ),
    );
    expect(vital(flat, "bp").trend).toBe("flat");
  });

  it("lo imposible se descarta, y la presión se resume por su sistólica", () => {
    const dirty = report(
      bundle(
        service(5, { id: "a", sys: 400, dia: 80, hr: 500, temp: 60, spo2: 140 }), // todo fuera de los límites de la base
        service(4, { id: "b", sys: null, dia: 85 }), // solo diastólica: no entra a la presión
        service(3, { id: "c", sys: 120, dia: null }), // la sistólica sola sí
      ),
    );
    expect(dirty.vitals.map((v) => v.key)).toEqual(["bp"]);
    expect(vital(dirty, "bp")).toMatchObject({ readings: 1, avg: 120, avg2: null });
    expect(averageText(vital(dirty, "bp"))).toBe("120 mmHg");
  });

  it("los registros automáticos no cuentan como lecturas", () => {
    const s = service(5, { id: "a" });
    s.logs.find((l) => l.event_type === "arrival")!.vital_systolic = 120;
    expect(report(bundle(s)).vitals).toEqual([]);
  });

  it("un registro generado por el sistema no cuenta, aunque lleve cifras y un tipo manual", () => {
    const s = service(5, { id: "a" });
    s.logs.push(
      careLog({
        booking_id: "a",
        event_type: "vital_signs",
        system_generated: true,
        vital_systolic: 190,
        vital_diastolic: 110,
        created_at: iso(-5 * DAY + 2 * HOUR),
      }),
    );
    expect(report(bundle(s)).vitals).toEqual([]);
  });

  it("lee las cifras como texto (así llega `numeric`)", () => {
    const s = service(5, { id: "a" });
    s.logs.push(
      careLog({
        booking_id: "a",
        event_type: "vital_signs",
        vital_temperature: "36.5",
        vital_heart_rate: "72",
        created_at: iso(-5 * DAY + 2 * HOUR),
      }),
    );
    const r2 = report(bundle(s));
    expect(vital(r2, "temperature").avg).toBe(36.5);
    expect(vital(r2, "heartRate").avg).toBe(72);
  });
});

describe("medicamentos", () => {
  it("avisa cuando casi siempre hay registro y un servicio no lo tiene", () => {
    const r = report(week());
    expect(r.medication).toEqual({
      withReport: 5,
      withRecords: 4,
      withoutRecords: 1,
      totalEvents: 8,
      gap: true,
    });
    const h = r.highlights.find((x) => x.id === "meds_gap")!;
    expect(h.title).toBe("1 servicio sin registro de medicamentos");
    expect(h.detail).toMatch(/4 de 5 servicios con parte/);
    expect(h.detail).toMatch(/no significa que no se haya dado/);
  });

  it("no avisa con pocos servicios con parte ni cuando casi nunca se registra", () => {
    const two = report(bundle(service(5, { id: "a", meds: 2 }), service(3, { id: "b" })));
    expect(two.medication.gap).toBe(false);
    const rare = report(
      bundle(
        service(9, { id: "a", meds: 1 }),
        service(7, { id: "b" }),
        service(5, { id: "c" }),
        service(3, { id: "d" }),
      ),
    );
    expect(rare.medication).toMatchObject({ withRecords: 1, withoutRecords: 3, gap: false });
  });

  it("la frontera es 60 %", () => {
    // 3 de 5 = 60 % → hay hueco; 2 de 5 = 40 % → no
    const mk = (withMeds: number) =>
      report(
        bundle(
          ...Array.from({ length: 5 }, (_, i) =>
            service(9 - i, { id: `x${i}`, meds: i < withMeds ? 1 : 0 }),
          ),
        ),
      );
    expect(mk(3).medication.gap).toBe(true);
    expect(mk(2).medication.gap).toBe(false);
    // 2 de 4 = 50 % tampoco alcanza
    const half = report(
      bundle(
        ...Array.from({ length: 4 }, (_, i) =>
          service(9 - i, { id: `y${i}`, meds: i < 2 ? 1 : 0 }),
        ),
      ),
    );
    expect(half.medication.gap).toBe(false);
  });
});

describe("alertas e incidentes", () => {
  it("cuenta alertas e incidentes, ordena de la más reciente y limita a 3", () => {
    const r = report(
      bundle(
        service(12, { id: "a", alert: "Se cayó de la cama" }),
        service(9, { id: "b", incident: "Mareo al levantarse" }),
        service(6, { id: "c", alert: "Fiebre" }),
        service(2, { id: "d", incident: "Rechazó los medicamentos" }),
      ),
    );
    expect(r.alerts.total).toBe(4);
    expect(r.alerts.last7d).toBe(2);
    expect(r.alerts.recent.map((a) => a.reason)).toEqual([
      "Rechazó los medicamentos",
      "Fiebre",
      "Mareo al levantarse",
    ]);
    expect(r.alerts.recent.map((a) => a.kind)).toEqual(["incident", "alert", "incident"]);
  });

  it("las alertas de la semana encabezan los hallazgos, con el motivo y el día", () => {
    const r = report(week());
    const h = r.highlights[0];
    expect(h).toMatchObject({
      id: "alerts_recent",
      severity: "alert",
      title: "Hubo 1 alerta o incidente en los últimos 7 días",
    });
    expect(h.detail).toBe("La más reciente: «Presión muy alta» (dom 11 oct).");
  });

  it("sin motivo escrito usa un texto neutro; los motivos largos se recortan", () => {
    const a = service(2, { id: "a", alert: "x" });
    a.logs.find((l) => l.is_alert)!.alert_reason = "   ";
    a.logs.find((l) => l.is_alert)!.description = "";
    const b = service(3, { id: "b", incident: "y".repeat(300) });
    const r = report(bundle(a, b));
    expect(r.alerts.recent[0].reason).toBe("Alerta registrada");
    expect(r.alerts.recent[1].reason).toHaveLength(120);
    expect(r.alerts.recent[1].reason.endsWith("…")).toBe(true);
  });

  it("una alerta de hace más de 7 días cuenta en el total pero no encabeza", () => {
    const r = report(bundle(service(12, { id: "a", alert: "Fiebre" })));
    expect(r.alerts).toMatchObject({ total: 1, last7d: 0 });
    expect(r.highlights.some((h) => h.id === "alerts_recent")).toBe(false);
  });

  it("una lectura fuera de rango de esta semana se señala aunque la última salga bien", () => {
    const r = report(
      bundle(
        service(6, { id: "a", sys: 190, dia: 100 }),
        service(3, { id: "b", sys: 120, dia: 78 }),
        service(1, { id: "c", sys: 118, dia: 76 }),
      ),
    );
    expect(vital(r, "bp").last?.level).toBe("ok");
    expect(vital(r, "bp").lastAlert).toMatchObject({ value: 190 });
    const h = r.highlights.find((x) => x.id === "vitals_alert_recent")!;
    expect(h.title).toBe("Un signo vital quedó fuera de rango esta semana");
    expect(h.detail).toBe("Presión arterial fuera de rango: 190/100 mmHg, el jue 8 oct.");
    expect(h.action).toBe(
      "Confírmalo con el médico tratante. Es una referencia general, no un diagnóstico.",
    );
  });

  it("una lectura fuera de rango de hace más de una semana no se destaca como reciente", () => {
    const r = report(bundle(service(12, { id: "a", sys: 190, dia: 100 })));
    expect(r.highlights.some((x) => x.id === "vitals_alert_recent")).toBe(false);
  });
});

describe("continuidad del equipo", () => {
  const sharedHours = (a: number, b: number) =>
    report(
      bundle(
        service(9, { id: "a", hours: a, pro: "p1", proName: "Ana" }),
        service(5, { id: "b", hours: b, pro: "p2", proName: "Beatriz" }),
      ),
    );

  it("la persona que más horas cubrió y su porcentaje", () => {
    const r = report(week());
    expect(r.continuity).toMatchObject({
      professionals: 2,
      topId: "pro-1",
      topName: "Laura Pérez",
      topSharePct: 60,
      level: "medium",
    });
  });

  it("fronteras: 70 % es alta, 69 % media, 40 % media, 39 % baja", () => {
    expect(sharedHours(70, 30).continuity.level).toBe("high");
    expect(sharedHours(69, 31).continuity.level).toBe("medium");
    expect(sharedHours(40, 60).continuity.level).toBe("medium"); // la principal es la de 60 h
    expect(
      report(
        bundle(
          service(9, { id: "a", hours: 39, pro: "p1" }),
          service(8, { id: "b", hours: 31, pro: "p2" }),
          service(7, { id: "c", hours: 30, pro: "p3" }),
        ),
      ).continuity.level,
    ).toBe("low");
  });

  it("con un solo servicio no se puede hablar de continuidad", () => {
    expect(report(bundle(service(5, { id: "a" }))).continuity.level).toBe("unknown");
  });

  it("alta continuidad es una buena noticia; baja con 3 servicios o más, un dato", () => {
    const high = report(bundle(service(9, { id: "a" }), service(5, { id: "b" })));
    expect(high.highlights.find((h) => h.id === "continuity_high")?.title).toBe(
      "Misma persona en el 100 % de las horas",
    );
    const low = report(
      bundle(
        service(9, { id: "a", pro: "p1" }),
        service(8, { id: "b", pro: "p2" }),
        service(7, { id: "c", pro: "p3" }),
      ),
    );
    expect(low.highlights.find((h) => h.id === "continuity_low")?.severity).toBe("info");
    expect(low.highlights.find((h) => h.id === "continuity_low")?.title).toBe(
      "3 profesionales distintos atendieron en este periodo",
    );
  });

  it("sin nombre del profesional no inventa uno", () => {
    const r = report(
      bundle(service(5, { id: "a", proName: null }), service(3, { id: "b", proName: null })),
    );
    expect(r.continuity.topName).toBeNull();
  });
});

describe("servicios sin parte", () => {
  it("avisa de los terminados sin registros; en curso sin registros todavía no", () => {
    const r = report(
      bundle(
        service(9, { id: "a" }),
        service(6, { id: "b", noReport: true }),
        service(0, { id: "c", status: "in_progress", noReport: true }),
      ),
    );
    expect(r.services.reportedCompleted).toBe(1);
    expect(r.services.reportedPct).toBe(50);
    const h = r.highlights.find((x) => x.id === "no_report")!;
    expect(h.title).toBe("1 servicio terminado sin parte registrado");
    expect(h.severity).toBe("watch"); // la mitad sin parte
  });

  it("el 40 % de los terminados sin parte ya es un aviso, no solo un dato", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => service(9 - i, { id: `a${i}` })),
      service(5, { id: "x", noReport: true }),
      service(4, { id: "y", noReport: true }),
    ];
    const r = report(bundle(...rows));
    expect(r.services.reportedPct).toBe(60);
    expect(r.highlights.find((h) => h.id === "no_report")).toMatchObject({
      severity: "watch",
      title: "2 servicios terminados sin parte registrado",
    });
  });

  it("pocos sin parte es solo un dato", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => service(9 - i, { id: `a${i}` })),
      service(2, { id: "z", noReport: true }),
    ];
    const r = report(bundle(...rows));
    expect(r.highlights.find((x) => x.id === "no_report")).toMatchObject({
      severity: "info",
      title: "1 servicio terminado sin parte registrado",
    });
  });

  it("solo la llegada y la salida automáticas no son un parte", () => {
    const r = report(bundle(service(5, { id: "a", noReport: true })));
    expect(r.services.reportedCompleted).toBe(0);
  });
});

describe("hallazgos", () => {
  it("el escenario difícil: alertas primero, luego a vigilar, nada de «todo bien»", () => {
    const r = report(week());
    expect(r.highlights.map((h) => [h.severity, h.id])).toEqual([
      ["alert", "alerts_recent"],
      ["alert", "vitals_alert_recent"],
      ["watch", "vitals_bp"],
      ["watch", "vitals_heartRate"],
      ["watch", "mood_worse"],
      ["watch", "meds_gap"],
    ]);
    const bp = r.highlights.find((h) => h.id === "vitals_bp")!;
    expect(bp.title).toBe("Presión arterial a vigilar: 3 de 5 lecturas fuera de lo esperado");
    expect(bp.detail).toBe(
      "Promedio 144/86 mmHg, con tendencia al alza. Referencia general para adultos en reposo.",
    );
    const hr = r.highlights.find((h) => h.id === "vitals_heartRate")!;
    expect(hr.title).toBe("Frecuencia cardíaca: tendencia al alza");
    const mood = r.highlights.find((h) => h.id === "mood_worse")!;
    expect(mood.detail).toBe("Tranquilo o contento en 2 de 5 servicios (40 %).");
  });

  it("el escenario tranquilo: buen ánimo, signos dentro de lo esperado y misma persona", () => {
    const r = report(
      bundle(
        service(12, { id: "a", mood: "calm", sys: 118, dia: 76, hr: 70 }),
        service(9, { id: "b", mood: "happy", sys: 122, dia: 78, hr: 72 }),
        service(6, { id: "c", mood: "calm", sys: 120, dia: 78, hr: 71 }),
        service(3, { id: "d", mood: "happy", sys: 119, dia: 77, hr: 70 }),
      ),
    );
    expect(r.highlights.map((h) => [h.severity, h.id])).toEqual([
      ["ok", "mood_ok"],
      ["ok", "vitals_ok"],
      ["ok", "continuity_high"],
    ]);
    expect(r.highlights[0].title).toBe("Buen ánimo en la mayoría de los servicios (100 %)");
    expect(r.highlights[1].title).toBe("Signos vitales dentro de lo esperado en 8 lecturas");
  });

  it("«buen ánimo» exige 70 %: 7 de 10 sí, 6 de 10 no", () => {
    const moods = (positive: number) =>
      bundle(
        ...Array.from({ length: 10 }, (_, i) =>
          service(28 - i * 2, { id: `p${i}`, mood: i < positive ? "calm" : "tired" }),
        ),
      );
    expect(report(moods(7)).highlights.some((h) => h.id === "mood_ok")).toBe(true);
    expect(report(moods(6)).highlights.some((h) => h.id === "mood_ok")).toBe(false);
  });

  it("dolor repetido en los últimos servicios", () => {
    const r = report(
      bundle(
        service(12, { id: "a", mood: "calm" }),
        service(9, { id: "b", mood: "pain" }),
        service(6, { id: "c", mood: "calm" }),
        service(3, { id: "d", mood: "pain" }),
      ),
    );
    expect(r.highlights.find((h) => h.id === "mood_pain")?.title).toBe(
      "Se registró dolor en 2 de los últimos 4 servicios",
    );
    const one = report(
      bundle(service(9, { id: "b", mood: "pain" }), service(3, { id: "d", mood: "calm" })),
    );
    expect(one.highlights.some((h) => h.id === "mood_pain")).toBe(false);
  });

  it("con pocos servicios advierte que las tendencias aún no son confiables", () => {
    const r = report(
      bundle(
        service(5, { id: "a", mood: "calm", sys: 120, dia: 80 }),
        service(3, { id: "b", mood: "calm" }),
      ),
    );
    expect(r.highlights.some((h) => h.id === "small_sample")).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("avisa cuando el servidor devolvió el tope de registros", () => {
    const r = report(
      bundle(service(5, { id: "a" }), service(4, { id: "b" }), service(3, { id: "c" })),
      { logsTruncated: true },
    );
    expect(r.highlights.find((h) => h.id === "truncated")?.severity).toBe("info");
    expect(
      report(bundle(service(5, { id: "a" }))).highlights.some((h) => h.id === "truncated"),
    ).toBe(false);
  });

  it("los ids son únicos y el orden respeta la gravedad", () => {
    const r = report(week());
    expect(new Set(r.highlights.map((h) => h.id)).size).toBe(r.highlights.length);
    const order = { alert: 0, watch: 1, ok: 2, info: 3 } as const;
    for (let i = 1; i < r.highlights.length; i++)
      expect(order[r.highlights[i - 1].severity]).toBeLessThanOrEqual(
        order[r.highlights[i].severity],
      );
  });
});

describe("confianza del informe", () => {
  it("baja con pocos servicios o poca información, alta con muchos y bien registrados", () => {
    expect(report(bundle(service(5, { id: "a", mood: "calm" }))).confidence).toBe("low");
    expect(report(week()).confidence).toBe("medium");
    const many = bundle(
      ...Array.from({ length: 9 }, (_, i) =>
        service(28 - i * 3, { id: `h${i}`, mood: "calm", sys: 120, dia: 80, hr: 70 }),
      ),
    );
    expect(report(many).confidence).toBe("high");
    // con 7 servicios, aunque haya 14 lecturas, todavía es media
    const seven = bundle(
      ...Array.from({ length: 7 }, (_, i) =>
        service(28 - i * 3, { id: `s${i}`, mood: "calm", sys: 120, dia: 80, hr: 70 }),
      ),
    );
    expect(report(seven).vitalReadings).toBe(14);
    expect(report(seven).confidence).toBe("medium");
  });
});

describe("resumen para el médico", () => {
  const text = doctorSummary(report(week()));

  it("trae el periodo, las cifras y la aclaración de que no es un diagnóstico", () => {
    expect(text).toMatch(/^Resumen de cuidado en casa · 14 sep 2026 – 14 oct 2026 \(30 días\)/);
    expect(text).toMatch(/no es un diagnóstico/);
    expect(text).toMatch(
      /• Servicios: 5 \(30 h contratadas\); terminados con parte registrado: 5 de 5\./,
    );
    expect(text).toMatch(
      /• Ánimo al terminar cada servicio \(5\): tranquilo 2, cansado 1, decaído 1, con dolor 1\. Tranquilo o contento en 40 %; tendencia a empeorar\./,
    );
    expect(text).toMatch(
      /• Presión arterial: 5 lecturas; promedio 144\/86 mmHg; última 182\/96 mmHg \(dom 11 oct\); 2 a vigilar y 1 fuera de rango; con tendencia al alza\./,
    );
    expect(text).toMatch(/• Frecuencia cardíaca: 5 lecturas; promedio 79 lpm; última 92 lpm/);
    expect(text).toMatch(
      /• Alertas e incidentes: 1\. Más reciente: «Presión muy alta» \(dom 11 oct\)\./,
    );
    expect(text).toMatch(/• Medicamentos: 8 registros en 4 de 5 servicios con parte/);
    expect(text).toMatch(
      /• Continuidad: 2 profesionales; el principal cubrió el 60 % de las horas\./,
    );
    expect(text).toMatch(/Referencias para «a vigilar»: Referencia general para adultos en reposo/);
  });

  it("no incluye nombres de profesionales ni datos de pago", () => {
    expect(text).not.toMatch(/Laura|Marta|\$|COP|WhatsApp|@/);
    expect(text).not.toMatch(/undefined|NaN|Infinity|\[object/);
  });

  it("dice «sin registros» cuando falta información en lugar de callar", () => {
    const t = doctorSummary(report(bundle(service(5, { id: "a", noReport: true }))));
    expect(t).toMatch(/• Ánimo: sin registros en este periodo\./);
    expect(t).toMatch(/• Signos vitales: sin lecturas en este periodo\./);
    expect(t).toMatch(/• Alertas e incidentes: ninguno\./);
    expect(t).toMatch(/• Medicamentos: sin partes en este periodo\./);
  });
});

describe("invariantes (partes aleatorios)", () => {
  const MOODS = ["happy", "calm", "tired", "sad", "pain", "agitated", "raro", "", null];
  const TYPES = [
    "medication",
    "vital_signs",
    "meal",
    "activity",
    "note",
    "incident",
    "arrival",
    "departure",
    "otro",
  ];
  for (const seed of [3, 12, 90, 2026, 4242]) {
    it(`semilla ${seed}: porcentajes en 0–100, totales que cuadran y textos limpios`, () => {
      const rnd = mulberry32(seed);
      const maybe = <T>(v: T, p = 0.4): T | null => (rnd() < p ? null : v);
      const bookings: WellbeingBooking[] = Array.from({ length: 40 }, (_, i) =>
        wBooking({
          id: `b${i}`,
          status: ["completed", "completed", "in_progress", "cancelled", "pending"][
            Math.floor(rnd() * 5)
          ],
          scheduled_at: rnd() < 0.03 ? "fecha-rota" : iso(-rnd() * 120 * DAY),
          duration_hours: rnd() < 0.05 ? "abc" : Math.round(rnd() * 12),
          professional_id: `pro${Math.floor(rnd() * 4)}`,
          professional_name: maybe(`Pro ${i}`),
        }),
      );
      const logs: WellbeingLog[] = Array.from({ length: 400 }, (_, i) =>
        careLog({
          id: `l${i}`,
          booking_id: `b${Math.floor(rnd() * 44)}`, // algunos ids no existen
          event_type: TYPES[Math.floor(rnd() * TYPES.length)],
          mood: MOODS[Math.floor(rnd() * MOODS.length)] as string | null,
          vital_systolic: maybe(Math.round(rnd() * 260), 0.7),
          vital_diastolic: maybe(Math.round(rnd() * 160), 0.7),
          vital_heart_rate: maybe(Math.round(rnd() * 320), 0.7),
          vital_temperature: maybe(Math.round(rnd() * 500) / 10, 0.8),
          vital_oxygen: maybe(Math.round(rnd() * 110), 0.8),
          is_alert: rnd() < 0.05,
          alert_reason: maybe("Motivo " + i, 0.5),
          system_generated: rnd() < 0.1,
          created_at: rnd() < 0.02 ? "fecha-rota" : iso(-rnd() * 120 * DAY),
        }),
      );
      for (const windowDays of [7, 30, 90]) {
        const r = report({ bookings, logs }, { windowDays });
        const pcts = [
          r.services.reportedPct,
          r.moods.positivePct,
          r.moods.negativePct,
          r.continuity.topSharePct,
        ];
        for (const p of pcts)
          if (p !== null) {
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(100);
          }
        expect(r.services.completed + r.services.inProgress).toBe(r.services.count);
        expect(r.services.reportedCompleted).toBeLessThanOrEqual(r.services.completed);
        expect(Object.values(r.moods.counts).reduce((a, b) => a + b, 0)).toBe(r.moods.withMood);
        expect(r.moods.withMood).toBeLessThanOrEqual(r.services.count);
        expect(r.medication.withRecords + r.medication.withoutRecords).toBe(
          r.medication.withReport,
        );
        expect(r.alerts.last7d).toBeLessThanOrEqual(r.alerts.total);
        expect(r.alerts.recent.length).toBeLessThanOrEqual(3);
        for (const v of r.vitals) {
          expect(v.readings).toBeGreaterThan(0);
          expect(v.watch + v.alert).toBeLessThanOrEqual(v.readings);
          expect(Number.isFinite(v.avg as number)).toBe(true);
          expect(v.min as number).toBeLessThanOrEqual(v.max as number);
          expect(v.avg as number).toBeGreaterThanOrEqual(v.min as number);
          expect(v.avg as number).toBeLessThanOrEqual(v.max as number);
        }
        expect(new Set(r.highlights.map((h) => h.id)).size).toBe(r.highlights.length);
        for (const h of r.highlights)
          expect(`${h.title} ${h.detail} ${h.action ?? ""}`).not.toMatch(
            /undefined|NaN|Infinity|\[object/,
          );
        expect(doctorSummary(r)).not.toMatch(/undefined|NaN|Infinity|\[object/);
      }
    });
  }

  it("el orden de los registros no cambia el informe", () => {
    const data = week();
    const a = report(data);
    const b = report({ bookings: [...data.bookings].reverse(), logs: [...data.logs].reverse() });
    expect(b).toEqual(a);
  });
});
