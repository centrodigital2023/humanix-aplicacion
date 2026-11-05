// Wompi (pasarela de Bancolombia) para cobrar en Humanix. Lógica pura y probada (`wompi.test.ts`).
//
// Cobro: Web Checkout de Wompi (https://checkout.wompi.co/p/). El servidor arma el enlace con la llave pública, el monto en
// centavos, nuestra referencia (= id de `payment_charges`) y la firma de integridad SHA-256 de
// `${referencia}${centavos}COP${expiración}${secreto de integridad}`. La familia elige ahí cómo paga (Bre-B si Wompi lo
// tiene activo en la cuenta, Nequi, PSE, botón Bancolombia, tarjeta…; se configura en el panel de Wompi).
//
// Aviso: Wompi envía `transaction.updated` a `/api/public/wompi/webhook`. La firma es SHA-256 de los valores de
// `signature.properties` (rutas dentro de `data`), luego `timestamp` y luego el secreto de eventos; llega en
// `signature.checksum` y en `X-Event-Checksum`. El dinero se mueve solo en la base (`hx_charge_paid`, idempotente).
import { PAYMENT_MAX_COP, PAYMENT_MIN_COP } from "./commissionMatrix";

export const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";
export const WOMPI_API_PRODUCTION = "https://production.wompi.co/v1";
export const WOMPI_API_SANDBOX = "https://sandbox.wompi.co/v1";

/** Llaves `pub_test_…` = Sandbox; `pub_prod_…` = Producción. */
export function wompiApiBase(publicKey: string): string {
  return /^pub_test_/i.test(publicKey) ? WOMPI_API_SANDBOX : WOMPI_API_PRODUCTION;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Firma de integridad del checkout (se calcula SOLO en el servidor). */
export function wompiIntegritySignature(input: {
  reference: string;
  amountInCents: number;
  currency?: "COP";
  expirationTime?: string | null;
  integritySecret: string;
}): Promise<string> {
  return sha256Hex(
    `${input.reference}${input.amountInCents}${input.currency ?? "COP"}${input.expirationTime ?? ""}${input.integritySecret}`,
  );
}

export type CheckoutResult =
  | { ok: true; url: string; amountInCents: number }
  | { ok: false; error: "amount_out_of_range" | "missing_reference" | "not_configured" };

/** Enlace del Web Checkout de Wompi. COP enteros entre $2.000 y $12.000.000 (se envían en centavos). */
export async function buildCheckoutUrl(input: {
  publicKey: string;
  integritySecret: string;
  amountCop: number;
  reference: string;
  redirectUrl?: string | null;
  expirationTime?: string | null;
  customerEmail?: string | null;
}): Promise<CheckoutResult> {
  if (!input.publicKey || !input.integritySecret) return { ok: false, error: "not_configured" };
  const amount = Math.round(Number(input.amountCop));
  if (!Number.isFinite(amount) || amount < PAYMENT_MIN_COP || amount > PAYMENT_MAX_COP) {
    return { ok: false, error: "amount_out_of_range" };
  }
  const reference = String(input.reference ?? "").trim();
  if (!reference) return { ok: false, error: "missing_reference" };
  const amountInCents = amount * 100;
  const signature = await wompiIntegritySignature({
    reference,
    amountInCents,
    expirationTime: input.expirationTime,
    integritySecret: input.integritySecret,
  });
  const q = new URLSearchParams();
  q.set("public-key", input.publicKey);
  q.set("currency", "COP");
  q.set("amount-in-cents", String(amountInCents));
  q.set("reference", reference);
  q.set("signature:integrity", signature);
  if (input.redirectUrl) q.set("redirect-url", input.redirectUrl);
  if (input.expirationTime) q.set("expiration-time", input.expirationTime);
  if (input.customerEmail) q.set("customer-data:email", input.customerEmail);
  return { ok: true, url: `${WOMPI_CHECKOUT_URL}?${q.toString()}`, amountInCents };
}

/** Lee una ruta (`transaction.id`) dentro de `data`. */
function pathValue(data: unknown, path: string): string {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur == null ? "" : String(cur);
}

/**
 * Firma de un evento de Wompi (cobros y pagos a terceros usan la misma regla, cada uno con su secreto):
 * SHA-256(valores de `signature.properties` en orden + `timestamp` + secreto). Se compara sin importar mayúsculas.
 */
export async function verifyWompiEvent(input: {
  rawBody: string;
  headerChecksum?: string | null;
  secret: string;
}): Promise<boolean> {
  if (!input.secret) return false;
  let o: {
    data?: unknown;
    signature?: { properties?: unknown; checksum?: unknown };
    timestamp?: unknown;
  };
  try {
    o = JSON.parse(input.rawBody);
  } catch {
    return false;
  }
  const props = o?.signature?.properties;
  const checksum = String(input.headerChecksum || o?.signature?.checksum || "").toLowerCase();
  if (!Array.isArray(props) || props.length === 0 || !checksum) return false;
  if (o.timestamp == null || !/^\d+$/.test(String(o.timestamp))) return false;
  const concat = props.map((p) => pathValue(o.data, String(p))).join("");
  const expected = await sha256Hex(`${concat}${o.timestamp}${input.secret}`);
  // Si vienen ambos (encabezado y cuerpo) deben coincidir con lo calculado.
  const bodySum = String(o?.signature?.checksum ?? "").toLowerCase();
  if (bodySum && bodySum !== checksum) return false;
  return safeEqual(checksum, expected);
}

export type WompiTxStatus = "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "ERROR";

export interface WompiTransactionEvent {
  type: string;
  transactionId: string;
  reference: string;
  status: WompiTxStatus | string;
  amountCop: number;
  paymentMethod: string | null;
  timestamp: string;
}

/** Lee `transaction.updated` de cobros; nulo si no trae lo mínimo. */
export function parseWompiTransactionEvent(rawBody: string): WompiTransactionEvent | null {
  let o: {
    event?: unknown;
    data?: { transaction?: Record<string, unknown> };
    timestamp?: unknown;
  };
  try {
    o = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const type = typeof o?.event === "string" ? o.event : "";
  const t = o?.data?.transaction;
  if (type !== "transaction.updated" || !t) return null;
  const id = String(t.id ?? "");
  const reference = String(t.reference ?? "");
  const cents = Number(t.amount_in_cents ?? NaN);
  if (!id || !reference || !Number.isFinite(cents)) return null;
  return {
    type,
    transactionId: id,
    reference,
    status: String(t.status ?? "").toUpperCase(),
    amountCop: Math.floor(cents / 100),
    paymentMethod: typeof t.payment_method_type === "string" ? t.payment_method_type : null,
    timestamp: String(o.timestamp ?? ""),
  };
}

/** Lo que el navegador necesita para pagar: el enlace del checkout y el id para escuchar el estado en vivo. */
export interface ChargeView {
  chargeId: string;
  amountCop: number;
  checkoutUrl: string | null;
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
  not_configured: "Los pagos en línea se están activando. Inténtalo en unos minutos.",
  not_found: "No encontramos este turno.",
  forbidden: "Solo quien reservó puede pagar este turno.",
  not_payable: "Podrás pagar cuando el profesional confirme el turno.",
  already_paid: "Este turno ya está pagado. ¡Gracias!",
  cash_booking: "Este turno se paga en efectivo directamente al profesional.",
  amount_out_of_range: "El monto debe estar entre $2.000 y $12.000.000.",
  provider_error: "No pudimos preparar el pago. Inténtalo de nuevo en un momento.",
};
