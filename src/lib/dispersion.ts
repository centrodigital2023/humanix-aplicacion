// Dispersión automática a profesionales por Bre-B con la API de Pagos a Terceros de Wompi. Lógica pura y probada
// (`dispersion.test.ts`).
//
// Cuando se libera el pago retenido de un turno, la base deja una fila `payouts` en `queued` (con la llave Bre-B del
// profesional) y despierta al despachador (`/api/public/wompi/dispatch`). El despachador reclama un lote
// (`hx_claim_payouts`) y envía cada pago a Wompi como un lote propio de una sola transacción (`POST /v2/payouts`), así el
// aviso de Wompi siempre se cruza con un solo pago. Anota el resultado (`hx_payout_result`). Los avisos firmados
// (`transaction.updated` / `payout.updated` en `/api/public/wompi/payouts-webhook`) cierran cada pago. Todo el dinero se
// anota en `ledger_entries` (migración 20261105200000).
//
// API (docs.wompi.co → Pagos a terceros → Dispersión BRE-B):
//   POST {base}/payouts   encabezados x-api-key, user-principal-id, idempotency-key (letras, números y guiones, ≤64, 24 h)
//   { reference, accountId, paymentType: "PROVIDERS", transactions: [{ key, amount (centavos), name, email, reference }] }
//   → 201 { data: { payoutId, transactions, success, failed } } · 409 EXC_032 = esa llave de idempotencia ya se procesó
//   Estados: transacción PENDING | PROCESSING | APPROVED | FAILED | REJECTED | CANCELLED;
//            lote PENDING | TOTAL_PAYMENT | PARTIAL_PAYMENT | REJECTED (sin saldo o sin cupo) | NOT_APPROVED …
import type { BrebKeyType } from "./breb";

export const WOMPI_PAYOUTS_API_PRODUCTION = "https://api.payouts.wompi.co/v2";
export const WOMPI_PAYOUTS_API_SANDBOX = "https://api.sandbox.payouts.wompi.co/v2";

export const PAYOUT_MIN_COP = 1_000;
/** Pagos por lote y en paralelo: suficiente para «segundos» sin golpear a Wompi. */
export const DISPATCH_BATCH_SIZE = 50;
export const DISPATCH_CONCURRENCY = 5;

export interface ClaimedPayout {
  id: string;
  professional_id: string;
  booking_id: string | null;
  amount_cop: number;
  key_type: string | null;
  key_value: string | null;
  attempts: number;
  batch_id: string;
  /** Sube cada vez que Wompi dice con certeza que no movió el dinero: así el siguiente intento lleva otra llave de
   * idempotencia (con la misma, Wompi respondería 409 «ya procesada» sin pagar). */
  idem_gen: number;
  /** Wompi pide nombre y correo del beneficiario. */
  payee_name: string | null;
  payee_email: string | null;
}

export interface WompiPayoutBody {
  reference: string;
  accountId: string;
  paymentType: "PROVIDERS";
  transactions: Array<{
    key: string;
    amount: number;
    name: string;
    email: string;
    reference: string;
    description: string;
  }>;
}

const KNOWN_KEY_TYPES: ReadonlySet<BrebKeyType> = new Set(["phone", "document", "email", "alias"]);

export type BuildPayoutResult =
  | { ok: true; body: WompiPayoutBody; idempotencyKey: string }
  | {
      ok: false;
      error: "missing_key" | "amount_out_of_range" | "missing_payee" | "not_configured";
    };

/** Huella corta de la llave Bre-B (djb2, base 36): parte de la llave de idempotencia. */
export function keyFingerprint(keyType: string, key: string): string {
  let h = 5381;
  for (const ch of `${keyType}:${key}`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** La llave Bre-B tal como la espera Wompi (alias con @, correo en minúsculas, celular/cédula solo dígitos). */
export function wompiKey(keyType: string, key: string): string {
  const k = key.trim();
  if (keyType === "alias") return k.startsWith("@") ? k : `@${k}`;
  if (keyType === "email") return k.toLowerCase();
  return k.replace(/\D/g, "");
}

/**
 * Cuerpo y llave de idempotencia. La llave es el pago + la huella de la llave Bre-B de destino + `idem_gen`: un
 * reintento tras una caída de red o un 5xx (no sabemos si Wompi lo recibió) manda la MISMA llave y Wompi no paga dos
 * veces (409 EXC_032 dentro de 24 h). Cambia si el profesional corrige su llave, o cuando Wompi respondió con certeza
 * que no pagó (rechazo, sin saldo, credencial): ahí `idem_gen` sube. La referencia del lote es esa misma llave: el aviso
 * `payout.updated` la trae de vuelta y así se encuentra el pago (empieza con su id).
 */
export function buildPayoutBody(p: ClaimedPayout, accountId: string): BuildPayoutResult {
  if (!accountId) return { ok: false, error: "not_configured" };
  const amount = Math.round(Number(p.amount_cop));
  if (!Number.isFinite(amount) || amount < PAYOUT_MIN_COP)
    return { ok: false, error: "amount_out_of_range" };
  const keyType = String(p.key_type ?? "");
  const raw = String(p.key_value ?? "").trim();
  if (!KNOWN_KEY_TYPES.has(keyType as BrebKeyType) || !raw)
    return { ok: false, error: "missing_key" };
  const name = String(p.payee_name ?? "").trim();
  const email = String(p.payee_email ?? "").trim();
  if (!name || !email) return { ok: false, error: "missing_payee" };
  const key = wompiKey(keyType, raw);
  const idempotencyKey = `${p.id}-${keyFingerprint(keyType, key)}-${Number(p.idem_gen) || 0}`;
  return {
    ok: true,
    idempotencyKey,
    body: {
      reference: idempotencyKey,
      accountId,
      paymentType: "PROVIDERS",
      transactions: [
        {
          key,
          amount: amount * 100,
          name: name.slice(0, 100),
          email,
          // Máx. 40 caracteres, letras, números y guiones: el id del pago (36).
          reference: p.id,
          description: "Pago Humanix por turno de cuidado",
        },
      ],
    },
  };
}

export type PayoutOutcome =
  | { status: "sent" | "paid"; providerId?: string }
  | {
      status: "retry" | "failed";
      error: string;
      providerId?: string;
      /** Wompi respondió y con certeza no creó el pago: el próximo intento usa otra llave de idempotencia. */
      definitive?: boolean;
    };

function errText(o: { code?: unknown; message?: unknown }): string {
  const msg = Array.isArray(o.message) ? o.message.join("; ") : String(o.message ?? "");
  return [o.code, msg].filter((x) => x != null && String(x) !== "").join(" ");
}

/**
 * Respuesta de `POST /v2/payouts` → qué anotar. Errores de configuración (401/403), de saldo (EXC_008) y pasajeros
 * (red, 408, 429, 5xx) se reintentan: nunca se le dice al profesional que su llave está mal por un problema nuestro o de
 * Wompi. Una transacción rechazada en validación (`failed` = 1) o un 400 sí es `failed`.
 */
export function classifyPayoutResponse(
  r: { httpStatus: number; json: unknown } | { networkError: string },
): PayoutOutcome {
  if ("networkError" in r)
    return { status: "retry", error: `network: ${r.networkError}`.slice(0, 120) };
  const o = (r.json ?? {}) as {
    code?: unknown;
    message?: unknown;
    data?: { payoutId?: unknown; success?: unknown; failed?: unknown };
  };
  const s = r.httpStatus;
  const providerId = o.data?.payoutId != null ? String(o.data.payoutId) : undefined;
  if (s >= 200 && s < 300) {
    if (Number(o.data?.failed ?? 0) > 0 && Number(o.data?.success ?? 0) === 0)
      return {
        status: "failed",
        providerId,
        error: "wompi_rejected_transaction",
        definitive: true,
      };
    return { status: "sent", providerId };
  }
  const code = String(o.code ?? "");
  // Misma llave de idempotencia ya procesada: Wompi tiene el pago; esperamos su aviso.
  if (s === 409 || code === "EXC_032") return { status: "sent" };
  const text = errText(o);
  if (code === "EXC_008")
    return {
      status: "retry",
      error: `wompi_insufficient_balance ${text}`.slice(0, 120),
      definitive: true,
    };
  // 408 / 5xx: no sabemos si Wompi lo procesó → misma llave de idempotencia en el reintento.
  if (s === 408 || s >= 500)
    return { status: "retry", error: `wompi_${s}${text ? `: ${text}` : ""}`.slice(0, 120) };
  if (s === 401 || s === 403 || s === 429)
    return {
      status: "retry",
      error: `wompi_${s}${text ? `: ${text}` : ""}`.slice(0, 120),
      definitive: true,
    };
  // 400 / 404 / 422: la llave o el destino no sirven.
  return { status: "failed", error: (text || `wompi_${s}`).slice(0, 120), definitive: true };
}

export interface WompiPayoutEvent {
  kind: "payout" | "transaction";
  /** Id del objeto del aviso (lote o transacción), para no anotar dos veces. */
  wompiId: string;
  /** Id del lote en Wompi (el que guardamos en `payouts.provider_payout_id`). */
  payoutId: string;
  /** Referencia del lote (nuestra llave de idempotencia; empieza con el id del pago). */
  reference: string | null;
  status: "paid" | "failed" | "retry" | "pending";
  rawStatus: string;
  reason: string | null;
}

const TX_STATUS: Record<string, WompiPayoutEvent["status"]> = {
  APPROVED: "paid",
  FAILED: "failed",
  REJECTED: "failed",
  CANCELLED: "failed",
  PENDING: "pending",
  PROCESSING: "pending",
};

const BATCH_STATUS: Record<string, WompiPayoutEvent["status"]> = {
  TOTAL_PAYMENT: "paid",
  // Sin saldo o sin cupo en la cuenta de Humanix: no es culpa del profesional, vuelve a la cola.
  REJECTED: "retry",
  PENDING: "pending",
  PENDING_APPROVAL: "pending",
  NOT_APPROVED: "pending",
  // Con una sola transacción por lote, el aviso de la transacción decide.
  PARTIAL_PAYMENT: "pending",
};

/** Aviso de Pagos a Terceros; nulo si no trae lo mínimo. */
export function parseWompiPayoutEvent(rawBody: string): WompiPayoutEvent | null {
  let o: {
    event?: unknown;
    data?: { transaction?: Record<string, unknown>; payout?: Record<string, unknown> };
  };
  try {
    o = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const event = String(o?.event ?? "");
  if (event === "transaction.updated" && o.data?.transaction) {
    const t = o.data.transaction;
    const id = String(t.id ?? "");
    const payoutId = String(t.payoutId ?? "");
    const raw = String(t.status ?? "").toUpperCase();
    const st = TX_STATUS[raw];
    if (!id || !payoutId || !st) return null;
    const fr = t.failureReason as { code?: unknown; message?: unknown } | undefined;
    return {
      kind: "transaction",
      wompiId: id,
      payoutId,
      reference: null,
      status: st,
      rawStatus: raw,
      reason: fr ? errText(fr).slice(0, 120) || raw : st === "failed" ? raw : null,
    };
  }
  if (event === "payout.updated" && o.data?.payout) {
    const p = o.data.payout;
    const id = String(p.id ?? "");
    const raw = String(p.status ?? "").toUpperCase();
    const st = BATCH_STATUS[raw];
    if (!id || !st) return null;
    return {
      kind: "payout",
      wompiId: id,
      payoutId: id,
      reference: typeof p.reference === "string" ? p.reference : null,
      status: st,
      rawStatus: raw,
      reason: st === "retry" ? `wompi_batch_${raw}` : null,
    };
  }
  return null;
}

/** WOMPI_PAYOUTS_ENABLED=true enciende la dispersión automática (apagada: el equipo paga a mano como antes). */
export function isDispersionEnabled(env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.WOMPI_PAYOUTS_ENABLED ?? "").trim());
}

/** WOMPI_PAYOUTS_ENV=sandbox usa el ambiente de pruebas; cualquier otro valor, producción. */
export function payoutsApiBase(env: Record<string, string | undefined>): string {
  return /^(sandbox|test)$/i.test(String(env.WOMPI_PAYOUTS_ENV ?? "").trim())
    ? WOMPI_PAYOUTS_API_SANDBOX
    : WOMPI_PAYOUTS_API_PRODUCTION;
}

/** Corre `fn` sobre `items` con a lo sumo `limit` a la vez, en orden de llegada. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
