// Negociación del valor entre una institución y un profesional — acotada, con expiración y sin subastas.
//
// Espeja las funciones SQL `offer_band_min/max`, `apply_to_offer`, `counter_application` y
// `accept_application` (migración 20261009100000). El servidor es quien decide; esto solo permite
// explicar las reglas en pantalla antes de enviar. Si cambias una regla, cambia las dos y sus pruebas.
//
//  · Quien publica fija el valor (por hora, por turno, mensual o paquete). Con el valor publicado se
//    postula cualquiera, también el plan Free; proponer OTRO valor es una función del plan Esencial.
//  · Máximo 3 rondas (la 3 es «última oferta»). Cada oferta vence a las 72 h (postulación inicial) o a
//    las 24 h (contraoferta), nunca después de 1 h antes del primer turno.
//  · El valor debe estar entre 0,8× y 2× del publicado y dentro de los límites de la modalidad.
//  · Solo responde a quien le toca (`awaiting`). El profesional puede cambiar su propia propuesta
//    mientras la institución no responda, sin gastar una ronda.

import {
  APPLICATION_TTL_HOURS,
  BAND_MAX_PCT,
  BAND_MIN_PCT,
  COUNTER_TTL_HOURS,
  MAX_ROUNDS,
  RATE_STEP,
  isExpired,
  midpointRate,
  roundToStep,
} from "./negotiation";
import { buildPriceBreakdown } from "./pricing";

const HOUR = 3_600_000;
const MIN_TTL_MS = 15 * 60_000;

export type OfferModality = "hour" | "shift" | "month" | "package";

export const MODALITY_LABEL: Record<OfferModality, string> = {
  hour: "por hora",
  shift: "por turno",
  month: "por mes",
  package: "por paquete",
};

export const MODALITY_NAME: Record<OfferModality, string> = {
  hour: "Por hora",
  shift: "Por turno",
  month: "Mensual",
  package: "Paquete",
};

/** Piso y techo absolutos por modalidad (COP). Igual que `offer_band_min/max` en SQL. */
export const MODALITY_BOUNDS: Record<OfferModality, { floor: number; cap: number }> = {
  hour: { floor: 8_000, cap: 250_000 },
  shift: { floor: 40_000, cap: 3_000_000 },
  month: { floor: 500_000, cap: 30_000_000 },
  package: { floor: 50_000, cap: 50_000_000 },
};

export function isOfferModality(value: unknown): value is OfferModality {
  return value === "hour" || value === "shift" || value === "month" || value === "package";
}

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;
const floorTo = (n: number, step: number) => Math.floor(n / step) * step;

/** Rango permitido para proponer otro valor sobre el publicado. */
export function offerBand(
  posted: number | null | undefined,
  modality: OfferModality,
): { min: number; max: number } {
  const { floor, cap } = MODALITY_BOUNDS[modality];
  const base = posted && Number.isFinite(posted) && posted > 0 ? posted : 1;
  const min = Math.max(floor, ceilTo((base * BAND_MIN_PCT) / 100, RATE_STEP));
  const max = Math.min(cap, floorTo((base * BAND_MAX_PCT) / 100, RATE_STEP));
  return { min, max: Math.max(min, max) };
}

export type AmountCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "below_band" | "above_band"; min: number; max: number };

export function validateOfferAmount(
  posted: number | null | undefined,
  modality: OfferModality,
  offered: unknown,
): AmountCheck {
  const { min, max } = offerBand(posted, modality);
  if (typeof offered !== "number" || !Number.isInteger(offered) || offered <= 0) {
    return { ok: false, reason: "invalid", min, max };
  }
  if (offered < min) return { ok: false, reason: "below_band", min, max };
  if (offered > max) return { ok: false, reason: "above_band", min, max };
  return { ok: true };
}

/** Valor que una institución puede publicar (no depende de otro valor previo). */
export function validatePublishedAmount(modality: OfferModality, amount: unknown): AmountCheck {
  const { floor, cap } = MODALITY_BOUNDS[modality];
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "invalid", min: floor, max: cap };
  }
  if (amount < floor) return { ok: false, reason: "below_band", min: floor, max: cap };
  if (amount > cap) return { ok: false, reason: "above_band", min: floor, max: cap };
  return { ok: true };
}

export function amountErrorCopy(
  check: Extract<AmountCheck, { ok: false }>,
  format: (n: number) => string,
): string {
  if (check.reason === "invalid") return "Escribe un valor válido en pesos.";
  return `El valor debe estar entre ${format(check.min)} y ${format(check.max)}.`;
}

export function describeAmount(
  amount: number,
  modality: OfferModality,
  format: (n: number) => string,
): string {
  return `${format(amount)} ${MODALITY_LABEL[modality]}`;
}

// ─── Estado de la postulación ────────────────────────────────────────────────

export type ApplicationStatus = "pending" | "accepted" | "rejected" | "withdrawn";
export type PartyRole = "institution" | "professional";

export interface ApplicationState {
  status: ApplicationStatus;
  awaiting: PartyRole;
  round_no: number;
  expires_at: string | null;
}

export interface ApplicationActions {
  accept: boolean;
  /** Rechazar (institución) o retirar / rechazar la contraoferta (profesional). */
  decline: boolean;
  /** Enviar un nuevo valor. `counterKind` dice si es contraoferta (gasta ronda) o cambio de propuesta. */
  counter: boolean;
  counterKind: "counter" | "revise" | null;
  /** El profesional tendría acción de negociar pero su plan no la incluye. */
  needsPlanToNegotiate: boolean;
  isFinalRound: boolean;
  waitingForOther: boolean;
  reason: string | null;
}

const NO_ACTIONS: ApplicationActions = {
  accept: false,
  decline: false,
  counter: false,
  counterKind: null,
  needsPlanToNegotiate: false,
  isFinalRound: false,
  waitingForOther: false,
  reason: null,
};

const CLOSED_REASON: Record<Exclude<ApplicationStatus, "pending">, string> = {
  accepted: "Esta postulación ya fue aceptada.",
  rejected: "La institución respondió a esta postulación.",
  withdrawn: "Esta postulación ya no está activa.",
};

/** Qué puede hacer cada parte ahora mismo (espeja `counter_application` / `accept_application`). */
export function applicationActions(
  app: ApplicationState,
  role: PartyRole,
  opts: { canNegotiate: boolean; now?: number },
): ApplicationActions {
  const now = opts.now ?? Date.now();
  if (app.status !== "pending") {
    return { ...NO_ACTIONS, reason: CLOSED_REASON[app.status] };
  }
  if (isExpired(app, now)) return { ...NO_ACTIONS, reason: "La oferta venció." };

  const isFinalRound = app.round_no >= MAX_ROUNDS;
  const myTurn = app.awaiting === role;

  if (role === "institution") {
    if (!myTurn) {
      return {
        ...NO_ACTIONS,
        decline: true,
        waitingForOther: true,
        isFinalRound,
        reason: "Esperando la respuesta del profesional.",
      };
    }
    return {
      accept: true,
      decline: true,
      counter: !isFinalRound,
      counterKind: isFinalRound ? null : "counter",
      needsPlanToNegotiate: false,
      isFinalRound,
      waitingForOther: false,
      reason: isFinalRound ? "Última oferta: solo puedes aceptarla o rechazarla." : null,
    };
  }

  // Profesional
  const canSendValue = !isFinalRound;
  const kind: "counter" | "revise" = myTurn ? "counter" : "revise";
  return {
    accept: myTurn,
    decline: true,
    counter: canSendValue && opts.canNegotiate,
    counterKind: canSendValue && opts.canNegotiate ? kind : null,
    needsPlanToNegotiate: canSendValue && !opts.canNegotiate,
    isFinalRound,
    waitingForOther: !myTurn,
    reason: !myTurn
      ? "Esperando la respuesta de la institución."
      : isFinalRound
        ? "Última oferta: solo puedes aceptarla o rechazarla."
        : null,
  };
}

export function applicationRoundLabel(round: number): string {
  if (round <= 1) return "Postulación inicial";
  if (round >= MAX_ROUNDS) return "Última oferta";
  return `Contraoferta ${round - 1}`;
}

/**
 * Vencimiento (espejo del servidor): 72 h para la postulación inicial y 24 h para cada contraoferta,
 * sin pasar de 1 h antes del primer turno y con un mínimo de 15 minutos para poder responder.
 * `revise` = el profesional cambia su propia propuesta: conserva 72 h solo si sigue siendo la inicial.
 */
export function applicationExpiry(args: {
  kind: "apply" | "counter" | "revise";
  /** Ronda vigente ANTES de la acción (1 en la postulación inicial). */
  round: number;
  firstShiftStart: string | null;
  now?: number;
}): string {
  const now = args.now ?? Date.now();
  const longTtl = args.kind === "apply" || (args.kind === "revise" && args.round <= 1);
  const ttl = (longTtl ? APPLICATION_TTL_HOURS : COUNTER_TTL_HOURS) * HOUR;
  const start = args.firstShiftStart ? new Date(args.firstShiftStart).getTime() : NaN;
  const cap = Number.isFinite(start) ? start - HOUR : Number.POSITIVE_INFINITY;
  return new Date(Math.max(Math.min(now + ttl, cap), now + MIN_TTL_MS)).toISOString();
}

// ─── Ayudas para decidir ─────────────────────────────────────────────────────

export interface InstitutionCounterSuggestion {
  suggested: number;
  isLastCounter: boolean;
  rationale: string;
}

/** Punto medio explicable entre la última oferta de la otra parte y la propia, dentro del rango. */
export function suggestApplicationCounter(args: {
  theirOffer: number;
  myLastOffer: number | null;
  posted: number;
  modality: OfferModality;
  round: number;
}): InstitutionCounterSuggestion {
  const { min, max } = offerBand(args.posted, args.modality);
  const anchor = args.myLastOffer ?? args.posted;
  const mid = midpointRate(args.theirOffer, anchor);
  const suggested = Math.min(max, Math.max(min, mid));
  const isLastCounter = args.round + 1 >= MAX_ROUNDS;
  const rationale = args.myLastOffer
    ? "Punto medio entre tu última oferta y la de la otra parte."
    : "Punto medio entre el valor publicado y la oferta recibida.";
  return {
    suggested,
    isLastCounter,
    rationale: isLastCounter ? `${rationale} Será tu última contraoferta.` : rationale,
  };
}

export interface ShiftSpan {
  hours: number;
}

/** Valor de UNA reserva (mismo cálculo que `accept_application`). */
export function perShiftTotal(
  modality: OfferModality,
  amount: number,
  hours: number,
  shiftCount: number,
): number {
  if (modality === "hour") return Math.round(amount * hours);
  if (modality === "shift") return amount;
  return Math.round(amount / Math.max(1, shiftCount));
}

/** Valor total acordado para todos los turnos seleccionados. */
export function contractTotal(
  modality: OfferModality,
  amount: number,
  shifts: ShiftSpan[],
): number {
  const n = shifts.length;
  if (n === 0) return modality === "month" || modality === "package" ? amount : 0;
  return shifts.reduce((sum, s) => sum + perShiftTotal(modality, amount, s.hours, n), 0);
}

/** Lo que queda para el profesional después de la comisión de Humanix (12 % Free, 0 % de pago). */
export function professionalNet(total: number, commissionPct: number) {
  const b = buildPriceBreakdown(total, 1, commissionPct);
  return { total: b.total, commission: b.commission, net: b.professionalNet };
}

export { roundToStep };
