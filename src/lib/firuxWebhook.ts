// Aviso de pago de Firux (ruta pública `/api/public/firux/webhook`). Probado en `firuxCharges.test.ts`.
//
//   1. Sin firma válida (HMAC-SHA256 de `${Firux-Timestamp}.${cuerpo}`, 5 minutos) → 401 y no se toca nada.
//   2. Se anota el aviso en `payment_webhook_events` (proveedor `firux`): queda la traza aunque llegue repetido.
//   3. `charge.paid` → `hx_firux_charge_paid` aplica el pago en una sola transacción (turno pagado, recarga o plan) y es
//      idempotente: un aviso repetido devuelve `already_applied` y no suma dos veces.
//   4. `charge.expired` / `charge.failed` → el cobro pendiente se marca así para que la pantalla ofrezca otro QR.
import { parseFiruxEvent, verifyFiruxSignature } from "./firux";

export interface WebhookStore {
  /** Anota el aviso; devuelve falso si ya estaba (mismo proveedor e id). */
  recordEvent(e: {
    id: string;
    type: string;
    signatureValid: boolean;
    payloadHash: string;
  }): Promise<boolean>;
  markEvent(id: string, processed: boolean, errorCode: string | null): Promise<void>;
  applyPaid(firuxId: string, amountPaid: number): Promise<string>;
  markCharge(firuxId: string, status: "expired" | "failed"): Promise<void>;
}

export interface WebhookConfig {
  secret: string | undefined;
  store: WebhookStore | null;
  nowSeconds: () => number;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handleFiruxWebhook(request: Request, cfg: WebhookConfig): Promise<Response> {
  if (!cfg.secret || !cfg.store) return json(503, { error: "not_configured" });
  const rawBody = await request.text();
  const valid = await verifyFiruxSignature({
    rawBody,
    timestamp: request.headers.get("firux-timestamp"),
    signature: request.headers.get("firux-signature"),
    secret: cfg.secret,
    nowSeconds: cfg.nowSeconds(),
  });
  if (!valid) return json(401, { error: "invalid_signature" });

  const event = parseFiruxEvent(rawBody);
  if (!event) {
    // Eventos firmados sin cobro (`webhook.test` del botón «Enviar prueba», `payment.notified` del Verificador):
    // se acusa recibo para que Firux no reintente; no mueven dinero aquí.
    return json(200, { received: true, result: "ignored" });
  }

  let bodyId: unknown = null;
  try {
    bodyId = (JSON.parse(rawBody) as { id?: unknown }).id;
  } catch {
    /* ya validado por parseFiruxEvent */
  }
  const eventId = String(
    request.headers.get("firux-event-id") ?? bodyId ?? `${event.type}:${event.chargeId}`,
  ).slice(0, 120);
  const store = cfg.store;
  await store.recordEvent({
    id: eventId,
    type: event.type,
    signatureValid: true,
    payloadHash: await sha256Hex(rawBody),
  });

  try {
    let result = "ignored";
    if (event.type === "charge.paid") {
      result = await store.applyPaid(event.chargeId, event.amountPaid);
    } else if (event.type === "charge.expired" || event.type === "charge.failed") {
      await store.markCharge(
        event.chargeId,
        event.type === "charge.expired" ? "expired" : "failed",
      );
      result = "marked";
    }
    const errorCode = result === "unknown_charge" || result === "underpaid" ? result : null;
    await store.markEvent(eventId, errorCode === null, errorCode);
    return json(200, { received: true, result });
  } catch (e) {
    await store.markEvent(eventId, false, "apply_failed").catch(() => undefined);
    // 500 → Firux reintenta; la función de la base es idempotente.
    console.error("[firux-webhook]", e instanceof Error ? e.message : e);
    return json(500, { error: "apply_failed" });
  }
}

/** Adaptador real con service role (REST de Supabase). */
export function supabaseWebhookStore(
  admin: import("@supabase/supabase-js").SupabaseClient,
): WebhookStore {
  return {
    async recordEvent(e) {
      const { error } = await admin.from("payment_webhook_events").insert({
        provider: "firux",
        external_event_id: e.id,
        event_type: e.type,
        signature_valid: e.signatureValid,
        payload_hash: e.payloadHash,
      });
      return !error;
    },
    async markEvent(id, processed, errorCode) {
      await admin
        .from("payment_webhook_events")
        .update({ processed, error_code: errorCode, processed_at: new Date().toISOString() })
        .eq("provider", "firux")
        .eq("external_event_id", id);
    },
    async applyPaid(firuxId, amountPaid) {
      const { data, error } = await admin.rpc("hx_firux_charge_paid", {
        p_firux_id: firuxId,
        p_amount_paid: amountPaid,
      });
      if (error) throw new Error(error.message);
      return String(data);
    },
    async markCharge(firuxId, status) {
      await admin
        .from("firux_charges")
        .update({ status })
        .eq("firux_id", firuxId)
        .eq("status", "pending");
    },
  };
}
