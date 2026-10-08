// Reglas puras de PQRS: calendario laboral de Colombia, plazos, riesgo de incumplimiento,
// señales de seguridad, duplicados, tendencias y CSV seguro.
// Sin APIs de Deno ni del navegador: lo usan las Edge Functions, el panel y las pruebas.

// ─── Calendario laboral de Colombia ──────────────────────────────────────────

const BOGOTA_OFFSET_MS = -5 * 3600_000; // Colombia no tiene horario de verano.
const DAY_MS = 86_400_000;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const ymdKey = (v: YMD) => `${v.y}-${pad(v.m)}-${pad(v.d)}`;
const utc = (v: YMD) => new Date(Date.UTC(v.y, v.m - 1, v.d));
const fromUtc = (dt: Date): YMD => ({
  y: dt.getUTCFullYear(),
  m: dt.getUTCMonth() + 1,
  d: dt.getUTCDate(),
});
const addDaysUtc = (dt: Date, n: number) => new Date(dt.getTime() + n * DAY_MS);

export function toBogotaYMD(ts: number | Date | string): YMD {
  const ms =
    ts instanceof Date ? ts.getTime() : typeof ts === "string" ? new Date(ts).getTime() : ts;
  return fromUtc(new Date(ms + BOGOTA_OFFSET_MS));
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
export function easterSunday(year: number): YMD {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { y: year, m: month, d: day };
}

function nextMonday(dt: Date): Date {
  const dow = dt.getUTCDay(); // 0 = domingo
  return addDaysUtc(dt, (8 - dow) % 7);
}

const holidayCache = new Map<number, Set<string>>();

/** Festivos de Colombia (Ley 51 de 1983 «Emiliani» + Semana Santa y festivos ligados a la Pascua). */
export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set<string>();
  const add = (dt: Date) => set.add(ymdKey(fromUtc(dt)));

  // Fijos
  for (const [m, d] of [
    [1, 1],
    [5, 1],
    [7, 20],
    [8, 7],
    [12, 8],
    [12, 25],
  ] as const) {
    add(new Date(Date.UTC(year, m - 1, d)));
  }
  // Trasladables al lunes siguiente
  for (const [m, d] of [
    [1, 6],
    [3, 19],
    [6, 29],
    [8, 15],
    [10, 12],
    [11, 1],
    [11, 11],
  ] as const) {
    add(nextMonday(new Date(Date.UTC(year, m - 1, d))));
  }
  // Ligados a la Pascua
  const easter = utc(easterSunday(year));
  add(addDaysUtc(easter, -3)); // Jueves Santo
  add(addDaysUtc(easter, -2)); // Viernes Santo
  add(nextMonday(addDaysUtc(easter, 39))); // Ascensión
  add(nextMonday(addDaysUtc(easter, 60))); // Corpus Christi
  add(nextMonday(addDaysUtc(easter, 68))); // Sagrado Corazón

  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(v: YMD): boolean {
  const dow = utc(v).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !colombianHolidays(v.y).has(ymdKey(v));
}

/** Fin del día (23:59:59 hora de Colombia) del N-ésimo día hábil posterior a la recepción. */
export function addBusinessDays(start: number | Date | string, n: number): Date {
  let cursor = utc(toBogotaYMD(start));
  let counted = 0;
  while (counted < Math.max(0, n)) {
    cursor = addDaysUtc(cursor, 1);
    if (isBusinessDay(fromUtc(cursor))) counted++;
  }
  const v = fromUtc(cursor);
  return new Date(Date.UTC(v.y, v.m - 1, v.d, 23, 59, 59, 999) - BOGOTA_OFFSET_MS);
}

/** Días hábiles transcurridos entre dos instantes (negativo si `to` es anterior a `from`). */
export function businessDaysBetween(
  from: number | Date | string,
  to: number | Date | string,
): number {
  const a = utc(toBogotaYMD(from));
  const b = utc(toBogotaYMD(to));
  if (a.getTime() === b.getTime()) return 0;
  const forward = b.getTime() > a.getTime();
  let cursor = forward ? a : b;
  const end = forward ? b : a;
  let count = 0;
  while (cursor.getTime() < end.getTime()) {
    cursor = addDaysUtc(cursor, 1);
    if (isBusinessDay(fromUtc(cursor))) count++;
  }
  return forward ? count : -count;
}

// ─── Plazos ──────────────────────────────────────────────────────────────────

export type TicketType = "peticion" | "queja" | "reclamo" | "sugerencia" | "denuncia" | "consulta";
export const TICKET_TYPES: readonly TicketType[] = [
  "peticion",
  "queja",
  "reclamo",
  "sugerencia",
  "denuncia",
  "consulta",
];

/**
 * Plazos de referencia en días hábiles. Petición general: 15 y consulta: 30 (Ley 1755 de 2015, art. 14);
 * reclamación directa del consumidor: 15 (Ley 1480 de 2011, art. 58). Es una referencia operativa:
 * debe validarse con asesoría jurídica según el tipo de solicitud y de solicitante.
 */
export const LEGAL_TERM_BUSINESS_DAYS: Record<TicketType, number> = {
  peticion: 15,
  queja: 15,
  reclamo: 15,
  sugerencia: 15,
  denuncia: 15,
  consulta: 30,
};

export function normalizeTicketType(raw: string | null | undefined): TicketType {
  const v = (raw ?? "").toLowerCase().trim();
  return (TICKET_TYPES as readonly string[]).includes(v) ? (v as TicketType) : "peticion";
}

export function legalDueAt(
  createdAt: number | Date | string,
  type: string | null | undefined,
): Date {
  return addBusinessDays(createdAt, LEGAL_TERM_BUSINESS_DAYS[normalizeTicketType(type)]);
}

/** Prórroga excepcional: hasta el doble del plazo inicial, avisando antes del vencimiento. */
export function extendedDueAt(
  createdAt: number | Date | string,
  type: string | null | undefined,
): Date {
  return addBusinessDays(createdAt, LEGAL_TERM_BUSINESS_DAYS[normalizeTicketType(type)] * 2);
}

export type Priority = "low" | "normal" | "high" | "urgent";

export function normalizePriority(raw: string | null | undefined): Priority {
  switch ((raw ?? "").toLowerCase()) {
    case "urgent":
    case "critical":
      return "urgent";
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "normal";
  }
}

/** Objetivo interno de primera respuesta, en horas calendario. */
export const FIRST_RESPONSE_HOURS: Record<Priority, number> = {
  urgent: 4,
  high: 24,
  normal: 48,
  low: 120,
};

// ─── Seguridad ───────────────────────────────────────────────────────────────

export type SafetyLevel = "none" | "review" | "critical";
export type SafetyCategory =
  | "self_harm"
  | "medical_emergency"
  | "physical_harm"
  | "harassment"
  | "theft"
  | "fraud"
  | "off_platform_payment";

export interface SafetySignals {
  level: SafetyLevel;
  categories: SafetyCategory[];
  matches: string[];
}

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const SAFETY_RULES: Array<{ category: SafetyCategory; level: "critical" | "review"; re: RegExp }> =
  [
    {
      category: "self_harm",
      level: "critical",
      re: /(quitarme la vida|suicid|hacerme dano|no quiero vivir|acabar con mi vida)/g,
    },
    {
      category: "medical_emergency",
      level: "critical",
      re: /(no respira|dejo de respirar|convulsion|inconsciente|se desmayo|dolor de pecho|hemorragia|sangrado|atragant|paro cardiaco|infarto|sobredosis|intoxic)/g,
    },
    {
      category: "physical_harm",
      level: "critical",
      re: /(maltrat|golpeo|golpearon|lo golpe|la golpe|agredi|agresion|violencia|lesion|se cayo|caida|fractura|quemadura|abuso fisico)/g,
    },
    {
      category: "harassment",
      level: "critical",
      re: /(acoso|acosa|hostig|tocamientos|abuso sexual|propuesta sexual|insinuaciones sexuales)/g,
    },
    {
      category: "theft",
      level: "review",
      re: /(robo|robaron|hurto|falta dinero|falto dinero|desaparecio|se llevo)/g,
    },
    {
      category: "fraud",
      level: "review",
      re: /(suplant|estafa|falsific|documento falso|titulo falso|identidad falsa|no tiene registro|rethus falso)/g,
    },
    {
      category: "off_platform_payment",
      level: "review",
      re: /(pagar por fuera|pago por fuera|fuera de la plataforma|sin pasar por humanix|evitar la comision|me pidio (que )?(le )?(pague|transfiera|consigne))/g,
    },
  ];

/**
 * Red de seguridad determinista, independiente del modelo de IA: prioriza el recall.
 * Un falso positivo solo manda el caso a revisión humana; un falso negativo puede costar mucho más.
 */
export function detectSafetySignals(text: string): SafetySignals {
  const normalized = normalizeText(text);
  const categories: SafetyCategory[] = [];
  const matches: string[] = [];
  let level: SafetyLevel = "none";
  for (const rule of SAFETY_RULES) {
    const found = normalized.match(rule.re);
    if (!found) continue;
    categories.push(rule.category);
    for (const f of found.slice(0, 2))
      if (matches.length < 6 && !matches.includes(f)) matches.push(f);
    if (rule.level === "critical") level = "critical";
    else if (level === "none") level = "review";
  }
  return { level, categories, matches };
}

// ─── SLA y riesgo de incumplimiento ──────────────────────────────────────────

export interface SlaTicket {
  type: string | null;
  status: string;
  created_at: string;
  ai_priority: string | null;
  ai_sentiment?: string | null;
  first_response_at?: string | null;
  assigned_to?: string | null;
  safety_level?: string | null;
}

export type SlaState = "ok" | "at_risk" | "breached" | "closed";

export interface SlaResult {
  legalDueAt: Date;
  legalRemainingBusinessDays: number;
  legalState: SlaState;
  firstResponseDueAt: Date;
  firstResponseState: "ok" | "at_risk" | "breached" | "done" | "closed";
  /** 0-100. Heurística explicable, no un modelo estadístico. */
  riskScore: number;
  reasons: string[];
}

const isClosed = (status: string) => status === "resolved" || status === "closed";

export function evaluateSla(t: SlaTicket, now: number = Date.now()): SlaResult {
  const created = new Date(t.created_at).getTime();
  const type = normalizeTicketType(t.type);
  const termDays = LEGAL_TERM_BUSINESS_DAYS[type];
  const due = legalDueAt(created, type);
  const remaining = businessDaysBetween(now, due);
  const priority = normalizePriority(t.ai_priority);
  const firstDue = new Date(created + FIRST_RESPONSE_HOURS[priority] * 3600_000);
  const closed = isClosed(t.status);

  if (closed) {
    return {
      legalDueAt: due,
      legalRemainingBusinessDays: remaining,
      legalState: "closed",
      firstResponseDueAt: firstDue,
      firstResponseState: "closed",
      riskScore: 0,
      reasons: [],
    };
  }

  const elapsedFraction = Math.min(1, Math.max(0, (termDays - Math.max(0, remaining)) / termDays));
  const breached = now > due.getTime();
  const legalState: SlaState = breached
    ? "breached"
    : remaining <= 3 || elapsedFraction >= 0.7
      ? "at_risk"
      : "ok";

  const responded = Boolean(t.first_response_at) || t.status === "in_progress";
  let firstResponseState: SlaResult["firstResponseState"] = "done";
  let firstRatio = 0;
  if (!responded) {
    firstRatio = (now - created) / Math.max(1, firstDue.getTime() - created);
    firstResponseState = firstRatio >= 1 ? "breached" : firstRatio >= 0.75 ? "at_risk" : "ok";
  }

  const parts: Array<{ weight: number; text: string }> = [];
  let score = 0;

  const legalWeight = breached ? 50 : Math.round(elapsedFraction * 40);
  score += legalWeight;
  if (breached)
    parts.push({
      weight: legalWeight,
      text: `Plazo legal vencido hace ${Math.abs(remaining)} día(s) hábil(es)`,
    });
  else if (legalState === "at_risk")
    parts.push({ weight: legalWeight, text: `Plazo legal vence en ${remaining} día(s) hábil(es)` });

  if (!responded) {
    const w = Math.round(Math.min(1, firstRatio) * 25);
    score += w;
    if (firstResponseState === "breached")
      parts.push({
        weight: w,
        text: `Sin primera respuesta (objetivo ${FIRST_RESPONSE_HOURS[priority]} h, vencido)`,
      });
    else if (firstResponseState === "at_risk")
      parts.push({
        weight: w,
        text: `Primera respuesta por vencer (objetivo ${FIRST_RESPONSE_HOURS[priority]} h)`,
      });
  }

  const priorityWeight = { urgent: 12, high: 7, normal: 2, low: 0 }[priority];
  score += priorityWeight;
  if (priority === "urgent" || priority === "high")
    parts.push({
      weight: priorityWeight,
      text: `Prioridad ${priority === "urgent" ? "urgente" : "alta"}`,
    });

  const sentiment = (t.ai_sentiment ?? "").toLowerCase();
  const sentimentWeight = sentiment === "very_negative" ? 6 : sentiment === "negative" ? 3 : 0;
  score += sentimentWeight;
  if (sentimentWeight >= 6)
    parts.push({ weight: sentimentWeight, text: "Sentimiento muy negativo" });

  const safetyWeight = t.safety_level === "critical" ? 15 : t.safety_level === "review" ? 7 : 0;
  score += safetyWeight;
  if (safetyWeight)
    parts.push({
      weight: safetyWeight,
      text:
        t.safety_level === "critical"
          ? "Señal de seguridad crítica"
          : "Señal de seguridad por revisar",
    });

  if (!t.assigned_to && t.status === "open") {
    score += 4;
    parts.push({ weight: 4, text: "Sin responsable asignado" });
  }

  return {
    legalDueAt: due,
    legalRemainingBusinessDays: remaining,
    legalState,
    firstResponseDueAt: firstDue,
    firstResponseState,
    riskScore: Math.min(100, Math.max(0, score)),
    reasons: parts.sort((a, b) => b.weight - a.weight).map((p) => p.text),
  };
}

// ─── Duplicados y relacionados ───────────────────────────────────────────────

const STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "en",
  "que",
  "por",
  "para",
  "con",
  "se",
  "mi",
  "me",
  "su",
  "es",
  "lo",
  "al",
  "del",
  "no",
  "si",
  "pero",
  "muy",
  "mas",
  "como",
  "le",
  "les",
  "ha",
  "han",
  "fue",
  "ser",
  "hay",
]);

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function textSimilarity(a: string, b: string): number {
  return jaccard(new Set(tokenize(a.slice(0, 600))), new Set(tokenize(b.slice(0, 600))));
}

export interface RelatableTicket {
  id: string;
  subject: string;
  description: string;
  contact_email: string | null;
  contact_phone?: string | null;
  user_id?: string | null;
  created_at: string;
}

export interface RelatedTicket {
  id: string;
  score: number;
  reason: "same_contact" | "similar_text" | "same_contact_similar_text";
  /** Solo sugerencia: la fusión siempre la decide una persona. */
  probableDuplicate: boolean;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export function findRelatedTickets(
  target: RelatableTicket,
  others: RelatableTicket[],
  opts: { windowDays?: number; minScore?: number; limit?: number } = {},
): RelatedTicket[] {
  const windowMs = (opts.windowDays ?? 14) * DAY_MS;
  const minScore = opts.minScore ?? 0.45;
  const targetTime = new Date(target.created_at).getTime();
  const targetText = `${target.subject} ${target.description}`;
  const out: RelatedTicket[] = [];

  for (const o of others) {
    if (o.id === target.id) continue;
    if (Math.abs(new Date(o.created_at).getTime() - targetTime) > windowMs) continue;
    const sameContact =
      (!!target.contact_email &&
        !!o.contact_email &&
        target.contact_email.toLowerCase() === o.contact_email.toLowerCase()) ||
      (digits(target.contact_phone).length >= 7 &&
        digits(target.contact_phone) === digits(o.contact_phone)) ||
      (!!target.user_id && target.user_id === o.user_id);
    const sim = textSimilarity(targetText, `${o.subject} ${o.description}`);

    let score = 0;
    let reason: RelatedTicket["reason"] | null = null;
    if (sameContact && sim >= 0.35) {
      score = Math.min(1, sim + 0.25);
      reason = "same_contact_similar_text";
    } else if (sameContact) {
      score = 0.5;
      reason = "same_contact";
    } else if (sim >= 0.6) {
      score = sim;
      reason = "similar_text";
    }
    if (reason && score >= minScore)
      out.push({
        id: o.id,
        score: Number(score.toFixed(2)),
        reason,
        probableDuplicate: score >= 0.85,
      });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
}

// ─── Tendencias ──────────────────────────────────────────────────────────────

export interface TrendRow {
  key: string;
  current: number;
  previous: number;
  changePct: number | null;
  spike: boolean;
}

export function categoryTrends(
  tickets: Array<{ ai_category: string | null; type: string | null; created_at: string }>,
  now: number = Date.now(),
): TrendRow[] {
  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const t of tickets) {
    const ts = new Date(t.created_at).getTime();
    const age = now - ts;
    if (age < 0 || age > 14 * DAY_MS) continue;
    const key = t.ai_category || t.type || "otro";
    const bucket = age <= 7 * DAY_MS ? cur : prev;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  return [...keys]
    .map((key) => {
      const current = cur.get(key) ?? 0;
      const previous = prev.get(key) ?? 0;
      return {
        key,
        current,
        previous,
        changePct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
        spike: current >= 3 && (previous === 0 || current >= previous * 2),
      };
    })
    .sort((a, b) => Number(b.spike) - Number(a.spike) || b.current - a.current);
}

// ─── CSV seguro ──────────────────────────────────────────────────────────────

/** Escapa comillas y neutraliza fórmulas de hoja de cálculo (=, +, -, @) para evitar inyección CSV. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; header: string }>,
): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","));
  return [head, ...body].join("\n");
}

// ─── Radicado y validación del formulario público ────────────────────────────

export const RADICADO_RE = /^PQRS-\d{4}-\d{6}$/;
export const isValidRadicado = (s: string) => RADICADO_RE.test(s.trim().toUpperCase());

export interface IntakeInput {
  name: string;
  email: string;
  phone: string | null;
  type: TicketType;
  subject: string;
  description: string;
}

export type IntakeResult =
  | { ok: true; value: IntakeInput; honeypot: false }
  | { ok: true; honeypot: true }
  | { ok: false; errors: string[] };

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim().slice(0, max) : "";

export function validateIntake(raw: unknown): IntakeResult {
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["body"] };
  const r = raw as Record<string, unknown>;

  // Campo trampa: un humano no lo ve ni lo llena.
  if (typeof r.website === "string" && r.website.trim() !== "") return { ok: true, honeypot: true };

  const errors: string[] = [];
  const name = clean(r.name, 120);
  const email = clean(r.email, 254).toLowerCase();
  const phoneDigits = digits(typeof r.phone === "string" ? r.phone : "");
  const subject = clean(r.subject, 200);
  const description = clean(r.description, 5000);
  const type = (TICKET_TYPES as readonly string[]).includes(String(r.type))
    ? (String(r.type) as TicketType)
    : null;

  if (name.length < 2) errors.push("name");
  if (!EMAIL_RE.test(email)) errors.push("email");
  if (phoneDigits && (phoneDigits.length < 7 || phoneDigits.length > 15)) errors.push("phone");
  if (!type) errors.push("type");
  if (subject.length < 3) errors.push("subject");
  if (description.length < 10) errors.push("description");
  if (r.consent !== true) errors.push("consent");
  if (errors.length || !type) return { ok: false, errors };

  return {
    ok: true,
    honeypot: false,
    value: { name, email, phone: phoneDigits || null, type, subject, description },
  };
}
