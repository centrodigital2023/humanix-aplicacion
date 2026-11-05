// Avisos de Wompi. Dos rutas públicas, cada una con su secreto (Wompi los da por separado):
//
//   /api/public/wompi/webhook          cobros (`transaction.updated`), secreto WOMPI_EVENTS_SECRET.
//   /api/public/wompi/payouts-webhook  pagos a terceros / dispersión Bre-B (`transaction.updated`, `payout.updated`),
//                                      secreto WOMPI_PAYOUTS_EVENTS_SECRET.
//
// Ambas: firma inválida → 401 y nada se toca. Se anota el aviso en `payment_webhook_events` (proveedor `wompi` o
// `wompi_payouts`), se aplica con funciones idempotentes de la base y se responde 200. Un error al aplicar → 500 y
// Wompi reintenta (hasta 3 veces).
import { applyWompiTransaction, type ApplyStore } from "./charges.server";
import { parseWompiPayoutEvent, type WompiPayoutEvent } from "./dispersion";
import { parseWompiTransactionEvent, verifyWompiEvent } from "./wompi";

export interface EventLog {
  /** Anota el aviso; devuelve falso si ya estaba (mismo proveedor e id). */
  recordEvent(e: { id: string; type: string; payloadHash: string }): Promise<boolean>;
  markEvent(id: string, processed: boolean, errorCode: string | null): Promise<void>;
}

export interface WebhookStore extends ApplyStore, EventLog {}

export interface PayoutWebhookStore extends EventLog {
  /** Resultado de una dispersión. Devuelve el estado final o `unknown_payout`. */
  applyPayout(e: WompiPayoutEvent): Promise<string>;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ERROR_RESULTS = new Set(["unknown_charge", "underpaid", "unknown_payout"]);

async function run(
  log: EventLog,
  id: string,
  type: string,
  rawBody: string,
  apply: () => Promise<string>,
  tag: string,
): Promise<Response> {
  await log.recordEvent({ id, type, payloadHash: await sha256Hex(rawBody) });
  try {
    const result = await apply();
    const errorCode = ERROR_RESULTS.has(result) ? result : null;
    await log.markEvent(id, errorCode === null, errorCode);
    return json(200, { received: true, result });
  } catch (e) {
    await log.markEvent(id, false, "apply_failed").catch(() => undefined);
    console.error(`[${tag}]`, e instanceof Error ? e.message : e);
    return json(500, { error: "apply_failed" });
  }
}

/** Avisos de cobros. */
export async function handleWompiWebhook(
  request: Request,
  cfg: { secret: string | undefined; store: WebhookStore | null },
): Promise<Response> {
  if (!cfg.secret || !cfg.store) return json(503, { error: "not_configured" });
  const rawBody = await request.text();
  const valid = await verifyWompiEvent({
    rawBody,
    headerChecksum: request.headers.get("x-event-checksum"),
    secret: cfg.secret,
  });
  if (!valid) return json(401, { error: "invalid_signature" });

  const ev = parseWompiTransactionEvent(rawBody);
  // Otros eventos firmados (p. ej. `nequi_token.updated`): se acusa recibo, no mueven dinero.
  if (!ev) return json(200, { received: true, result: "ignored" });
  const store = cfg.store;
  return run(
    store,
    `${ev.transactionId}:${ev.status}`.slice(0, 120),
    ev.type,
    rawBody,
    () => applyWompiTransaction(store, ev),
    "wompi-webhook",
  );
}

/** Avisos de la API de Pagos a Terceros (dispersión Bre-B a profesionales). */
export async function handleWompiPayoutWebhook(
  request: Request,
  cfg: { secret: string | undefined; store: PayoutWebhookStore | null },
): Promise<Response> {
  if (!cfg.secret || !cfg.store) return json(503, { error: "not_configured" });
  const rawBody = await request.text();
  const valid = await verifyWompiEvent({
    rawBody,
    headerChecksum: request.headers.get("x-event-checksum"),
    secret: cfg.secret,
  });
  if (!valid) return json(401, { error: "invalid_signature" });

  const ev = parseWompiPayoutEvent(rawBody);
  if (!ev || ev.status === "pending") return json(200, { received: true, result: "ignored" });
  const store = cfg.store;
  return run(
    store,
    `${ev.kind}:${ev.wompiId}:${ev.rawStatus}`.slice(0, 120),
    `${ev.kind}.updated`,
    rawBody,
    () => store.applyPayout(ev),
    "wompi-payouts-webhook",
  );
}

function eventLog(
  admin: import("@supabase/supabase-js").SupabaseClient,
  provider: "wompi" | "wompi_payouts",
): EventLog {
  return {
    async recordEvent(e) {
      const { error } = await admin.from("payment_webhook_events").insert({
        provider,
        external_event_id: e.id,
        event_type: e.type,
        signature_valid: true,
        payload_hash: e.payloadHash,
      });
      return !error;
    },
    async markEvent(id, processed, errorCode) {
      await admin
        .from("payment_webhook_events")
        .update({ processed, error_code: errorCode, processed_at: new Date().toISOString() })
        .eq("provider", provider)
        .eq("external_event_id", id);
    },
  };
}

/** Adaptador real con service role. */
export async function supabaseWebhookStore(
  admin: import("@supabase/supabase-js").SupabaseClient,
): Promise<WebhookStore> {
  const { supabaseApplyStore } = await import("./charges.server");
  return { ...eventLog(admin, "wompi"), ...supabaseApplyStore(admin) };
}

export function supabasePayoutWebhookStore(
  admin: import("@supabase/supabase-js").SupabaseClient,
): PayoutWebhookStore {
  return {
    ...eventLog(admin, "wompi_payouts"),
    async applyPayout(e) {
      const { data, error } = await admin.rpc("hx_payout_webhook", {
        p_provider_id: e.payoutId,
        p_reference: e.reference,
        p_status: e.status,
        p_error: e.reason,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
  };
}
