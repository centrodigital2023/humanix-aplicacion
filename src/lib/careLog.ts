// Parte del turno (bitácora asistencial) — lógica pura, sin base de datos.
//
// Espejo de `public.care_logs` y de su guardia `care_logs_guard` (supabase/migrations/20261010100000_care_loop.sql):
// el servidor es quien manda — solo el profesional del servicio escribe, solo mientras está en curso, la llegada y
// la salida se registran solas y los textos no llevan contacto ni datos de pago. Aquí se valida lo mismo en el
// formulario para dar un mensaje claro ANTES de viajar, se sugieren alertas con rangos de referencia y se resume
// el parte para la familia. Si cambias un rango o una lista, cambia también la migración y sus pruebas.

import { z } from "zod";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "./opportunities";

// ─── Tipos de evento y ánimo ─────────────────────────────────────────────────

export const CARE_EVENT_TYPES = [
  "arrival",
  "medication",
  "vital_signs",
  "meal",
  "activity",
  "note",
  "incident",
  "departure",
] as const;
export type CareEventType = (typeof CARE_EVENT_TYPES)[number];

/** Lo que el profesional escribe a mano. Llegada y salida las genera el sistema al cambiar el estado. */
export const MANUAL_EVENT_TYPES = [
  "medication",
  "vital_signs",
  "meal",
  "activity",
  "note",
  "incident",
] as const;
export type ManualEventType = (typeof MANUAL_EVENT_TYPES)[number];

export function isManualEvent(type: string): type is ManualEventType {
  return (MANUAL_EVENT_TYPES as readonly string[]).includes(type);
}

export interface EventMeta {
  label: string;
  /** Nombre del icono de lucide-react (el componente lo resuelve). */
  icon:
    | "Home"
    | "Pill"
    | "Activity"
    | "Utensils"
    | "PersonStanding"
    | "FileText"
    | "AlertTriangle"
    | "LogOut";
  /** Clases de color con tokens semánticos (sin hex). */
  tone: string;
}

export const EVENT_META: Record<CareEventType, EventMeta> = {
  arrival: { label: "Llegada", icon: "Home", tone: "text-biosensor bg-biosensor/10" },
  medication: { label: "Medicamento", icon: "Pill", tone: "text-copper bg-copper/10" },
  vital_signs: {
    label: "Signos vitales",
    icon: "Activity",
    tone: "text-fuchsia-neural bg-fuchsia-neural/10",
  },
  meal: { label: "Alimentación", icon: "Utensils", tone: "text-ok bg-ok/10" },
  activity: { label: "Actividad", icon: "PersonStanding", tone: "text-trust bg-trust/10" },
  note: { label: "Nota", icon: "FileText", tone: "text-muted-foreground bg-muted" },
  incident: { label: "Incidente", icon: "AlertTriangle", tone: "text-sos bg-sos/10" },
  departure: { label: "Fin del turno", icon: "LogOut", tone: "text-muted-foreground bg-muted" },
};

export const CARE_MOODS = ["happy", "calm", "tired", "sad", "pain", "agitated"] as const;
export type CareMood = (typeof CARE_MOODS)[number];

export const MOOD_META: Record<CareMood, { label: string; emoji: string; tone: string }> = {
  happy: { label: "Contento/a", emoji: "😊", tone: "text-ok bg-ok/10" },
  calm: { label: "Tranquilo/a", emoji: "🙂", tone: "text-biosensor bg-biosensor/10" },
  tired: { label: "Cansado/a", emoji: "😴", tone: "text-muted-foreground bg-muted" },
  sad: { label: "Decaído/a", emoji: "😔", tone: "text-trust bg-trust/10" },
  pain: { label: "Con dolor", emoji: "😣", tone: "text-warn bg-warn/10" },
  agitated: { label: "Inquieto/a", emoji: "😟", tone: "text-sos bg-sos/10" },
};

export function isCareMood(v: unknown): v is CareMood {
  return typeof v === "string" && (CARE_MOODS as readonly string[]).includes(v);
}

/** Frase corta para la familia a partir del último ánimo registrado. */
export function moodHeadline(mood: CareMood | null | undefined): string | null {
  if (!mood) return null;
  switch (mood) {
    case "happy":
      return "Pasó un buen turno: estuvo contento/a.";
    case "calm":
      return "El turno transcurrió con tranquilidad.";
    case "tired":
      return "Estuvo cansado/a durante el turno.";
    case "sad":
      return "Estuvo decaído/a; vale la pena acompañarlo/a.";
    case "pain":
      return "Refirió dolor durante el turno.";
    case "agitated":
      return "Estuvo inquieto/a durante el turno.";
  }
}

// ─── Atajos de un toque ──────────────────────────────────────────────────────

export interface CarePreset {
  id: string;
  label: string;
  type: ManualEventType;
  text: string;
  mood?: CareMood;
}

/**
 * Registrar en menos de diez segundos: cada atajo ya trae tipo y texto. Todos los textos pasan los mismos
 * filtros que el servidor (sin teléfonos ni datos de pago) — lo verifica la prueba.
 */
export const CARE_PRESETS: CarePreset[] = [
  {
    id: "meds_taken",
    label: "Tomó sus medicamentos",
    type: "medication",
    text: "Tomó sus medicamentos a la hora indicada.",
  },
  {
    id: "meds_refused",
    label: "Rechazó un medicamento",
    type: "medication",
    text: "Rechazó un medicamento; se le explicó y se le ofreció de nuevo. Queda pendiente informar al médico.",
  },
  {
    id: "breakfast",
    label: "Desayunó bien",
    type: "meal",
    text: "Desayunó completo y sin dificultad.",
  },
  {
    id: "lunch",
    label: "Almorzó bien",
    type: "meal",
    text: "Almorzó con apetito y sin dificultad para tragar.",
  },
  { id: "dinner", label: "Cenó bien", type: "meal", text: "Cenó completo y sin molestias." },
  {
    id: "hydration",
    label: "Tomó líquidos",
    type: "meal",
    text: "Se mantuvo hidratado/a: tomó líquidos con regularidad.",
  },
  {
    id: "walk",
    label: "Caminó / ejercicios",
    type: "activity",
    text: "Realizó su caminata y los ejercicios indicados, con buena tolerancia.",
  },
  {
    id: "hygiene",
    label: "Aseo y cambio de ropa",
    type: "activity",
    text: "Se realizó el aseo personal y el cambio de ropa, con comodidad.",
  },
  {
    id: "rest",
    label: "Descansó",
    type: "activity",
    text: "Descansó y durmió una siesta tranquila.",
  },
  {
    id: "visit",
    label: "Recibió visita",
    type: "activity",
    text: "Recibió visita familiar y la disfrutó.",
    mood: "happy",
  },
  {
    id: "good_mood",
    label: "De buen ánimo",
    type: "note",
    text: "Estuvo de buen ánimo y conversó con gusto.",
    mood: "happy",
  },
  {
    id: "needs_company",
    label: "Necesita compañía",
    type: "note",
    text: "Se le notó decaído/a; conviene que lo/la visiten o le llamen hoy.",
    mood: "sad",
  },
];

// ─── Signos vitales ──────────────────────────────────────────────────────────

/** Mismos rangos que los CHECK de `care_logs` (cualquier valor fuera de aquí la base de datos lo rechaza). */
export const VITAL_LIMITS = {
  systolic: { min: 50, max: 250, label: "Sistólica", unit: "mmHg" },
  diastolic: { min: 30, max: 150, label: "Diastólica", unit: "mmHg" },
  heartRate: { min: 20, max: 300, label: "Frecuencia cardíaca", unit: "lpm" },
  temperature: { min: 30, max: 45, label: "Temperatura", unit: "°C" },
  oxygen: { min: 50, max: 100, label: "Saturación de oxígeno", unit: "%" },
} as const;
export type VitalKey = keyof typeof VITAL_LIMITS;

export interface Vitals {
  systolic?: number | null;
  diastolic?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  oxygen?: number | null;
}

export type VitalLevel = "watch" | "alert";
export interface VitalFlag {
  key: VitalKey;
  level: VitalLevel;
  message: string;
}

export const VITALS_DISCLAIMER =
  "Referencia general para adultos en reposo; no es un diagnóstico. Sigue siempre el criterio del médico tratante.";

const has = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * Sugerencia de alertas con rangos generales de adultos en reposo. NO decide por el profesional: solo le propone
 * marcar la alerta (la familia y su círculo reciben el aviso al instante). Cada paciente puede tener metas
 * distintas (por ejemplo, EPOC), por eso el profesional siempre confirma.
 */
export function vitalFlags(v: Vitals): VitalFlag[] {
  const out: VitalFlag[] = [];
  if (has(v.oxygen)) {
    if (v.oxygen < 90)
      out.push({ key: "oxygen", level: "alert", message: `Saturación baja (${v.oxygen}%).` });
    else if (v.oxygen < 94)
      out.push({ key: "oxygen", level: "watch", message: `Saturación algo baja (${v.oxygen}%).` });
  }
  if (has(v.temperature)) {
    if (v.temperature >= 39 || v.temperature < 35)
      out.push({
        key: "temperature",
        level: "alert",
        message: `Temperatura fuera de rango (${v.temperature} °C).`,
      });
    else if (v.temperature >= 38)
      out.push({ key: "temperature", level: "watch", message: `Fiebre (${v.temperature} °C).` });
  }
  if (has(v.systolic) || has(v.diastolic)) {
    const s = has(v.systolic) ? v.systolic : null;
    const d = has(v.diastolic) ? v.diastolic : null;
    if ((s !== null && (s >= 180 || s < 90)) || (d !== null && d >= 120)) {
      out.push({
        key: "systolic",
        level: "alert",
        message: `Presión arterial fuera de rango (${s ?? "?"}/${d ?? "?"}).`,
      });
    } else if ((s !== null && (s >= 140 || s < 100)) || (d !== null && d >= 90)) {
      out.push({
        key: "systolic",
        level: "watch",
        message: `Presión arterial a vigilar (${s ?? "?"}/${d ?? "?"}).`,
      });
    }
  }
  if (has(v.heartRate)) {
    if (v.heartRate > 120 || v.heartRate < 45)
      out.push({
        key: "heartRate",
        level: "alert",
        message: `Frecuencia cardíaca fuera de rango (${v.heartRate} lpm).`,
      });
    else if (v.heartRate > 100 || v.heartRate < 55)
      out.push({
        key: "heartRate",
        level: "watch",
        message: `Frecuencia cardíaca a vigilar (${v.heartRate} lpm).`,
      });
  }
  return out;
}

export function suggestsAlert(flags: VitalFlag[]): boolean {
  return flags.some((f) => f.level === "alert");
}

/**
 * Lee los campos de texto del formulario (con coma decimal, vacíos, basura) sin lanzar errores, para mostrar las
 * señales de rango MIENTRAS el profesional escribe. La validación real es `careLogFormSchema`.
 */
export function parseLooseVitals(input: {
  systolic?: unknown;
  diastolic?: unknown;
  heartRate?: unknown;
  temperature?: unknown;
  oxygen?: unknown;
}): Vitals {
  const read = (v: unknown, key: VitalKey): number | undefined => {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === ""))
      return undefined;
    const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
    const { min, max } = VITAL_LIMITS[key];
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  return {
    systolic: read(input.systolic, "systolic"),
    diastolic: read(input.diastolic, "diastolic"),
    heartRate: read(input.heartRate, "heartRate"),
    temperature: read(input.temperature, "temperature"),
    oxygen: read(input.oxygen, "oxygen"),
  };
}

/** «PA 120/80 · FC 72 · T 36.5 °C · SpO₂ 97 %». Vacío si no hay ningún valor. */
export function formatVitals(v: Vitals): string {
  const parts: string[] = [];
  if (has(v.systolic) || has(v.diastolic))
    parts.push(`PA ${v.systolic ?? "?"}/${v.diastolic ?? "?"}`);
  if (has(v.heartRate)) parts.push(`FC ${v.heartRate}`);
  if (has(v.temperature)) parts.push(`T ${v.temperature} °C`);
  if (has(v.oxygen)) parts.push(`SpO₂ ${v.oxygen} %`);
  return parts.join(" · ");
}

export function hasAnyVital(v: Vitals): boolean {
  return (
    has(v.systolic) || has(v.diastolic) || has(v.heartRate) || has(v.temperature) || has(v.oxygen)
  );
}

// ─── Formulario (react-hook-form + zod) ──────────────────────────────────────

export const DESCRIPTION_MAX = 800;
export const ALERT_REASON_MAX = 200;

/** Campo numérico opcional de un input de texto: '' → undefined; con coma decimal → punto. */
const optionalNumber = (min: number, max: number, label: string, integer: boolean) =>
  z.union([z.string(), z.number(), z.undefined(), z.null()]).transform((raw, ctx) => {
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === ""))
      return undefined;
    const n = typeof raw === "number" ? raw : Number(raw.trim().replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: "custom", message: `${label}: escribe un número.` });
      return z.NEVER;
    }
    if (integer && !Number.isInteger(n)) {
      ctx.addIssue({ code: "custom", message: `${label}: usa un número entero.` });
      return z.NEVER;
    }
    if (n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `${label}: debe estar entre ${min} y ${max}.` });
      return z.NEVER;
    }
    return n;
  });

export const careLogFormSchema = z
  .object({
    eventType: z.enum(MANUAL_EVENT_TYPES),
    description: z.string().max(DESCRIPTION_MAX + 200, "El texto es demasiado largo."),
    mood: z.union([z.enum(CARE_MOODS), z.literal("")]).optional(),
    isAlert: z.boolean().optional(),
    alertReason: z
      .string()
      .max(ALERT_REASON_MAX + 100)
      .optional(),
    systolic: optionalNumber(
      VITAL_LIMITS.systolic.min,
      VITAL_LIMITS.systolic.max,
      "Sistólica",
      true,
    ),
    diastolic: optionalNumber(
      VITAL_LIMITS.diastolic.min,
      VITAL_LIMITS.diastolic.max,
      "Diastólica",
      true,
    ),
    heartRate: optionalNumber(
      VITAL_LIMITS.heartRate.min,
      VITAL_LIMITS.heartRate.max,
      "Frecuencia cardíaca",
      true,
    ),
    temperature: optionalNumber(
      VITAL_LIMITS.temperature.min,
      VITAL_LIMITS.temperature.max,
      "Temperatura",
      false,
    ),
    oxygen: optionalNumber(VITAL_LIMITS.oxygen.min, VITAL_LIMITS.oxygen.max, "Saturación", true),
  })
  .superRefine((v, ctx) => {
    const isAlert = v.isAlert === true || v.eventType === "incident";
    const text = v.description.trim();
    if (!text) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "Cuéntale a la familia qué pasó.",
      });
    } else if (text.length > DESCRIPTION_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: `Máximo ${DESCRIPTION_MAX} caracteres.`,
      });
    } else if (!isAlert) {
      // Una alerta nunca se bloquea por su contenido (igual que en el servidor): la seguridad va primero.
      const check = checkOutgoingMessage(text, { required: true, maxChars: DESCRIPTION_MAX });
      if (!check.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["description"],
          message: MESSAGE_ERROR_COPY[check.reason],
        });
      }
    }
    if (v.eventType === "vital_signs" && !hasAnyVital(v)) {
      ctx.addIssue({
        code: "custom",
        path: ["systolic"],
        message: "Anota al menos un signo vital.",
      });
    }
    if (v.eventType !== "vital_signs" && hasAnyVital(v)) {
      ctx.addIssue({
        code: "custom",
        path: ["eventType"],
        message: "Los signos vitales van en un registro de «Signos vitales».",
      });
    }
    if (v.alertReason && v.alertReason.trim().length > ALERT_REASON_MAX) {
      ctx.addIssue({
        code: "custom",
        path: ["alertReason"],
        message: `Máximo ${ALERT_REASON_MAX} caracteres.`,
      });
    }
  });

export type CareLogFormInput = z.input<typeof careLogFormSchema>;
export type CareLogFormValues = z.output<typeof careLogFormSchema>;

export interface CareLogInsert {
  booking_id: string;
  professional_id: string;
  event_type: ManualEventType;
  description: string;
  mood?: CareMood;
  is_alert: boolean;
  alert_reason?: string;
  patient_name?: string;
  vital_systolic?: number;
  vital_diastolic?: number;
  vital_heart_rate?: number;
  vital_temperature?: number;
  vital_oxygen?: number;
}

/** Fila para `care_logs`. El servidor reafirma `professional_id`, el estado y los textos; aquí solo se arma. */
export function buildCareLogInsert(
  values: CareLogFormValues,
  ctx: { bookingId: string; professionalId: string; patientName?: string | null },
): CareLogInsert {
  const isAlert = values.isAlert === true || values.eventType === "incident";
  const row: CareLogInsert = {
    booking_id: ctx.bookingId,
    professional_id: ctx.professionalId,
    event_type: values.eventType,
    description: values.description.trim(),
    is_alert: isAlert,
  };
  if (values.mood && isCareMood(values.mood)) row.mood = values.mood;
  if (isAlert) {
    const reason = (values.alertReason ?? "").trim();
    row.alert_reason = reason || values.description.trim().slice(0, ALERT_REASON_MAX);
  }
  const patient = (ctx.patientName ?? "").trim();
  if (patient) row.patient_name = patient.slice(0, 80);
  if (values.eventType === "vital_signs") {
    if (has(values.systolic)) row.vital_systolic = values.systolic;
    if (has(values.diastolic)) row.vital_diastolic = values.diastolic;
    if (has(values.heartRate)) row.vital_heart_rate = values.heartRate;
    if (has(values.temperature)) row.vital_temperature = values.temperature;
    if (has(values.oxygen)) row.vital_oxygen = values.oxygen;
  }
  return row;
}

/** Texto de la nota de cierre del turno: la nota del profesional o, si solo eligió ánimo, una frase con el ánimo. */
export function closingNoteText(values: { mood?: CareMood | ""; note?: string }): string | null {
  const note = (values.note ?? "").trim();
  if (note) return `Cierre del turno: ${note}`;
  if (values.mood && isCareMood(values.mood)) {
    return `Cierre del turno. Ánimo del paciente al final: ${MOOD_META[values.mood].label.toLowerCase()}.`;
  }
  return null;
}

// ─── Lectura: línea de tiempo y resumen ──────────────────────────────────────

export interface CareLogRow {
  id: string;
  booking_id?: string;
  event_type: string;
  description: string;
  mood?: string | null;
  vital_systolic: number | null;
  vital_diastolic: number | null;
  vital_heart_rate: number | null;
  vital_temperature: number | null;
  vital_oxygen: number | null;
  is_alert: boolean;
  alert_reason?: string | null;
  system_generated?: boolean | null;
  created_at: string;
}

export function vitalsOf(row: CareLogRow): Vitals {
  return {
    systolic: row.vital_systolic,
    diastolic: row.vital_diastolic,
    heartRate: row.vital_heart_rate,
    temperature: row.vital_temperature,
    oxygen: row.vital_oxygen,
  };
}

export function eventMeta(type: string): EventMeta {
  return (EVENT_META as Record<string, EventMeta>)[type] ?? EVENT_META.note;
}

/** Más reciente primero; empata por id para que el orden sea estable. */
export function sortLogsDesc<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return d !== 0 ? d : b.id.localeCompare(a.id);
  });
}

/** Une lo que ya está en pantalla con un registro nuevo (por tiempo real) sin duplicarlo. */
export function mergeLog<T extends { id: string; created_at: string }>(
  rows: T[],
  incoming: T,
): T[] {
  if (rows.some((r) => r.id === incoming.id)) return rows;
  return sortLogsDesc([...rows, incoming] as Array<T & { id: string }>) as T[];
}

export interface LogCounts {
  total: number;
  byType: Partial<Record<CareEventType, number>>;
  alerts: number;
  vitals: number;
}

/** Conteos de lo que el profesional escribió (excluye la llegada y la salida automáticas). */
export function countLogs(rows: CareLogRow[]): LogCounts {
  const manual = rows.filter((r) => !r.system_generated && isManualEvent(r.event_type));
  const byType: Partial<Record<CareEventType, number>> = {};
  for (const r of manual)
    byType[r.event_type as CareEventType] = (byType[r.event_type as CareEventType] ?? 0) + 1;
  return {
    total: manual.length,
    byType,
    alerts: manual.filter((r) => r.is_alert).length,
    vitals: manual.filter((r) => hasAnyVital(vitalsOf(r))).length,
  };
}

export function lastMood(rows: CareLogRow[]): CareMood | null {
  const withMood = rows.filter((r) => isCareMood(r.mood));
  if (!withMood.length) return null;
  return sortLogsDesc(withMood)[0].mood as CareMood;
}

const BOGOTA_OFFSET_MS = -5 * 3_600_000;

/** Día calendario en hora de Colombia (UTC-5 todo el año): «2026-10-09». */
export function bogotaDay(iso: string): string {
  return new Date(new Date(iso).getTime() + BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

export function groupLogsByDay<T extends { created_at: string; id: string }>(
  rows: T[],
): Array<{ day: string; rows: T[] }> {
  const groups = new Map<string, T[]>();
  for (const r of sortLogsDesc(rows)) {
    const day = bogotaDay(r.created_at);
    const list = groups.get(day);
    if (list) list.push(r);
    else groups.set(day, [r]);
  }
  return [...groups.entries()].map(([day, list]) => ({ day, rows: list }));
}

/** «2 h 15 min» / «45 min» / «3 h». Espejo de `public.hx_duration_label`. */
export function durationLabel(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0)
    return null;
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) return `${m / 60} h`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ─── Parte final (resultado de `care_report`) ────────────────────────────────

export interface CareReport {
  booking_id: string;
  status: string;
  scheduled_at: string;
  planned_hours: number | string | null;
  professional: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  events: number;
  by_type: Record<string, number>;
  vitals_count: number;
  last_vitals: (Vitals & { at: string }) | null;
  alerts: number;
  incidents: number;
  moods: Array<{ at: string; mood: string }>;
}

/** Normaliza la respuesta JSON del servidor (puede traer nulos o tipos sueltos). */
export function parseCareReport(raw: unknown): CareReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0) =>
    typeof v === "number" && Number.isFinite(v)
      ? v
      : Number.isFinite(Number(v)) && v !== null && v !== ""
        ? Number(v)
        : d;
  const lv = r.last_vitals as Record<string, unknown> | null | undefined;
  return {
    booking_id: String(r.booking_id ?? ""),
    status: String(r.status ?? ""),
    scheduled_at: String(r.scheduled_at ?? ""),
    planned_hours: (r.planned_hours as number | string | null) ?? null,
    professional: typeof r.professional === "string" ? r.professional : null,
    started_at: typeof r.started_at === "string" ? r.started_at : null,
    ended_at: typeof r.ended_at === "string" ? r.ended_at : null,
    duration_minutes:
      r.duration_minutes === null || r.duration_minutes === undefined
        ? null
        : num(r.duration_minutes),
    events: num(r.events),
    by_type:
      r.by_type && typeof r.by_type === "object" ? (r.by_type as Record<string, number>) : {},
    vitals_count: num(r.vitals_count),
    last_vitals: lv
      ? {
          at: String(lv.at ?? ""),
          systolic: (lv.systolic as number | null) ?? null,
          diastolic: (lv.diastolic as number | null) ?? null,
          heartRate: (lv.heart_rate as number | null) ?? null,
          temperature: (lv.temperature as number | null) ?? null,
          oxygen: (lv.oxygen as number | null) ?? null,
        }
      : null,
    alerts: num(r.alerts),
    incidents: num(r.incidents),
    moods: Array.isArray(r.moods) ? (r.moods as Array<{ at: string; mood: string }>) : [],
  };
}

/** Último ánimo registrado en el parte (`care_report` ya los trae en orden cronológico). */
export function reportLastMood(report: Pick<CareReport, "moods">): CareMood | null {
  const last = report.moods[report.moods.length - 1];
  return last && isCareMood(last.mood) ? last.mood : null;
}

export type ReportTone = "ok" | "watch" | "alert";

/** Semáforo del parte: alerta si hubo incidentes o alertas; a vigilar si algún signo vital quedó fuera de rango. */
export function reportTone(report: CareReport): ReportTone {
  if (report.alerts > 0 || report.incidents > 0) return "alert";
  if (report.last_vitals && vitalFlags(report.last_vitals).length > 0) return "watch";
  return "ok";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * El parte «en palabras»: frases cálidas armadas con las cifras del servidor (nunca con IA ni con el texto libre,
 * así no se envían datos de salud a terceros ni se inventa nada). Se muestra a la familia al abrir el parte.
 */
export function narrateShift(report: CareReport, alertReasons: string[] = []): string[] {
  if (report.events === 0 && report.alerts === 0) return [];
  const who = report.professional ?? "El profesional";
  const out: string[] = [];
  const dur = durationLabel(report.duration_minutes);
  const done = report.status === "completed";
  out.push(
    dur
      ? `${who} ${done ? "acompañó" : "lleva acompañando"} a tu familiar ${done ? "durante" : "desde hace"} ${dur}.`
      : `${who} está atendiendo a tu familiar.`,
  );

  const bits: string[] = [];
  const n = (t: string) => report.by_type[t] ?? 0;
  if (n("medication") > 0)
    bits.push(plural(n("medication"), "registro de medicamentos", "registros de medicamentos"));
  if (n("meal") > 0)
    bits.push(
      plural(
        n("meal"),
        "registro de alimentación o líquidos",
        "registros de alimentación o líquidos",
      ),
    );
  if (n("activity") > 0)
    bits.push(
      plural(
        n("activity"),
        "actividad (caminata, aseo, descanso)",
        "actividades (caminata, aseo, descanso)",
      ),
    );
  if (n("note") > 0) bits.push(plural(n("note"), "nota", "notas"));
  if (bits.length) out.push(`Hasta ahora quedó: ${bits.join(", ")}.`);

  if (report.vitals_count > 0) {
    const v = report.last_vitals ? formatVitals(report.last_vitals) : "";
    out.push(
      `Se tomaron signos vitales ${report.vitals_count === 1 ? "una vez" : `${report.vitals_count} veces`}${v ? `; el último: ${v}` : ""}.`,
    );
  }

  const headline = moodHeadline(reportLastMood(report));
  if (headline) out.push(headline);

  if (report.alerts > 0) {
    const reasons = alertReasons
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 2);
    out.push(
      `Atención: hubo ${plural(report.alerts, "alerta", "alertas")}${reasons.length ? ` (${reasons.join("; ")})` : ""}. ${
        done ? "Conviene comentarlo con el médico tratante." : "El profesional ya te avisó."
      }`,
    );
  } else if (
    report.events > 0 &&
    !(report.last_vitals && vitalFlags(report.last_vitals).length > 0)
  ) {
    out.push("No hubo alertas.");
  }

  out.push(
    done
      ? "El turno terminó: puedes darle las gracias a tu profesional y calificar el servicio."
      : "El turno sigue en curso.",
  );
  return out;
}

function dayText(iso: string): string {
  const d = new Date(new Date(iso).getTime() + BOGOTA_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/**
 * Resumen en texto plano para copiar o enviar a un familiar o al médico. Lo decide la familia: la plataforma no
 * lo comparte sola. No incluye nombres completos, direcciones ni teléfonos.
 */
export function reportToText(report: CareReport): string {
  const lines: string[] = [];
  lines.push(
    `Parte del turno · ${report.professional ?? "Profesional"} · ${dayText(report.scheduled_at)}`,
  );
  const dur = durationLabel(report.duration_minutes);
  if (dur) lines.push(`Duración: ${dur}`);
  const counts = Object.entries(report.by_type)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${eventMeta(t).label.toLowerCase()}`);
  if (counts.length) lines.push(`Registros: ${counts.join(", ")}`);
  if (report.last_vitals) {
    const v = formatVitals(report.last_vitals);
    if (v) lines.push(`Últimos signos vitales: ${v}`);
  }
  const headline = moodHeadline(reportLastMood(report));
  if (headline) lines.push(headline);
  if (report.alerts > 0) lines.push(`Alertas: ${report.alerts}`);
  return lines.join("\n");
}
