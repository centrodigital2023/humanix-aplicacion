// Inteligencia de mercado — lógica pura (sin red ni base de datos).
//
// Convierte las respuestas de /validacion en lo que el equipo necesita para decidir: ¿ya son suficientes para
// creerle a los números?, ¿qué dolores se repiten?, ¿a quién contactar primero?, ¿dónde está la oportunidad? y un
// veredicto con criterios a la vista. Todo es determinista (sin IA ni azar): el mismo conjunto de respuestas da
// siempre la misma lectura, y cada número se puede reconstruir con la tabla del panel.
//
// Lo que NO hace: no promete ingresos ni «demuestra» nada con muestras chicas. Mientras haya pocas respuestas
// dice cuántas faltan y con qué margen de error se está mirando.

import { bogotaDateTime, toCsv, type CsvColumn } from "./careExport";
import {
  PROFILES,
  PROFILE_META,
  SIGNAL_TIER_LABEL,
  alternativesOf,
  avg,
  canonicalName,
  channelsOf,
  median,
  normalizeText,
  payOf,
  pct,
  round1,
  signalOf,
  tabulate,
  tierFor,
  wtpOf,
  type Profile,
  type ResponseRow,
  type Tabulation,
} from "./marketValidation";

const DAY_MS = 86_400_000;

// ─── Objetivos (todos a la vista y en un solo lugar) ─────────────────────────────────

export const TARGETS = {
  /** Respuestas por perfil para que su lectura deje de ser anecdótica. */
  perProfile: 30,
  /** Respuestas totales para un margen de error de ±10 puntos (95 % de confianza). */
  total: 100,
  /** Criterios del veredicto: se cumplen o no, sin matices ocultos. */
  verdict: { minResponses: 30, signal: 55, medianWtp: 40, payingPct: 25, verifiedPct: 50 },
  /** Un lead con puntaje igual o mayor se considera «listo para contactar». */
  leadReady: 60,
  /** Señal mínima para avisar al superadmin de un lead fuerte recién verificado. */
  hotLeadSignal: 70,
} as const;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ─── Estadística honesta ───────────────────────────────────────────────────────────

const Z95 = 1.96;

/** Intervalo de Wilson para una proporción (mejor que el normal con muestras pequeñas). Devuelve fracciones 0–1. */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number = Z95,
): { p: number; low: number; high: number } {
  if (!(n > 0)) return { p: 0, low: 0, high: 1 };
  const s = Math.min(Math.max(successes, 0), n);
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Margen de error (fracción) de una proporción con `n` respuestas; por defecto el peor caso (p = 0,5). */
export function marginOfError(n: number, p = 0.5, z: number = Z95): number {
  return n > 0 ? z * Math.sqrt((p * (1 - p)) / n) : 1;
}

/** Respuestas necesarias para un margen de error dado (peor caso). */
export function requiredSample(moe = 0.1, p = 0.5, z: number = Z95): number {
  return Math.ceil((z * z * p * (1 - p)) / (moe * moe));
}

// ─── Respuestas que cuentan para la lectura ────────────────────────────────────────────

/** Avisos de calidad que sacan a una respuesta de la lectura del mercado y de la lista de contacto. */
const BAD_FLAGS = ["gibberish", "repeated_text", "example_copy", "duplicate_text"];

/** Una respuesta con aviso grave (sin sentido, repetida, copiada) sigue guardada, pero no cuenta para decidir. */
export const isTrusted = (r: Pick<ResponseRow, "quality_flags">): boolean =>
  !(r.quality_flags ?? []).some((f) => BAD_FLAGS.includes(f));

export function trustedRows(rows: ResponseRow[]): ResponseRow[] {
  return rows.filter(isTrusted);
}

// ─── ¿Ya son suficientes para creerle a los números? ─────────────────────────────────

export type ReadinessStatus = "none" | "few" | "growing" | "ready";

export interface Readiness {
  profile?: Profile;
  label: string;
  n: number;
  target: number;
  missing: number;
  /** Margen de error en puntos porcentuales (peor caso), o null si no hay respuestas. */
  moePct: number | null;
  status: ReadinessStatus;
}

export const READINESS_LABEL: Record<ReadinessStatus, string> = {
  none: "Sin respuestas",
  few: "Muy pocas",
  growing: "En camino",
  ready: "Suficientes",
};

function readinessOf(n: number, target: number, label: string, profile?: Profile): Readiness {
  return {
    profile,
    label,
    n,
    target,
    missing: Math.max(0, target - n),
    moePct: n > 0 ? Math.round(marginOfError(n) * 100) : null,
    status: n === 0 ? "none" : n < 10 ? "few" : n < target ? "growing" : "ready",
  };
}

export function sampleReadiness(all: ResponseRow[]): { total: Readiness; byProfile: Readiness[] } {
  const rows = trustedRows(all);
  return {
    total: readinessOf(rows.length, TARGETS.total, "Total"),
    byProfile: PROFILES.map((p) =>
      readinessOf(
        rows.filter((r) => r.profile_type === p).length,
        TARGETS.perProfile,
        PROFILE_META[p].label,
        p,
      ),
    ),
  };
}

// ─── Embudo: respuesta → contacto verificado → código → canje ───────────────────────

export interface Funnel {
  responses: number;
  verified: number;
  withCode: number;
  redeemed: number;
  /** Porcentajes enteros; null si no hay con qué dividir. */
  verifiedRate: number | null;
  codeRate: number | null;
  redeemRate: number | null;
  /** Códigos vigentes que aún nadie canjeó. */
  unredeemed: number;
  /** De esos, los que vencen en los próximos 7 días. */
  expiringSoon: number;
}

const hasOwnCode = (r: ResponseRow): boolean =>
  Boolean(r.promo_code) && (r.benefit_status ?? "none") !== "none";
const isRedeemed = (r: ResponseRow): boolean => Boolean(r.premium_activated || r.redeemed_at);

export function funnel(rows: ResponseRow[], now: number = Date.now()): Funnel {
  const verified = rows.filter((r) => r.contact_verified_at);
  const withCode = rows.filter(hasOwnCode);
  const redeemedWithCode = withCode.filter(isRedeemed);
  const live = withCode.filter((r) => {
    if (isRedeemed(r) || (r.benefit_status ?? "") !== "available") return false;
    const end = r.benefit_expires_at ? new Date(r.benefit_expires_at).getTime() : Infinity;
    return Number.isNaN(end) ? true : end > now;
  });
  const expiringSoon = live.filter((r) => {
    const end = r.benefit_expires_at ? new Date(r.benefit_expires_at).getTime() : Infinity;
    return Number.isFinite(end) && end - now <= 7 * DAY_MS;
  });
  return {
    responses: rows.length,
    verified: verified.length,
    withCode: withCode.length,
    redeemed: redeemedWithCode.length,
    verifiedRate: rows.length ? pct(verified.length, rows.length) : null,
    codeRate: verified.length ? pct(withCode.length, verified.length) : null,
    redeemRate: withCode.length ? pct(redeemedWithCode.length, withCode.length) : null,
    unredeemed: live.length,
    expiringSoon: expiringSoon.length,
  };
}

// ─── Temas de dolor y requisitos (diccionario en español, sin tildes) ───────────────

export type ThemeId =
  | "trust"
  | "shifts"
  | "urgency"
  | "price"
  | "payments"
  | "quality"
  | "communication"
  | "legal"
  | "geography"
  | "discovery";

interface ThemeDef {
  id: ThemeId;
  label: string;
  /** Lo que significa para el negocio (se muestra bajo el tema). */
  meaning: string;
  patterns: RegExp[];
}

/** Los patrones se aplican sobre texto normalizado (minúsculas, sin tildes) y buscan raíces de palabra. */
export const THEMES: ThemeDef[] = [
  {
    id: "trust",
    label: "Confianza y verificación",
    meaning: "Quieren saber con quién tratan: antecedentes, identidad y respaldo.",
    patterns: [
      /\bantecedent/,
      /\bverific/,
      /\bconfi[ae]/,
      /\bcertific/,
      /\breferencias?\b/,
      /\brethus\b/,
      /\bavalad/,
      /\bestaf/,
      /\bfraud/,
      /\bfals[oa]s?\b/,
      /\bseguridad(?! social)/,
      /\binsegur/,
      /\bdesconfi/,
      /\bhoja de vida/,
      /\bidentidad\b/,
    ],
  },
  {
    id: "shifts",
    label: "Turnos y reemplazos",
    meaning: "Necesitan cubrir turnos o tener reemplazo cuando alguien falla.",
    patterns: [
      /\bturnos?\b/,
      /\breemplaz/,
      /\bcubrir\b/,
      /\bcubiert/,
      /\bausenc/,
      /\bausent/,
      /\bno llega/,
      /\bfalla(n|r|ron)?\b/,
      /\bdisponibilidad\b/,
      /\bultimo momento/,
      /\bnoches?\b/,
      /\bmadrugada/,
      /\bfines? de semana/,
      /\b24 ?\/ ?7\b/,
    ],
  },
  {
    id: "urgency",
    label: "Urgencia y rapidez",
    meaning: "El tiempo de respuesta decide: lo necesitan ya, no en días.",
    patterns: [
      /\burgen/,
      /\brapid/,
      /\binmediat/,
      /\bde inmediato/,
      /\bya mismo/,
      /\bsin demora/,
      /\bpronto\b/,
      /\bmenos de (una|un|\d+) horas?/,
      /\bagil/,
      /\bdemor/,
    ],
  },
  {
    id: "price",
    label: "Precio y costos",
    meaning: "El costo pesa en la decisión: comparan tarifas y presupuesto.",
    patterns: [
      /\bcaros?\b/,
      /\bcostos?\b/,
      /\bcostos[oa]/,
      /\bcobran\b/,
      /\btarifas?\b/,
      /\bprecios?\b/,
      /\bbarat/,
      /\beconomic/,
      /\bpresupuesto/,
      /\bmucha plata/,
      /\bhonorarios?\b/,
      /\bcomision/,
      /\bahorr/,
    ],
  },
  {
    id: "payments",
    label: "Pagos y cobros",
    meaning: "El profesional quiere cobrar a tiempo y sin riesgo.",
    patterns: [
      /\bpag(o|os|ar|an)\b.{0,30}\b(mismo dia|a tiempo|puntual|tarde|atrasad|demor|garanti)/,
      /\bme deben\b/,
      /\bno (me )?pagan/,
      /\bsin pago/,
      /\bcobrar\b/,
      /\bfactur/,
      /\bcuenta de cobro/,
      /\btransferencia/,
      /\bnequi\b/,
      /\bdaviplata/,
      /\bimpag/,
    ],
  },
  {
    id: "quality",
    label: "Calidad y experiencia",
    meaning: "Buscan buen trato y gente preparada, con opiniones que lo respalden.",
    patterns: [
      /\bcalidad/,
      /\bexperienc/,
      /\bcalificad/,
      /\bcalificacion/,
      /\bcapacitad/,
      /\bentrenad/,
      /\bformacion/,
      /\bpreparad/,
      /\bbuen trato/,
      /\btrato\b/,
      /\bamabl/,
      /\bcalidez/,
      /\bresenas?\b/,
      /\bopiniones\b/,
    ],
  },
  {
    id: "communication",
    label: "Seguimiento y tranquilidad",
    meaning: "Quieren enterarse de cómo va el servicio sin tener que preguntar.",
    patterns: [
      /\bavis(e|a|an|ar|o|os)\b/,
      /\breportes?\b/,
      /\bseguimiento/,
      /\bnotific/,
      /\binforme/,
      /\bsaber como (va|esta)/,
      /\bcomunic/,
      /\btranquil/,
      /\bmonitor/,
      /\btiempo real/,
      /\bcamara/,
      /\bbitacora/,
    ],
  },
  {
    id: "legal",
    label: "Contratos y formalidad",
    meaning: "Piden contrato, seguridad social y respaldo legal.",
    patterns: [
      /\bcontrat/,
      /\bseguridad social/,
      /\bafiliaci/,
      /\barl\b/,
      /\bpila\b/,
      /\blegal/,
      /\bformal/,
      /\bfirma/,
      /\bfactura electronica/,
      /\bnomina/,
      /\bprestaciones/,
      /\bresponsabilidad/,
      /\bpoliza/,
      /\bcumplimiento/,
    ],
  },
  {
    id: "geography",
    label: "Cobertura y cercanía",
    meaning: "Importa que el servicio llegue a su barrio o ciudad.",
    patterns: [
      /\bbarrios?\b/,
      /\bzonas?\b/,
      /\bcerca\b/,
      /\bcercan/,
      /\bciudad(es)?\b/,
      /\bmunicipio/,
      /\bdistancia/,
      /\bdesplaz/,
      /\blejos\b/,
      /\brural/,
      /\bvereda/,
    ],
  },
  {
    id: "discovery",
    label: "Difícil encontrar y comparar",
    meaning: "Hoy buscar a alguien es desordenado: grupos, ofertas dudosas, sin información.",
    patterns: [
      /\bno (encuentro|consigo|hay|se donde|se en quien)/,
      /\bdificil (encontrar|conseguir)/,
      /\bdesorden/,
      /\bdisperso/,
      /\bgrupos? de (whatsapp|facebook)/,
      /\bofertas? falsas?/,
      /\bpublicidad/,
      /\bbuscar\b/,
      /\bbusqueda/,
    ],
  },
];

const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

/** Temas que aparecen en un texto (en el orden del diccionario, sin repetir). */
export function classifyThemes(text: string): ThemeId[] {
  const t = normalizeText(text ?? "");
  if (!t) return [];
  return THEMES.filter((th) => th.patterns.some((re) => re.test(t))).map((th) => th.id);
}

/** El texto sobre el que se detectan los temas: el dolor, el beneficio buscado y los requisitos (no el público). */
function themeSource(r: ResponseRow): string[] {
  return [r.pain_point, r.key_benefit, r.comments].filter((x): x is string => Boolean(x?.trim()));
}

export interface ThemeStat {
  id: ThemeId;
  label: string;
  meaning: string;
  count: number;
  /** % de las respuestas con texto de dolor. */
  pct: number;
  byProfile: Record<Profile, number>;
  quote: { text: string; profile: string } | null;
}

function pickQuote(rows: ResponseRow[], id: ThemeId): { text: string; profile: string } | null {
  const def = THEME_BY_ID.get(id);
  if (!def) return null;
  const ranked = [...rows].sort((a, b) => (signalOf(b) ?? -1) - (signalOf(a) ?? -1));
  for (const r of ranked) {
    for (const field of themeSource(r)) {
      for (const sentence of field.split(/[.!?…\n]+/)) {
        const s = sentence.replace(/\s+/g, " ").trim();
        if (s.length < 25 || s.length > 220) continue;
        if (def.patterns.some((re) => re.test(normalizeText(s)))) {
          return { text: s, profile: r.profile_type };
        }
      }
    }
  }
  return null;
}

export function themeStats(all: ResponseRow[]): ThemeStat[] {
  const withText = trustedRows(all).filter((r) => themeSource(r).length > 0);
  const byTheme = new Map<ThemeId, ResponseRow[]>();
  for (const r of withText) {
    for (const id of classifyThemes(themeSource(r).join(" . "))) {
      byTheme.set(id, [...(byTheme.get(id) ?? []), r]);
    }
  }
  return THEMES.filter((t) => byTheme.has(t.id))
    .map((t) => {
      const matched = byTheme.get(t.id) ?? [];
      const byProfile = Object.fromEntries(
        PROFILES.map((p) => [p, matched.filter((r) => r.profile_type === p).length]),
      ) as Record<Profile, number>;
      return {
        id: t.id,
        label: t.label,
        meaning: t.meaning,
        count: matched.length,
        pct: pct(matched.length, withText.length),
        byProfile,
        quote: pickQuote(matched, t.id),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
}

// ─── ¿A quién contactar primero? ─────────────────────────────────────────────────────

export type LeadStage = "redeemed" | "code" | "verified";

export interface Lead {
  id: string;
  name: string;
  profile: string;
  contact: string;
  contactKind: "whatsapp" | "email" | null;
  city: string | null;
  score: number;
  signal: number | null;
  wtp: number | null;
  stage: LeadStage;
  reasons: string[];
  createdAt: string;
}

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  redeemed: "Ya canjeó su mes",
  code: "Con código sin canjear",
  verified: "Contacto verificado",
};

const daysSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
};

function contactOf(r: ResponseRow): { value: string; kind: "whatsapp" | "email" | null } {
  if (r.whatsapp) return { value: r.whatsapp, kind: "whatsapp" };
  if (r.email) return { value: r.email, kind: "email" };
  return { value: "", kind: null };
}

/**
 * Puntaje de contacto (0–100). Solo entran contactos VERIFICADOS y sin avisos graves de calidad.
 * Pesos: señal de demanda 55 · disposición a pagar 15 · ya paga hoy 10 · institución 10 (cuenta de mayor valor)
 * o profesional 4 · requisitos concretos 5 · reciente 5. Un aviso de poco esfuerzo resta 15.
 */
export function leadScore(
  r: ResponseRow,
  now: number = Date.now(),
): { score: number; reasons: string[]; stage: LeadStage } | null {
  if (!r.contact_verified_at) return null;
  const flags = r.quality_flags ?? [];
  if (flags.some((f) => BAD_FLAGS.includes(f))) return null;

  const reasons: string[] = [];
  const signal = signalOf(r);
  const wtp = wtpOf(r);
  let score = 0;

  if (signal !== null) {
    score += signal * 0.55;
    if (signal >= 45) reasons.push(`${SIGNAL_TIER_LABEL[tierFor(signal)]} (${signal})`);
  }
  if (wtp !== null) {
    score += wtp * 0.15;
    if (wtp >= 40) reasons.push(`Estima que ${wtp} % pagaría`);
  }
  const pays = payOf(r);
  if (pays === "yes") {
    score += 10;
    reasons.push("Ya paga por algo similar");
  } else if (pays === "not_researched") {
    score += 2;
  }
  if (r.profile_type === "ips_eps") {
    score += 10;
    reasons.push("Institución: cuenta de mayor valor");
  } else if (r.profile_type === "profesional") {
    score += 4;
  }
  const words = (r.comments ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words >= 6) {
    score += 5;
    reasons.push("Dejó requisitos concretos");
  }
  const age = daysSince(r.created_at, now);
  if (age !== null && age <= 3) {
    score += 5;
    reasons.push(age === 0 ? "Llegó hoy" : `Llegó hace ${age} ${plural(age, "día", "días")}`);
  } else if (age !== null && age <= 7) {
    score += 2;
  }
  if (flags.includes("low_effort")) score -= 15;

  const stage: LeadStage = isRedeemed(r) ? "redeemed" : hasOwnCode(r) ? "code" : "verified";
  if (stage === "redeemed") reasons.unshift("Ya probó el plan Esencial: conviértelo en pago");

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    reasons: reasons.slice(0, 5),
    stage,
  };
}

export function priorityLeads(rows: ResponseRow[], now: number = Date.now(), limit = 10): Lead[] {
  const leads: Lead[] = [];
  for (const r of rows) {
    const s = leadScore(r, now);
    if (!s) continue;
    const c = contactOf(r);
    leads.push({
      id: r.id,
      name: r.full_name?.trim() || "Sin nombre",
      profile: r.profile_type,
      contact: c.value,
      contactKind: c.kind,
      city: r.city?.trim() || null,
      score: s.score,
      signal: signalOf(r),
      wtp: wtpOf(r),
      stage: s.stage,
      reasons: s.reasons,
      createdAt: r.created_at,
    });
  }
  return leads
    .sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(0, limit));
}

const titleCase = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "");

/**
 * Primer mensaje sugerido para escribirle a un contacto (el equipo lo edita antes de enviarlo). Nunca habla de
 * pagos: el cobro ocurre solo en el checkout de la web.
 */
export function leadGreeting(l: Pick<Lead, "name" | "stage">): string {
  const first = l.name && l.name !== "Sin nombre" ? titleCase(l.name.trim().split(/\s+/)[0]) : "";
  const hello = first
    ? `Hola ${first}, soy del equipo de Humanix.`
    : "Hola, soy del equipo de Humanix.";
  return l.stage === "redeemed"
    ? `${hello} ¿Cómo te ha ido con tu mes del plan Esencial? Me encantaría saber qué te ha servido y qué te falta. ¿Tienes 5 minutos?`
    : `${hello} Gracias por contarnos qué necesitas. ¿Te puedo hacer 3 preguntas rápidas para ayudarte mejor?`;
}

const LEAD_COLUMNS: Array<CsvColumn<Lead>> = [
  { header: "Puntaje", value: (l) => l.score },
  { header: "Nombre", value: (l) => l.name },
  {
    header: "Perfil",
    value: (l) => PROFILE_META[l.profile as Profile]?.label ?? l.profile,
  },
  { header: "Contacto", value: (l) => l.contact },
  {
    header: "Medio",
    value: (l) =>
      l.contactKind === "whatsapp" ? "WhatsApp" : l.contactKind === "email" ? "Correo" : "",
  },
  { header: "Ciudad", value: (l) => l.city },
  { header: "Etapa", value: (l) => LEAD_STAGE_LABEL[l.stage] },
  { header: "Señal de demanda", value: (l) => l.signal },
  { header: "Disposición a pagar %", value: (l) => l.wtp },
  { header: "Por qué", value: (l) => l.reasons.join(" | ") },
  { header: "Fecha de la respuesta", value: (l) => bogotaDateTime(l.createdAt) },
];

/** Lista de contactos prioritarios para Excel (celdas neutralizadas contra fórmulas). */
export function leadsToCsv(leads: Lead[]): string {
  return toCsv(leads, LEAD_COLUMNS);
}

/** ¿Merece un aviso inmediato al superadmin? (contacto verificado, señal fuerte y sin avisos graves). */
export function isHotLead(
  r: Pick<ResponseRow, "signal_score" | "total_score" | "quality_flags">,
): boolean {
  const s = signalOf(r);
  const flags = r.quality_flags ?? [];
  return s !== null && s >= TARGETS.hotLeadSignal && !flags.some((f) => BAD_FLAGS.includes(f));
}

// ─── Dónde está la oportunidad: perfil × ciudad ────────────────────────────────────────

export interface Segment {
  key: string;
  profile: Profile;
  profileLabel: string;
  city: string;
  n: number;
  avgSignal: number;
  avgWtp: number;
  payingPct: number;
  verifiedPct: number;
  /** 60 % señal + 25 % disposición a pagar + 15 % ya pagan (0–100). */
  score: number;
}

export function segmentRanking(all: ResponseRow[], minN = 2, limit = 6): Segment[] {
  const groups = new Map<string, { profile: Profile; city: string; rows: ResponseRow[] }>();
  for (const r of trustedRows(all)) {
    if (!(PROFILES as readonly string[]).includes(r.profile_type)) continue;
    const profile = r.profile_type as Profile;
    const city = r.city?.trim() || "Sin ciudad";
    // La ciudad es texto libre: se agrupa con un objeto en vez de partir una clave por un separador.
    const key = `${profile}\u0000${city}`;
    const g = groups.get(key) ?? { profile, city, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const out: Segment[] = [];
  for (const { profile, city, rows: g } of groups.values()) {
    if (g.length < minN) continue;
    const signals = g.map(signalOf).filter((x): x is number => x !== null);
    const wtps = g.map(wtpOf).filter((x): x is number => x !== null);
    const answered = g.filter((r) => payOf(r) !== "unknown");
    const paying = answered.filter((r) => payOf(r) === "yes").length;
    const avgSignal = round1(avg(signals));
    const avgWtp = Math.round(avg(wtps));
    const payingPct = pct(paying, answered.length);
    out.push({
      key: `${profile}|${city}`,
      profile,
      profileLabel: PROFILE_META[profile].label,
      city,
      n: g.length,
      avgSignal,
      avgWtp,
      payingPct,
      verifiedPct: pct(g.filter((r) => r.contact_verified_at).length, g.length),
      score: Math.round(avgSignal * 0.6 + avgWtp * 0.25 + payingPct * 0.15),
    });
  }
  return out.sort((a, b) => b.score - a.score || b.n - a.n).slice(0, Math.max(0, limit));
}

// ─── Veredicto con criterios a la vista ──────────────────────────────────────────────

export type Verdict = "insufficient" | "weak" | "promising" | "validated";

export interface Criterion {
  key: "signal" | "wtp" | "paying" | "verified";
  label: string;
  /** null = todavía no hay datos para evaluarlo. */
  ok: boolean | null;
  value: string;
  target: string;
}

export interface VerdictReport {
  verdict: Verdict;
  label: string;
  summary: string;
  criteria: Criterion[];
  passed: number;
  evaluated: number;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  insufficient: "Datos insuficientes",
  weak: "Señal débil",
  promising: "Prometedor",
  validated: "Mercado validado",
};

export function marketVerdict(all: ResponseRow[]): VerdictReport {
  const T = TARGETS.verdict;
  const rows = trustedRows(all);
  const tab = tabulate(rows);
  const n = rows.length;
  const wtps = rows.map(wtpOf).filter((x): x is number => x !== null);
  const answered = tab.pays.yes + tab.pays.no + tab.pays.not_researched;

  const criteria: Criterion[] = [
    {
      key: "signal",
      label: "Señal de demanda media",
      ok: n === 0 ? null : tab.avgSignal >= T.signal,
      value: n === 0 ? "—" : `${tab.avgSignal} / 100`,
      target: `≥ ${T.signal}`,
    },
    {
      key: "wtp",
      label: "Disposición a pagar (mediana)",
      ok: wtps.length === 0 ? null : median(wtps) >= T.medianWtp,
      value: wtps.length === 0 ? "—" : `${Math.round(median(wtps))} %`,
      target: `≥ ${T.medianWtp} %`,
    },
    {
      key: "paying",
      label: "Ya pagan por algo similar",
      ok: answered === 0 ? null : tab.payingPct >= T.payingPct,
      value: answered === 0 ? "—" : `${tab.payingPct} %`,
      target: `≥ ${T.payingPct} %`,
    },
    {
      key: "verified",
      label: "Contactos verificados",
      ok: n === 0 ? null : tab.verifiedPct >= T.verifiedPct,
      value: n === 0 ? "—" : `${tab.verifiedPct} %`,
      target: `≥ ${T.verifiedPct} %`,
    },
  ];
  const evaluated = criteria.filter((c) => c.ok !== null).length;
  const passed = criteria.filter((c) => c.ok === true).length;

  let verdict: Verdict;
  if (n < T.minResponses || evaluated < 3) verdict = "insufficient";
  else if (passed === evaluated) verdict = "validated";
  else if (passed >= evaluated - 1) verdict = "promising";
  else verdict = "weak";

  const summary =
    verdict === "insufficient"
      ? n === 0
        ? `Aún no hay respuestas. Con ${T.minResponses} ya se puede hacer una primera lectura.`
        : `Faltan ${Math.max(0, T.minResponses - n)} ${plural(Math.max(0, T.minResponses - n), "respuesta", "respuestas")} para una primera lectura confiable (llevas ${n} de ${T.minResponses}).`
      : verdict === "validated"
        ? `Cumple los ${evaluated} criterios con ${n} respuestas. Es una señal favorable, no una garantía: confírmala con ventas reales.`
        : verdict === "promising"
          ? `Cumple ${passed} de ${evaluated} criterios. Revisa el que no llega a la meta antes de invertir más.`
          : `Cumple solo ${passed} de ${evaluated} criterios. Conviene entender qué no está funcionando antes de seguir.`;

  return { verdict, label: VERDICT_LABEL[verdict], summary, criteria, passed, evaluated };
}

// ─── Hallazgos en lenguaje claro ─────────────────────────────────────────────────────

export type Severity = "risk" | "warn" | "good" | "info";

export interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { risk: 0, warn: 1, good: 2, info: 3 };

const INFORMAL = /whatsapp|facebook|recomendaciones|redes sociales|conocid/i;

/** Respuestas de los últimos 7 días y de los 7 anteriores (por instante, relativo a `now`). */
function weeklyCounts(rows: ResponseRow[], now: number): { last7: number; prev7: number } {
  let last7 = 0;
  let prev7 = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age < 0) continue;
    if (age <= 7 * DAY_MS) last7++;
    else if (age <= 14 * DAY_MS) prev7++;
  }
  return { last7, prev7 };
}

export function buildInsights(all: ResponseRow[], now: number = Date.now()): Insight[] {
  // La lectura del mercado usa solo respuestas confiables; el embudo, la tendencia y la calidad miran todo lo recibido.
  const rows = trustedRows(all);
  const tab = tabulate(rows, now);
  const n = rows.length;
  const excluded = all.length - rows.length;
  const out: Insight[] = [];
  const add = (i: Insight) => out.push(i);

  if (all.length === 0) {
    return [
      {
        id: "empty",
        severity: "info",
        title: "Aún no hay respuestas",
        detail: "Cuando llegue el primer formulario, esta pestaña empieza a leer los datos sola.",
        action: "Comparte el enlace /validacion con familias, IPS/EPS y profesionales.",
      },
    ];
  }

  if (excluded > 0) {
    add({
      id: "excluded",
      severity: "warn",
      title: `${excluded} ${plural(excluded, "respuesta con aviso grave no cuenta", "respuestas con avisos graves no cuentan")} en esta lectura`,
      detail:
        "Son textos sin sentido, repetidos o copiados de otra persona: siguen guardados, pero no inflan el veredicto ni la lista de contacto.",
      action: "Revísalas en «Respuestas» (llevan un triángulo de aviso) antes de decidir.",
    });
  }
  if (n === 0) return out;

  // 1) ¿Son suficientes?
  const moe = Math.round(marginOfError(n) * 100);
  if (n < TARGETS.verdict.minResponses) {
    add({
      id: "sample",
      severity: "warn",
      title: `Muestra pequeña: ${n} ${plural(n, "respuesta", "respuestas")}`,
      detail: `Con ${n} el margen de error es de ±${moe} puntos. Sirven de orientación, no para decidir.`,
      action: `Faltan ${TARGETS.verdict.minResponses - n} para la primera lectura y ${requiredSample(0.1)} para un margen de ±10 puntos.`,
    });
  } else {
    add({
      id: "sample",
      severity: n >= TARGETS.total ? "good" : "info",
      title: `Muestra de ${n} respuestas (margen ±${moe} puntos)`,
      detail:
        n >= TARGETS.total
          ? "Ya hay base para creerle a los porcentajes generales."
          : `Para bajar el margen a ±10 puntos hacen falta ${requiredSample(0.1)} respuestas.`,
    });
  }

  // 2) Perfiles sin voz
  const empty = tab.byProfile.filter((p) => p.count === 0);
  if (n >= 5 && empty.length) {
    add({
      id: "profile-gap",
      severity: "warn",
      title: `Falta la voz de ${empty.map((p) => p.label).join(" y de ")}`,
      detail: "Sin sus respuestas la lectura del mercado queda incompleta.",
      action: "Comparte el formulario directamente con ese perfil.",
    });
  }

  // 3) Perfil más y menos fuerte
  const eligible = tab.byProfile.filter((p) => p.count >= 3);
  if (eligible.length) {
    const sorted = [...eligible].sort((a, b) => b.avgSignal - a.avgSignal);
    const top = sorted[0];
    add({
      id: "strongest-profile",
      severity: top.avgSignal >= 70 ? "good" : "info",
      title: `${top.label} muestra la señal más fuerte`,
      detail: `Señal media de ${top.avgSignal} sobre 100 con ${top.count} ${plural(top.count, "respuesta", "respuestas")}${top.count < 10 ? " (pocas: tómalo con cautela)" : ""}.`,
      action: "Dale prioridad en el producto y en la adquisición.",
    });
    const bottom = sorted[sorted.length - 1];
    if (sorted.length >= 2 && top.avgSignal - bottom.avgSignal >= 15) {
      add({
        id: "weakest-profile",
        severity: "info",
        title: `${bottom.label} tiene la señal más baja (${bottom.avgSignal})`,
        detail: `Hay ${round1(top.avgSignal - bottom.avgSignal)} puntos de diferencia con ${top.label}.`,
        action: "Revisa si el problema planteado les importa o si el mensaje no los alcanza.",
      });
    }
  }

  // 4) Disposición a pagar
  const wtps = rows.map(wtpOf).filter((x): x is number => x !== null);
  if (wtps.length >= 3) {
    const m = Math.round(median(wtps));
    const withWtp = tab.byProfile.filter((p) => p.count >= 3 && Number.isFinite(p.medianWtp));
    let gapText = "";
    let hasGap = false;
    if (withWtp.length >= 2) {
      const hi = [...withWtp].sort((a, b) => b.medianWtp - a.medianWtp)[0];
      const lo = [...withWtp].sort((a, b) => a.medianWtp - b.medianWtp)[0];
      if (hi.medianWtp - lo.medianWtp >= 25) {
        hasGap = true;
        gapText = ` Hay una brecha de ${hi.medianWtp - lo.medianWtp} puntos entre ${hi.label} (${hi.medianWtp} %) y ${lo.label} (${lo.medianWtp} %).`;
      }
    }
    add({
      id: "wtp",
      severity: m >= TARGETS.verdict.medianWtp ? "good" : m < 25 ? "warn" : "info",
      title: `Disposición a pagar: mediana de ${m} %`,
      detail: `La mitad de las respuestas estima que al menos ${m} % de las personas de su entorno pagaría.${gapText}`,
      action: hasGap
        ? "Segmenta la oferta y el precio por perfil."
        : m < 25
          ? "Prueba otros precios o beneficios antes de invertir más."
          : undefined,
    });
  }

  // 5) ¿Ya hay presupuesto?
  const answered = tab.pays.yes + tab.pays.no + tab.pays.not_researched;
  if (answered >= 5) {
    if (tab.payingPct >= 40) {
      add({
        id: "budget",
        severity: "good",
        title: `Ya existe presupuesto: ${tab.payingPct} % paga hoy por algo similar`,
        detail: "Quien ya gasta en esto entiende el valor y compara.",
        action: "Posiciona Humanix como una mejora de lo que ya pagan.",
      });
    } else if (tab.payingPct <= 10) {
      add({
        id: "budget",
        severity: "warn",
        title: `Casi nadie paga hoy por algo similar (${tab.payingPct} %)`,
        detail:
          "Es un mercado por educar: la gente tiene el problema pero no suele pagar por resolverlo.",
        action: "El mes gratis y la demostración de valor serán clave para convertir.",
      });
    } else {
      add({
        id: "budget",
        severity: "info",
        title: `${tab.payingPct} % ya paga por algo similar`,
        detail: "Hay un grupo con presupuesto y otro por convencer.",
      });
    }
  }

  // 6) Competencia
  const topAlt = tab.topAlternatives[0];
  if (topAlt && topAlt.count >= Math.max(2, Math.ceil(n * 0.2))) {
    const informal = INFORMAL.test(topAlt.name);
    add({
      id: "competition",
      severity: "info",
      title: `La alternativa más mencionada es «${topAlt.name}»`,
      detail: `${topAlt.count} de ${n} respuestas (${topAlt.pct} %).${informal ? " Es un canal informal: no verifica a nadie ni garantiza pagos." : ""}`,
      action: informal
        ? "La oportunidad está donde lo informal falla: verificación, pago seguro y rapidez."
        : "Estudia su oferta y su precio para diferenciarte.",
    });
  }

  // 7) Canales para llegar a cada perfil
  const topChannel = tab.topChannels[0];
  if (topChannel && topChannel.count >= 2) {
    const per = tab.byProfile
      .filter((p) => p.count >= 3)
      .map((p) => {
        const counts = new Map<string, number>();
        rows
          .filter((r) => r.profile_type === p.profile)
          .forEach((r) => channelsOf(r).forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        return best ? `${p.label}: ${best[0]}` : null;
      })
      .filter((x): x is string => x !== null);
    add({
      id: "channels",
      severity: "info",
      title: `Dónde buscan hoy: ${topChannel.name} (${topChannel.pct} %)`,
      detail: per.length
        ? `Por perfil — ${per.join(" · ")}.`
        : "Es donde ya están: ahí hay que estar.",
      action: "Prioriza esos canales para llegar a cada perfil.",
    });
  }

  // 8) Dolores que más se repiten
  const themes = themeStats(all);
  if (themes.length && themes[0].count >= 2) {
    const top3 = themes.slice(0, 3);
    add({
      id: "themes",
      severity: "info",
      title: `Lo que más duele: ${top3[0].label}`,
      detail: `En orden — ${top3.map((t) => `${t.label} (${t.pct} %)`).join(" · ")}.`,
      action: "Conviértelos en mensajes de venta y en prioridades del producto.",
    });
  }

  // 9) Embudo
  const f = funnel(all, now);
  if (all.length >= 10 && f.verifiedRate !== null && f.verifiedRate < 50) {
    add({
      id: "funnel-verify",
      severity: f.verifiedRate < 25 ? "risk" : "warn",
      title: `Solo ${f.verifiedRate} % verifica su contacto`,
      detail: "Sin verificar no hay beneficio ni dato confiable.",
      action:
        "Revisa que el código llegue (plantilla de WhatsApp aprobada, correo configurado) y simplifica ese paso.",
    });
  }
  if (f.withCode >= 5 && f.redeemRate !== null && f.redeemRate < 30) {
    add({
      id: "funnel-redeem",
      severity: "warn",
      title: `Solo ${f.redeemRate} % canjeó su mes del plan Esencial`,
      detail: `${f.unredeemed} ${plural(f.unredeemed, "código sigue vigente", "códigos siguen vigentes")} sin canjear.`,
      action: "Recuérdales entrar a /planes con su código.",
    });
  }
  if (f.expiringSoon > 0) {
    add({
      id: "funnel-expiring",
      severity: "warn",
      title: `${f.expiringSoon} ${plural(f.expiringSoon, "código vence", "códigos vencen")} en 7 días`,
      detail: "Después de esa fecha ya no se podrán canjear.",
      action: "Avísales ahora para que no pierdan su mes.",
    });
  }

  // 10) Calidad de los datos
  const flagged = all.filter((r) => (r.quality_flags ?? []).length > 0).length;
  if (all.length >= 10 && pct(flagged, all.length) >= 20) {
    add({
      id: "quality",
      severity: "warn",
      title: `${pct(flagged, all.length)} % de las respuestas tiene avisos de calidad`,
      detail: `${flagged} de ${all.length} respuestas son muy cortas, repetidas o parecen copiadas.`,
      action: "Revisa esas filas y, si es mucho, endurece el formulario.",
    });
  }

  // 11) Tendencia semanal
  const { last7, prev7 } = weeklyCounts(all, now);
  if (prev7 >= 3) {
    const change = Math.round(((last7 - prev7) / prev7) * 100);
    if (change >= 20) {
      add({
        id: "trend",
        severity: "good",
        title: `Las respuestas subieron ${change} % frente a la semana anterior`,
        detail: `${last7} esta semana contra ${prev7} la anterior.`,
      });
    } else if (change <= -30) {
      add({
        id: "trend",
        severity: "warn",
        title: `Las respuestas bajaron ${Math.abs(change)} % frente a la semana anterior`,
        detail: `${last7} esta semana contra ${prev7} la anterior.`,
        action: "Vuelve a compartir el formulario o prueba otro canal.",
      });
    }
  } else if (last7 >= 3) {
    add({
      id: "trend",
      severity: "info",
      title: `Llegaron ${last7} respuestas en los últimos 7 días`,
      detail: "Todavía no hay una semana anterior con la que compararlas.",
    });
  }

  // 12) Contactos listos
  const ready = priorityLeads(all, now, 1000).filter((l) => l.score >= TARGETS.leadReady);
  if (ready.length) {
    add({
      id: "leads",
      severity: "good",
      title: `${ready.length} ${plural(ready.length, "contacto listo", "contactos listos")} para hablar`,
      detail: "Verificados, con señal alta y sin avisos de calidad.",
      action: "Empieza por la lista «Contactar primero» y pídeles una llamada corta.",
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}

// ─── Resumen para compartir ──────────────────────────────────────────────────────────

const bogotaDate = (now: number): string =>
  new Date(now).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota",
  });

/** Texto plano listo para pegar en un correo o un chat con el equipo o los inversionistas. */
export function executiveSummary(all: ResponseRow[], now: number = Date.now()): string {
  const rows = trustedRows(all);
  const tab = tabulate(rows, now);
  const n = rows.length;
  const excluded = all.length - n;
  const lines: string[] = [`Validación de mercado de Humanix — corte al ${bogotaDate(now)}`];
  if (all.length === 0) {
    lines.push("Aún no hay respuestas del formulario.");
    return lines.join("\n");
  }
  if (n === 0) {
    lines.push(
      `Hay ${all.length} ${plural(all.length, "respuesta", "respuestas")}, todas con avisos graves de calidad: ninguna cuenta para la lectura.`,
    );
    return lines.join("\n");
  }
  const v = marketVerdict(all);
  const f = funnel(all, now);
  const themes = themeStats(all).slice(0, 3);
  const leads = priorityLeads(all, now, 1000).filter((l) => l.score >= TARGETS.leadReady);

  lines.push(
    `• Respuestas: ${n} (${tab.verifiedPct} % con contacto verificado) · señal media ${tab.avgSignal} de 100`,
    `• Lectura: ${v.label} — ${v.summary}`,
  );
  if (excluded > 0) {
    lines.push(
      `• No cuentan en esta lectura: ${excluded} ${plural(excluded, "respuesta con aviso grave", "respuestas con avisos graves")} de calidad (sin sentido, repetidas o copiadas)`,
    );
  }
  const profiles = tab.byProfile
    .filter((p) => p.count > 0)
    .map((p) => `${p.label} ${p.count} (señal ${p.avgSignal}, mediana ${p.medianWtp} %)`);
  if (profiles.length) lines.push(`• Por perfil: ${profiles.join(" · ")}`);
  lines.push(
    `• Disposición a pagar: mediana ${tab.medianWtp} % · promedio ${tab.avgWtp} %`,
    `• Ya pagan por algo similar: ${tab.payingPct} %`,
  );
  if (tab.topAlternatives.length) {
    lines.push(
      `• Alternativas que usan hoy: ${tab.topAlternatives
        .slice(0, 3)
        .map((a) => `${a.name} (${a.pct} %)`)
        .join(", ")}`,
    );
  }
  if (themes.length) {
    lines.push(`• Dolores principales: ${themes.map((t) => `${t.label} (${t.pct} %)`).join(", ")}`);
  }
  lines.push(
    `• Embudo: ${f.responses} respuestas → ${f.verified} verificadas → ${f.withCode} con código → ${f.redeemed} canjeadas`,
  );
  if (leads.length) {
    lines.push(`• Contactos prioritarios: ${leads.length} listos para hablar`);
  }
  lines.push(
    `Lectura automática y orientativa: con menos de ${TARGETS.perProfile} respuestas por perfil las cifras pueden cambiar.`,
  );
  return lines.join("\n");
}

// Reexporta para que la interfaz importe de un solo lugar.
export { alternativesOf, canonicalName };
