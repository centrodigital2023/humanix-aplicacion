// Dispersión automática a profesionales por Bre-B (Firux). Lógica pura y probada (`dispersion.test.ts`).
//
// Cuando se libera el pago retenido de un turno, la base deja una fila `payouts` en `queued` (con la llave Bre-B del
// profesional) y despierta al despachador (`/api/public/firux/dispatch`). El despachador reclama un lote
// (`hx_claim_payouts`), envía cada pago a Firux en paralelo y anota el resultado (`hx_payout_result`). El aviso firmado de
// Firux (`payout.paid` / `payout.failed`) cierra cada pago. Todo el dinero se anota en `ledger_entries`
// (migración 20261105100000).
//
// ASUNCIÓN (Firux no ha publicado la API de dispersiones; corregir aquí cuando salga):
//   POST /v1/payouts  { amount, currency: "COP", external_reference, description,
//                       destination: { type: "breb_key", key_type, key } }   + Idempotency-Key
//   → { id, status: "pending" | "processing" | "paid" | "failed", failure_reason? }
//   Aviso: { type: "payout.paid" | "payout.failed", data: { id, external_reference, failure_reason? } }
import type { BrebKeyType } from "./breb";

export const FIRUX_PAYOUT_MIN_COP = 1_000;
/** Pagos por lote y en paralelo: suficiente para «segundos» sin golpear a Firux. */
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
}

export interface FiruxPayoutBody {
  amount: number;
  currency: "COP";
  external_reference: string;
  description: string;
  destination: { type: "breb_key"; key_type: string; key: string };
}

/** Tipo de llave tal como (suponemos) lo espera Firux. */
const KEY_TYPE: Record<BrebKeyType, string> = {
  phone: "phone",
  document: "document",
  email: "email",
  alias: "alias",
};

export type BuildPayoutResult =
  | { ok: true; body: FiruxPayoutBody; idempotencyKey: string }
  | { ok: false; error: "missing_key" | "amount_out_of_range" };

/** Huella corta de la llave Bre-B (djb2): parte de la Idempotency-Key. */
export function keyFingerprint(keyType: string, key: string): string {
  let h = 5381;
  for (const ch of `${keyType}:${key}`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** Cuerpo y llave de idempotencia. La Idempotency-Key es el pago + la llave Bre-B de destino: un reintento (red caída,
 * servidor reiniciado a mitad, error 5xx) manda la MISMA llave y Firux no paga dos veces. Solo cambia si el profesional
 * corrige su llave tras un rechazo, y ahí sí es un pago nuevo hacia otra cuenta. */
export function buildPayoutBody(p: ClaimedPayout): BuildPayoutResult {
  const amount = Math.round(Number(p.amount_cop));
  if (!Number.isFinite(amount) || amount < FIRUX_PAYOUT_MIN_COP)
    return { ok: false, error: "amount_out_of_range" };
  const keyType = KEY_TYPE[p.key_type as BrebKeyType];
  const key = String(p.key_value ?? "").trim();
  if (!keyType || !key) return { ok: false, error: "missing_key" };
  return {
    ok: true,
    idempotencyKey: `payout_${p.id}_${keyFingerprint(keyType, key)}`,
    body: {
      amount,
      currency: "COP",
      external_reference: p.id,
      description: "Pago Humanix por turno de cuidado",
      destination: { type: "breb_key", key_type: keyType, key },
    },
  };
}

export type PayoutOutcome =
  | { status: "sent" | "paid"; firuxId: string }
  | { status: "retry" | "failed"; error: string; firuxId?: string };

/** Respuesta de Firux → qué anotar. Errores de configuración (401/403) y pasajeros (red, 408, 429, 5xx) se reintentan:
 * nunca se le dice al profesional que su llave está mal por un problema nuestro o de Firux. */
export function classifyPayoutResponse(
  r: { httpStatus: number; json: unknown } | { networkError: string },
): PayoutOutcome {
  if ("networkError" in r)
    return { status: "retry", error: `network: ${r.networkError}`.slice(0, 120) };
  const o = (r.json ?? {}) as {
    id?: unknown;
    status?: unknown;
    failure_reason?: unknown;
    error?: unknown;
  };
  const firuxId = o.id != null ? String(o.id) : undefined;
  const reason = String(
    o.failure_reason ?? (o.error as { message?: unknown })?.message ?? o.error ?? "",
  );
  const s = r.httpStatus;
  if (s >= 200 && s < 300) {
    const st = String(o.status ?? "pending").toLowerCase();
    if (!firuxId) return { status: "retry", error: "firux_missing_id" };
    if (st === "paid" || st === "succeeded" || st === "completed")
      return { status: "paid", firuxId };
    if (st === "failed" || st === "rejected")
      return { status: "failed", firuxId, error: reason || "rejected" };
    return { status: "sent", firuxId };
  }
  // Misma Idempotency-Key ya procesada: Firux tiene el pago; esperamos su aviso.
  if (s === 409 && firuxId) return { status: "sent", firuxId };
  if (s === 401 || s === 403 || s === 408 || s === 409 || s === 429 || s >= 500)
    return { status: "retry", error: `firux_${s}${reason ? `: ${reason}` : ""}`.slice(0, 120) };
  // 400 / 404 / 422: la llave o el destino no sirven.
  return { status: "failed", error: (reason || `firux_${s}`).slice(0, 120) };
}

export interface FiruxPayoutEvent {
  type: "payout.paid" | "payout.failed";
  payoutId: string;
  reference: string | null;
  reason: string | null;
}

/** Aviso de dispersión; nulo si no es de dispersión o no trae lo mínimo. */
export function parsePayoutEvent(rawBody: string): FiruxPayoutEvent | null {
  let o: { type?: unknown; data?: Record<string, unknown> };
  try {
    o = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const type = String(o?.type ?? "");
  const map: Record<string, FiruxPayoutEvent["type"]> = {
    "payout.paid": "payout.paid",
    "payout.succeeded": "payout.paid",
    "payout.failed": "payout.failed",
    "payout.returned": "payout.failed",
  };
  const t = map[type];
  const id = String(o?.data?.payout_id ?? o?.data?.id ?? "");
  if (!t || !id) return null;
  const ref = o.data?.external_reference;
  const reason = o.data?.failure_reason;
  return {
    type: t,
    payoutId: id,
    reference: typeof ref === "string" ? ref : null,
    reason: typeof reason === "string" ? reason.slice(0, 120) : null,
  };
}

/** FIRUX_PAYOUTS_ENABLED=true enciende la dispersión automática (apagada: el equipo paga a mano como antes). */
export function isDispersionEnabled(env: Record<string, string | undefined>): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.FIRUX_PAYOUTS_ENABLED ?? "").trim());
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
