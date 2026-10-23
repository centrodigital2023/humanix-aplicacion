// Pacientes y coordinación de cuidado de la institución — lógica pura (sin red, sin DOM; la hora entra como parámetro).
//
// El servidor (migración 20261014100000_institution_care_core.sql) decide lo que importa: quién entra, los límites del plan, las firmas
// de las notas, el NEWS2 y las alertas. Aquí solo se interpreta lo que devuelve y se arma lo que muestra la pantalla: cifras del
// tablero, filtros, avance de un caso, línea de tiempo, primeros pasos, uso del plan, mensajes para la familia y los errores traducidos.

import { toCsv, bogotaDateTime, type CsvColumn } from "./careExport";
import type { News2Band } from "./news2";
import type {
  AlertSeverity,
  CareType,
  CaseOutcome,
  CasePriority,
  CaseStatus,
  InstAlert,
  InstCase,
  InstEvent,
  InstLive,
  InstNote,
  InstObs,
  InstPatient,
  InstTask,
  NoteKind,
  PatientModality,
  PatientStatus,
  TaskKind,
  Tone,
} from "./instCareTypes";

// ── Hora ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Clock = Date | number;
export const nowMs = (n: Clock): number => (typeof n === "number" ? n : n.getTime());
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const BOGOTA_OFFSET_MS = -5 * HOUR; // Colombia no cambia de hora en el año

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n: number) => String(n).padStart(2, "0");

function bogotaParts(iso: string | number | Date) {
  const t = typeof iso === "string" ? Date.parse(iso) : nowMs(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + BOGOTA_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dayNumber: Math.floor((t + BOGOTA_OFFSET_MS) / DAY),
  };
}

/** «10:30 a. m.» en hora de Colombia. */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = bogotaParts(iso);
  if (!p) return "";
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad(p.mi)} ${p.h < 12 ? "a. m." : "p. m."}`;
}

/** «hoy 10:30 a. m.», «ayer 4:05 p. m.» o «12 oct 4:05 p. m.». */
export function dayClockLabel(iso: string | null | undefined, now: Clock): string {
  if (!iso) return "";
  const p = bogotaParts(iso);
  const n = bogotaParts(now);
  if (!p || !n) return "";
  const diff = n.dayNumber - p.dayNumber;
  const day =
    diff === 0 ? "hoy" : diff === 1 ? "ayer" : diff === -1 ? "mañana" : `${p.d} ${MONTHS[p.mo]}`;
  return `${day} ${clockLabel(iso)}`;
}

/** «12 oct 2026». */
export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = bogotaParts(iso);
  return p ? `${p.d} ${MONTHS[p.mo]} ${p.y}` : "";
}

/** «hace 5 min», «hace 2 h», «hace 3 d» (o «justo ahora»). Para el futuro: «en 20 min». */
export function timeAgo(iso: string | null | undefined, now: Clock): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = nowMs(now) - t;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "justo ahora";
  const unit =
    abs < HOUR
      ? `${Math.max(1, Math.round(abs / MIN))} min`
      : abs < DAY
        ? `${Math.round(abs / HOUR)} h`
        : `${Math.round(abs / DAY)} d`;
  return diff >= 0 ? `hace ${unit}` : `en ${unit}`;
}

/** «7 min» o «1 h 20 min» a partir de milisegundos. */
export function durationLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

// ── Textos y etiquetas ────────────────────────────────────────────────────────────────────────────────────────────────

export function normalizeText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1] ?? "")[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const AVATAR_TONES: Tone[] = ["trust", "ok", "copper", "biosensor", "fuchsia"];
/** Un color estable por paciente (no revela nada: sale del identificador). */
export function avatarTone(id: string): Tone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length] ?? "trust";
}

/** Edad en años cumplidos (hora de Colombia). `null` si no hay fecha válida. */
export function ageYears(birth: string | null | undefined, now: Clock): number | null {
  if (!birth) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const n = bogotaParts(now);
  if (!n) return null;
  let age = n.y - y;
  if (n.mo + 1 < mo || (n.mo + 1 === mo && n.d < d)) age -= 1;
  return age < 0 ? null : age;
}

/** «73 años», «1 año», «8 meses» o vacío. */
export function ageLabel(birth: string | null | undefined, now: Clock): string {
  const years = ageYears(birth, now);
  if (years === null) return "";
  if (years >= 1) return years === 1 ? "1 año" : `${years} años`;
  const m = /^(\d{4})-(\d{2})/.exec(birth ?? "");
  const n = bogotaParts(now);
  if (!m || !n) return "";
  const months = Math.max(0, (n.y - Number(m[1])) * 12 + (n.mo + 1 - Number(m[2])));
  return months === 1 ? "1 mes" : `${months} meses`;
}

export const MODALITY_META: Record<PatientModality, { label: string; tone: Tone }> = {
  hospital: { label: "Hospitalizado", tone: "sos" },
  remote: { label: "Remoto", tone: "biosensor" },
  postop: { label: "Posoperatorio", tone: "copper" },
  chronic: { label: "Crónico", tone: "trust" },
  elder: { label: "Adulto mayor", tone: "fuchsia" },
};
export const MODALITY_ORDER: PatientModality[] = [
  "hospital",
  "remote",
  "postop",
  "chronic",
  "elder",
];

export const STATUS_META: Record<PatientStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "warn" },
  active: { label: "Activo", tone: "ok" },
  paused: { label: "En pausa", tone: "muted" },
  discharged: { label: "Con alta", tone: "trust" },
};

export const CASE_STATUS_META: Record<CaseStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "warn" },
  active: { label: "Activo", tone: "ok" },
  completed: { label: "Completado", tone: "trust" },
  cancelled: { label: "Cancelado", tone: "muted" },
};

export const PRIORITY_META: Record<CasePriority, { label: string; tone: Tone }> = {
  low: { label: "Baja", tone: "muted" },
  medium: { label: "Media", tone: "trust" },
  high: { label: "Alta", tone: "warn" },
  urgent: { label: "Urgente", tone: "sos" },
};

export const CARE_TYPE_META: Record<CareType, { label: string }> = {
  domiciliary: { label: "Atención domiciliaria" },
  nursing: { label: "Enfermería" },
  postop: { label: "Posoperatorio" },
  elder: { label: "Adulto mayor" },
  palliative: { label: "Cuidado paliativo" },
  chronic: { label: "Enfermedad crónica" },
  rehab: { label: "Rehabilitación" },
  other: { label: "Otro" },
};

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  recovered: "Recuperado",
  stable: "Estable",
  referred: "Remitido a otro servicio",
  withdrawn: "Retiro del servicio",
  deceased: "Fallecimiento",
  other: "Otro motivo",
};

export const NOTE_KIND_META: Record<NoteKind, { label: string; tone: Tone }> = {
  evolution: { label: "Evolución", tone: "trust" },
  nursing: { label: "Enfermería", tone: "ok" },
  coordination: { label: "Coordinación", tone: "copper" },
  family: { label: "Familia", tone: "fuchsia" },
  incident: { label: "Incidente", tone: "sos" },
  handoff: { label: "Relevo de turno", tone: "biosensor" },
  correction: { label: "Corrección", tone: "warn" },
};
/** Tipos que una persona puede escribir (el relevo solo lo escribe el relevo de turno). */
export const WRITABLE_NOTE_KINDS: NoteKind[] = [
  "evolution",
  "nursing",
  "coordination",
  "family",
  "incident",
];

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  call: "Llamada",
  visit: "Visita",
  medication: "Medicamentos",
  lab: "Laboratorio",
  education: "Educación",
  followup: "Seguimiento",
  obs_round: "Ronda de signos",
  other: "Otra",
};

// ── Cifras del tablero (vienen calculadas del servidor) ───────────────────────────────────────────────────────────────

export interface CareLimits {
  patients: number;
  monitored: number;
  devices: number;
  escalation: boolean;
  followups: boolean;
  handoff: boolean;
  export: boolean;
}

export interface CareOverview {
  plan: string;
  limits: CareLimits;
  usage: { patients: number; monitored: number; devices: number };
  patients: {
    total: number;
    open: number;
    pending: number;
    active: number;
    paused: number;
    discharged: number;
    monitored: number;
  };
  cases: {
    active: number;
    pending: number;
    completed: number;
    cancelled: number;
    rated: number;
    avgSatisfaction: number | null;
  };
  tasks: { open: number; overdue: number };
  monitoring: { total: number; online: number; overdue: number; highRisk: number };
  alerts: {
    open: number;
    unacked: number;
    critical: number;
    overdue: number;
    falseAlarm30d: number;
  };
  impact: {
    since: string | null;
    manualControls: number;
    deviceReadings: number;
    alerts: number;
    alertsOnTime: number;
    medianAckSeconds: number | null;
    tasksDone: number;
    notes: number;
    casesCompleted: number;
  };
  ontimeStreak: number;
  generatedAt: string | null;
}

export const FREE_LIMITS: CareLimits = {
  patients: 5,
  monitored: 3,
  devices: 0,
  escalation: false,
  followups: false,
  handoff: false,
  export: false,
};

export const EMPTY_OVERVIEW: CareOverview = {
  plan: "free",
  limits: FREE_LIMITS,
  usage: { patients: 0, monitored: 0, devices: 0 },
  patients: { total: 0, open: 0, pending: 0, active: 0, paused: 0, discharged: 0, monitored: 0 },
  cases: { active: 0, pending: 0, completed: 0, cancelled: 0, rated: 0, avgSatisfaction: null },
  tasks: { open: 0, overdue: 0 },
  monitoring: { total: 0, online: 0, overdue: 0, highRisk: 0 },
  alerts: { open: 0, unacked: 0, critical: 0, overdue: 0, falseAlarm30d: 0 },
  impact: {
    since: null,
    manualControls: 0,
    deviceReadings: 0,
    alerts: 0,
    alertsOnTime: 0,
    medianAckSeconds: null,
    tasksDone: 0,
    notes: 0,
    casesCompleted: 0,
  },
  ontimeStreak: 0,
  generatedAt: null,
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return d;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = num(v, Number.NaN);
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
const objOf = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});

/** Interpreta lo que devuelve `inst_care_overview()`. Ante algo que no es un objeto devuelve `null`; los datos que falten valen 0. */
export function parseOverview(raw: unknown): CareOverview | null {
  if (!isObj(raw)) return null;
  const l = objOf(raw.limits);
  const u = objOf(raw.usage);
  const p = objOf(raw.patients);
  const c = objOf(raw.cases);
  const t = objOf(raw.tasks);
  const m = objOf(raw.monitoring);
  const a = objOf(raw.alerts);
  const i = objOf(raw.impact);
  return {
    plan: typeof raw.plan === "string" ? raw.plan : "free",
    limits: {
      patients: num(l.patients, FREE_LIMITS.patients),
      monitored: num(l.monitored, FREE_LIMITS.monitored),
      devices: num(l.devices, FREE_LIMITS.devices),
      escalation: bool(l.escalation),
      followups: bool(l.followups),
      handoff: bool(l.handoff),
      export: bool(l.export),
    },
    usage: { patients: num(u.patients), monitored: num(u.monitored), devices: num(u.devices) },
    patients: {
      total: num(p.total),
      open: num(p.open),
      pending: num(p.pending),
      active: num(p.active),
      paused: num(p.paused),
      discharged: num(p.discharged),
      monitored: num(p.monitored),
    },
    cases: {
      active: num(c.active),
      pending: num(c.pending),
      completed: num(c.completed),
      cancelled: num(c.cancelled),
      rated: num(c.rated),
      avgSatisfaction: numOrNull(c.avg_satisfaction),
    },
    tasks: { open: num(t.open), overdue: num(t.overdue) },
    monitoring: {
      total: num(m.total),
      online: num(m.online),
      overdue: num(m.overdue),
      highRisk: num(m.high_risk),
    },
    alerts: {
      open: num(a.open),
      unacked: num(a.unacked),
      critical: num(a.critical),
      overdue: num(a.overdue),
      falseAlarm30d: num(a.false_alarm_30d),
    },
    impact: {
      since: typeof i.since === "string" ? i.since : null,
      manualControls: num(i.manual_controls),
      deviceReadings: num(i.device_readings),
      alerts: num(i.alerts),
      alertsOnTime: num(i.alerts_on_time),
      medianAckSeconds: numOrNull(i.median_ack_seconds),
      tasksDone: num(i.tasks_done),
      notes: num(i.notes),
      casesCompleted: num(i.cases_completed),
    },
    ontimeStreak: num(raw.ontime_streak),
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : null,
  };
}

export const PLAN_NAME: Record<string, string> = {
  free: "Free",
  essential_monthly: "Familiar",
  pro_monthly: "Pro",
  family_premium_monthly: "Premium Familiar",
  pro_premium_monthly: "Premium Profesional",
  institution_monthly: "Institucional",
};
export const planName = (plan: string): string => PLAN_NAME[plan] ?? "Free";
export const isPremiumPlan = (o: CareOverview): boolean => o.plan === "institution_monthly";

export interface KpiTile {
  key: "patients" | "active" | "pending" | "completed" | "rating";
  label: string;
  value: string;
  sub: string;
  tone: Tone;
}

/** Miles con punto, igual en todos los navegadores («1.000»; con cuatro cifras, `toLocaleString("es")` no agrupa). */
export const thousandsEs = (n: number): string =>
  String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Español de Colombia: coma decimal. «4,5». */
export const decimalEs = (n: number, digits = 1): string =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", ",");

/** Las cinco cifras de arriba de Pacientes. El promedio solo existe si hubo valoraciones (nunca un «0,0» que parezca una mala nota). */
export function patientKpis(o: CareOverview): KpiTile[] {
  const rated = o.cases.rated;
  return [
    {
      key: "patients",
      label: "Pacientes",
      value: String(o.patients.open),
      sub: o.patients.discharged > 0 ? `${o.patients.discharged} con alta` : "en la institución",
      tone: "trust",
    },
    {
      key: "active",
      label: "Activos",
      value: String(o.cases.active),
      sub: "casos en curso",
      tone: "ok",
    },
    {
      key: "pending",
      label: "Pendientes",
      value: String(o.cases.pending),
      sub: "por iniciar",
      tone: "warn",
    },
    {
      key: "completed",
      label: "Completados",
      value: String(o.cases.completed),
      sub: "casos cerrados",
      tone: "biosensor",
    },
    {
      key: "rating",
      label: "★ Promedio",
      value:
        o.cases.avgSatisfaction === null || rated === 0 ? "—" : decimalEs(o.cases.avgSatisfaction),
      sub:
        rated === 0
          ? "Sin valoraciones aún"
          : rated === 1
            ? "1 valoración"
            : `${rated} valoraciones`,
      tone: "copper",
    },
  ];
}

// ── Plan: uso y límites ───────────────────────────────────────────────────────────────────────────────────────────────

export interface UsageMeter {
  key: "patients" | "monitored" | "devices";
  label: string;
  used: number;
  limit: number;
  ratio: number;
  state: "ok" | "near" | "full" | "locked";
  message: string;
}

export function usageMeters(o: CareOverview): UsageMeter[] {
  const one = (
    key: UsageMeter["key"],
    label: string,
    used: number,
    limit: number,
    unit: string,
  ): UsageMeter => {
    if (limit <= 0) {
      return {
        key,
        label,
        used,
        limit,
        ratio: 0,
        state: "locked",
        message: "Disponible con Institucional",
      };
    }
    const ratio = Math.min(1, used / limit);
    const state: UsageMeter["state"] = used >= limit ? "full" : ratio >= 0.8 ? "near" : "ok";
    return {
      key,
      label,
      used,
      limit,
      ratio,
      state,
      message:
        state === "full"
          ? `Llegaste al máximo de ${thousandsEs(limit)} ${unit}`
          : `${thousandsEs(used)} de ${thousandsEs(limit)} ${unit}`,
    };
  };
  return [
    one("patients", "Pacientes", o.usage.patients, o.limits.patients, "pacientes"),
    one("monitored", "En monitoreo", o.usage.monitored, o.limits.monitored, "en monitoreo"),
    one("devices", "Dispositivos", o.usage.devices, o.limits.devices, "dispositivos"),
  ];
}

export interface Upsell {
  show: boolean;
  /** «full»: ya no puede crecer; «near»: se acerca; «info»: puede hacer más con el plan de pago. */
  urgency: "full" | "near" | "info";
  headline: string;
  perks: string[];
}

export const PREMIUM_PERKS = [
  "Hasta 1.000 pacientes y 300 en monitoreo",
  "Dispositivos y relojes conectados (hasta 300)",
  "Escalamiento automático de alertas sin atender",
  "Seguimientos automáticos de cada caso",
  "Relevo de turno I-PASS guardado en la historia",
  "Exportación de la historia (FHIR y CSV)",
  "Equipo con usuario y módulos propios",
];

export function upsellFor(o: CareOverview): Upsell {
  if (isPremiumPlan(o)) return { show: false, urgency: "info", headline: "", perks: [] };
  const meters = usageMeters(o).filter((m) => m.state !== "locked");
  const full = meters.find((m) => m.state === "full");
  const near = meters.find((m) => m.state === "near");
  if (full) {
    return {
      show: true,
      urgency: "full",
      headline: `Llegaste al máximo de ${full.limit} ${full.label.toLowerCase()} del plan Free`,
      perks: PREMIUM_PERKS,
    };
  }
  if (near) {
    return {
      show: true,
      urgency: "near",
      headline: `Estás cerca del límite del plan Free (${near.used} de ${near.limit} ${near.label.toLowerCase()})`,
      perks: PREMIUM_PERKS,
    };
  }
  return {
    show: true,
    urgency: "info",
    headline: "Con Institucional tu equipo cuida a más personas con menos esfuerzo",
    perks: PREMIUM_PERKS,
  };
}

// ── Primeros pasos (la lista que convierte un tablero vacío en el hábito de usarlo) ────────────────────────────────────

export interface OnboardingStep {
  key: "patient" | "case" | "note" | "monitor" | "control" | "device" | "team";
  label: string;
  hint: string;
  done: boolean;
  /** Pide el plan Institucional y la institución no lo tiene: no cuenta para el avance. */
  locked: boolean;
}

export interface Onboarding {
  steps: OnboardingStep[];
  done: number;
  total: number;
  pct: number;
  next: OnboardingStep | null;
  complete: boolean;
}

export function careOnboarding(
  o: CareOverview,
  flags: { hasCase?: boolean; hasNote?: boolean; hasControl?: boolean; hasTeam?: boolean } = {},
): Onboarding {
  const premium = isPremiumPlan(o);
  const hasCase =
    flags.hasCase ?? o.cases.active + o.cases.pending + o.cases.completed + o.cases.cancelled > 0;
  const steps: OnboardingStep[] = [
    {
      key: "patient",
      label: "Registra tu primer paciente",
      hint: "Solo toma un minuto; puedes completar el resto después.",
      done: o.patients.total > 0,
      locked: false,
    },
    {
      key: "case",
      label: "Abre su primer caso",
      hint: "Un caso reúne el servicio, la persona que lo presta y el seguimiento.",
      done: hasCase,
      locked: false,
    },
    {
      key: "note",
      label: "Escribe la primera nota",
      hint: "Las notas quedan firmadas y no se pueden alterar: son la historia confiable.",
      done: flags.hasNote ?? o.impact.notes > 1,
      locked: false,
    },
    {
      key: "monitor",
      label: "Pon a alguien en monitoreo",
      hint: "El NEWS2 se calcula solo y te avisa si empeora.",
      done: o.patients.monitored > 0 || o.monitoring.total > 0,
      locked: false,
    },
    {
      key: "control",
      label: "Registra el primer control de signos",
      hint: "Pulso, saturación, presión… el puntaje y las alertas salen solos.",
      done: flags.hasControl ?? o.impact.manualControls + o.impact.deviceReadings > 0,
      locked: false,
    },
    {
      key: "device",
      label: "Conecta un reloj o dispositivo",
      hint: "Los signos llegan solos, aunque nadie esté mirando la pantalla.",
      done: o.usage.devices > 0,
      locked: !premium,
    },
    {
      key: "team",
      label: "Invita a tu equipo",
      hint: "Cada persona entra con su usuario y solo ve lo que le corresponde.",
      done: flags.hasTeam ?? false,
      locked: !premium,
    },
  ];
  const active = steps.filter((s) => !s.locked);
  const done = active.filter((s) => s.done).length;
  const total = active.length;
  return {
    steps,
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    next: active.find((s) => !s.done) ?? null,
    complete: done === total,
  };
}

// ── Filtros y orden de la lista ───────────────────────────────────────────────────────────────────────────────────────

export interface PatientFilter {
  q?: string;
  /** «open» = todos menos los que tienen el alta. */
  status?: PatientStatus | "open" | "all";
  modality?: PatientModality | "all";
  monitoring?: boolean;
}

export function filterPatients(list: InstPatient[], f: PatientFilter): InstPatient[] {
  const q = normalizeText(f.q);
  const status = f.status ?? "open";
  return list.filter((p) => {
    if (status === "open" ? p.status === "discharged" : status !== "all" && p.status !== status)
      return false;
    if (f.modality && f.modality !== "all" && p.modality !== f.modality) return false;
    if (f.monitoring !== undefined && p.monitoring !== f.monitoring) return false;
    if (!q) return true;
    const hay = normalizeText(
      [p.full_name, p.document_number, p.room, p.eps_name, p.city, p.external_ref, ...p.conditions]
        .filter(Boolean)
        .join(" "),
    );
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}

const BAND_WEIGHT: Record<News2Band, number> = { high: 4, medium: 3, low_medium: 2, low: 1 };
const SEVERITY_WEIGHT: Record<AlertSeverity, number> = { critical: 3, urgent: 2, warn: 1 };

export interface AttentionContext {
  live: Map<string, Pick<InstLive, "last_band" | "next_obs_due_at">>;
  alerts: InstAlert[];
  now: Clock;
}

/** Cuánta atención pide un paciente: alertas abiertas > banda del NEWS2 > control vencido. Mayor = más urgente. */
export function attentionScore(p: InstPatient, ctx: AttentionContext): number {
  let score = 0;
  for (const a of ctx.alerts) {
    if (a.patient_id !== p.id || a.status === "resolved") continue;
    score = Math.max(
      score,
      1000 + SEVERITY_WEIGHT[a.severity] * 100 + (a.status === "open" ? 50 : 0),
    );
  }
  const live = ctx.live.get(p.id);
  if (p.monitoring && live) {
    if (live.last_band) score += BAND_WEIGHT[live.last_band] * 10;
    if (live.next_obs_due_at && Date.parse(live.next_obs_due_at) < nowMs(ctx.now)) score += 5;
  } else if (p.monitoring) {
    score += 5; // en monitoreo y sin ningún control: pide el primero
  }
  return score;
}

export type PatientSort = "attention" | "name" | "recent";

export function sortPatients(
  list: InstPatient[],
  sort: PatientSort,
  ctx?: AttentionContext,
): InstPatient[] {
  const byName = (a: InstPatient, b: InstPatient) =>
    a.full_name.localeCompare(b.full_name, "es", { sensitivity: "base" });
  const copy = [...list];
  if (sort === "name") return copy.sort(byName);
  if (sort === "recent")
    return copy.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || byName(a, b));
  if (!ctx) return copy.sort(byName);
  const score = new Map(copy.map((p) => [p.id, attentionScore(p, ctx)] as const));
  return copy.sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || byName(a, b));
}

// ── Casos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CaseProgress {
  /** 0–100 si hay fecha estimada de cierre. */
  pct: number | null;
  daysOpen: number;
  /** Días que faltan para la fecha estimada (negativo = ya pasó). */
  daysLeft: number | null;
  late: boolean;
  label: string;
}

export function caseProgress(c: InstCase, now: Clock): CaseProgress {
  const n = nowMs(now);
  const opened = Date.parse(c.opened_at);
  const end = c.closed_at ? Date.parse(c.closed_at) : n;
  const daysOpen = Math.max(0, Math.floor((end - opened) / DAY));
  const closed = c.status === "completed" || c.status === "cancelled";
  if (!c.target_end_at || closed) {
    return {
      pct: closed ? 100 : null,
      daysOpen,
      daysLeft: null,
      late: false,
      label: closed
        ? `Cerrado tras ${daysOpen} ${daysOpen === 1 ? "día" : "días"}`
        : `${daysOpen} ${daysOpen === 1 ? "día" : "días"} abierto`,
    };
  }
  const target = Date.parse(c.target_end_at);
  const span = Math.max(DAY, target - opened);
  const pct = Math.max(0, Math.min(100, Math.round(((n - opened) / span) * 100)));
  const daysLeft = Math.ceil((target - n) / DAY);
  const late = target < n;
  return {
    pct,
    daysOpen,
    daysLeft,
    late,
    label: late
      ? `Pasó la fecha estimada hace ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "día" : "días"}`
      : daysLeft === 0
        ? "Termina hoy"
        : `Faltan ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`,
  };
}

/** «4,5» o «—». */
export const starsLabel = (avg: number | null | undefined): string =>
  avg === null || avg === undefined ? "—" : decimalEs(avg);

// ── Línea de tiempo del paciente ──────────────────────────────────────────────────────────────────────────────────────

export type TimelineIcon =
  | "note"
  | "alert"
  | "task"
  | "case"
  | "obs"
  | "monitor"
  | "device"
  | "patient"
  | "export"
  | "handoff"
  | "check";

export interface TimelineItem {
  id: string;
  at: string;
  icon: TimelineIcon;
  tone: Tone;
  title: string;
  detail?: string;
  actor?: string | null;
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";

const STATUS_LABEL_ANY: Record<string, string> = {
  pending: "pendiente",
  active: "activo",
  paused: "en pausa",
  discharged: "con alta",
};

/** Cómo se cuenta un evento de la bitácora. `null` = no se muestra (ya aparece como nota, control o alerta). */
export function describeEvent(
  e: Pick<InstEvent, "kind" | "data">,
): { title: string; tone: Tone; icon: TimelineIcon } | null {
  const d = e.data ?? {};
  switch (e.kind) {
    case "patient_created":
      return { title: "Paciente registrado", tone: "ok", icon: "patient" };
    case "patient_updated":
      return { title: "Datos del paciente actualizados", tone: "muted", icon: "patient" };
    case "patient_status":
      return {
        title: `Estado: ${STATUS_LABEL_ANY[str(d.from)] ?? str(d.from)} → ${STATUS_LABEL_ANY[str(d.to)] ?? str(d.to)}`,
        tone: "muted",
        icon: "patient",
      };
    case "patient_discharged": {
      const outcome = str(d.outcome) as CaseOutcome;
      return {
        title: `Alta del paciente${OUTCOME_LABEL[outcome] ? ` · ${OUTCOME_LABEL[outcome]}` : ""}`,
        tone: "trust",
        icon: "check",
      };
    }
    case "scale_changed":
      return {
        title: `Escala de saturación ${str(d.from)} → ${str(d.to)} (por indicación médica)`,
        tone: "warn",
        icon: "monitor",
      };
    case "case_opened":
      return { title: "Caso abierto", tone: "ok", icon: "case" };
    case "case_updated":
      return { title: "Caso actualizado", tone: "muted", icon: "case" };
    case "case_closed":
      return {
        title: str(d.status) === "completed" ? "Caso completado" : "Caso cancelado",
        tone: str(d.status) === "completed" ? "trust" : "muted",
        icon: "case",
      };
    case "case_rated":
      return { title: "Servicio valorado", tone: "copper", icon: "check" };
    case "task_added":
      return { title: "Tarea agregada", tone: "muted", icon: "task" };
    case "task_done":
      return { title: "Tarea hecha", tone: "ok", icon: "task" };
    case "monitoring_on":
      return { title: "Entró a monitoreo", tone: "biosensor", icon: "monitor" };
    case "monitoring_off":
      return { title: "Salió de monitoreo", tone: "muted", icon: "monitor" };
    case "alert_ack":
      return { title: "Alerta vista por el equipo", tone: "ok", icon: "alert" };
    case "alert_resolved":
      return { title: "Alerta resuelta", tone: "ok", icon: "alert" };
    case "alert_escalated":
      return { title: "Alerta sin atender: se avisó de nuevo", tone: "sos", icon: "alert" };
    case "device_created":
      return { title: "Dispositivo emparejado", tone: "biosensor", icon: "device" };
    case "device_revoked":
      return { title: "Dispositivo revocado", tone: "muted", icon: "device" };
    case "export":
      return { title: "Historia exportada", tone: "muted", icon: "export" };
    case "handoff_committed":
      return { title: "Relevo de turno guardado", tone: "biosensor", icon: "handoff" };
    default:
      return null; // note_added y obs_recorded se cuentan con la nota y el control mismos
  }
}

const SEVERITY_TITLE: Record<AlertSeverity, string> = {
  critical: "Alerta crítica",
  urgent: "Alerta urgente",
  warn: "Alerta de atención",
};
const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  critical: "sos",
  urgent: "warn",
  warn: "copper",
};

export interface TimelineInput {
  notes?: InstNote[];
  events?: InstEvent[];
  alerts?: InstAlert[];
  tasks?: InstTask[];
  cases?: InstCase[];
  obs?: InstObs[];
}

/** Todo lo que le pasó a un paciente, lo más reciente primero. */
export function buildTimeline(input: TimelineInput, limit = 80): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const n of input.notes ?? []) {
    const meta = NOTE_KIND_META[n.kind];
    out.push({
      id: `note:${n.id}`,
      at: n.created_at,
      icon: n.kind === "handoff" ? "handoff" : "note",
      tone: meta.tone,
      title: n.kind === "correction" ? "Corrección a una nota anterior" : meta.label,
      detail: clip(n.body),
      actor: n.author_name,
    });
  }
  for (const e of input.events ?? []) {
    const d = describeEvent(e);
    if (!d) continue;
    out.push({
      id: `event:${e.id}`,
      at: e.created_at,
      icon: d.icon,
      tone: d.tone,
      title: d.title,
      actor: e.actor_name,
    });
  }
  for (const a of input.alerts ?? []) {
    out.push({
      id: `alert:${a.id}:open`,
      at: a.opened_at,
      icon: "alert",
      tone: SEVERITY_TONE[a.severity],
      title: SEVERITY_TITLE[a.severity],
      detail: a.message,
    });
  }
  for (const t of input.tasks ?? []) {
    if (t.status === "done" && t.completed_at) {
      out.push({
        id: `task:${t.id}:done`,
        at: t.completed_at,
        icon: "task",
        tone: "ok",
        title: `Tarea hecha: ${t.title}`,
        actor: t.completed_name,
      });
    }
  }
  for (const c of input.cases ?? []) {
    out.push({
      id: `case:${c.id}:open`,
      at: c.opened_at,
      icon: "case",
      tone: "ok",
      title: `Caso abierto: ${c.title}`,
      detail: c.professional_label ? `Con ${c.professional_label}` : undefined,
    });
    if (c.closed_at) {
      out.push({
        id: `case:${c.id}:close`,
        at: c.closed_at,
        icon: "case",
        tone: c.status === "completed" ? "trust" : "muted",
        title: `${c.status === "completed" ? "Caso completado" : "Caso cancelado"}: ${c.title}`,
        detail:
          [c.outcome ? OUTCOME_LABEL[c.outcome] : "", c.satisfaction ? `${c.satisfaction} ★` : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
    }
  }
  for (const o of input.obs ?? []) {
    if (o.source === "device") continue; // las lecturas del dispositivo son muchas: se ven en la gráfica
    const parts = [
      o.hr !== null ? `pulso ${o.hr}` : "",
      o.spo2 !== null ? `SpO₂ ${String(o.spo2).replace(".", ",")} %` : "",
      o.sbp !== null ? `PAS ${o.sbp}` : "",
      o.temp_c !== null ? `${String(o.temp_c).replace(".", ",")} °C` : "",
    ].filter(Boolean);
    out.push({
      id: `obs:${o.id}`,
      at: o.recorded_at,
      icon: "obs",
      tone: o.band ? bandTone(o.band) : "muted",
      title: o.news2 !== null ? `Control · NEWS2 ${o.news2}` : "Control de signos",
      detail: parts.join(" · ") || undefined,
      actor: o.recorded_by_name,
    });
  }
  return out
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function bandTone(b: News2Band | null | undefined): Tone {
  switch (b) {
    case "high":
      return "sos";
    case "medium":
      return "warn";
    case "low_medium":
      return "copper";
    case "low":
      return "ok";
    default:
      return "muted";
  }
}

// ── Mensaje para la familia (con su autorización; nunca se envía solo) ────────────────────────────────────────────────

const BAND_PHRASE: Record<News2Band | "none", string> = {
  low: "se encuentra estable",
  low_medium: "lo estamos vigilando más de cerca por un cambio en uno de sus signos",
  medium: "estamos atendiendo un cambio en su estado y el equipo médico lo está valorando",
  high: "requiere atención inmediata y el equipo lo está atendiendo ahora mismo",
  none: "sigue en seguimiento de nuestro equipo",
};

export interface FamilyUpdateInput {
  patientName: string;
  institutionName: string;
  band?: News2Band | null;
  lastObsAt?: string | null;
  now: Clock;
  /** Si la familia quiere ver los valores (por defecto solo se cuenta el estado en palabras). */
  vitals?: Partial<Record<"hr" | "spo2" | "sbp" | "dbp" | "temp_c" | "rr", number>> | null;
  signer?: string | null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

/** Texto cálido y corto. No pide dinero ni datos (los pagos se hacen solo en la web de Humanix) y no diagnostica. */
export function familyUpdateText(i: FamilyUpdateInput): string {
  const phrase = BAND_PHRASE[i.band ?? "none"];
  const when = i.lastObsAt ? ` (control de ${dayClockLabel(i.lastObsAt, i.now)})` : "";
  const v = i.vitals ?? null;
  const vitalsLine = v
    ? (() => {
        const parts = [
          v.hr !== undefined ? `pulso ${v.hr}` : "",
          v.spo2 !== undefined ? `saturación ${decimalEs(v.spo2, 0)} %` : "",
          v.sbp !== undefined && v.dbp !== undefined
            ? `presión ${v.sbp}/${v.dbp}`
            : v.sbp !== undefined
              ? `presión sistólica ${v.sbp}`
              : "",
          v.temp_c !== undefined ? `temperatura ${decimalEs(v.temp_c)} °C` : "",
          v.rr !== undefined ? `respiración ${v.rr} por minuto` : "",
        ].filter(Boolean);
        return parts.length ? `\nÚltimos valores: ${parts.join(", ")}.` : "";
      })()
    : "";
  const urgent = i.band === "high" || i.band === "medium";
  return [
    `Hola, le saluda ${i.institutionName}.`,
    `Le contamos cómo va ${firstName(i.patientName)}${when}: ${phrase}.${vitalsLine}`,
    urgent
      ? "Le llamaremos por teléfono para darle más detalles. Si puede, deje su línea disponible."
      : "Si tiene preguntas o nota algo distinto, responda este mensaje o llame a la institución.",
    i.signer ? `— ${i.signer}, ${i.institutionName}` : `— Equipo de ${i.institutionName}`,
  ].join("\n");
}

export type PhoneKind = "mobile" | "landline" | "unknown";

/** Normaliza un teléfono colombiano: móviles de 10 dígitos que empiezan por 3 (con o sin +57). */
export function normalizeCoPhone(raw: string | null | undefined): {
  e164: string | null;
  kind: PhoneKind;
} {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return { e164: null, kind: "unknown" };
  const national = digits.startsWith("57") && digits.length === 12 ? digits.slice(2) : digits;
  if (national.length === 10 && national.startsWith("3"))
    return { e164: `57${national}`, kind: "mobile" };
  if (national.length === 10 && national.startsWith("60"))
    return { e164: `57${national}`, kind: "landline" };
  if (national.length === 7) return { e164: null, kind: "landline" };
  return { e164: null, kind: "unknown" };
}

/** Enlace de WhatsApp con el texto escrito (la persona lo revisa y lo envía; nada sale solo). Solo para móviles. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const p = normalizeCoPhone(phone);
  if (p.kind !== "mobile" || !p.e164) return null;
  return `https://wa.me/${p.e164}?text=${encodeURIComponent(text)}`;
}

// ── Errores del servidor, traducidos ──────────────────────────────────────────────────────────────────────────────────

export type CareErrorKind = "plan" | "validation" | "forbidden" | "conflict" | "other";

interface PgErrorLike {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string | null;
}

const ERROR_TEXT: Record<string, { text: string; kind: CareErrorKind }> = {
  forbidden: { text: "No tienes acceso a esta parte de la institución.", kind: "forbidden" },
  not_institution: { text: "Solo una institución puede registrar pacientes.", kind: "forbidden" },
  not_found: {
    text: "No encontramos ese registro. Puede que otra persona lo haya cambiado.",
    kind: "conflict",
  },
  consent_required: {
    text: "Confirma que la institución cuenta con la autorización del paciente o de su acudiente.",
    kind: "validation",
  },
  duplicate_document: {
    text: "Ya hay un paciente con ese documento en tu institución.",
    kind: "conflict",
  },
  invalid_data: { text: "Revisa los datos: alguno no es válido.", kind: "validation" },
  patient_limit: { text: "Llegaste al máximo de pacientes de tu plan.", kind: "plan" },
  monitor_limit: { text: "Llegaste al máximo de pacientes en monitoreo de tu plan.", kind: "plan" },
  device_limit: { text: "Llegaste al máximo de dispositivos de tu plan.", kind: "plan" },
  devices_plan: { text: "Conectar dispositivos es parte del plan Institucional.", kind: "plan" },
  handoff_plan: {
    text: "Guardar el relevo de turno es parte del plan Institucional.",
    kind: "plan",
  },
  export_plan: { text: "Exportar la historia es parte del plan Institucional.", kind: "plan" },
  patient_discharged: {
    text: "El paciente ya tiene el alta. Reactívalo para seguir.",
    kind: "conflict",
  },
  patient_not_active: { text: "El paciente debe estar activo para esto.", kind: "conflict" },
  not_monitored: { text: "El paciente no está en monitoreo.", kind: "conflict" },
  case_closed: { text: "Ese caso ya está cerrado.", kind: "conflict" },
  use_close: { text: "Para cerrar un caso usa «Cerrar caso».", kind: "validation" },
  use_discharge: { text: "Para dar el alta usa «Dar de alta».", kind: "validation" },
  reason_required: {
    text: "La escala 2 de saturación se usa solo por indicación médica: escribe cuál es.",
    kind: "validation",
  },
  empty_vitals: { text: "Escribe al menos un valor.", kind: "validation" },
  future_time: { text: "La hora del control está en el futuro.", kind: "validation" },
  too_old: { text: "No se registran controles de hace más de 48 horas.", kind: "validation" },
  application_invalid: {
    text: "Esa postulación no está aceptada o no es de tu institución.",
    kind: "validation",
  },
  application_used: { text: "Esa postulación ya tiene un caso.", kind: "conflict" },
  note_immutable: {
    text: "Las notas no se editan ni se borran: agrega una corrección.",
    kind: "conflict",
  },
  note_mismatch: { text: "La nota que corriges es de otro paciente.", kind: "validation" },
  case_mismatch: { text: "Ese caso es de otro paciente.", kind: "validation" },
  patient_mismatch: { text: "Ese paciente no es de tu institución.", kind: "validation" },
  device_revoked: { text: "Ese dispositivo está revocado: empareja uno nuevo.", kind: "conflict" },
};

/** Qué campo falló cuando el servidor dice «datos inválidos» (viene el nombre de la restricción en `details`). */
const CONSTRAINT_TEXT: Array<[RegExp, string]> = [
  [/full_name/, "Revisa el nombre (2 a 120 caracteres, sin los símbolos < >)."],
  [/document_number/, "Revisa el número de documento (4 a 20 letras, números, punto o guion)."],
  [/document_type/, "Revisa el tipo de documento."],
  [/inst_patients_check$/, "Si escribes un número de documento, elige también el tipo."],
  [/emergency_phone/, "Revisa el teléfono de contacto (solo números, 7 a 20 dígitos)."],
  [/birth_date/, "Revisa la fecha de nacimiento."],
  [
    /conditions|allergies/,
    "Revisa las listas de condiciones y alergias (hasta 20, de 80 caracteres).",
  ],
  [/inst_cases_title/, "El título del caso debe tener entre 3 y 140 caracteres."],
  [/target_end_at/, "Revisa la fecha estimada de cierre."],
  [/satisfaction/, "La valoración es de 1 a 5 estrellas."],
  [/inst_tasks_title/, "El título de la tarea debe tener entre 3 y 160 caracteres."],
  [/inst_devices_label/, "El nombre del dispositivo debe tener entre 2 y 60 caracteres."],
  [/inst_obs_hr/, "El pulso debe estar entre 20 y 300."],
  [/inst_obs_rr/, "La frecuencia respiratoria debe estar entre 4 y 70."],
  [/inst_obs_spo2/, "La saturación debe estar entre 50 y 100 %."],
  [/inst_obs_sbp/, "La presión sistólica debe estar entre 40 y 300."],
  [/inst_obs_dbp/, "La presión diastólica debe estar entre 20 y 200."],
  [/inst_obs_temp/, "La temperatura debe estar entre 25 y 45 °C."],
  [/inst_obs_pain/, "El dolor se califica de 0 a 10."],
  [/inst_obs_avpu/, "El estado de conciencia no es válido."],
];

function asPg(err: unknown): PgErrorLike {
  return isObj(err) ? (err as PgErrorLike) : { message: typeof err === "string" ? err : undefined };
}

export function careErrorKind(err: unknown): CareErrorKind {
  const e = asPg(err);
  const hint = (e.hint ?? "").trim();
  return ERROR_TEXT[hint]?.kind ?? "other";
}

export function careErrorMessage(err: unknown): string {
  const e = asPg(err);
  const hint = (e.hint ?? "").trim();
  if (hint === "invalid_data") {
    const detail = e.details ?? "";
    const match = CONSTRAINT_TEXT.find(([re]) => re.test(detail));
    if (match) return match[1];
  }
  const known = ERROR_TEXT[hint];
  if (known) {
    // Los topes del plan traen el número exacto en el mensaje del servidor: se conserva.
    if (known.kind === "plan" && e.message && /\d/.test(e.message)) return e.message;
    return known.text;
  }
  if (e.code === "42501") return "No tienes acceso a esta parte de la institución.";
  if (e.message && !/^(ERROR|PGRST|JWT|FetchError)/i.test(e.message) && e.message.length < 160)
    return e.message;
  return "No se pudo completar la acción. Inténtalo de nuevo.";
}

// ── Exportación ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function patientsToCsv(patients: InstPatient[], cases: InstCase[], now: Clock): string {
  const byPatient = new Map<string, InstCase[]>();
  for (const c of cases) byPatient.set(c.patient_id, [...(byPatient.get(c.patient_id) ?? []), c]);
  const columns: Array<CsvColumn<InstPatient>> = [
    { header: "Nombre", value: (p) => p.full_name },
    {
      header: "Documento",
      value: (p) => [p.document_type, p.document_number].filter(Boolean).join(" "),
    },
    { header: "Edad", value: (p) => ageYears(p.birth_date, now) },
    { header: "Sexo", value: (p) => p.sex },
    { header: "EPS", value: (p) => p.eps_name },
    { header: "Ciudad", value: (p) => p.city },
    { header: "Modalidad", value: (p) => MODALITY_META[p.modality].label },
    { header: "Estado", value: (p) => STATUS_META[p.status].label },
    { header: "Habitación", value: (p) => p.room },
    { header: "En monitoreo", value: (p) => (p.monitoring ? "Sí" : "No") },
    { header: "Condiciones", value: (p) => p.conditions.join(", ") },
    { header: "Alergias", value: (p) => p.allergies.join(", ") },
    { header: "Registrado", value: (p) => bogotaDateTime(p.created_at) },
    {
      header: "Casos abiertos",
      value: (p) =>
        (byPatient.get(p.id) ?? []).filter((c) => c.status === "active" || c.status === "pending")
          .length,
    },
    {
      header: "Casos cerrados",
      value: (p) => (byPatient.get(p.id) ?? []).filter((c) => c.closed_at).length,
    },
  ];
  return toCsv(patients, columns);
}

export function notesToCsv(notes: InstNote[]): string {
  const columns: Array<CsvColumn<InstNote>> = [
    { header: "N.º", value: (n) => n.seq },
    { header: "Fecha", value: (n) => bogotaDateTime(n.created_at) },
    { header: "Tipo", value: (n) => NOTE_KIND_META[n.kind].label },
    { header: "Autor", value: (n) => n.author_name },
    { header: "Texto", value: (n) => n.body },
    { header: "Firma (SHA-256)", value: (n) => n.hash },
  ];
  return toCsv(
    [...notes].sort((a, b) => a.seq - b.seq),
    columns,
  );
}
