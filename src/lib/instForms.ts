// Formularios de Pacientes y Monitoreo — un solo camino de validación (Zod) para react-hook-form, con las MISMAS reglas que la base de datos
// (migración 20261014100000): lo que aquí pasa, allá pasa; y los mensajes salen antes de viajar a la red. Lógica pura: la hora de
// Colombia entra como parámetro donde hace falta.

import { z } from "zod";
import { MODALITY_ORDER, thousandsEs } from "./instCare";
import type {
  CareType,
  CasePriority,
  DeviceKind,
  NoteKind,
  PatientModality,
  TaskKind,
} from "./instCareTypes";

const BOGOTA_OFFSET_MIN = -5 * 60;

// ── Opciones de los selectores (etiquetas en español) ────────────────────────────────────────────────────────────────

export const DOC_TYPE_OPTIONS = [
  { value: "CC", label: "Cédula de ciudadanía" },
  { value: "TI", label: "Tarjeta de identidad" },
  { value: "RC", label: "Registro civil" },
  { value: "CE", label: "Cédula de extranjería" },
  { value: "PA", label: "Pasaporte" },
  { value: "PEP", label: "Permiso especial de permanencia" },
  { value: "PPT", label: "Permiso por protección temporal" },
  { value: "OTRO", label: "Otro documento" },
] as const;

export const SEX_OPTIONS = [
  { value: "F", label: "Femenino" },
  { value: "M", label: "Masculino" },
  { value: "O", label: "Otro" },
] as const;

export const MODALITY_OPTIONS: ReadonlyArray<{ value: PatientModality; label: string }> = [
  { value: "hospital", label: "Hospitalizado" },
  { value: "remote", label: "Remoto" },
  { value: "postop", label: "Posoperatorio" },
  { value: "chronic", label: "Crónico" },
  { value: "elder", label: "Adulto mayor" },
];

export const CARE_TYPE_OPTIONS: ReadonlyArray<{ value: CareType; label: string }> = [
  { value: "domiciliary", label: "Atención domiciliaria" },
  { value: "nursing", label: "Enfermería" },
  { value: "postop", label: "Posoperatorio" },
  { value: "elder", label: "Adulto mayor" },
  { value: "palliative", label: "Cuidado paliativo" },
  { value: "chronic", label: "Enfermedad crónica" },
  { value: "rehab", label: "Rehabilitación" },
  { value: "other", label: "Otro" },
];

export const PRIORITY_OPTIONS: ReadonlyArray<{ value: CasePriority; label: string }> = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

export const NOTE_KIND_OPTIONS: ReadonlyArray<{ value: NoteKind; label: string; hint: string }> = [
  { value: "evolution", label: "Evolución", hint: "Cómo va la persona hoy" },
  { value: "nursing", label: "Enfermería", hint: "Cuidados, curaciones, medicamentos" },
  { value: "coordination", label: "Coordinación", hint: "Citas, autorizaciones, traslados" },
  { value: "family", label: "Familia", hint: "Lo hablado con la familia" },
  { value: "incident", label: "Incidente", hint: "Caídas, errores, eventos adversos" },
];

export const TASK_KIND_OPTIONS: ReadonlyArray<{ value: TaskKind; label: string }> = [
  { value: "call", label: "Llamada" },
  { value: "visit", label: "Visita" },
  { value: "medication", label: "Medicamentos" },
  { value: "lab", label: "Laboratorio" },
  { value: "education", label: "Educación" },
  { value: "followup", label: "Seguimiento" },
  { value: "obs_round", label: "Ronda de signos" },
  { value: "other", label: "Otra" },
];

export const OUTCOME_OPTIONS = [
  { value: "recovered", label: "Recuperado" },
  { value: "stable", label: "Estable" },
  { value: "referred", label: "Remitido a otro servicio" },
  { value: "withdrawn", label: "Retiro del servicio" },
  { value: "deceased", label: "Fallecimiento" },
  { value: "other", label: "Otro motivo" },
] as const;

export const DEVICE_KIND_OPTIONS: ReadonlyArray<{ value: DeviceKind; label: string }> = [
  { value: "smartwatch", label: "Reloj inteligente" },
  { value: "smartphone", label: "Celular" },
  { value: "sensor", label: "Sensor" },
  { value: "monitor", label: "Monitor" },
];

export const SATISFACTION_BY_OPTIONS = [
  { value: "patient", label: "La persona atendida" },
  { value: "family", label: "La familia" },
  { value: "coordinator", label: "Quien coordina" },
] as const;

// ── Fechas y horas de Colombia ───────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** «2026-10-14» según la hora de Colombia. */
export function bogotaToday(now: Date | number = Date.now()): string {
  const t = typeof now === "number" ? now : now.getTime();
  return new Date(t + BOGOTA_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Lo que escribe `<input type="datetime-local">` («2026-10-14T10:30») leído como hora de Colombia → instante ISO. `null` si no es válido. */
export function bogotaLocalToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((local ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const t = Date.UTC(y, mo - 1, d, h, mi) - BOGOTA_OFFSET_MIN * 60_000;
  const back = new Date(t + BOGOTA_OFFSET_MIN * 60_000);
  // Rechaza fechas que se «corrigen» solas (31 de febrero, hora 25).
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi
  )
    return null;
  return new Date(t).toISOString();
}

/** Instante → «2026-10-14T10:30» en hora de Colombia, para `<input type="datetime-local">`. */
export function isoToBogotaLocal(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + BOGOTA_OFFSET_MIN * 60_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** «2026-10-24» (fecha elegida) → fin de ese día en Colombia, como instante ISO. `null` si no es una fecha real. */
export function endOfBogotaDayIso(date: string | null | undefined): string | null {
  return bogotaLocalToIso(`${(date ?? "").trim()}T23:59`);
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ── Listas escritas a mano («EPOC, Hipertensión; Diabetes») ───────────────────────────────────────────────────────────

/* eslint-disable no-control-regex -- los caracteres de control son justo lo que se quiere rechazar */
const TAGS_OR_CONTROL = /[\u0000-\u001f\u007f<>]/;
/** Control salvo el salto de línea y la tabulación (texto de varias líneas). */
const CONTROL_NOT_NEWLINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/* eslint-enable no-control-regex */

/** Separa por coma, punto y coma o salto de línea; quita espacios y repetidos (sin distinguir mayúsculas). */
export function parseList(
  raw: string | null | undefined,
  opts: { maxItems?: number; maxLen?: number } = {},
): { items: string[]; error: string | null } {
  const maxItems = opts.maxItems ?? 20;
  const maxLen = opts.maxLen ?? 80;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of (raw ?? "").split(/[,;\n]+/)) {
    const t = part.trim().replace(/\s+/g, " ");
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t);
  }
  if (items.length > maxItems) return { items, error: `Máximo ${maxItems} elementos.` };
  const long = items.find((i) => i.length > maxLen);
  if (long) return { items, error: `Cada elemento admite hasta ${maxLen} caracteres.` };
  if (items.some((i) => TAGS_OR_CONTROL.test(i)))
    return { items, error: "No uses los signos < ni > ni caracteres de control." };
  return { items, error: null };
}

// ── Piezas de esquema ────────────────────────────────────────────────────────────────────────────────────────────────

/** Texto de una línea, opcional; el vacío vale «sin dato». */
const optionalLine = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: máximo ${max} caracteres.`)
    .refine(
      (v) => !TAGS_OR_CONTROL.test(v),
      `${label}: no uses los signos < ni > ni caracteres de control.`,
    );

/** Texto libre opcional (admite saltos de línea; sin caracteres de control). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}: máximo ${max} caracteres.`)
    .refine((v) => !CONTROL_NOT_NEWLINE.test(v), `${label}: contiene caracteres no válidos.`);

const MODALITIES = MODALITY_ORDER as [PatientModality, ...PatientModality[]];

// ── Paciente ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const caseFields = {
  title: optionalLine(140, "Título del caso"),
  care_type: z.enum(CARE_TYPE_OPTIONS.map((o) => o.value) as [CareType, ...CareType[]]),
  priority: z.enum(PRIORITY_OPTIONS.map((o) => o.value) as [CasePriority, ...CasePriority[]]),
  /** Fecha estimada de cierre («YYYY-MM-DD»), opcional. */
  target_date: z.string().trim(),
  summary: optionalText(2000, "Resumen"),
  professional_label: optionalLine(120, "Profesional"),
  /** Postulación aceptada de la que nace el caso (vacío = caso manual). */
  application_id: z.string().trim(),
};

export const patientFormSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, "Escribe el nombre completo (al menos 2 letras).")
      .max(120, "El nombre admite hasta 120 caracteres.")
      .refine((v) => !TAGS_OR_CONTROL.test(v), "El nombre no puede llevar los signos < ni >."),
    document_type: z.enum(["", ...DOC_TYPE_OPTIONS.map((o) => o.value)] as [string, ...string[]]),
    document_number: z.string().trim(),
    birth_date: z.string().trim(),
    sex: z.enum(["", "F", "M", "O"]),
    eps_name: optionalLine(80, "EPS"),
    city: optionalLine(80, "Ciudad"),
    address: optionalLine(200, "Dirección"),
    modality: z.enum(MODALITIES),
    room: optionalLine(40, "Habitación o cama"),
    conditions: z.string(),
    allergies: z.string(),
    emergency_name: optionalLine(80, "Contacto de emergencia"),
    emergency_phone: z.string().trim(),
    external_ref: optionalLine(40, "Historia clínica o referencia"),
    status: z.enum(["active", "pending"]),
    family_updates_ok: z.boolean(),
    monitor: z.boolean(),
    with_case: z.boolean(),
    ...caseFields,
    consent: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.document_number) {
      if (!v.document_type) issue("document_type", "Elige el tipo de documento.");
      if (
        v.document_number.length < 4 ||
        v.document_number.length > 20 ||
        !/^[A-Za-z0-9.-]+$/.test(v.document_number)
      )
        issue("document_number", "El documento lleva de 4 a 20 letras, números, punto o guion.");
    }
    if (v.birth_date) {
      if (!isRealDate(v.birth_date)) issue("birth_date", "Escribe una fecha de nacimiento válida.");
      else if (v.birth_date < "1900-01-01")
        issue("birth_date", "La fecha de nacimiento es demasiado antigua.");
      else if (v.birth_date > bogotaToday())
        issue("birth_date", "La fecha de nacimiento no puede ser futura.");
    }
    if (v.emergency_phone && !/^[0-9+() -]{7,20}$/.test(v.emergency_phone))
      issue(
        "emergency_phone",
        "El teléfono lleva de 7 a 20 números (puede incluir +, paréntesis y guiones).",
      );
    for (const f of ["conditions", "allergies"] as const) {
      const r = parseList(v[f]);
      if (r.error) issue(f, r.error);
    }
    if (v.monitor && v.status !== "active")
      issue("monitor", "Solo un paciente activo puede entrar a monitoreo.");
    if (v.with_case) {
      if (v.title.length < 3) issue("title", "El título del caso lleva al menos 3 caracteres.");
      if (v.target_date) {
        if (!endOfBogotaDayIso(v.target_date)) issue("target_date", "Escribe una fecha válida.");
        else if (v.target_date < bogotaToday())
          issue("target_date", "La fecha estimada no puede ser anterior a hoy.");
      }
    }
    if (!v.consent)
      issue(
        "consent",
        "Confirma que la institución cuenta con la autorización del paciente o de su acudiente.",
      );
  });

export type PatientFormValues = z.infer<typeof patientFormSchema>;

export const PATIENT_FORM_DEFAULTS: PatientFormValues = {
  full_name: "",
  document_type: "",
  document_number: "",
  birth_date: "",
  sex: "",
  eps_name: "",
  city: "",
  address: "",
  modality: "remote",
  room: "",
  conditions: "",
  allergies: "",
  emergency_name: "",
  emergency_phone: "",
  external_ref: "",
  status: "active",
  family_updates_ok: false,
  monitor: false,
  with_case: false,
  title: "",
  care_type: "domiciliary",
  priority: "medium",
  target_date: "",
  summary: "",
  professional_label: "",
  application_id: "",
  consent: false,
};

// ── Lo que se manda a la base ────────────────────────────────────────────────────────────────────────────────────────

export interface PatientPayload {
  full_name: string;
  document_type?: string | null;
  document_number?: string | null;
  birth_date?: string | null;
  sex?: "F" | "M" | "O" | null;
  eps_name?: string | null;
  city?: string | null;
  address?: string | null;
  modality?: string;
  room?: string | null;
  conditions?: string[];
  allergies?: string[];
  emergency_name?: string | null;
  emergency_phone?: string | null;
  status?: "pending" | "active";
  family_updates_ok?: boolean;
  external_ref?: string | null;
}

export interface CasePayload {
  title?: string;
  care_type?: string;
  priority?: string;
  status?: "pending" | "active";
  target_end_at?: string | null;
  summary?: string | null;
  professional_label?: string | null;
  application_id?: string | null;
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Todos los campos (el alta los manda todos; en una edición, los que cambian). */
export function patientPayload(v: PatientFormValues): PatientPayload {
  return {
    full_name: v.full_name.trim(),
    document_type: orNull(v.document_type),
    document_number: orNull(v.document_number),
    birth_date: orNull(v.birth_date),
    sex: (orNull(v.sex) as "F" | "M" | "O" | null) ?? null,
    eps_name: orNull(v.eps_name),
    city: orNull(v.city),
    address: orNull(v.address),
    modality: v.modality,
    room: orNull(v.room),
    conditions: parseList(v.conditions).items,
    allergies: parseList(v.allergies).items,
    emergency_name: orNull(v.emergency_name),
    emergency_phone: orNull(v.emergency_phone),
    status: v.status,
    family_updates_ok: v.family_updates_ok,
    external_ref: orNull(v.external_ref),
  };
}

/** El primer caso del alta (o `null` si no se pidió). */
export function firstCasePayload(v: PatientFormValues): CasePayload | null {
  if (!v.with_case) return null;
  return casePayloadOf(v);
}

function casePayloadOf(v: {
  title: string;
  care_type: string;
  priority: string;
  target_date: string;
  summary: string;
  professional_label: string;
  application_id: string;
}): CasePayload {
  const app = orNull(v.application_id);
  return {
    title: v.title.trim(),
    care_type: v.care_type,
    priority: v.priority,
    status: "active",
    target_end_at: v.target_date ? endOfBogotaDayIso(v.target_date) : null,
    summary: orNull(v.summary),
    // Con postulación, el servidor pone el nombre del profesional: no se manda uno escrito a mano.
    ...(app ? { application_id: app } : { professional_label: orNull(v.professional_label) }),
  };
}

/** Los datos de un paciente ya guardado, como valores del formulario (para editarlo). */
export function patientToFormValues(p: {
  full_name: string;
  document_type: string | null;
  document_number: string | null;
  birth_date: string | null;
  sex: string | null;
  eps_name: string | null;
  city: string | null;
  address: string | null;
  modality: PatientModality;
  room: string | null;
  conditions: string[];
  allergies: string[];
  emergency_name: string | null;
  emergency_phone: string | null;
  external_ref: string | null;
  family_updates_ok: boolean;
}): PatientFormValues {
  return {
    ...PATIENT_FORM_DEFAULTS,
    full_name: p.full_name,
    document_type: p.document_type ?? "",
    document_number: p.document_number ?? "",
    birth_date: p.birth_date?.slice(0, 10) ?? "",
    sex: (p.sex as "F" | "M" | "O" | null) ?? "",
    eps_name: p.eps_name ?? "",
    city: p.city ?? "",
    address: p.address ?? "",
    modality: p.modality,
    room: p.room ?? "",
    conditions: p.conditions.join(", "),
    allergies: p.allergies.join(", "),
    emergency_name: p.emergency_name ?? "",
    emergency_phone: p.emergency_phone ?? "",
    external_ref: p.external_ref ?? "",
    // El estado y el monitoreo se cambian con sus propias acciones: al editar no se piden ni se mandan.
    status: "active",
    family_updates_ok: p.family_updates_ok,
    monitor: false,
    // La autorización ya se confirmó al registrar al paciente: al editar no se vuelve a pedir.
    consent: true,
  };
}

/** Lo que se manda al editar: los datos del paciente, sin el estado (tiene su propia acción). */
export function patientEditPayload(v: PatientFormValues): PatientPayload {
  const { status: _status, ...rest } = patientPayload(v);
  void _status;
  return rest;
}

// ── Caso ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const caseFormSchema = z.object(caseFields).superRefine((v, ctx) => {
  if (v.title.length < 3)
    ctx.addIssue({
      code: "custom",
      path: ["title"],
      message: "El título del caso lleva al menos 3 caracteres.",
    });
  if (v.target_date) {
    if (!endOfBogotaDayIso(v.target_date))
      ctx.addIssue({ code: "custom", path: ["target_date"], message: "Escribe una fecha válida." });
    else if (v.target_date < bogotaToday())
      ctx.addIssue({
        code: "custom",
        path: ["target_date"],
        message: "La fecha estimada no puede ser anterior a hoy.",
      });
  }
});
export type CaseFormValues = z.infer<typeof caseFormSchema>;

export const CASE_FORM_DEFAULTS: CaseFormValues = {
  title: "",
  care_type: "domiciliary",
  priority: "medium",
  target_date: "",
  summary: "",
  professional_label: "",
  application_id: "",
};

export function casePayload(v: CaseFormValues): CasePayload {
  return casePayloadOf(v);
}

/** Lo que se cambia al editar un caso abierto (no se toca la postulación ni el estado). */
export function caseEditPayload(v: CaseFormValues, hasApplication: boolean): CasePayload {
  return {
    title: v.title.trim(),
    care_type: v.care_type,
    priority: v.priority,
    target_end_at: v.target_date ? endOfBogotaDayIso(v.target_date) : null,
    summary: orNull(v.summary),
    ...(hasApplication ? {} : { professional_label: orNull(v.professional_label) }),
  };
}

export function caseToFormValues(c: {
  title: string;
  care_type: CareType;
  priority: CasePriority;
  target_end_at: string | null;
  summary: string | null;
  professional_label: string | null;
  application_id: string | null;
}): CaseFormValues {
  return {
    title: c.title,
    care_type: c.care_type,
    priority: c.priority,
    target_date: c.target_end_at ? bogotaToday(Date.parse(c.target_end_at)) : "",
    summary: c.summary ?? "",
    professional_label: c.professional_label ?? "",
    application_id: c.application_id ?? "",
  };
}

// ── Tarea, nota, cierre, alta y dispositivo ───────────────────────────────────────────────────────────────────────────

export const taskFormSchema = z
  .object({
    title: optionalLine(160, "Tarea"),
    kind: z.enum(TASK_KIND_OPTIONS.map((o) => o.value) as [TaskKind, ...TaskKind[]]),
    /** «YYYY-MM-DDTHH:mm» en hora de Colombia (vacío = mañana a esta hora). */
    due_local: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.title.length < 3)
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "Describe la tarea (al menos 3 letras).",
      });
    if (v.due_local && !bogotaLocalToIso(v.due_local))
      ctx.addIssue({
        code: "custom",
        path: ["due_local"],
        message: "Escribe una fecha y hora válidas.",
      });
  });
export type TaskFormValues = z.infer<typeof taskFormSchema>;

export function taskPayload(v: TaskFormValues): {
  title: string;
  kind: string;
  dueAt: string | null;
} {
  return {
    title: v.title.trim(),
    kind: v.kind,
    dueAt: v.due_local ? bogotaLocalToIso(v.due_local) : null,
  };
}

export const NOTE_MAX = 4000;

/** Lo que una persona puede escribir: los cinco tipos de nota y la corrección de una nota anterior (el relevo lo escribe solo el relevo). */
export const NOTE_WRITE_KINDS: [NoteKind, ...NoteKind[]] = [
  "evolution",
  "nursing",
  "coordination",
  "family",
  "incident",
  "correction",
];

export const noteFormSchema = z.object({
  kind: z.enum(NOTE_WRITE_KINDS),
  body: z
    .string()
    .trim()
    .min(2, "Escribe la nota.")
    .max(NOTE_MAX, `La nota admite hasta ${thousandsEs(NOTE_MAX)} caracteres.`)
    .refine((v) => !CONTROL_NOT_NEWLINE.test(v), "La nota contiene caracteres no válidos."),
  case_id: z.string().trim(),
});
export type NoteFormValues = z.infer<typeof noteFormSchema>;

export const closeCaseSchema = z
  .object({
    status: z.enum(["completed", "cancelled"]),
    outcome: z.enum(OUTCOME_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    /** 0 = sin valoración. */
    satisfaction: z.number().int().min(0).max(5),
    by: z.enum(SATISFACTION_BY_OPTIONS.map((o) => o.value) as [string, ...string[]]),
    note: optionalText(500, "Comentario"),
  })
  .superRefine((v, ctx) => {
    if (v.status === "cancelled" && v.satisfaction > 0)
      ctx.addIssue({
        code: "custom",
        path: ["satisfaction"],
        message: "Solo un caso completado se valora.",
      });
  });
export type CloseCaseValues = z.infer<typeof closeCaseSchema>;

export function closeCasePayload(v: CloseCaseValues) {
  return {
    status: v.status,
    outcome: v.outcome,
    satisfaction: v.satisfaction > 0 ? v.satisfaction : null,
    by: v.satisfaction > 0 ? v.by : undefined,
    note: v.satisfaction > 0 ? v.note : undefined,
  };
}

export const dischargeSchema = z.object({
  outcome: z.enum(OUTCOME_OPTIONS.map((o) => o.value) as [string, ...string[]]),
  note: optionalText(500, "Nota del alta"),
});
export type DischargeValues = z.infer<typeof dischargeSchema>;

export const deviceFormSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Ponle un nombre (al menos 2 letras).")
    .max(60, "El nombre admite hasta 60 caracteres.")
    .refine((v) => !TAGS_OR_CONTROL.test(v), "El nombre no puede llevar los signos < ni >."),
  kind: z.enum(DEVICE_KIND_OPTIONS.map((o) => o.value) as [DeviceKind, ...DeviceKind[]]),
});
export type DeviceFormValues = z.infer<typeof deviceFormSchema>;
