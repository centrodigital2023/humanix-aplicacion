// Negociación del valor entre familia y profesional: acotada, con expiración y sin subastas.
//
// Reglas (las aplica el servidor en `apply_to_family_need` / `counter_slot_proposal`; esto las
// espeja para explicarlas en pantalla antes de enviar):
//  · Máximo 3 rondas: oferta inicial + 2 contraofertas. La ronda 3 es «última oferta».
//  · La postulación vence a las 72 h y cada contraoferta a las 24 h (nunca después de 1 h antes del
//    turno); no hay ofertas que queden colgadas.
//  · El valor debe estar entre 0,8× y 2× de la tarifa que publicó la familia y nunca bajo el piso de
//    plataforma: así no hay carrera a la baja entre profesionales ni abusos al alza.
//  · Solo responde quien NO hizo la última oferta.
//  · Se muestra siempre cuánto queda neto después de la comisión (12 % en plan Free, 0 % en pagos).

import { buildPriceBreakdown } from "./pricing";

const HOUR = 3_600_000;

export const MAX_ROUNDS = 3;
export const APPLICATION_TTL_HOURS = 72;
export const COUNTER_TTL_HOURS = 24;
const MIN_TTL_MS = 15 * 60_000;
export const RATE_STEP = 500;
/** Piso de plataforma en COP/h. Revisar cada año junto con el salario mínimo. */
export const MIN_HOURLY_RATE = 8_000;
export const MAX_HOURLY_RATE = 250_000;
/** Porcentajes enteros: evitan el ruido de coma flotante al redondear (0,8 × 20000 ≠ 16000 exacto). */
export const BAND_MIN_PCT = 80;
export const BAND_MAX_PCT = 200;
/** Salario mínimo legal mensual vigente 2026 (referencia para advertir ofertas muy bajas). */
export const SMMLV_2026 = 1_750_905;
/** SMMLV / 240 horas mensuales, redondeado hacia arriba. */
export const MIN_WAGE_PER_HOUR = Math.ceil(SMMLV_2026 / 240);

export type NegotiationRole = "family" | "professional";
export type ProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "expired"
  | "countered";

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;

export function roundToStep(n: number, step = RATE_STEP): number {
  return Math.round(n / step) * step;
}

/** Rango permitido para ofertar sobre una tarifa publicada. */
export function rateBand(posted: number | null | undefined): { min: number; max: number } {
  const base = posted && Number.isFinite(posted) && posted > 0 ? posted : MIN_HOURLY_RATE;
  const min = Math.max(MIN_HOURLY_RATE, ceilTo((base * BAND_MIN_PCT) / 100, RATE_STEP));
  const max = Math.min(MAX_HOURLY_RATE, floorTo((base * BAND_MAX_PCT) / 100, RATE_STEP));
  return { min, max: Math.max(min, max) };
}

export type OfferCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "below_band" | "above_band"; min: number; max: number };

export function validateOffer(posted: number | null | undefined, offered: unknown): OfferCheck {
  const { min, max } = rateBand(posted);
  if (typeof offered !== "number" || !Number.isInteger(offered) || offered <= 0) {
    return { ok: false, reason: "invalid", min, max };
  }
  if (offered < min) return { ok: false, reason: "below_band", min, max };
  if (offered > max) return { ok: false, reason: "above_band", min, max };
  return { ok: true };
}

export function offerErrorCopy(
  check: Extract<OfferCheck, { ok: false }>,
  format: (n: number) => string,
): string {
  if (check.reason === "invalid") return "Escribe un valor por hora válido.";
  return `El valor por hora debe estar entre ${format(check.min)} y ${format(check.max)} para esta solicitud.`;
}

// ─── Estado de la negociación ────────────────────────────────────────────────

export interface Negotiable {
  status: ProposalStatus;
  proposed_by: NegotiationRole;
  round: number;
  expires_at: string | null;
}

export function isExpired(n: Pick<Negotiable, "expires_at">, now = Date.now()): boolean {
  if (!n.expires_at) return false;
  const t = new Date(n.expires_at).getTime();
  return Number.isFinite(t) && t <= now;
}

export interface RespondOptions {
  accept: boolean;
  reject: boolean;
  counter: boolean;
  withdraw: boolean;
  /** true cuando la próxima respuesta ya no admite contraoferta. */
  isFinalRound: boolean;
  reason: string | null;
}

export function respondOptions(
  n: Negotiable,
  role: NegotiationRole,
  now = Date.now(),
): RespondOptions {
  const none: RespondOptions = {
    accept: false,
    reject: false,
    counter: false,
    withdraw: false,
    isFinalRound: n.round >= MAX_ROUNDS,
    reason: null,
  };
  if (n.status !== "pending") return { ...none, reason: "Esta propuesta ya no está activa." };
  if (isExpired(n, now)) return { ...none, reason: "La oferta venció." };
  if (n.proposed_by === role) {
    return { ...none, withdraw: true, reason: "Esperando respuesta de la otra parte." };
  }
  const isFinalRound = n.round >= MAX_ROUNDS;
  return {
    accept: true,
    reject: true,
    counter: !isFinalRound,
    withdraw: false,
    isFinalRound,
    reason: isFinalRound ? "Última oferta: solo puedes aceptarla o rechazarla." : null,
  };
}

export function roundLabel(round: number): string {
  if (round <= 1) return "Oferta inicial";
  if (round >= MAX_ROUNDS) return "Última oferta";
  return `Contraoferta ${round - 1}`;
}

/**
 * Vencimiento de una oferta (espejo del servidor): 72 h para la postulación inicial y 24 h para cada
 * contraoferta, sin pasar de 1 h antes del turno y con un mínimo de 15 minutos para poder responder.
 */
export function expiryFor(args: { round: number; startsAt: string; now?: number }): string {
  const now = args.now ?? Date.now();
  const ttl = (args.round <= 1 ? APPLICATION_TTL_HOURS : COUNTER_TTL_HOURS) * HOUR;
  const start = new Date(args.startsAt).getTime();
  const cap = Number.isFinite(start) ? start - HOUR : Number.POSITIVE_INFINITY;
  return new Date(Math.max(Math.min(now + ttl, cap), now + MIN_TTL_MS)).toISOString();
}

export function timeLeftLabel(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "Venció";
  const minutes = Math.floor(left / 60_000);
  if (minutes < 1) return "Vence en menos de 1 min";
  if (minutes < 60) return `Vence en ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `Vence en ${h} h ${m} min` : `Vence en ${h} h`;
}

// ─── Ayudas para decidir ─────────────────────────────────────────────────────

export function midpointRate(a: number, b: number): number {
  return roundToStep((a + b) / 2);
}

export interface CounterSuggestion {
  suggested: number;
  isLastCounter: boolean;
  rationale: string;
}

/**
 * Sugerencia determinista y explicable: el punto medio entre la última oferta de la otra parte y la
 * propia (o la tarifa publicada si todavía no hay oferta propia), dentro del rango permitido.
 */
export function suggestCounter(args: {
  theirOffer: number;
  myLastOffer: number | null;
  posted: number;
  round: number;
}): CounterSuggestion {
  const { min, max } = rateBand(args.posted);
  const anchor = args.myLastOffer ?? args.posted;
  const mid = midpointRate(args.theirOffer, anchor);
  const suggested = Math.min(max, Math.max(min, mid));
  const isLastCounter = args.round + 1 >= MAX_ROUNDS;
  const rationale = args.myLastOffer
    ? "Punto medio entre tu última oferta y la de la otra parte."
    : "Punto medio entre la tarifa publicada y la oferta recibida.";
  return {
    suggested,
    isLastCounter,
    rationale: isLastCounter ? `${rationale} Será tu última contraoferta.` : rationale,
  };
}

export interface MarketStats {
  n: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

/** Mínimo de avisos comparables para mostrar una referencia de mercado. */
export const MIN_MARKET_SAMPLE = 5;

export type MarketPosition = "unknown" | "below" | "within" | "above";

export function marketPosition(
  rate: number,
  stats: MarketStats | null | undefined,
): MarketPosition {
  if (!stats || stats.n < MIN_MARKET_SAMPLE || stats.p25 == null || stats.p75 == null)
    return "unknown";
  if (rate < stats.p25) return "below";
  if (rate > stats.p75) return "above";
  return "within";
}

export function marketCopy(
  position: MarketPosition,
  stats: MarketStats | null | undefined,
  format: (n: number) => string,
): string {
  if (position === "unknown" || !stats || stats.p25 == null || stats.p75 == null) {
    return "Aún no hay suficientes solicitudes comparables en tu zona para dar una referencia.";
  }
  const range = `${format(stats.p25)}–${format(stats.p75)}`;
  if (position === "below") return `Por debajo del rango habitual en tu zona (${range}/h).`;
  if (position === "above")
    return `Por encima del rango habitual en tu zona (${range}/h): puede tardar más en aceptarse.`;
  return `Dentro del rango habitual en tu zona (${range}/h).`;
}

export function netPerHour(rate: number, commissionPct: number): number {
  return buildPriceBreakdown(rate, 1, commissionPct).professionalNet;
}

/** Aviso cuando, descontada la comisión, la hora queda por debajo del salario mínimo por hora. */
export function lowNetWarning(
  rate: number,
  commissionPct: number,
  format: (n: number) => string,
): string | null {
  const net = netPerHour(rate, commissionPct);
  return net < MIN_WAGE_PER_HOUR
    ? `Después de la comisión te quedarían ${format(net)}/h, menos que el salario mínimo por hora (${format(MIN_WAGE_PER_HOUR)}).`
    : null;
}
