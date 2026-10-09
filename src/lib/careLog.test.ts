import { describe, it, expect } from "vitest";
import {
  CARE_MOODS,
  CARE_PRESETS,
  DESCRIPTION_MAX,
  MANUAL_EVENT_TYPES,
  VITAL_LIMITS,
  bogotaDay,
  buildCareLogInsert,
  careLogFormSchema,
  closingNoteText,
  countLogs,
  durationLabel,
  eventMeta,
  formatVitals,
  groupLogsByDay,
  isManualEvent,
  lastMood,
  mergeLog,
  moodHeadline,
  narrateShift,
  parseLooseVitals,
  parseCareReport,
  reportLastMood,
  reportToText,
  reportTone,
  sortLogsDesc,
  suggestsAlert,
  vitalFlags,
  type CareLogRow,
  type CareReport,
} from "./careLog";
import { checkOutgoingMessage } from "./opportunities";

const row = (o: Partial<CareLogRow> = {}): CareLogRow => ({
  id: "l1",
  event_type: "note",
  description: "Nota",
  vital_systolic: null,
  vital_diastolic: null,
  vital_heart_rate: null,
  vital_temperature: null,
  vital_oxygen: null,
  is_alert: false,
  created_at: "2026-10-09T15:00:00Z",
  ...o,
});

describe("atajos de un toque", () => {
  it("todos pasan los mismos filtros que el servidor (sin contacto ni pagos) y caben en el límite", () => {
    for (const p of CARE_PRESETS) {
      expect(
        checkOutgoingMessage(p.text, { required: true, maxChars: DESCRIPTION_MAX }),
        p.id,
      ).toEqual({
        ok: true,
        text: p.text,
      });
      expect(isManualEvent(p.type), p.id).toBe(true);
    }
  });
  it("los ids son únicos y los ánimos que traen son válidos", () => {
    const ids = CARE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CARE_PRESETS) if (p.mood) expect(CARE_MOODS).toContain(p.mood);
  });
  it("cubre medicamento, comida, actividad y nota", () => {
    const types = new Set(CARE_PRESETS.map((p) => p.type));
    for (const t of ["medication", "meal", "activity", "note"] as const)
      expect(types.has(t)).toBe(true);
  });
});

describe("tipos de evento", () => {
  it("la llegada y la salida no son manuales", () => {
    expect(isManualEvent("arrival")).toBe(false);
    expect(isManualEvent("departure")).toBe(false);
    expect(MANUAL_EVENT_TYPES).toHaveLength(6);
  });
  it("un tipo desconocido cae en «Nota»", () => {
    expect(eventMeta("zzz").label).toBe("Nota");
    expect(eventMeta("incident").label).toBe("Incidente");
  });
  it("frase de ánimo para la familia", () => {
    expect(moodHeadline("happy")).toContain("contento");
    expect(moodHeadline(null)).toBeNull();
  });
});

describe("signos vitales: sugerencia de alerta", () => {
  it("valores normales no generan señales", () => {
    expect(
      vitalFlags({ systolic: 120, diastolic: 80, heartRate: 72, temperature: 36.5, oxygen: 97 }),
    ).toEqual([]);
  });
  it("saturación: <90 alerta, 90–93 a vigilar, ≥94 normal", () => {
    expect(vitalFlags({ oxygen: 89 })[0]).toMatchObject({ key: "oxygen", level: "alert" });
    expect(vitalFlags({ oxygen: 92 })[0]).toMatchObject({ key: "oxygen", level: "watch" });
    expect(vitalFlags({ oxygen: 94 })).toEqual([]);
  });
  it("temperatura: ≥39 o <35 alerta, ≥38 a vigilar", () => {
    expect(vitalFlags({ temperature: 39 })[0].level).toBe("alert");
    expect(vitalFlags({ temperature: 34.8 })[0].level).toBe("alert");
    expect(vitalFlags({ temperature: 38.2 })[0].level).toBe("watch");
    expect(vitalFlags({ temperature: 37.9 })).toEqual([]);
  });
  it("presión arterial: crisis alerta, elevada a vigilar", () => {
    expect(vitalFlags({ systolic: 185, diastolic: 95 })[0].level).toBe("alert");
    expect(vitalFlags({ systolic: 150, diastolic: 85 })[0].level).toBe("watch");
    expect(vitalFlags({ systolic: 85, diastolic: 55 })[0].level).toBe("alert");
    expect(vitalFlags({ systolic: 120, diastolic: 121 })[0].level).toBe("alert");
  });
  it("frecuencia cardíaca", () => {
    expect(vitalFlags({ heartRate: 130 })[0].level).toBe("alert");
    expect(vitalFlags({ heartRate: 40 })[0].level).toBe("alert");
    expect(vitalFlags({ heartRate: 105 })[0].level).toBe("watch");
    expect(vitalFlags({ heartRate: 50 })[0].level).toBe("watch");
    expect(vitalFlags({ heartRate: 70 })).toEqual([]);
  });
  it("ignora valores ausentes y solo sugiere alerta con nivel alto", () => {
    expect(vitalFlags({})).toEqual([]);
    expect(suggestsAlert(vitalFlags({ oxygen: 92 }))).toBe(false);
    expect(suggestsAlert(vitalFlags({ oxygen: 85 }))).toBe(true);
  });
  it("formatea los vitales", () => {
    expect(
      formatVitals({ systolic: 120, diastolic: 80, heartRate: 72, temperature: 36.5, oxygen: 97 }),
    ).toBe("PA 120/80 · FC 72 · T 36.5 °C · SpO₂ 97 %");
    expect(formatVitals({})).toBe("");
    expect(formatVitals({ systolic: 130 })).toBe("PA 130/?");
  });
});

describe("lectura tolerante de los vitales mientras se escribe", () => {
  it("convierte texto, ignora vacíos y valores fuera del rango de la base de datos", () => {
    expect(
      parseLooseVitals({
        systolic: "120",
        diastolic: " 80 ",
        heartRate: "",
        temperature: "36,5",
        oxygen: "abc",
      }),
    ).toEqual({
      systolic: 120,
      diastolic: 80,
      heartRate: undefined,
      temperature: 36.5,
      oxygen: undefined,
    });
    expect(parseLooseVitals({ oxygen: "120", systolic: "10" })).toEqual({
      systolic: undefined,
      diastolic: undefined,
      heartRate: undefined,
      temperature: undefined,
      oxygen: undefined,
    });
  });
  it("alimenta las señales de rango", () => {
    expect(vitalFlags(parseLooseVitals({ oxygen: "88" }))[0]).toMatchObject({
      key: "oxygen",
      level: "alert",
    });
    expect(vitalFlags(parseLooseVitals({}))).toEqual([]);
  });
});

describe("formulario del parte", () => {
  const ok = (v: object) => careLogFormSchema.safeParse(v);
  const base = { eventType: "note", description: "Estuvo tranquilo/a toda la tarde." } as const;

  it("acepta una nota simple", () => {
    const r = ok(base);
    expect(r.success).toBe(true);
  });
  it("rechaza descripción vacía o en blanco", () => {
    expect(ok({ ...base, description: "   " }).success).toBe(false);
  });
  it("rechaza teléfonos, correos y datos de pago, con el mensaje claro", () => {
    for (const bad of [
      "Escríbeme al 3001234567",
      "Mi correo es laura@correo.com",
      "Paga por nequi 3001234567",
    ]) {
      const r = ok({ ...base, description: bad });
      expect(r.success, bad).toBe(false);
    }
  });
  it("una alerta no se bloquea por su contenido (igual que en el servidor)", () => {
    const r = ok({
      eventType: "incident",
      description: "Caída leve; se avisó al hijo al 3001234567",
    });
    expect(r.success).toBe(true);
  });
  it("texto clínico habitual no se bloquea", () => {
    for (const good of [
      "Tomó losartán 50 mg a las 8:00 a.m. y metformina 850 mg con el almuerzo",
      "Se llamó a la línea 123 por precaución; dolor 7/10 en rodilla derecha desde las 10:30",
      "Almorzó sopa y arroz, comió 3/4 del plato y tomó 250 ml de agua",
      "Aplicó enoxaparina 40 mg en abdomen, rotando el sitio de inyección",
    ]) {
      expect(ok({ eventType: "note", description: good }).success, good).toBe(true);
    }
  });
  it("respeta el máximo de caracteres", () => {
    expect(ok({ ...base, description: "a".repeat(DESCRIPTION_MAX) }).success).toBe(true);
    expect(ok({ ...base, description: "a".repeat(DESCRIPTION_MAX + 1) }).success).toBe(false);
  });
  it("los tipos del sistema no se aceptan en el formulario", () => {
    expect(ok({ eventType: "arrival", description: "Llegué" }).success).toBe(false);
    expect(ok({ eventType: "departure", description: "Salí" }).success).toBe(false);
  });
  it("signos vitales: al menos uno, y solo dentro de los rangos de la base de datos", () => {
    expect(ok({ eventType: "vital_signs", description: "Control" }).success).toBe(false);
    expect(ok({ eventType: "vital_signs", description: "Control", oxygen: "97" }).success).toBe(
      true,
    );
    expect(ok({ eventType: "vital_signs", description: "Control", oxygen: "120" }).success).toBe(
      false,
    );
    expect(
      ok({ eventType: "vital_signs", description: "Control", temperature: "36,5" }).success,
    ).toBe(true);
    expect(
      ok({ eventType: "vital_signs", description: "Control", heartRate: "72.5" }).success,
    ).toBe(false);
    expect(ok({ eventType: "vital_signs", description: "Control", systolic: "abc" }).success).toBe(
      false,
    );
    for (const k of Object.keys(VITAL_LIMITS) as Array<keyof typeof VITAL_LIMITS>) {
      expect(
        ok({
          eventType: "vital_signs",
          description: "Control",
          [k]: String(VITAL_LIMITS[k].min - 1),
        }).success,
        k,
      ).toBe(false);
      expect(
        ok({ eventType: "vital_signs", description: "Control", [k]: String(VITAL_LIMITS[k].max) })
          .success,
        k,
      ).toBe(true);
    }
  });
  it("vitales en un registro que no es de signos vitales se rechazan", () => {
    expect(ok({ ...base, oxygen: "97" }).success).toBe(false);
  });
  it("ánimo válido o vacío", () => {
    expect(ok({ ...base, mood: "happy" }).success).toBe(true);
    expect(ok({ ...base, mood: "" }).success).toBe(true);
    expect(ok({ ...base, mood: "furious" }).success).toBe(false);
  });
});

describe("armado de la fila", () => {
  const ctx = { bookingId: "b1", professionalId: "p1", patientName: "  Rosa Díaz  " };
  it("nota simple", () => {
    const parsed = careLogFormSchema.parse({
      eventType: "note",
      description: "  Buen día  ",
      mood: "calm",
    });
    expect(buildCareLogInsert(parsed, ctx)).toEqual({
      booking_id: "b1",
      professional_id: "p1",
      event_type: "note",
      description: "Buen día",
      mood: "calm",
      is_alert: false,
      patient_name: "Rosa Díaz",
    });
  });
  it("un incidente siempre queda como alerta y trae motivo", () => {
    const parsed = careLogFormSchema.parse({
      eventType: "incident",
      description: "Caída leve en el baño",
    });
    const r = buildCareLogInsert(parsed, ctx);
    expect(r.is_alert).toBe(true);
    expect(r.alert_reason).toBe("Caída leve en el baño");
  });
  it("alerta marcada con motivo propio", () => {
    const parsed = careLogFormSchema.parse({
      eventType: "vital_signs",
      description: "Saturación baja",
      oxygen: "89",
      isAlert: true,
      alertReason: "SpO2 89%",
    });
    const r = buildCareLogInsert(parsed, { bookingId: "b1", professionalId: "p1" });
    expect(r).toMatchObject({ is_alert: true, alert_reason: "SpO2 89%", vital_oxygen: 89 });
    expect(r.patient_name).toBeUndefined();
  });
  it("los vitales numéricos llegan como números", () => {
    const parsed = careLogFormSchema.parse({
      eventType: "vital_signs",
      description: "Control",
      systolic: "120",
      diastolic: "80",
      heartRate: "72",
      temperature: "36,5",
      oxygen: "97",
    });
    expect(buildCareLogInsert(parsed, ctx)).toMatchObject({
      vital_systolic: 120,
      vital_diastolic: 80,
      vital_heart_rate: 72,
      vital_temperature: 36.5,
      vital_oxygen: 97,
    });
  });
});

describe("nota de cierre", () => {
  it("la nota gana; si solo hay ánimo, una frase; si no hay nada, nada", () => {
    expect(closingNoteText({ mood: "happy", note: "  Cenó completo  " })).toBe(
      "Cierre del turno: Cenó completo",
    );
    expect(closingNoteText({ mood: "tired", note: "" })).toBe(
      "Cierre del turno. Ánimo del paciente al final: cansado/a.",
    );
    expect(closingNoteText({ mood: "", note: "   " })).toBeNull();
    expect(closingNoteText({})).toBeNull();
  });
  it("la nota de cierre es un registro válido del parte", () => {
    const text = closingNoteText({ mood: "calm", note: "Quedó descansando" })!;
    expect(
      careLogFormSchema.safeParse({ eventType: "note", description: text, mood: "calm" }).success,
    ).toBe(true);
  });
});

describe("línea de tiempo", () => {
  it("ordena del más reciente al más antiguo, estable por id", () => {
    const rows = [
      row({ id: "a", created_at: "2026-10-09T10:00:00Z" }),
      row({ id: "c", created_at: "2026-10-09T12:00:00Z" }),
      row({ id: "b", created_at: "2026-10-09T12:00:00Z" }),
    ];
    expect(sortLogsDesc(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("mergeLog no duplica y deja el nuevo arriba", () => {
    const rows = [row({ id: "a", created_at: "2026-10-09T10:00:00Z" })];
    expect(mergeLog(rows, row({ id: "a" }))).toBe(rows);
    expect(
      mergeLog(rows, row({ id: "z", created_at: "2026-10-09T11:00:00Z" })).map((r) => r.id),
    ).toEqual(["z", "a"]);
  });
  it("agrupa por día de Colombia (UTC-5)", () => {
    // 02:00 UTC del día 10 es 21:00 del día 9 en Bogotá.
    expect(bogotaDay("2026-10-10T02:00:00Z")).toBe("2026-10-09");
    expect(bogotaDay("2026-10-10T05:00:00Z")).toBe("2026-10-10");
    const groups = groupLogsByDay([
      row({ id: "1", created_at: "2026-10-10T02:00:00Z" }),
      row({ id: "2", created_at: "2026-10-09T15:00:00Z" }),
      row({ id: "3", created_at: "2026-10-10T14:00:00Z" }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-10-10", "2026-10-09"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("cuenta solo lo escrito por el profesional", () => {
    const c = countLogs([
      row({ id: "1", event_type: "arrival", system_generated: true }),
      row({ id: "2", event_type: "medication" }),
      row({ id: "3", event_type: "medication" }),
      row({ id: "4", event_type: "vital_signs", vital_oxygen: 97 }),
      row({ id: "5", event_type: "incident", is_alert: true }),
      row({ id: "6", event_type: "departure", system_generated: true }),
    ]);
    expect(c).toEqual({
      total: 4,
      byType: { medication: 2, vital_signs: 1, incident: 1 },
      alerts: 1,
      vitals: 1,
    });
  });
  it("último ánimo registrado", () => {
    expect(lastMood([])).toBeNull();
    expect(
      lastMood([
        row({ id: "1", mood: "sad", created_at: "2026-10-09T10:00:00Z" }),
        row({ id: "2", mood: "happy", created_at: "2026-10-09T13:00:00Z" }),
        row({ id: "3", mood: null, created_at: "2026-10-09T14:00:00Z" }),
      ]),
    ).toBe("happy");
  });
});

describe("duración", () => {
  it("coincide con public.hx_duration_label (misma tabla que la prueba de PostgreSQL)", () => {
    expect([0, 45, 60, 135].map(durationLabel)).toEqual(["0 min", "45 min", "1 h", "2 h 15 min"]);
    expect(durationLabel(-1)).toBeNull();
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(Number.NaN)).toBeNull();
  });
});

describe("parte final", () => {
  const server = {
    booking_id: "b1",
    status: "in_progress",
    scheduled_at: "2026-10-09T13:00:00Z",
    planned_hours: 4,
    professional: "Laura P.",
    started_at: "2026-10-09T13:05:00Z",
    ended_at: null,
    duration_minutes: 135,
    events: 11,
    by_type: { medication: 2, meal: 1, vital_signs: 2, incident: 1 },
    vitals_count: 2,
    last_vitals: {
      at: "2026-10-09T15:00:00Z",
      systolic: null,
      diastolic: null,
      heart_rate: null,
      temperature: null,
      oxygen: 89,
    },
    alerts: 2,
    incidents: 1,
    moods: [{ at: "2026-10-09T14:00:00Z", mood: "happy" }],
  };
  it("normaliza la respuesta del servidor", () => {
    const r = parseCareReport(server)!;
    expect(r.events).toBe(11);
    expect(r.last_vitals).toMatchObject({ oxygen: 89, heartRate: null });
    expect(r.moods).toHaveLength(1);
  });
  it("tolera nulos", () => {
    const r = parseCareReport({
      booking_id: "b1",
      status: "confirmed",
      scheduled_at: "2026-10-09T13:00:00Z",
      last_vitals: null,
    })!;
    expect(r.events).toBe(0);
    expect(r.last_vitals).toBeNull();
    expect(r.duration_minutes).toBeNull();
    expect(parseCareReport(null)).toBeNull();
  });
  it("último ánimo del parte", () => {
    expect(reportLastMood({ moods: [] })).toBeNull();
    expect(
      reportLastMood({
        moods: [
          { at: "a", mood: "sad" },
          { at: "b", mood: "happy" },
        ],
      }),
    ).toBe("happy");
    expect(reportLastMood({ moods: [{ at: "a", mood: "raro" }] })).toBeNull();
  });
  it("semáforo del parte", () => {
    const base = parseCareReport({ ...server, alerts: 0, incidents: 0, last_vitals: null })!;
    expect(reportTone(base)).toBe("ok");
    expect(reportTone({ ...base, alerts: 1 })).toBe("alert");
    expect(reportTone({ ...base, last_vitals: { at: "", oxygen: 92 } })).toBe("watch");
    expect(reportTone({ ...base, last_vitals: { at: "", oxygen: 98 } })).toBe("ok");
  });
  it("resumen en texto para copiar, sin datos personales", () => {
    const text = reportToText(parseCareReport(server) as CareReport);
    expect(text).toContain("Parte del turno · Laura P. · 2026-10-09");
    expect(text).toContain("Duración: 2 h 15 min");
    expect(text).toContain("2 medicamento");
    expect(text).toContain("SpO₂ 89 %");
    expect(text).toContain("Pasó un buen turno");
    expect(text).toContain("Alertas: 2");
    expect(text).not.toMatch(/\d{7,}/);
  });
});

describe("el parte en palabras", () => {
  const base = parseCareReport({
    booking_id: "b1",
    status: "in_progress",
    scheduled_at: "2026-10-09T13:00:00Z",
    professional: "Laura P.",
    duration_minutes: 135,
    events: 6,
    by_type: { medication: 2, meal: 1, activity: 1, note: 1, vital_signs: 1 },
    vitals_count: 1,
    last_vitals: {
      at: "t",
      systolic: 120,
      diastolic: 80,
      heart_rate: 72,
      temperature: 36.5,
      oxygen: 97,
    },
    alerts: 0,
    incidents: 0,
    moods: [{ at: "t", mood: "happy" }],
  })!;
  it("cuenta lo ocurrido con calidez y sin alertas", () => {
    const text = narrateShift(base).join(" ");
    expect(text).toContain("Laura P. lleva acompañando a tu familiar desde hace 2 h 15 min.");
    expect(text).toContain(
      "2 registros de medicamentos, 1 registro de alimentación o líquidos, 1 actividad (caminata, aseo, descanso), 1 nota",
    );
    expect(text).toContain(
      "Se tomaron signos vitales una vez; el último: PA 120/80 · FC 72 · T 36.5 °C · SpO₂ 97 %.",
    );
    expect(text).toContain("Pasó un buen turno: estuvo contento/a.");
    expect(text).toContain("No hubo alertas.");
    expect(text).toContain("El turno sigue en curso.");
  });
  it("con alertas las nombra, sin diagnosticar", () => {
    const text = narrateShift({ ...base, alerts: 2, incidents: 1 }, [
      "Caída leve",
      "SpO2 89%",
      "tercera",
    ]).join(" ");
    expect(text).toContain(
      "Atención: hubo 2 alertas (Caída leve; SpO2 89%). El profesional ya te avisó.",
    );
    expect(text).not.toContain("No hubo alertas.");
  });
  it("al terminar invita a agradecer y a comentar las alertas con el médico", () => {
    const done = { ...base, status: "completed", alerts: 1 };
    const text = narrateShift(done).join(" ");
    expect(text).toContain("acompañó a tu familiar durante 2 h 15 min");
    expect(text).toContain("Conviene comentarlo con el médico tratante.");
    expect(text).toContain("puedes darle las gracias a tu profesional y calificar el servicio");
  });
  it("sin registros no hay narración; sin duración usa una frase neutra; no dice «no hubo alertas» con vitales fuera de rango", () => {
    expect(narrateShift({ ...base, events: 0, by_type: {}, alerts: 0 })).toEqual([]);
    expect(narrateShift({ ...base, duration_minutes: null })[0]).toBe(
      "Laura P. está atendiendo a tu familiar.",
    );
    const low = narrateShift({ ...base, last_vitals: { at: "t", oxygen: 88 } }).join(" ");
    expect(low).not.toContain("No hubo alertas.");
  });
  it("singulares", () => {
    const one = narrateShift({
      ...base,
      by_type: { medication: 1 },
      events: 1,
      vitals_count: 0,
      moods: [],
    }).join(" ");
    expect(one).toContain("1 registro de medicamentos");
    expect(one).not.toContain("signos vitales");
  });
});
