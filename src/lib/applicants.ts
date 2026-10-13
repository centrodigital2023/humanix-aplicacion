// Postulantes de la familia en tarjetas: una sola forma para las dos vías por las que un profesional responde a una familia —las
// necesidades por horas (`slot_proposals`, RPC `family_applicants`) y las ofertas de trabajo (`applications`, RPC
// `family_offer_applicants`)—, qué puede hacer la familia con cada tarjeta según su plan y cómo se explican los errores.
//
// La base decide todo lo que importa (nombre completo o abreviado, quién puede negociar, el cupo diario de contactos, el teléfono).
// Aquí solo se normalizan sus filas, se ordenan y se traducen a acciones y textos.

import { MODALITY_LABEL, isOfferModality, type OfferModality } from "./institutionNegotiation";
import { MAX_ROUNDS, timeLeftLabel } from "./negotiation";
import { classifyHubError, whatsAppLink, type ServerError } from "./opportunities";
import { formatCOP } from "./pricing";
import { distanceBandRank, trustFromColumns, type TrustSummary } from "./trustScore";

export type ApplicantSource = "slots" | "offer";
/** A quién le toca: la familia, el profesional o ya está resuelta (aceptada). */
export type ApplicantTurn = "family" | "professional" | "done";

export interface SlotApplicantRow {
  proposal_id: string;
  professional_id: string;
  family_need_id: string | null;
  display_name: string;
  name_is_short: boolean;
  avatar_url: string | null;
  specialty: string | null;
  years_experience: number | null;
  city: string | null;
  distance_band_km: number | null;
  ratings_count: number | null;
  stars_avg: number | string | null;
  total_jobs: number | null;
  trust_score: number | null;
  trust_level: string | null;
  rethus_verified: boolean | null;
  hourly_rate: number;
  posted_rate: number | null;
  round_no: number;
  proposed_by: string;
  status: string;
  awaiting: string;
  message: string | null;
  starts_at: string;
  ends_at: string;
  hours: number | string;
  estimated_total: number | null;
  expires_at: string | null;
  created_at: string;
  booking_id: string | null;
  can_negotiate: boolean;
  can_reveal: boolean;
  has_phone: boolean;
  contact_unlocked: boolean;
  reveals_left: number;
  plan_key: string;
}

export interface OfferApplicantRow {
  application_id: string;
  job_offer_id: string;
  offer_title: string;
  modality: string;
  offer_start: string | null;
  offer_end: string | null;
  has_shifts: boolean;
  professional_id: string;
  display_name: string;
  name_is_short: boolean;
  avatar_url: string | null;
  specialty: string | null;
  years_experience: number | null;
  city: string | null;
  distance_band_km: number | null;
  ratings_count: number | null;
  stars_avg: number | string | null;
  total_jobs: number | null;
  trust_score: number | null;
  trust_level: string | null;
  rethus_verified: boolean | null;
  posted_amount: number | null;
  proposed_amount: number | null;
  round_no: number;
  status: string;
  awaiting: string;
  message: string | null;
  expires_at: string | null;
  created_at: string;
  can_negotiate: boolean;
  can_reveal: boolean;
  has_phone: boolean;
  contact_unlocked: boolean;
  reveals_left: number;
  plan_key: string;
}

export interface ApplicantCard {
  key: string;
  source: ApplicantSource;
  /** Id de la propuesta (horas) o de la postulación (oferta de trabajo). */
  id: string;
  professionalId: string;
  /** Necesidad u oferta a la que responde. */
  targetId: string | null;
  title: string;
  displayName: string;
  nameIsShort: boolean;
  avatarUrl: string | null;
  specialty: string | null;
  yearsExperience: number | null;
  city: string | null;
  distanceBandKm: number | null;
  ratingsCount: number;
  starsAvg: number | null;
  totalJobs: number | null;
  trust: TrustSummary;
  rethusVerified: boolean;
  /** Lo que se propone ahora (por hora en las horas; según la modalidad en las ofertas). */
  amount: number;
  postedAmount: number | null;
  modality: OfferModality;
  /** Equivalente por hora para comparar tarjetas distintas (nulo si no se puede decir). */
  hourlyEquivalent: number | null;
  round: number;
  status: string;
  turn: ApplicantTurn;
  message: string | null;
  startsAt: string | null;
  endsAt: string | null;
  hours: number | null;
  estimatedTotal: number | null;
  expiresAt: string | null;
  createdAt: string;
  bookingId: string | null;
  canNegotiate: boolean;
  canReveal: boolean;
  hasPhone: boolean;
  contactUnlocked: boolean;
  revealsLeft: number;
  plan: string;
  /** Solo ofertas: si tiene turnos abiertos (si no, al aceptar hay que definir el horario). */
  hasShifts: boolean;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const turnOf = (v: string): ApplicantTurn =>
  v === "professional" ? "professional" : v === "done" ? "done" : "family";

/** Horas que se suponen para pasar un valor por turno o por mes a «por hora» (solo para comparar). */
export const ASSUMED_HOURS = { shift: 8, month: 192 } as const;

export function hourlyEquivalent(
  amount: number | null | undefined,
  modality: OfferModality,
): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  switch (modality) {
    case "hour":
      return amount;
    case "shift":
      return Math.round(amount / ASSUMED_HOURS.shift);
    case "month":
      return Math.round(amount / ASSUMED_HOURS.month);
    default:
      return null;
  }
}

export function fromSlotRow(r: SlotApplicantRow): ApplicantCard {
  return {
    key: `slots:${r.proposal_id}`,
    source: "slots",
    id: r.proposal_id,
    professionalId: r.professional_id,
    targetId: r.family_need_id,
    title: "Cuidado por horas",
    displayName: r.display_name,
    nameIsShort: !!r.name_is_short,
    avatarUrl: r.avatar_url,
    specialty: r.specialty,
    yearsExperience: r.years_experience,
    city: r.city,
    distanceBandKm: r.distance_band_km,
    ratingsCount: Number(r.ratings_count ?? 0),
    starsAvg: num(r.stars_avg),
    totalJobs: r.total_jobs,
    trust: trustFromColumns(r.trust_score, r.trust_level, true, r.rethus_verified),
    rethusVerified: !!r.rethus_verified,
    amount: r.hourly_rate,
    postedAmount: r.posted_rate,
    modality: "hour",
    hourlyEquivalent: r.hourly_rate,
    round: r.round_no,
    status: r.status,
    turn: turnOf(r.awaiting),
    message: r.message,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    hours: num(r.hours),
    estimatedTotal: r.estimated_total,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    bookingId: r.booking_id,
    canNegotiate: !!r.can_negotiate,
    canReveal: !!r.can_reveal,
    hasPhone: !!r.has_phone,
    contactUnlocked: !!r.contact_unlocked,
    revealsLeft: Number(r.reveals_left ?? 0),
    plan: r.plan_key,
    hasShifts: true,
  };
}

export function fromOfferRow(r: OfferApplicantRow): ApplicantCard {
  const modality: OfferModality = isOfferModality(r.modality) ? r.modality : "hour";
  const amount = r.proposed_amount ?? r.posted_amount ?? 0;
  return {
    key: `offer:${r.application_id}`,
    source: "offer",
    id: r.application_id,
    professionalId: r.professional_id,
    targetId: r.job_offer_id,
    title: r.offer_title,
    displayName: r.display_name,
    nameIsShort: !!r.name_is_short,
    avatarUrl: r.avatar_url,
    specialty: r.specialty,
    yearsExperience: r.years_experience,
    city: r.city,
    distanceBandKm: r.distance_band_km,
    ratingsCount: Number(r.ratings_count ?? 0),
    starsAvg: num(r.stars_avg),
    totalJobs: r.total_jobs,
    trust: trustFromColumns(r.trust_score, r.trust_level, true, r.rethus_verified),
    rethusVerified: !!r.rethus_verified,
    amount,
    postedAmount: r.posted_amount,
    modality,
    hourlyEquivalent: hourlyEquivalent(amount, modality),
    round: r.round_no,
    status: r.status,
    turn: turnOf(r.awaiting),
    message: r.message,
    startsAt: r.offer_start,
    endsAt: r.offer_end,
    hours: null,
    estimatedTotal: null,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    bookingId: null,
    canNegotiate: !!r.can_negotiate,
    canReveal: !!r.can_reveal,
    hasPhone: !!r.has_phone,
    contactUnlocked: !!r.contact_unlocked,
    revealsLeft: Number(r.reveals_left ?? 0),
    plan: r.plan_key,
    hasShifts: !!r.has_shifts,
  };
}

// ─── Orden y grupos ──────────────────────────────────────────────────────────

export type ApplicantSort = "recent" | "price" | "rating" | "trust" | "near";

export const APPLICANT_SORT_LABEL: Record<ApplicantSort, string> = {
  recent: "Más recientes",
  price: "Menor valor",
  rating: "Mejor calificados",
  trust: "Más confianza",
  near: "Más cercanos",
};

/** Mayor primero; lo que no tiene dato va al final. */
const desc = (a: number | null, b: number | null) => (a == null ? 1 : b == null ? -1 : b - a);
const asc = (a: number | null, b: number | null) => (a == null ? 1 : b == null ? -1 : a - b);

export function sortApplicants(cards: ApplicantCard[], mode: ApplicantSort): ApplicantCard[] {
  const byRecent = (a: ApplicantCard, b: ApplicantCard) => b.createdAt.localeCompare(a.createdAt);
  const primary = (a: ApplicantCard, b: ApplicantCard): number => {
    switch (mode) {
      case "price":
        return asc(a.hourlyEquivalent, b.hourlyEquivalent);
      case "rating":
        return desc(a.starsAvg, b.starsAvg) || b.ratingsCount - a.ratingsCount;
      case "trust":
        return desc(a.trust.score, b.trust.score);
      case "near":
        return distanceBandRank(a.distanceBandKm) - distanceBandRank(b.distanceBandKm);
      default:
        return 0;
    }
  };
  return [...cards].sort((a, b) => primary(a, b) || byRecent(a, b));
}

export interface ApplicantGroups {
  /** Te toca responder. */
  action: ApplicantCard[];
  /** Esperando al profesional. */
  waiting: ApplicantCard[];
  /** Aceptadas. */
  done: ApplicantCard[];
}

export function partitionApplicants(cards: ApplicantCard[]): ApplicantGroups {
  const g: ApplicantGroups = { action: [], waiting: [], done: [] };
  for (const c of cards) {
    if (c.turn === "done") g.done.push(c);
    else if (c.turn === "professional") g.waiting.push(c);
    else g.action.push(c);
  }
  return g;
}

export function turnLabel(c: ApplicantCard): string {
  if (c.turn === "done") return "Aceptada";
  if (c.turn === "professional") return "Esperando su respuesta";
  return c.round > 1 ? "Te toca responder" : "Nueva postulación";
}

// ─── Qué puede hacer la familia con cada tarjeta ─────────────────────────────

export type NegotiationState = "available" | "locked_plan" | "final_round" | "waiting" | "closed";

export function negotiationState(c: ApplicantCard): { state: NegotiationState; reason: string } {
  if (c.turn === "done" || c.status !== "pending")
    return { state: "closed", reason: "Esta postulación ya está resuelta." };
  if (c.turn === "professional")
    return { state: "waiting", reason: `Esperando la respuesta de ${c.displayName}.` };
  if (c.round >= MAX_ROUNDS) {
    return {
      state: "final_round",
      reason: "Es la última oferta: solo puedes aceptarla o rechazarla.",
    };
  }
  if (c.canNegotiate) return { state: "available", reason: "Puedes proponer otro valor por hora." };
  if (c.plan === "free")
    return { state: "locked_plan", reason: "Negociar el valor está en el plan Esencial." };
  return { state: "closed", reason: "No se puede negociar ahora." };
}

export type ContactState = "plan" | "unlocked" | "no_phone" | "quota" | "ready";

export function contactState(c: ApplicantCard): ContactState {
  if (!c.canReveal) return "plan";
  if (c.contactUnlocked) return "unlocked";
  if (!c.hasPhone) return "no_phone";
  if (c.revealsLeft <= 0) return "quota";
  return "ready";
}

export const CONTACT_STATE_COPY: Record<ContactState, string> = {
  plan: "El WhatsApp del profesional se desbloquea desde el plan Esencial.",
  unlocked: "Contacto desbloqueado hoy.",
  no_phone:
    "Este profesional aún no registró un teléfono. Coordina desde la reserva cuando lo aceptes.",
  quota: "Hoy ya usaste todos tus desbloqueos. Mañana se renuevan.",
  ready: "Desbloquea su WhatsApp para coordinar los detalles.",
};

/** Mensaje inicial de WhatsApp de la familia: sin enlaces ni datos de pago, y recuerda que se paga solo en la web. */
export function familyToProMessage(args: {
  familyName: string | null | undefined;
  proName: string | null | undefined;
  title: string;
}): string {
  const fam = (args.familyName ?? "").trim().split(/\s+/)[0] || "una familia";
  const pro = (args.proName ?? "").trim().split(/\s+/)[0];
  return [
    `Hola${pro ? ` ${pro}` : ""}, soy ${fam} de Humanix.`,
    `Vi tu postulación a «${args.title.slice(0, 60)}».`,
    "¿Podemos coordinar los detalles del servicio?",
    "Recuerda que los pagos se gestionan únicamente en la página web de Humanix.",
  ].join(" ");
}

export function applicantWhatsAppLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  return whatsAppLink(phone, message);
}

// ─── Aceptar ofertas de trabajo sin horario ──────────────────────────────────

export interface ShiftInput {
  starts_at: string;
  ends_at: string;
}

const DAY_MS = 24 * 3_600_000;

/**
 * Aceptar una postulación a una oferta sin turnos abiertos exige un horario. Si la oferta ya trae inicio y fin vigentes y
 * caben en un turno (hasta 24 h), se propone ese; si no, hay que pedirlo a la familia.
 */
export function defaultAcceptShifts(c: ApplicantCard, now = Date.now()): ShiftInput[] | null {
  if (c.source !== "offer" || c.hasShifts) return [];
  if (!c.startsAt || !c.endsAt) return null;
  const start = Date.parse(c.startsAt);
  const end = Date.parse(c.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (end - start > DAY_MS || start < now - 3_600_000) return null;
  return [{ starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }];
}

export function acceptNeedsSchedule(c: ApplicantCard): boolean {
  return c.source === "offer" && !c.hasShifts && c.status === "pending";
}

// ─── Textos ──────────────────────────────────────────────────────────────────

export function amountLabel(c: ApplicantCard): string {
  return `${formatCOP(c.amount)} ${MODALITY_LABEL[c.modality]}`;
}

/** «$21.000 por hora · 4 h · ≈ $84.000» (el total solo cuando se conoce). */
export function priceLine(c: ApplicantCard): string {
  const parts = [amountLabel(c)];
  if (c.hours != null) parts.push(`${c.hours % 1 === 0 ? c.hours : c.hours.toFixed(1)} h`);
  if (c.estimatedTotal != null) parts.push(`≈ ${formatCOP(c.estimatedTotal)}`);
  return parts.join(" · ");
}

/** Cuánto se aparta del valor publicado: «+5 %», «−10 %» o «Valor publicado». */
export function deltaFromPosted(c: ApplicantCard): { pct: number; label: string } {
  if (!c.postedAmount || c.postedAmount <= 0) return { pct: 0, label: "Valor publicado" };
  const pct = Math.round(((c.amount - c.postedAmount) / c.postedAmount) * 100);
  if (pct === 0) return { pct, label: "Valor publicado" };
  return { pct, label: `${pct > 0 ? "+" : "−"}${Math.abs(pct)} % sobre lo publicado` };
}

export function expiryText(c: ApplicantCard, now = Date.now()): string | null {
  if (c.turn === "done") return null;
  return timeLeftLabel(c.expiresAt, now);
}

export function starsText(c: ApplicantCard): string {
  if (c.starsAvg == null) return "Sin calificaciones";
  return `${c.starsAvg.toFixed(1)} (${c.ratingsCount})`;
}

export function initialsOf(name: string): string {
  const parts = name
    .replace(/[^\p{L}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function summarizeApplicants(cards: ApplicantCard[]): {
  toAnswer: number;
  waiting: number;
  accepted: number;
} {
  const g = partitionApplicants(cards);
  return { toAnswer: g.action.length, waiting: g.waiting.length, accepted: g.done.length };
}

// ─── Errores ─────────────────────────────────────────────────────────────────

export type ApplicantErrorKind =
  | "negotiate_plan"
  | "contact_plan"
  | "quota"
  | "not_active"
  | "shifts_required"
  | "final_round"
  | "rate_out_of_band"
  | "conflict"
  | "forbidden_content"
  | "other";

export interface ApplicantError {
  kind: ApplicantErrorKind;
  message: string;
  /** El texto invita a mejorar de plan. */
  upsell: boolean;
}

export function applicantError(err: ServerError | null | undefined): ApplicantError {
  const hint = err?.hint ?? "";
  if (hint === "proposal_not_active") {
    return {
      kind: "not_active",
      message: "Esta postulación ya no está vigente. Actualiza la lista.",
      upsell: false,
    };
  }
  const c = classifyHubError(err);
  switch (c.kind) {
    case "negotiate_plan":
      return {
        kind: "negotiate_plan",
        message: "Negociar el valor está disponible desde el plan Esencial.",
        upsell: true,
      };
    case "plan_required":
      return {
        kind: "contact_plan",
        message: "Ver el WhatsApp del profesional está disponible desde el plan Esencial.",
        upsell: true,
      };
    case "quota":
      return { kind: "quota", message: c.message, upsell: false };
    case "shifts_required":
      return {
        kind: "shifts_required",
        message: "Define el horario del servicio para poder aceptar.",
        upsell: false,
      };
    case "final_round":
      return { kind: "final_round", message: c.message, upsell: false };
    case "rate_out_of_band":
      return { kind: "rate_out_of_band", message: c.message, upsell: false };
    case "conflict":
      return {
        kind: "conflict",
        message: "Ese horario se cruza con otro servicio confirmado del profesional.",
        upsell: false,
      };
    case "forbidden_content":
      return { kind: "forbidden_content", message: c.message, upsell: false };
    case "unavailable":
      return {
        kind: "not_active",
        message: "Esta postulación ya no está disponible. Actualiza la lista.",
        upsell: false,
      };
    default:
      return { kind: "other", message: c.message, upsell: false };
  }
}
