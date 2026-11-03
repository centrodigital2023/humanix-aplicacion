// Firux Partner API v1 (cobros por Bre-B). Lógica pura y probada (`firux.test.ts`): armar el cobro, verificar la firma del aviso
// (HMAC-SHA256 de `${timestamp}.${cuerpo}`, ventana de 5 minutos) y leer el evento. El dinero se mueve en la base, en una sola
// transacción (`hx_firux_charge_paid`, migración 20261103160000): un aviso repetido o simultáneo no aplica dos veces.
import { FIRUX_MAX_COP, FIRUX_MIN_COP } from "./commissionMatrix";

export const FIRUX_API = "https://api.firux.co/v1";
export const FIRUX_SIGNATURE_WINDOW_S = 300;

export interface FiruxCharge {
  id: string;
  status: string;
  amount: number;
  qr_emv?: string | null;
  payment_url?: string | null;
  expires_at?: string | null;
}

export type ChargeBodyResult =
  | { ok: true; body: { amount: number; external_reference: string; description: string } }
  | { ok: false; error: "amount_out_of_range" | "missing_reference" };

/** Cuerpo de `POST /v1/charges`: COP enteros entre $2.000 y $12.000.000. */
export function buildChargeBody(input: {
  amountCop: number;
  reference: string;
  description: string;
}): ChargeBodyResult {
  const amount = Math.round(Number(input.amountCop));
  if (!Number.isFinite(amount) || amount < FIRUX_MIN_COP || amount > FIRUX_MAX_COP) {
    return { ok: false, error: "amount_out_of_range" };
  }
  const reference = String(input.reference ?? "").trim();
  if (!reference) return { ok: false, error: "missing_reference" };
  return {
    ok: true,
    body: {
      amount,
      external_reference: reference.slice(0, 64),
      description: String(input.description ?? "").slice(0, 255),
    },
  };
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function firuxSignatureFor(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)),
  );
}

/** `Firux-Timestamp` + `Firux-Signature: v1=<hex>[, v1=<hex>]`, con una ventana de 5 minutos contra repeticiones. */
export async function verifyFiruxSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  nowSeconds: number;
}): Promise<boolean> {
  const { rawBody, timestamp, signature, secret, nowSeconds } = input;
  if (!timestamp || !signature || !secret || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > FIRUX_SIGNATURE_WINDOW_S) return false;
  const expected = await firuxSignatureFor(secret, timestamp, rawBody);
  return signature
    .split(",")
    .map((s) => s.trim().replace(/^v1=/, ""))
    .some((sig) => safeEqual(sig.toLowerCase(), expected));
}

export interface FiruxEvent {
  type: string;
  chargeId: string;
  reference: string | null;
  amountPaid: number;
}

/** Lee el aviso; nulo si no trae lo mínimo. */
export function parseFiruxEvent(rawBody: string): FiruxEvent | null {
  let p: unknown;
  try {
    p = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const o = p as {
    type?: unknown;
    data?: {
      charge_id?: unknown;
      id?: unknown;
      external_reference?: unknown;
      amount_paid?: unknown;
      amount?: unknown;
    };
  };
  const type = typeof o?.type === "string" ? o.type : "";
  const chargeId = String(o?.data?.charge_id ?? o?.data?.id ?? "");
  if (!type || !chargeId) return null;
  const amount = Math.round(Number(o.data?.amount_paid ?? o.data?.amount ?? 0));
  const ref = o.data?.external_reference;
  return {
    type,
    chargeId,
    reference: typeof ref === "string" ? ref : null,
    amountPaid: Number.isFinite(amount) ? amount : 0,
  };
}

/** Enlace para abrir el pago en la app del banco (si Firux no lo trae, el QR basta). */
export function payLink(charge: Pick<FiruxCharge, "payment_url">): string | null {
  const u = charge.payment_url ?? "";
  return /^https:\/\//i.test(u) ? u : null;
}

/** Lo que el navegador necesita para mostrar el pago: QR, enlace al banco y el id para escuchar el estado en vivo. */
export interface ChargeView {
  chargeId: string;
  amountCop: number;
  qrEmv: string | null;
  paymentUrl: string | null;
  expiresAt: string | null;
  status: string;
}

export type ChargeErrorCode =
  | "not_configured"
  | "not_found"
  | "forbidden"
  | "not_payable"
  | "already_paid"
  | "cash_booking"
  | "amount_out_of_range"
  | "provider_error";

export type ChargeResult = { ok: true; charge: ChargeView } | { ok: false; code: ChargeErrorCode };

export const CHARGE_ERROR_MESSAGE: Record<ChargeErrorCode, string> = {
  not_configured: "Los pagos con Bre-B se están activando. Inténtalo en unos minutos.",
  not_found: "No encontramos este turno.",
  forbidden: "Solo quien reservó puede pagar este turno.",
  not_payable: "Podrás pagar cuando el profesional confirme el turno.",
  already_paid: "Este turno ya está pagado. ¡Gracias!",
  cash_booking: "Este turno se paga en efectivo directamente al profesional.",
  amount_out_of_range: "El monto debe estar entre $2.000 y $12.000.000.",
  provider_error: "No pudimos generar el código de pago. Inténtalo de nuevo en un momento.",
};
