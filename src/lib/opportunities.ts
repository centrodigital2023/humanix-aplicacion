// Hub de oportunidades del profesional — lógica pura, explicable y verificable.
//
// Seguridad: lo que se oculta (dirección, teléfono, notas con datos de contacto) lo decide el
// SERVIDOR (vista `family_needs_for_pros` y RPC `reveal_opportunity_contact`). Estas funciones solo
// agrupan, puntúan y presentan lo que el servidor ya filtró. `redactContactInfo` replica la regla de
// `public.redact_contact_info` (SQL) para textos que se muestren fuera de esa vista; si cambias una,
// cambia la otra y sus pruebas.

import { cityKey } from "./marketplaceInsights";
import { normalizeText } from "./pqrsRules";
import { containsPaymentInstruction } from "../../supabase/functions/_shared/paymentGuard";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Colombia no tiene horario de verano: UTC-5 todo el año. */
const BOGOTA_OFFSET = -5 * HOUR;

/** Un turno agrupado no pasa de 24 h: una semana 24/7 se ofrece como 7 turnos, no como uno de 168 h. */
export const MAX_SHIFT_HOURS = 24;

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

export function hoursBetween(startIso: string, endIso: string): number {
  const diff = (ms(endIso) - ms(startIso)) / HOUR;
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff * 100) / 100 : 0;
}

// ─── Datos de contacto: qué se oculta ────────────────────────────────────────

const HIDDEN_CONTACT = "[contacto oculto]";
const HIDDEN_LINK = "[enlace oculto]";
const HIDDEN_ADDRESS = "[dirección oculta]";

const STREET_WORDS =
  "calle|cll|cl|carrera|cra|cr|kr|avenida|av|diagonal|diag|dg|transversal|tv|circular|autopista";
const UNIT_WORDS =
  "apto|apartamento|apt|torre|interior|int|bloque|manzana|mz|lote|oficina|piso|casa";
const BUILDING_WORDS =
  "[Cc]onjunto|[Ee]dificio|[Uu]rbanizaci[oó]n|[Cc]ondominio|[Aa]grupaci[oó]n|[Uu]nidad [Rr]esidencial";

/**
 * Misma lista, mismo orden y mismos patrones que `public.redact_contact_info` (SQL).
 * Se limita a lo que Postgres (ARE) y JavaScript interpretan igual.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, HIDDEN_CONTACT],
  [/(https?:\/\/|www\.)\S+/gi, HIDDEN_LINK],
  [/(^|\s)@[A-Za-z0-9._]{3,}/g, `$1${HIDDEN_CONTACT}`],
  [/\(\d{3}\)[ .-]?\d{3}[ .-]?\d{2,4}/g, HIDDEN_CONTACT],
  [/\+?\d([ .-]?\d){6,}/g, HIDDEN_CONTACT],
  [
    new RegExp(
      `(^|[^A-Za-z])(${STREET_WORDS})\\.?\\s*\\d+[a-z]?(\\s+bis)?(\\s+(sur|norte|este|oeste))?(\\s*(#|no\\.?|n°|nº)?\\s*\\d+[a-z]?(\\s*[-–]\\s*\\d+)?)?`,
      "gi",
    ),
    `$1${HIDDEN_ADDRESS}`,
  ],
  [
    new RegExp(`(^|[^A-Za-z])(${UNIT_WORDS})\\.?\\s*(#|no\\.?)?\\s*\\d+[a-z]?`, "gi"),
    `$1${HIDDEN_ADDRESS}`,
  ],
  [
    new RegExp(`(${BUILDING_WORDS})(\\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*){1,3}`, "g"),
    HIDDEN_ADDRESS,
  ],
];

/** Quita teléfonos, correos, enlaces, @usuarios y direcciones exactas de un texto libre. */
export function redactContactInfo(text: string | null | undefined): string {
  let out = String(text ?? "");
  for (const [re, replacement] of REDACTIONS) out = out.replace(re, replacement);
  return out;
}

export function hasContactInfo(text: string | null | undefined): boolean {
  const t = String(text ?? "");
  return redactContactInfo(t) !== t;
}

/** Nombre visible antes de desbloquear contacto: «María G.». */
export function displayName(fullName: string | null | undefined): string {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length || parts[0].includes("@")) return "Familia";
  const first = parts[0];
  if (parts.length === 1) return first;
  const initial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${initial}.`;
}

/** Quita caracteres de control (conserva tabulación y saltos de línea). */
export function stripControlChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c <= 8 || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) continue;
    out += ch;
  }
  return out;
}

export type MessageCheck =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "too_long" | "contact_info" | "payment_instruction" };

/**
 * Mensajes que viajan por la plataforma (postulación, contraoferta, comentarios): sin teléfonos,
 * enlaces ni instrucciones de pago. El contacto se desbloquea con el plan, de forma auditada, y los
 * pagos ocurren solo en la página web.
 */
export function checkOutgoingMessage(
  raw: string | null | undefined,
  opts: { required?: boolean; maxChars?: number } = {},
): MessageCheck {
  const maxChars = opts.maxChars ?? 500;
  const text = stripControlChars(String(raw ?? "")).trim();
  if (!text) return opts.required ? { ok: false, reason: "empty" } : { ok: true, text: "" };
  if (text.length > maxChars) return { ok: false, reason: "too_long" };
  if (containsPaymentInstruction(text)) return { ok: false, reason: "payment_instruction" };
  if (hasContactInfo(text)) return { ok: false, reason: "contact_info" };
  return { ok: true, text };
}

export const MESSAGE_ERROR_COPY: Record<Exclude<MessageCheck, { ok: true }>["reason"], string> = {
  empty: "Escribe un mensaje.",
  too_long: "El mensaje es demasiado largo.",
  contact_info:
    "No incluyas teléfonos, correos, enlaces ni direcciones: el contacto se desbloquea desde tu plan.",
  payment_instruction:
    "No incluyas datos de pago. Los pagos se hacen únicamente en la página web de Humanix.",
};

// ─── Turnos: la familia marca horas sueltas; el profesional ve turnos ────────

export interface NeedBlock {
  id: string;
  family_user_id: string;
  display_name: string | null;
  city: string | null;
  care_type: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate: number | null;
  notes_public: string | null;
  status: string;
}

export interface Shift {
  key: string;
  family_user_id: string;
  display_name: string;
  city: string | null;
  care_type: string | null;
  need_ids: string[];
  starts_at: string;
  ends_at: string;
  hours: number;
  rate_min: number | null;
  rate_max: number | null;
  /** Promedio ponderado por horas, redondeado a COP. */
  rate_avg: number | null;
  notes: string[];
}

function newShift(b: NeedBlock): Shift {
  return {
    key: `${b.family_user_id}:${b.id}`,
    family_user_id: b.family_user_id,
    display_name: b.display_name || "Familia",
    city: b.city,
    care_type: b.care_type,
    need_ids: [b.id],
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    hours: hoursBetween(b.starts_at, b.ends_at),
    rate_min: b.hourly_rate,
    rate_max: b.hourly_rate,
    rate_avg: b.hourly_rate,
    notes: b.notes_public?.trim() ? [b.notes_public.trim()] : [],
  };
}

/**
 * Une bloques contiguos de una misma familia en turnos de hasta `maxHours`. Solo considera bloques
 * abiertos y con horario válido; no mezcla familias ni salta huecos.
 */
export function groupNeedsIntoShifts(blocks: NeedBlock[], maxHours = MAX_SHIFT_HOURS): Shift[] {
  const usable = blocks
    .filter((b) => b.status === "open" && hoursBetween(b.starts_at, b.ends_at) > 0)
    .sort(
      (a, b) =>
        a.family_user_id.localeCompare(b.family_user_id) || ms(a.starts_at) - ms(b.starts_at),
    );

  const shifts: Shift[] = [];
  // Acumuladores para el promedio ponderado del turno en curso.
  let current: Shift | null = null;
  let rateWeight = 0;
  let rateSum = 0;

  const flush = () => {
    if (!current) return;
    current.rate_avg = rateWeight > 0 ? Math.round(rateSum / rateWeight) : null;
    shifts.push(current);
  };

  for (const b of usable) {
    const h = hoursBetween(b.starts_at, b.ends_at);
    const extendable =
      current &&
      current.family_user_id === b.family_user_id &&
      ms(current.ends_at) === ms(b.starts_at) &&
      current.hours + h <= maxHours;

    if (current && extendable) {
      current.need_ids.push(b.id);
      current.ends_at = b.ends_at;
      current.hours = Math.round((current.hours + h) * 100) / 100;
      if (b.hourly_rate != null) {
        current.rate_min =
          current.rate_min == null ? b.hourly_rate : Math.min(current.rate_min, b.hourly_rate);
        current.rate_max =
          current.rate_max == null ? b.hourly_rate : Math.max(current.rate_max, b.hourly_rate);
        rateSum += b.hourly_rate * h;
        rateWeight += h;
      }
      current.care_type = current.care_type || b.care_type;
      current.city = current.city || b.city;
      const note = b.notes_public?.trim();
      if (note && !current.notes.includes(note)) current.notes.push(note);
    } else {
      flush();
      current = newShift(b);
      rateSum = b.hourly_rate != null ? b.hourly_rate * h : 0;
      rateWeight = b.hourly_rate != null ? h : 0;
    }
  }
  flush();
  return shifts;
}

export function estimatedTotal(rate: number | null, hours: number): number | null {
  return rate == null || !Number.isFinite(rate) ? null : Math.round(rate * hours);
}

// ─── Urgencia y presentación del horario ─────────────────────────────────────

export type Urgency = "now" | "today" | "tomorrow" | "week" | "later";

export const URGENCY_LABEL: Record<Urgency, string> = {
  now: "Urgente · en menos de 6 h",
  today: "Hoy",
  tomorrow: "Mañana",
  week: "Esta semana",
  later: "Programado",
};

const bogotaDay = (t: number) => Math.floor((t + BOGOTA_OFFSET) / DAY);

export function urgencyOf(startsAt: string, now = Date.now()): Urgency {
  const start = ms(startsAt);
  if (!Number.isFinite(start)) return "later";
  if (start - now <= 6 * HOUR) return "now";
  const days = bogotaDay(start) - bogotaDay(now);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return "week";
  return "later";
}

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n: number) => String(n).padStart(2, "0");

function bogotaParts(iso: string) {
  const d = new Date(ms(iso) + BOGOTA_OFFSET);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    day: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()],
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** Día calendario en Colombia (YYYY-MM-DD) de un instante. */
export function bogotaDayKey(iso: string): string {
  const t = ms(iso);
  return Number.isFinite(t) ? new Date(t + BOGOTA_OFFSET).toISOString().slice(0, 10) : "";
}

/** «lun 12 oct», en hora de Colombia. */
export function bogotaDayLabel(iso: string): string {
  if (!Number.isFinite(ms(iso))) return "";
  const p = bogotaParts(iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** «lun 12 oct · 18:00–06:00 (12 h)», siempre en hora de Colombia y sin depender del ICU del equipo. */
export function formatShiftRange(startsAt: string, endsAt: string): string {
  if (!Number.isFinite(ms(startsAt)) || !Number.isFinite(ms(endsAt))) return "Horario por definir";
  const s = bogotaParts(startsAt);
  const e = bogotaParts(endsAt);
  const hours = hoursBetween(startsAt, endsAt);
  const h = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${s.weekday} ${s.day} ${s.month} · ${s.time}–${e.time} (${h} h)`;
}

// ─── Compatibilidad explicable ───────────────────────────────────────────────

export interface ProContext {
  specialty: string | null;
  subSpecialties: string[];
  /** Ciudades de servicio y ciudad base (sin normalizar). */
  cities: string[];
  hourlyRate: number | null;
  /** Servicios ya confirmados: se usan para detectar cruces de horario. */
  busy: Array<{ start: string; end: string }>;
}

export interface FamilySignal {
  stars: number | null;
  ratings: number;
}

export interface MatchResult {
  score: number;
  label: "Excelente" | "Buena" | "Posible" | "Baja";
  reasons: string[];
  warnings: string[];
  conflict: boolean;
}

const SPECIALTY_SYNONYMS: Array<[RegExp, RegExp]> = [
  [/geriatr|adulto mayor/, /adulto mayor|geriatr|anciano|abuel/],
  [/pediatr/, /pediatr|nino|infan|bebe|neonat/],
  [/enfermer/, /enfermer|curaci|inyect|sonda|ostom|oxigen|herida|signos|postoperat|post operat/],
  [/fisio|rehabilit|terapia fisica/, /fisio|rehabilit|movilid|terapia/],
  [/respirator/, /respirat|oxigen|ventila|traqueo/],
  [/auxiliar|cuidador/, /auxiliar|cuidad|acompan|aseo|higiene|domicili/],
  [/psicolog|salud mental/, /psicolog|salud mental|demencia|alzheimer|ansied/],
  [/nutric/, /nutric|dieta|alimenta|sonda/],
  [/paliativ|oncolog/, /paliativ|oncolog|cancer|dolor|terminal/],
  [/medic/, /medic|valoracion/],
];
const GENERIC_CARE = /domicili|cuidador|acompan|cuidado en casa|general|sin especificar/;

/**
 * Coincidencia entre un texto de cuidado (tipo de servicio, especialidad pedida, área) y el perfil del
 * profesional. La usan las solicitudes de familias y los turnos de instituciones.
 */
export function careFitText(
  text: string,
  pro: ProContext,
  emptyReason = "No especificó el tipo de cuidado",
): { points: number; reason?: string; warning?: string } {
  const haystack = normalizeText(text);
  const proText = normalizeText([pro.specialty ?? "", ...pro.subSpecialties].join(" "));
  if (!haystack.trim()) {
    return { points: 18, reason: emptyReason };
  }
  if (proText.trim()) {
    for (const [proRe, careRe] of SPECIALTY_SYNONYMS) {
      if (proRe.test(proText) && careRe.test(haystack)) {
        return {
          points: 30,
          reason: `Coincide con tu especialidad (${pro.specialty ?? "perfil"})`,
        };
      }
    }
    const careTokens = haystack.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
    if (careTokens.some((t) => proText.includes(t))) {
      return { points: 30, reason: "Coincide con tu perfil profesional" };
    }
  }
  if (GENERIC_CARE.test(haystack)) {
    return { points: 22, reason: "Cuidado general en casa, abierto a varios perfiles" };
  }
  return { points: 8, warning: "El tipo de cuidado no coincide claramente con tu especialidad" };
}

function careFit(
  shift: Shift,
  pro: ProContext,
): { points: number; reason?: string; warning?: string } {
  return careFitText(
    `${shift.care_type ?? ""} ${shift.notes.join(" ")}`,
    pro,
    "La familia no especificó el tipo de cuidado",
  );
}

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd;

export function scoreShift(
  shift: Shift,
  pro: ProContext,
  family?: FamilySignal | null,
): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Ciudad (30)
  const shiftCity = cityKey(shift.city);
  const proCities = new Set(pro.cities.map((c) => cityKey(c)).filter(Boolean));
  if (!shiftCity) {
    score += 15;
  } else if (proCities.has(shiftCity)) {
    score += 30;
    reasons.push("Está en tu zona de servicio");
  } else {
    warnings.push("Fuera de tus ciudades de servicio");
  }

  // Tipo de cuidado (30)
  const care = careFit(shift, pro);
  score += care.points;
  if (care.reason) reasons.push(care.reason);
  if (care.warning) warnings.push(care.warning);

  // Tarifa (20)
  if (pro.hourlyRate == null || pro.hourlyRate <= 0 || shift.rate_avg == null) {
    score += 10;
  } else {
    const ratio = shift.rate_avg / pro.hourlyRate;
    if (ratio >= 1) {
      score += 20;
      reasons.push("Paga igual o más que tu tarifa");
    } else if (ratio >= 0.9) {
      score += 15;
      reasons.push(`Cerca de tu tarifa (${Math.round((1 - ratio) * 100)}% menos)`);
    } else if (ratio >= 0.75) {
      score += 8;
      warnings.push(
        `Paga ${Math.round((1 - ratio) * 100)}% menos que tu tarifa: puedes proponer otro valor`,
      );
    } else {
      warnings.push(
        `Paga ${Math.round((1 - ratio) * 100)}% menos que tu tarifa: negocia o déjala pasar`,
      );
    }
  }

  // Agenda (10)
  const start = ms(shift.starts_at);
  const end = ms(shift.ends_at);
  const conflict = pro.busy.some((b) => overlaps(start, end, ms(b.start), ms(b.end)));
  if (conflict) {
    warnings.push("Se cruza con un servicio que ya tienes confirmado");
  } else {
    score += 10;
    reasons.push("Sin cruces con tu agenda");
  }

  // Reputación de la familia (10) — sin historial no se penaliza.
  if (family && family.stars != null && family.ratings >= 3) {
    const s = family.stars;
    const txt = `${s.toFixed(1)} · ${family.ratings} reseñas`;
    if (s >= 4.5) {
      score += 10;
      reasons.push(`Familia con excelente reputación (${txt})`);
    } else if (s >= 4) {
      score += 7;
      reasons.push(`Familia bien calificada (${txt})`);
    } else if (s >= 3.5) {
      score += 3;
    } else {
      warnings.push(`Familia con calificación baja (${txt})`);
    }
  } else {
    score += 5;
  }

  if (conflict) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    score >= 80 ? "Excelente" : score >= 60 ? "Buena" : score >= 40 ? "Posible" : "Baja";
  return { score, label, reasons, warnings, conflict };
}

export interface RankedShift {
  shift: Shift;
  match: MatchResult;
  urgency: Urgency;
}

const URGENCY_RANK: Record<Urgency, number> = { now: 0, today: 1, tomorrow: 2, week: 3, later: 4 };

export function rankShifts(
  shifts: Shift[],
  pro: ProContext,
  signals: Record<string, FamilySignal | undefined> = {},
  now = Date.now(),
): RankedShift[] {
  return shifts
    .map((shift) => ({
      shift,
      match: scoreShift(shift, pro, signals[shift.family_user_id]),
      urgency: urgencyOf(shift.starts_at, now),
    }))
    .sort(
      (a, b) =>
        Number(a.match.conflict) - Number(b.match.conflict) ||
        b.match.score - a.match.score ||
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        ms(a.shift.starts_at) - ms(b.shift.starts_at),
    );
}

export interface OpportunitySummary {
  shifts: number;
  hours: number;
  potentialEarnings: number;
  urgent: number;
  conflicts: number;
}

export function summarizeOpportunities(rows: RankedShift[]): OpportunitySummary {
  const free = rows.filter((r) => !r.match.conflict);
  return {
    shifts: free.length,
    hours: Math.round(free.reduce((n, r) => n + r.shift.hours, 0) * 100) / 100,
    potentialEarnings: free.reduce(
      (n, r) => n + (estimatedTotal(r.shift.rate_avg, r.shift.hours) ?? 0),
      0,
    ),
    urgent: free.filter((r) => r.urgency === "now" || r.urgency === "today").length,
    conflicts: rows.length - free.length,
  };
}

// ─── Alertas de oportunidades ────────────────────────────────────────────────

export interface OpportunityAlert {
  cities: string[];
  care_types: string[];
  min_rate: number | null;
  urgent_only: boolean;
}

/** Misma regla que el disparador SQL `notify_opportunity_alerts`, para mostrar una vista previa. */
export function alertMatchesShift(
  alert: OpportunityAlert,
  shift: Shift,
  now = Date.now(),
): boolean {
  if (alert.cities.length) {
    const key = cityKey(shift.city);
    if (!key || !alert.cities.some((c) => cityKey(c) === key)) return false;
  }
  if (alert.care_types.length) {
    const hay = normalizeText(`${shift.care_type ?? ""} ${shift.notes.join(" ")}`);
    if (!alert.care_types.some((t) => hay.includes(normalizeText(t)))) return false;
  }
  if (alert.min_rate != null && (shift.rate_max ?? 0) < alert.min_rate) return false;
  if (alert.urgent_only) {
    const u = urgencyOf(shift.starts_at, now);
    if (u !== "now" && u !== "today") return false;
  }
  return true;
}

// ─── Postulación y primer contacto ───────────────────────────────────────────

export interface ProIntro {
  name: string | null;
  specialty: string | null;
  yearsExperience: number | null;
  rethusVerified: boolean;
}

/** Borrador determinista (sin IA) para que la postulación no salga vacía; el profesional lo edita. */
export function buildApplicationDraft(shift: Shift, pro: ProIntro): string {
  const first = (pro.name ?? "").trim().split(/\s+/)[0] || "un profesional de Humanix";
  const parts: string[] = [`Hola, soy ${first}`];
  if (pro.specialty) parts[0] += `, ${pro.specialty.toLowerCase()}`;
  if (pro.yearsExperience && pro.yearsExperience > 0) {
    parts[0] += ` con ${pro.yearsExperience} ${pro.yearsExperience === 1 ? "año" : "años"} de experiencia`;
  }
  parts[0] += pro.rethusVerified ? " y registro RETHUS verificado." : ".";
  parts.push(
    `Puedo cubrir el turno ${formatShiftRange(shift.starts_at, shift.ends_at)}.`,
    "Quedo atento/a a tus indicaciones sobre el paciente y la rutina del servicio.",
  );
  return parts.join(" ");
}

/** E.164 ligero para wa.me: quita símbolos y antepone 57 a celulares colombianos de 10 dígitos. */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
  const full = /^3\d{9}$/.test(digits) ? `57${digits}` : digits;
  return /^\d{10,15}$/.test(full) ? full : null;
}

/** Mensaje inicial de WhatsApp: sin enlaces ni datos de pago; recuerda que se paga solo en la web. */
export function buildFamilyOutreachMessage(args: {
  familyName: string | null;
  proName: string | null;
  shift: Pick<Shift, "starts_at" | "ends_at">;
}): string {
  const fam = (args.familyName ?? "").trim().split(/\s+/)[0] || "";
  const pro = (args.proName ?? "").trim().split(/\s+/)[0] || "un profesional";
  return [
    `Hola${fam ? ` ${fam}` : ""}, soy ${pro} de Humanix.`,
    `Vi tu solicitud de cuidado (${formatShiftRange(args.shift.starts_at, args.shift.ends_at)}).`,
    "¿Podemos coordinar los detalles del servicio?",
    "Recuerda que los pagos se gestionan únicamente en la página web de Humanix.",
  ].join(" ");
}

export function whatsAppLink(number: string | null | undefined, message: string): string | null {
  const n = toWhatsAppNumber(number);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
}

// ─── Desbloqueo de contacto: espejo del servidor ─────────────────────────────

/**
 * Cupo diario de desbloqueos por plan. El servidor (`reveal_opportunity_contact`) aplica el mismo
 * valor; esto solo permite explicarlo en pantalla antes de gastar un intento.
 */
export const REVEAL_DAILY_QUOTA = {
  free: 0,
  essential_monthly: 15,
  pro_monthly: 40,
  institution_monthly: 40,
} as const;

export type RevealBlock = "plan" | "not_applied" | "quota" | null;

export function canRevealContact(args: {
  plan: string | null | undefined;
  hasApplied: boolean;
  revealsToday: number;
}): { allowed: boolean; blockedBy: RevealBlock; remaining: number } {
  const quota = REVEAL_DAILY_QUOTA[(args.plan ?? "free") as keyof typeof REVEAL_DAILY_QUOTA] ?? 0;
  const remaining = Math.max(0, quota - args.revealsToday);
  if (quota === 0) return { allowed: false, blockedBy: "plan", remaining: 0 };
  if (!args.hasApplied) return { allowed: false, blockedBy: "not_applied", remaining };
  if (remaining === 0) return { allowed: false, blockedBy: "quota", remaining: 0 };
  return { allowed: true, blockedBy: null, remaining };
}

// ─── Filas del servidor → modelo del hub ─────────────────────────────────────

/** Fila que devuelve `public.list_open_family_needs()` (nunca trae dirección). */
export interface OpenNeedRow {
  id: string;
  family_user_id: string;
  display_name: string | null;
  city: string | null;
  care_type: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate: number | null;
  notes_public: string | null;
  created_at: string;
  already_applied: boolean | null;
  family_stars: number | string | null;
  family_ratings: number | null;
  family_completed: number | null;
}

export interface FamilyInfo extends FamilySignal {
  completed: number;
}

export function splitOpenNeedRows(rows: OpenNeedRow[]): {
  blocks: NeedBlock[];
  families: Record<string, FamilyInfo>;
  appliedNeedIds: Set<string>;
} {
  const blocks: NeedBlock[] = [];
  const families: Record<string, FamilyInfo> = {};
  const appliedNeedIds = new Set<string>();
  for (const r of rows) {
    blocks.push({
      id: r.id,
      family_user_id: r.family_user_id,
      display_name: r.display_name,
      city: r.city,
      care_type: r.care_type,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      hourly_rate: r.hourly_rate,
      notes_public: r.notes_public,
      status: "open",
    });
    if (r.already_applied) appliedNeedIds.add(r.id);
    if (!families[r.family_user_id]) {
      const stars = r.family_stars == null ? null : Number(r.family_stars);
      families[r.family_user_id] = {
        stars: stars != null && Number.isFinite(stars) ? stars : null,
        ratings: r.family_ratings ?? 0,
        completed: r.family_completed ?? 0,
      };
    }
  }
  return { blocks, families, appliedNeedIds };
}

export const isShiftApplied = (shift: Shift, appliedNeedIds: Set<string>): boolean =>
  shift.need_ids.some((id) => appliedNeedIds.has(id));

// ─── Filtros y vista por día ─────────────────────────────────────────────────

export interface HubFilters {
  /** Ciudad exacta tal como llega del servidor; vacío = todas. */
  city: string;
  /** Texto libre sobre tipo de cuidado y notas. */
  query: string;
  minRate: number | null;
  urgentOnly: boolean;
  hideConflicts: boolean;
  sort: "match" | "soonest" | "pay";
}

export const DEFAULT_FILTERS: HubFilters = {
  city: "",
  query: "",
  minRate: null,
  urgentOnly: false,
  hideConflicts: false,
  sort: "match",
};

export function applyFilters(items: RankedShift[], f: HubFilters): RankedShift[] {
  const q = normalizeText(f.query);
  const city = cityKey(f.city);
  const out = items.filter(({ shift, match, urgency }) => {
    if (city && cityKey(shift.city) !== city) return false;
    if (q && !normalizeText(`${shift.care_type ?? ""} ${shift.notes.join(" ")}`).includes(q)) {
      return false;
    }
    if (f.minRate != null && (shift.rate_max ?? 0) < f.minRate) return false;
    if (f.urgentOnly && urgency !== "now" && urgency !== "today") return false;
    if (f.hideConflicts && match.conflict) return false;
    return true;
  });
  if (f.sort === "soonest") {
    return [...out].sort((a, b) => ms(a.shift.starts_at) - ms(b.shift.starts_at));
  }
  if (f.sort === "pay") {
    const pay = (r: RankedShift) => estimatedTotal(r.shift.rate_avg, r.shift.hours) ?? 0;
    return [...out].sort((a, b) => pay(b) - pay(a));
  }
  return out;
}

/** Ciudades presentes en los turnos, sin repetir (por clave normalizada) y ordenadas. */
export function distinctCities(shifts: Shift[]): string[] {
  const seen = new Map<string, string>();
  for (const s of shifts) {
    const key = cityKey(s.city);
    if (key && s.city && !seen.has(key)) seen.set(key, s.city);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
}

export interface DayGroup<T> {
  dayKey: string;
  label: string;
  items: T[];
}

/** Agrupa por día de inicio en hora de Colombia (un turno nocturno cuenta en el día en que empieza). */
export function groupShiftsByDay<T extends { shift: Shift }>(items: T[]): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  const sorted = [...items].sort((a, b) => ms(a.shift.starts_at) - ms(b.shift.starts_at));
  for (const it of sorted) {
    const t = ms(it.shift.starts_at);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t + BOGOTA_OFFSET);
    const dayKey = d.toISOString().slice(0, 10);
    let g = groups.get(dayKey);
    if (!g) {
      g = {
        dayKey,
        label: `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
        items: [],
      };
      groups.set(dayKey, g);
    }
    g.items.push(it);
  }
  return [...groups.values()];
}

// ─── Errores del servidor → mensajes y acciones ──────────────────────────────

export type HubErrorKind =
  | "plan_required"
  | "negotiate_plan"
  | "application_required"
  | "quota"
  | "duplicate"
  | "conflict"
  | "unavailable"
  | "forbidden_content"
  | "rate_out_of_band"
  | "final_round"
  | "shift_full"
  | "shifts_required"
  | "contract_locked"
  | "other";

export interface ServerError {
  message?: string | null;
  hint?: string | null;
  code?: string | null;
}

export function classifyHubError(err: ServerError | null | undefined): {
  kind: HubErrorKind;
  message: string;
} {
  const message =
    (err?.message ?? "").trim() || "No se pudo completar la acción. Inténtalo de nuevo.";
  const hint = err?.hint ?? "";
  const lower = message.toLowerCase();
  if (hint === "plan_required") return { kind: "plan_required", message };
  if (hint === "negotiate_rate_requires_plan") return { kind: "negotiate_plan", message };
  if (hint === "application_required") return { kind: "application_required", message };
  if (hint === "quota_exceeded") return { kind: "quota", message };
  if (hint === "rate_out_of_band") return { kind: "rate_out_of_band", message };
  if (hint === "final_round") return { kind: "final_round", message };
  if (hint === "shift_full") return { kind: "shift_full", message };
  if (hint === "shifts_required") return { kind: "shifts_required", message };
  if (hint === "contract_locked") return { kind: "contract_locked", message };
  if (hint === "forbidden_content") return { kind: "forbidden_content", message };
  if (err?.code === "23505") return { kind: "duplicate", message };
  if (err?.code === "23P01") return { kind: "conflict", message };
  if (lower.includes("ya no está disponible") || lower.includes("venció")) {
    return { kind: "unavailable", message };
  }
  if (lower.includes("teléfonos") || lower.includes("datos de pago")) {
    return { kind: "forbidden_content", message };
  }
  return { kind: "other", message };
}

// ─── Contexto del profesional (a partir de sus tablas) ───────────────────────

/** Fecha de hoy en Colombia (YYYY-MM-DD); coincide con `revealed_on` del servidor. */
export function bogotaToday(now = Date.now()): string {
  return new Date(now + BOGOTA_OFFSET).toISOString().slice(0, 10);
}

export function buildProContext(args: {
  specialty: string | null;
  sub_specialties: string[] | null;
  service_cities: string[] | null;
  home_city: string | null;
  hourly_rate: number | null;
  profileCity: string | null;
  bookings: Array<{ scheduled_at: string; duration_hours: number | string }>;
}): ProContext {
  const cities = [...(args.service_cities ?? []), args.home_city, args.profileCity].filter(
    (c): c is string => !!c && c.trim() !== "",
  );
  const busy = args.bookings.flatMap((b) => {
    const start = ms(b.scheduled_at);
    const hours = Number(b.duration_hours);
    return Number.isFinite(start) && Number.isFinite(hours) && hours > 0
      ? [{ start: b.scheduled_at, end: new Date(start + hours * HOUR).toISOString() }]
      : [];
  });
  return {
    specialty: args.specialty,
    subSpecialties: args.sub_specialties ?? [],
    cities,
    hourlyRate: args.hourly_rate && args.hourly_rate > 0 ? args.hourly_rate : null,
    busy,
  };
}

/** «Bogotá, Soacha» → ["Bogotá", "Soacha"]: sin vacíos ni repetidos (por texto normalizado), tope por elemento. */
export function parseList(text: string, opts: { max?: number; maxLen?: number } = {}): string[] {
  const max = opts.max ?? 10;
  const maxLen = opts.maxLen ?? 40;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const item = raw.trim().slice(0, maxLen);
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}
