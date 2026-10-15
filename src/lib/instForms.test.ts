import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CARE_TYPE_OPTIONS,
  CASE_FORM_DEFAULTS,
  DEVICE_KIND_OPTIONS,
  DOC_TYPE_OPTIONS,
  MODALITY_OPTIONS,
  NOTE_KIND_OPTIONS,
  OUTCOME_OPTIONS,
  PATIENT_FORM_DEFAULTS,
  PRIORITY_OPTIONS,
  SATISFACTION_BY_OPTIONS,
  SEX_OPTIONS,
  TASK_KIND_OPTIONS,
  bogotaLocalToIso,
  bogotaToday,
  caseEditPayload,
  caseFormSchema,
  casePayload,
  caseToFormValues,
  closeCasePayload,
  closeCaseSchema,
  deviceFormSchema,
  dischargeSchema,
  endOfBogotaDayIso,
  firstCasePayload,
  isoToBogotaLocal,
  NOTE_WRITE_KINDS,
  noteFormSchema,
  parseList,
  patientEditPayload,
  patientFormSchema,
  patientPayload,
  patientToFormValues,
  taskFormSchema,
  taskPayload,
  type PatientFormValues,
} from "./instForms";
import {
  CARE_TYPE_META,
  MODALITY_ORDER,
  OUTCOME_LABEL,
  PRIORITY_META,
  TASK_KIND_LABEL,
  WRITABLE_NOTE_KINDS,
} from "./instCare";
import { mkPatient } from "./instCare.fixtures";

const valid = (over: Partial<PatientFormValues> = {}): PatientFormValues => ({
  ...PATIENT_FORM_DEFAULTS,
  full_name: "Ana Lucía Pérez",
  consent: true,
  ...over,
});
const errorsOf = (v: PatientFormValues) => {
  const r = patientFormSchema.safeParse(v);
  if (r.success) return {} as Record<string, string>;
  return Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("hora de Colombia", () => {
  it("el día de hoy es el de Colombia (a las 9 p. m. ya es mañana en UTC)", () => {
    expect(bogotaToday(Date.parse("2026-10-15T02:00:00Z"))).toBe("2026-10-14");
    expect(bogotaToday(Date.parse("2026-10-15T05:00:00Z"))).toBe("2026-10-15");
    expect(bogotaToday(new Date("2026-10-14T16:00:00Z"))).toBe("2026-10-14");
  });

  it("fecha y hora escritas en el formulario → instante, y de vuelta", () => {
    expect(bogotaLocalToIso("2026-10-14T10:30")).toBe("2026-10-14T15:30:00.000Z");
    expect(bogotaLocalToIso("2026-12-31T23:59")).toBe("2027-01-01T04:59:00.000Z");
    expect(isoToBogotaLocal("2026-10-14T15:30:00.000Z")).toBe("2026-10-14T10:30");
    expect(isoToBogotaLocal(bogotaLocalToIso("2026-02-28T00:05"))).toBe("2026-02-28T00:05");
  });

  it("rechaza lo que no existe o no tiene el formato", () => {
    for (const bad of [
      "",
      "2026-02-31T10:00",
      "2026-10-14T24:00",
      "2026-10-14 10:30",
      "2026-13-01T10:00",
      "mañana",
      null,
      undefined,
    ])
      expect(bogotaLocalToIso(bad)).toBeNull();
    expect(isoToBogotaLocal("nada")).toBe("");
    expect(isoToBogotaLocal(null)).toBe("");
  });

  it("el cierre estimado de un caso es el final de ese día en Colombia", () => {
    expect(endOfBogotaDayIso("2026-10-24")).toBe("2026-10-25T04:59:00.000Z");
    expect(endOfBogotaDayIso("2026-02-30")).toBeNull();
    expect(endOfBogotaDayIso("")).toBeNull();
  });
});

describe("listas escritas a mano", () => {
  it("separa por coma, punto y coma o línea; limpia espacios; quita repetidos sin distinguir mayúsculas", () => {
    expect(parseList(" EPOC,  hipertensión ;  Diabetes tipo 2\nepoc,, ").items).toEqual([
      "EPOC",
      "hipertensión",
      "Diabetes tipo 2",
    ]);
    expect(parseList("").items).toEqual([]);
    expect(parseList(null).items).toEqual([]);
  });

  it("hasta 20 elementos de 80 caracteres, sin signos de etiqueta", () => {
    const many = Array.from({ length: 21 }, (_, i) => `c${i}`).join(",");
    expect(parseList(many).error).toBe("Máximo 20 elementos.");
    expect(parseList(Array.from({ length: 20 }, (_, i) => `c${i}`).join(",")).error).toBeNull();
    expect(parseList("x".repeat(81)).error).toBe("Cada elemento admite hasta 80 caracteres.");
    expect(parseList("x".repeat(80)).error).toBeNull();
    expect(parseList("<b>negrita</b>").error).toBe(
      "No uses los signos < ni > ni caracteres de control.",
    );
  });
});

describe("formulario de paciente", () => {
  it("lo mínimo: el nombre y la autorización", () => {
    expect(errorsOf(valid())).toEqual({});
    expect(patientFormSchema.safeParse(valid()).success).toBe(true);
  });

  it("sin la autorización del paciente o su acudiente no se registra a nadie", () => {
    expect(errorsOf(valid({ consent: false })).consent).toBe(
      "Confirma que la institución cuenta con la autorización del paciente o de su acudiente.",
    );
  });

  it("nombre: 2 a 120 caracteres, sin < ni >", () => {
    expect(errorsOf(valid({ full_name: "A" })).full_name).toContain("al menos 2");
    expect(errorsOf(valid({ full_name: "  " })).full_name).toContain("al menos 2");
    expect(errorsOf(valid({ full_name: "x".repeat(121) })).full_name).toContain("120");
    expect(errorsOf(valid({ full_name: "x".repeat(120) })).full_name).toBeUndefined();
    expect(errorsOf(valid({ full_name: "Ana <script>" })).full_name).toContain("< ni >");
  });

  it("documento: con número hace falta el tipo, y el número lleva 4 a 20 letras, números, punto o guion", () => {
    expect(errorsOf(valid({ document_number: "1020304050" })).document_type).toBe(
      "Elige el tipo de documento.",
    );
    expect(errorsOf(valid({ document_type: "CC", document_number: "1020304050" }))).toEqual({});
    expect(
      errorsOf(valid({ document_type: "CC", document_number: "123" })).document_number,
    ).toContain("4 a 20");
    expect(
      errorsOf(valid({ document_type: "CC", document_number: "1".repeat(21) })).document_number,
    ).toContain("4 a 20");
    expect(
      errorsOf(valid({ document_type: "CC", document_number: "12 34 56" })).document_number,
    ).toContain("4 a 20");
    expect(errorsOf(valid({ document_type: "PA", document_number: "AB-123.45" }))).toEqual({});
    // el tipo solo, sin número, es válido
    expect(errorsOf(valid({ document_type: "CC" }))).toEqual({});
  });

  it("fecha de nacimiento: real, desde 1900 y no futura (hora de Colombia)", () => {
    expect(errorsOf(valid({ birth_date: "1948-03-01" }))).toEqual({});
    expect(errorsOf(valid({ birth_date: "1948-02-30" })).birth_date).toContain("válida");
    expect(errorsOf(valid({ birth_date: "01/03/1948" })).birth_date).toContain("válida");
    expect(errorsOf(valid({ birth_date: "1899-12-31" })).birth_date).toContain("antigua");
    expect(errorsOf(valid({ birth_date: "2999-01-01" })).birth_date).toContain("futura");
    expect(errorsOf(valid({ birth_date: bogotaToday() }))).toEqual({});
  });

  it("teléfono de contacto: 7 a 20 números, con +, paréntesis, espacios o guiones", () => {
    expect(errorsOf(valid({ emergency_phone: "300 123 4567" }))).toEqual({});
    expect(errorsOf(valid({ emergency_phone: "+57 (300) 123-4567" }))).toEqual({});
    expect(errorsOf(valid({ emergency_phone: "123" })).emergency_phone).toContain("7 a 20");
    expect(errorsOf(valid({ emergency_phone: "llamar a Luis" })).emergency_phone).toContain(
      "7 a 20",
    );
  });

  it("condiciones y alergias: hasta 20 de 80 caracteres", () => {
    expect(errorsOf(valid({ conditions: "EPOC, Asma", allergies: "Penicilina" }))).toEqual({});
    expect(errorsOf(valid({ conditions: "x".repeat(81) })).conditions).toContain("80");
    expect(
      errorsOf(valid({ allergies: Array.from({ length: 21 }, (_, i) => `a${i}`).join(",") }))
        .allergies,
    ).toContain("20");
  });

  it("campos de texto con su tope (EPS 80, ciudad 80, dirección 200, habitación 40, referencia 40)", () => {
    expect(errorsOf(valid({ eps_name: "x".repeat(81) })).eps_name).toContain("80");
    expect(errorsOf(valid({ city: "x".repeat(81) })).city).toContain("80");
    expect(errorsOf(valid({ address: "x".repeat(201) })).address).toContain("200");
    expect(errorsOf(valid({ room: "x".repeat(41) })).room).toContain("40");
    expect(errorsOf(valid({ external_ref: "x".repeat(41) })).external_ref).toContain("40");
    expect(errorsOf(valid({ room: "<201>" })).room).toContain("< ni >");
  });

  it("solo un paciente activo entra a monitoreo", () => {
    expect(errorsOf(valid({ monitor: true, status: "active" }))).toEqual({});
    expect(errorsOf(valid({ monitor: true, status: "pending" })).monitor).toContain("activo");
  });

  it("el primer caso: título de 3 o más letras y una fecha estimada que no sea del pasado", () => {
    expect(errorsOf(valid({ with_case: true, title: "Cuidado post-alta" }))).toEqual({});
    expect(errorsOf(valid({ with_case: true, title: "ab" })).title).toContain("al menos 3");
    expect(
      errorsOf(valid({ with_case: true, title: "abc", target_date: "2020-01-01" })).target_date,
    ).toContain("anterior a hoy");
    expect(
      errorsOf(valid({ with_case: true, title: "abc", target_date: "2026-02-30" })).target_date,
    ).toContain("válida");
    expect(errorsOf(valid({ with_case: true, title: "abc", target_date: bogotaToday() }))).toEqual(
      {},
    );
    // sin caso, el título no importa
    expect(errorsOf(valid({ with_case: false, title: "" }))).toEqual({});
  });
});

describe("lo que se manda al crear o editar un paciente", () => {
  it("los vacíos pasan a «sin dato» y las listas a arreglos", () => {
    const p = patientPayload(
      valid({
        full_name: "  Ana  ",
        document_type: "CC",
        document_number: "1020304050",
        sex: "F",
        conditions: "EPOC; Asma",
        allergies: "",
        emergency_phone: "300 123 4567",
        family_updates_ok: true,
      }),
    );
    expect(p).toEqual({
      full_name: "Ana",
      document_type: "CC",
      document_number: "1020304050",
      birth_date: null,
      sex: "F",
      eps_name: null,
      city: null,
      address: null,
      modality: "remote",
      room: null,
      conditions: ["EPOC", "Asma"],
      allergies: [],
      emergency_name: null,
      emergency_phone: "300 123 4567",
      status: "active",
      family_updates_ok: true,
      external_ref: null,
    });
  });

  it("el primer caso solo viaja si se pidió; con postulación el servidor pone el nombre del profesional", () => {
    expect(firstCasePayload(valid())).toBeNull();
    const manual = firstCasePayload(
      valid({
        with_case: true,
        title: " Curaciones ",
        professional_label: "Laura Gómez",
        target_date: "2026-12-31",
        summary: "Herida quirúrgica",
      }),
    )!;
    expect(manual).toEqual({
      title: "Curaciones",
      care_type: "domiciliary",
      priority: "medium",
      status: "active",
      target_end_at: "2027-01-01T04:59:00.000Z",
      summary: "Herida quirúrgica",
      professional_label: "Laura Gómez",
    });
    const app = firstCasePayload(
      valid({
        with_case: true,
        title: "Turno IPS",
        professional_label: "Escrito a mano",
        application_id: "app-1",
      }),
    )!;
    expect(app.application_id).toBe("app-1");
    expect(app).not.toHaveProperty("professional_label");
  });

  it("editar: se cargan los datos del paciente y no se manda el estado", () => {
    const p = mkPatient({
      conditions: ["EPOC", "Asma"],
      allergies: [],
      emergency_phone: "300 123 4567",
    });
    const values = patientToFormValues(p);
    expect(values).toMatchObject({
      full_name: "Ana Lucía Pérez",
      document_type: "CC",
      conditions: "EPOC, Asma",
      allergies: "",
      birth_date: "1948-03-01",
      consent: true,
      monitor: false,
      with_case: false,
    });
    expect(patientFormSchema.safeParse(values).success).toBe(true);
    const edit = patientEditPayload(values);
    expect(edit).not.toHaveProperty("status");
    expect(edit.conditions).toEqual(["EPOC", "Asma"]);
    expect(edit.full_name).toBe("Ana Lucía Pérez");
  });

  it("al editar, un paciente sin datos opcionales no rompe el formulario", () => {
    const p = mkPatient({
      document_type: null,
      document_number: null,
      birth_date: null,
      sex: null,
      eps_name: null,
      city: null,
      address: null,
      room: null,
      emergency_name: null,
      emergency_phone: null,
      external_ref: null,
    });
    const values = patientToFormValues(p);
    expect(patientFormSchema.safeParse(values).success).toBe(true);
    expect(patientEditPayload(values)).toMatchObject({
      document_type: null,
      birth_date: null,
      sex: null,
    });
  });
});

describe("formulario de caso", () => {
  const v = { ...CASE_FORM_DEFAULTS, title: "Cuidado post-alta" };

  it("título de 3 o más letras; fecha estimada real y no pasada", () => {
    expect(caseFormSchema.safeParse(v).success).toBe(true);
    expect(caseFormSchema.safeParse({ ...v, title: "ab" }).success).toBe(false);
    expect(caseFormSchema.safeParse({ ...v, title: "x".repeat(141) }).success).toBe(false);
    expect(caseFormSchema.safeParse({ ...v, target_date: "2020-01-01" }).success).toBe(false);
    expect(caseFormSchema.safeParse({ ...v, target_date: "2026-02-30" }).success).toBe(false);
    expect(caseFormSchema.safeParse({ ...v, target_date: bogotaToday() }).success).toBe(true);
    expect(caseFormSchema.safeParse({ ...v, summary: "x".repeat(2001) }).success).toBe(false);
    expect(caseFormSchema.safeParse({ ...v, professional_label: "x".repeat(121) }).success).toBe(
      false,
    );
  });

  it("abrir un caso arranca activo; con postulación no se manda el nombre", () => {
    expect(casePayload({ ...v, application_id: "app-9", professional_label: "x" })).toMatchObject({
      status: "active",
      application_id: "app-9",
    });
    expect(casePayload({ ...v, application_id: "app-9" })).not.toHaveProperty("professional_label");
    expect(casePayload(v)).toMatchObject({ professional_label: null, target_end_at: null });
  });

  it("editar un caso: no toca el estado ni la postulación, y el nombre solo si no viene de una postulación", () => {
    const manual = caseEditPayload({ ...v, professional_label: "Laura" }, false);
    expect(manual).toMatchObject({ title: "Cuidado post-alta", professional_label: "Laura" });
    expect(manual).not.toHaveProperty("status");
    expect(manual).not.toHaveProperty("application_id");
    expect(caseEditPayload({ ...v, professional_label: "Laura" }, true)).not.toHaveProperty(
      "professional_label",
    );
  });

  it("un caso guardado vuelve al formulario con su fecha de Colombia", () => {
    const f = caseToFormValues({
      title: "Curaciones",
      care_type: "nursing",
      priority: "high",
      target_end_at: "2026-10-25T04:59:00.000Z",
      summary: null,
      professional_label: null,
      application_id: null,
    });
    expect(f).toMatchObject({
      title: "Curaciones",
      target_date: "2026-10-24",
      summary: "",
      application_id: "",
    });
  });
});

describe("tarea, nota, cierre, alta y dispositivo", () => {
  it("tarea: título de 3 o más letras y una hora válida o vacía", () => {
    const base = { title: "Llamar a la familia", kind: "call", due_local: "" } as const;
    expect(taskFormSchema.safeParse(base).success).toBe(true);
    expect(taskFormSchema.safeParse({ ...base, title: "ab" }).success).toBe(false);
    expect(taskFormSchema.safeParse({ ...base, title: "x".repeat(161) }).success).toBe(false);
    expect(taskFormSchema.safeParse({ ...base, due_local: "2026-02-31T10:00" }).success).toBe(
      false,
    );
    expect(taskPayload({ ...base, due_local: "2026-10-14T10:30" })).toEqual({
      title: "Llamar a la familia",
      kind: "call",
      dueAt: "2026-10-14T15:30:00.000Z",
    });
    expect(taskPayload(base).dueAt).toBeNull();
  });

  it("nota: 2 a 4.000 caracteres sin caracteres de control (el salto de línea sí)", () => {
    const ok = { kind: "evolution", body: "Evoluciona bien.\nSin fiebre.", case_id: "" } as const;
    expect(noteFormSchema.safeParse(ok).success).toBe(true);
    expect(noteFormSchema.safeParse({ ...ok, body: "a" }).success).toBe(false);
    expect(noteFormSchema.safeParse({ ...ok, body: "   " }).success).toBe(false);
    expect(noteFormSchema.safeParse({ ...ok, body: "x".repeat(4001) }).success).toBe(false);
    expect(noteFormSchema.safeParse({ ...ok, body: "x".repeat(4000) }).success).toBe(true);
    expect(noteFormSchema.safeParse({ ...ok, body: "texto\u0007raro" }).success).toBe(false);
    // una corrección sí se puede escribir; el relevo lo escribe solo el relevo de turno
    expect(noteFormSchema.safeParse({ ...ok, kind: "correction" }).success).toBe(true);
    expect(noteFormSchema.safeParse({ ...ok, kind: "handoff" }).success).toBe(false);
  });

  it("cerrar un caso: solo uno completado se valora; sin estrellas no viaja ni el comentario", () => {
    const base = {
      status: "completed",
      outcome: "recovered",
      satisfaction: 0,
      by: "family",
      note: "",
    } as const;
    expect(closeCaseSchema.safeParse(base).success).toBe(true);
    expect(
      closeCaseSchema.safeParse({ ...base, status: "cancelled", satisfaction: 4 }).success,
    ).toBe(false);
    expect(closeCaseSchema.safeParse({ ...base, satisfaction: 6 }).success).toBe(false);
    expect(closeCaseSchema.safeParse({ ...base, satisfaction: 1.5 }).success).toBe(false);
    expect(closeCaseSchema.safeParse({ ...base, note: "x".repeat(501) }).success).toBe(false);
    expect(closeCasePayload(base)).toEqual({
      status: "completed",
      outcome: "recovered",
      satisfaction: null,
      by: undefined,
      note: undefined,
    });
    expect(closeCasePayload({ ...base, satisfaction: 5, note: "Muy agradecidos" })).toEqual({
      status: "completed",
      outcome: "recovered",
      satisfaction: 5,
      by: "family",
      note: "Muy agradecidos",
    });
  });

  it("alta y dispositivo", () => {
    expect(dischargeSchema.safeParse({ outcome: "stable", note: "" }).success).toBe(true);
    expect(dischargeSchema.safeParse({ outcome: "huyó", note: "" }).success).toBe(false);
    expect(dischargeSchema.safeParse({ outcome: "stable", note: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(deviceFormSchema.safeParse({ label: "Reloj Samsung", kind: "smartwatch" }).success).toBe(
      true,
    );
    expect(deviceFormSchema.safeParse({ label: "R", kind: "smartwatch" }).success).toBe(false);
    expect(deviceFormSchema.safeParse({ label: "x".repeat(61), kind: "sensor" }).success).toBe(
      false,
    );
    expect(deviceFormSchema.safeParse({ label: "Reloj <1>", kind: "sensor" }).success).toBe(false);
    expect(deviceFormSchema.safeParse({ label: "Reloj", kind: "nevera" }).success).toBe(false);
  });
});

describe("las opciones coinciden con las etiquetas del resto de la app", () => {
  it("mismas claves y mismos nombres", () => {
    expect(MODALITY_OPTIONS.map((o) => o.value)).toEqual(MODALITY_ORDER);
    expect(CARE_TYPE_OPTIONS.map((o) => [o.value, o.label])).toEqual(
      Object.entries(CARE_TYPE_META).map(([k, m]) => [k, m.label]),
    );
    expect(PRIORITY_OPTIONS.map((o) => [o.value, o.label])).toEqual(
      ["low", "medium", "high", "urgent"].map((k) => [
        k,
        PRIORITY_META[k as keyof typeof PRIORITY_META].label,
      ]),
    );
    expect(NOTE_KIND_OPTIONS.map((o) => o.value)).toEqual(WRITABLE_NOTE_KINDS);
    expect(NOTE_WRITE_KINDS).toEqual([...NOTE_KIND_OPTIONS.map((o) => o.value), "correction"]);
    expect(TASK_KIND_OPTIONS.map((o) => [o.value, o.label])).toEqual(
      Object.entries(TASK_KIND_LABEL),
    );
    expect(OUTCOME_OPTIONS.map((o) => [o.value, o.label])).toEqual(Object.entries(OUTCOME_LABEL));
  });
});

// ── Contrato con la base de datos ───────────────────────────────────────────────────────────────────────────────────
// Si alguien cambia una lista de valores en la migración (o en una opción de pantalla) sin cambiar la otra, esto falla.

const SQL = readFileSync(
  require("node:path").resolve(process.cwd(), "supabase/migrations/20261014100000_institution_care_core.sql"),
  "utf8",
);

function tableBlock(name: string): string {
  const start = SQL.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  expect(start, `tabla ${name}`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("\n);", start));
}

function dbEnum(table: string, column: string): string[] {
  const m = new RegExp(`\\b${column}\\s+IN \\(([^)]*)\\)`).exec(tableBlock(table));
  expect(m, `${table}.${column}`).not.toBeNull();
  return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

describe("contrato con la migración", () => {
  const sorted = (a: readonly string[]) => [...a].sort();

  it("documento, sexo y modalidad del paciente", () => {
    expect(sorted(DOC_TYPE_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_patients", "document_type")),
    );
    expect(sorted(SEX_OPTIONS.map((o) => o.value))).toEqual(sorted(dbEnum("inst_patients", "sex")));
    expect(sorted(MODALITY_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_patients", "modality")),
    );
  });

  it("tipo y prioridad del caso, desenlaces y quién valora", () => {
    expect(sorted(CARE_TYPE_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_cases", "care_type")),
    );
    expect(sorted(PRIORITY_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_cases", "priority")),
    );
    expect(sorted(OUTCOME_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_cases", "outcome")),
    );
    expect(sorted(SATISFACTION_BY_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_cases", "satisfaction_by")),
    );
  });

  it("tareas, dispositivos y notas (el relevo no se escribe a mano)", () => {
    expect(sorted(TASK_KIND_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_tasks", "kind")),
    );
    expect(sorted(DEVICE_KIND_OPTIONS.map((o) => o.value))).toEqual(
      sorted(dbEnum("inst_devices", "kind")),
    );
    const noteKinds = dbEnum("inst_notes", "kind");
    expect(sorted([...NOTE_KIND_OPTIONS.map((o) => o.value), "handoff", "correction"])).toEqual(
      sorted(noteKinds),
    );
  });

  it("largos de texto iguales a los de la base", () => {
    const patients = tableBlock("inst_patients");
    expect(patients).toContain("hx_name_ok(full_name, 2, 120)");
    expect(patients).toContain("hx_text_ok(eps_name, 80)");
    expect(patients).toContain("hx_text_ok(city, 80)");
    expect(patients).toContain("hx_text_ok(address, 200)");
    expect(patients).toContain("hx_text_ok(room, 40)");
    expect(patients).toContain("hx_text_ok(external_ref, 40)");
    expect(patients).toContain("hx_text_array_ok(conditions, 20, 80)");
    expect(patients).toContain("{7,20}");
    expect(patients).toContain("BETWEEN 4 AND 20");
    expect(tableBlock("inst_cases")).toContain("hx_name_ok(title, 3, 140)");
    expect(tableBlock("inst_cases")).toContain("hx_text_ok(summary, 2000)");
    expect(tableBlock("inst_tasks")).toContain("hx_name_ok(title, 3, 160)");
    expect(tableBlock("inst_devices")).toContain("hx_name_ok(label, 2, 60)");
    expect(tableBlock("inst_notes")).toContain("hx_text_ok(body, 4000)");
  });
});
