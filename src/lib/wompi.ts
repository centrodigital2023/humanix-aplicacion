// Wompi (Bancolombia) — pasarela de pago de Humanix. Lógica pura y probada (`wompi.test.ts`):
//   · Web Checkout: enlace firmado con la «firma de integridad» SHA-256(referencia + centavos + moneda + vence + secreto).
//   · Aviso `transaction.updated`: checksum SHA-256(valores de `signature.properties` + timestamp + secreto de eventos).
// La referencia que viaja a Wompi es siempre el id de nuestra fila `firux_charges` (tabla de cobros genérica), así que
// cada intento de pago es único y el aviso sabe exactamente qué cobro aplicar con `hx_firux_charge_paid` (idempotente).
import type { FiruxCreate } from "./firuxCharges.server";

export const WOMPI_CHECKOUT = "https://checkout.wompi.co/p/";

export interface WompiConfig {
  publicKey: string;
  integritySecret: string;
  redirectUrl: string;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function integrityString(input: {
  reference: string;
  amountInCents: number;
  currency: string;
  expirationTime?: string;
  secret: string;
}): string {
  return `${input.reference}${input.amountInCents}${input.currency}${input.expirationTime ?? ""}${input.secret}`;
}

/** Enlace de Web Checkout (PSE, tarjeta, Nequi, Botón Bancolombia…). */
export async function buildCheckoutUrl(
  cfg: WompiConfig,
  input: { reference: string; amountCop: number; expirationTime?: string },
): Promise<string> {
  const amountInCents = Math.round(input.amountCop) * 100;
  const signature = await sha256Hex(
    integrityString({
      reference: input.reference,
      amountInCents,
      currency: "COP",
      expirationTime: input.expirationTime,
      secret: cfg.integritySecret,
    }),
  );
  const p = new URLSearchParams({
    "public-key": cfg.publicKey,
    currency: "COP",
    "amount-in-cents": String(amountInCents),
    reference: input.reference,
    "signature:integrity": signature,
    "redirect-url": cfg.redirectUrl,
  });
  if (input.expirationTime) p.set("expiration-time", input.expirationTime);
  return `${WOMPI_CHECKOUT}?${p.toString()}`;
}

/** Adaptador de cobro: no llama a ninguna API, solo arma el enlace firmado con nuestra referencia. */
export function wompiCreateCharge(cfg: WompiConfig): FiruxCreate {
  return async (body, idempotencyKey) => {
    const url = await buildCheckoutUrl(cfg, {
      reference: idempotencyKey,
      amountCop: body.amount,
      expirationTime: body.expires_at,
    });
    return {
      id: idempotencyKey,
      status: "pending",
      amount: body.amount,
      qr_emv: null,
      payment_url: url,
      expires_at: body.expires_at ?? null,
    };
  };
}

export interface WompiEvent {
  event: string;
  transactionId: string;
  reference: string;
  status: string;
  amountCop: number;
}

function pick(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Verifica el checksum del aviso. Devuelve el evento leído o null si la firma no cuadra. */
export async function verifyWompiEvent(rawBody: string, secret: string): Promise<WompiEvent | null> {
  if (!secret) return null;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const sig = pick(body, "signature") as { properties?: unknown; checksum?: unknown } | undefined;
  const ts = pick(body, "timestamp");
  if (!sig || !Array.isArray(sig.properties) || typeof sig.checksum !== "string" || ts == null) return null;
  const data = pick(body, "data");
  const concat = sig.properties.map((p) => String(pick(data, String(p)) ?? "")).join("");
  const expected = await sha256Hex(`${concat}${ts}${secret}`);
  const got = sig.checksum.toLowerCase();
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  const tx = pick(data, "transaction") as Record<string, unknown> | undefined;
  return {
    event: String(pick(body, "event") ?? ""),
    transactionId: String(tx?.id ?? ""),
    reference: String(tx?.reference ?? ""),
    status: String(tx?.status ?? ""),
    amountCop: Math.round(Number(tx?.amount_in_cents ?? 0) / 100),
  };
}
