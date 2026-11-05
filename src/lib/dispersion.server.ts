// Despachador de la dispersión automática (servidor). Reclama un lote de pagos listos, los envía a Wompi (Pagos a
// Terceros, Bre-B) en paralelo y anota cada resultado en la base. Inyectable y probado (`dispersion.test.ts`). Las reglas
// puras están en `dispersion.ts`.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPayoutBody,
  classifyPayoutResponse,
  DISPATCH_BATCH_SIZE,
  DISPATCH_CONCURRENCY,
  mapLimit,
  type ClaimedPayout,
  type WompiPayoutBody,
  type PayoutOutcome,
} from "./dispersion";

export type DispatchTrigger = "auto" | "staff" | "cron";

export interface DispersionStore {
  claim(limit: number, trigger: DispatchTrigger, by: string | null): Promise<ClaimedPayout[]>;
  result(payoutId: string, outcome: PayoutOutcome): Promise<string>;
  finishBatch(batchId: string): Promise<void>;
}

export type WompiPayoutSend = (
  body: WompiPayoutBody,
  idempotencyKey: string,
) => Promise<{ httpStatus: number; json: unknown } | { networkError: string }>;

export interface DispersionDeps {
  enabled: boolean;
  store: DispersionStore;
  send: WompiPayoutSend | null;
  /** Cuenta de origen en Wompi (`GET /accounts`): WOMPI_PAYOUTS_ACCOUNT_ID. */
  accountId: string;
}

export interface DispatchSummary {
  ok: boolean;
  reason?: "disabled" | "not_configured";
  claimed: number;
  sent: number;
  paid: number;
  retry: number;
  failed: number;
  totalCop: number;
}

const empty = (reason?: DispatchSummary["reason"]): DispatchSummary => ({
  ok: !reason,
  ...(reason ? { reason } : {}),
  claimed: 0,
  sent: 0,
  paid: 0,
  retry: 0,
  failed: 0,
  totalCop: 0,
});

/** Un ciclo de dispersión: hasta `rounds` lotes seguidos mientras haya pagos listos. */
export async function runDispersion(
  deps: DispersionDeps,
  trigger: DispatchTrigger,
  by: string | null = null,
  rounds = 4,
): Promise<DispatchSummary> {
  if (!deps.enabled) return empty("disabled");
  if (!deps.send || !deps.accountId) return empty("not_configured");
  const send = deps.send;
  const sum = empty();
  for (let round = 0; round < rounds; round++) {
    const batch = await deps.store.claim(DISPATCH_BATCH_SIZE, trigger, by);
    if (batch.length === 0) break;
    sum.claimed += batch.length;
    let stop = false;
    await mapLimit(batch, DISPATCH_CONCURRENCY, async (p) => {
      let outcome: PayoutOutcome;
      const built = buildPayoutBody(p, deps.accountId);
      if (!built.ok) {
        outcome = { status: "failed", error: built.error };
      } else if (stop) {
        // Wompi dijo que la credencial no sirve o no hay saldo: no seguimos golpeando; el resto vuelve a la cola sin
        // haberse enviado (por eso puede repetir la misma llave de idempotencia).
        outcome = { status: "retry", error: "skipped_after_account_error" };
      } else {
        try {
          outcome = classifyPayoutResponse(await send(built.body, built.idempotencyKey));
        } catch (e) {
          outcome = { status: "retry", error: e instanceof Error ? e.message : "send_failed" };
        }
        if (
          outcome.status === "retry" &&
          /^wompi_(40[13]|insufficient_balance)/.test(outcome.error)
        )
          stop = true;
      }
      const final = await deps.store.result(p.id, outcome);
      if (final === "sent") sum.sent += 1;
      else if (final === "paid") sum.paid += 1;
      else if (final === "retry") sum.retry += 1;
      else if (final === "failed") sum.failed += 1;
      if (final === "sent" || final === "paid") sum.totalCop += Number(p.amount_cop) || 0;
    });
    await deps.store.finishBatch(batch[0].batch_id);
    if (stop || batch.length < DISPATCH_BATCH_SIZE) break;
  }
  return sum;
}

// ─── Adaptadores reales ──────────────────────────────────────────────────────

export function supabaseDispersionStore(admin: SupabaseClient): DispersionStore {
  return {
    async claim(limit, trigger, by) {
      const { data, error } = await admin.rpc("hx_claim_payouts", {
        p_limit: limit,
        p_trigger: trigger,
        p_by: by,
      });
      if (error) throw new Error(`hx_claim_payouts: ${error.message}`);
      return ((data ?? []) as ClaimedPayout[]).map((r) => ({
        ...r,
        amount_cop: Number(r.amount_cop),
        idem_gen: Number(r.idem_gen ?? 0),
      }));
    },
    async result(payoutId, outcome) {
      const { data, error } = await admin.rpc("hx_payout_result", {
        p_payout: payoutId,
        p_status: outcome.status,
        p_provider_id: outcome.providerId ?? null,
        p_error: "error" in outcome ? outcome.error : null,
        p_definitive: "definitive" in outcome ? !!outcome.definitive : false,
      });
      if (error) throw new Error(`hx_payout_result: ${error.message}`);
      return String(data);
    },
    async finishBatch(batchId) {
      await admin.rpc("hx_finish_batch", { p_batch: batchId });
    },
  };
}

/** `POST /v2/payouts` de la API de Pagos a Terceros de Wompi. */
export function wompiSendPayout(
  cfg: { apiKey: string; userPrincipalId: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): WompiPayoutSend {
  return async (body, idempotencyKey) => {
    try {
      const r = await fetchImpl(`${cfg.baseUrl}/payouts`, {
        method: "POST",
        headers: {
          "x-api-key": cfg.apiKey,
          "user-principal-id": cfg.userPrincipalId,
          "idempotency-key": idempotencyKey,
          "business-application-id": "WOMPI_PAYOUTS",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      let json: unknown = null;
      try {
        json = await r.json();
      } catch {
        json = null;
      }
      return { httpStatus: r.status, json };
    } catch (e) {
      return { networkError: e instanceof Error ? e.message : "fetch_failed" };
    }
  };
}

/** Dependencias reales desde el entorno del servidor. */
export async function dispersionDepsFromEnv(): Promise<DispersionDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { isDispersionEnabled, payoutsApiBase } = await import("./dispersion");
  const apiKey = process.env.WOMPI_PAYOUTS_API_KEY;
  const userPrincipalId = process.env.WOMPI_PAYOUTS_USER_ID;
  return {
    enabled: isDispersionEnabled(process.env),
    store: supabaseDispersionStore(supabaseAdmin as never),
    send:
      apiKey && userPrincipalId
        ? wompiSendPayout({ apiKey, userPrincipalId, baseUrl: payoutsApiBase(process.env) })
        : null,
    accountId: process.env.WOMPI_PAYOUTS_ACCOUNT_ID ?? "",
  };
}

/** Comparación en tiempo constante del secreto del despachador. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** `POST /api/public/wompi/dispatch` (lo llama la base con pg_net o el reloj). Solo con `Authorization: Bearer <secreto>`. */
export async function handleDispatchRequest(
  request: Request,
  cfg: { secret: string | undefined; deps: () => Promise<DispersionDeps> },
): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (!cfg.secret) return json(503, { error: "not_configured" });
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!sameSecret(token, cfg.secret)) return json(401, { error: "unauthorized" });
  let trigger: DispatchTrigger = "auto";
  try {
    const b = (await request.json()) as { trigger?: unknown };
    if (b?.trigger === "cron") trigger = "cron";
  } catch {
    /* cuerpo vacío: auto */
  }
  try {
    const summary = await runDispersion(await cfg.deps(), trigger);
    return json(200, summary);
  } catch (e) {
    console.error("[wompi-dispatch]", e instanceof Error ? e.message : e);
    return json(500, { error: "dispatch_failed" });
  }
}
