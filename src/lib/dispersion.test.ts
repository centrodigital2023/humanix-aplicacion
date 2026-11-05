import { describe, expect, it } from "vitest";
import { firuxSignatureFor } from "./firux";
import { handleFiruxWebhook, type WebhookStore } from "./firuxWebhook";
import {
  buildPayoutBody,
  classifyPayoutResponse,
  DISPATCH_BATCH_SIZE,
  isDispersionEnabled,
  keyFingerprint,
  mapLimit,
  parsePayoutEvent,
  type ClaimedPayout,
} from "./dispersion";
import {
  handleDispatchRequest,
  runDispersion,
  type DispersionDeps,
  type DispersionStore,
  type FiruxPayoutSend,
} from "./dispersion.server";

const P = (over: Partial<ClaimedPayout> = {}): ClaimedPayout => ({
  id: "33333333-3333-4333-8333-333333333333",
  professional_id: "22222222-2222-4222-8222-222222222222",
  booking_id: "11111111-1111-4111-8111-111111111111",
  amount_cop: 85_000,
  key_type: "phone",
  key_value: "3001234567",
  attempts: 0,
  batch_id: "44444444-4444-4444-8444-444444444444",
  ...over,
});

describe("buildPayoutBody", () => {
  it("arma el pago a la llave Bre-B con el id del pago como referencia", () => {
    const r = buildPayoutBody(P());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({
      amount: 85_000,
      currency: "COP",
      external_reference: P().id,
      destination: { type: "breb_key", key_type: "phone", key: "3001234567" },
    });
  });
  it("la Idempotency-Key no cambia entre reintentos, solo si cambia la llave", () => {
    const a = buildPayoutBody(P({ attempts: 0 }));
    const b = buildPayoutBody(P({ attempts: 3 }));
    const c = buildPayoutBody(P({ key_value: "3009999999" }));
    if (!a.ok || !b.ok || !c.ok) throw new Error("bad");
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey);
    expect(keyFingerprint("phone", "1")).toBe(keyFingerprint("phone", "1"));
  });
  it("sin llave o con monto inválido no se envía", () => {
    expect(buildPayoutBody(P({ key_value: null }))).toEqual({ ok: false, error: "missing_key" });
    expect(buildPayoutBody(P({ key_type: "otra" }))).toEqual({ ok: false, error: "missing_key" });
    expect(buildPayoutBody(P({ amount_cop: 0 }))).toEqual({
      ok: false,
      error: "amount_out_of_range",
    });
  });
});

describe("classifyPayoutResponse", () => {
  it("aceptado, pagado y rechazado", () => {
    expect(
      classifyPayoutResponse({ httpStatus: 201, json: { id: "po_1", status: "pending" } }),
    ).toEqual({
      status: "sent",
      firuxId: "po_1",
    });
    expect(
      classifyPayoutResponse({ httpStatus: 200, json: { id: "po_1", status: "paid" } }),
    ).toEqual({
      status: "paid",
      firuxId: "po_1",
    });
    expect(
      classifyPayoutResponse({
        httpStatus: 200,
        json: { id: "po_1", status: "failed", failure_reason: "key_not_found" },
      }),
    ).toEqual({ status: "failed", firuxId: "po_1", error: "key_not_found" });
  });
  it("llave inválida (4xx) es fallo; red, 5xx, 429 y credencial mala se reintentan", () => {
    expect(
      classifyPayoutResponse({ httpStatus: 422, json: { error: { message: "invalid key" } } })
        .status,
    ).toBe("failed");
    for (const s of [401, 403, 408, 429, 500, 503])
      expect(classifyPayoutResponse({ httpStatus: s, json: null }).status).toBe("retry");
    expect(classifyPayoutResponse({ networkError: "ECONNRESET" }).status).toBe("retry");
    expect(classifyPayoutResponse({ httpStatus: 200, json: {} }).status).toBe("retry");
  });
  it("409 con id = ya lo tiene Firux", () => {
    expect(classifyPayoutResponse({ httpStatus: 409, json: { id: "po_9" } })).toEqual({
      status: "sent",
      firuxId: "po_9",
    });
  });
});

describe("parsePayoutEvent", () => {
  it("lee payout.paid / payout.failed e ignora cobros", () => {
    expect(
      parsePayoutEvent(
        JSON.stringify({ type: "payout.paid", data: { id: "po_1", external_reference: "x" } }),
      ),
    ).toEqual({ type: "payout.paid", payoutId: "po_1", reference: "x", reason: null });
    expect(
      parsePayoutEvent(
        JSON.stringify({ type: "payout.failed", data: { id: "po_1", failure_reason: "closed" } }),
      )?.reason,
    ).toBe("closed");
    expect(
      parsePayoutEvent(JSON.stringify({ type: "charge.paid", data: { id: "ch_1" } })),
    ).toBeNull();
    expect(parsePayoutEvent("no json")).toBeNull();
  });
});

describe("flag y utilidades", () => {
  it("FIRUX_PAYOUTS_ENABLED", () => {
    expect(isDispersionEnabled({})).toBe(false);
    expect(isDispersionEnabled({ FIRUX_PAYOUTS_ENABLED: "true" })).toBe(true);
    expect(isDispersionEnabled({ FIRUX_PAYOUTS_ENABLED: "no" })).toBe(false);
  });
  it("mapLimit respeta el límite y el orden", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

function fakeStore(batches: ClaimedPayout[][]) {
  const results: Array<{ id: string; status: string; error?: string }> = [];
  const finished: string[] = [];
  const store: DispersionStore = {
    claim: async () => batches.shift() ?? [],
    result: async (id, o) => {
      results.push({ id, status: o.status, ...("error" in o ? { error: o.error } : {}) });
      return o.status;
    },
    finishBatch: async (b) => {
      finished.push(b);
    },
  };
  return { store, results, finished };
}

describe("runDispersion", () => {
  it("apagada o sin llave de Firux no envía nada", async () => {
    const { store } = fakeStore([[P()]]);
    expect((await runDispersion({ enabled: false, store, send: null }, "auto")).reason).toBe(
      "disabled",
    );
    expect((await runDispersion({ enabled: true, store, send: null }, "auto")).reason).toBe(
      "not_configured",
    );
  });

  it("envía el lote en paralelo y anota cada resultado", async () => {
    const batch = [P({ id: "a" }), P({ id: "b", key_value: null }), P({ id: "c" }), P({ id: "d" })];
    const { store, results, finished } = fakeStore([batch]);
    const sent: string[] = [];
    const send: FiruxPayoutSend = async (body, key) => {
      sent.push(key);
      if (body.external_reference === "c") return { httpStatus: 503, json: null };
      if (body.external_reference === "d")
        return { httpStatus: 200, json: { id: "po_d", status: "paid" } };
      return { httpStatus: 201, json: { id: `po_${body.external_reference}` } };
    };
    const s = await runDispersion({ enabled: true, store, send }, "auto");
    expect(sent).toHaveLength(3); // «b» no tiene llave: no se envía
    expect(Object.fromEntries(results.map((r) => [r.id, r.status]))).toEqual({
      a: "sent",
      b: "failed",
      c: "retry",
      d: "paid",
    });
    expect(s).toMatchObject({
      claimed: 4,
      sent: 1,
      paid: 1,
      retry: 1,
      failed: 1,
      totalCop: 170_000,
    });
    expect(finished).toEqual([P().batch_id]);
  });

  it("si la credencial de Firux no sirve, no sigue enviando el resto", async () => {
    const batch = Array.from({ length: 8 }, (_, i) => P({ id: `p${i}` }));
    const { store, results } = fakeStore([batch]);
    let calls = 0;
    const send: FiruxPayoutSend = async () => {
      calls++;
      return { httpStatus: 401, json: null };
    };
    const deps: DispersionDeps = { enabled: true, store, send };
    await runDispersion(deps, "staff");
    expect(calls).toBeLessThan(8);
    expect(results.every((r) => r.status === "retry")).toBe(true);
  });

  it("sigue con otro lote cuando el primero venía lleno", async () => {
    const full = Array.from({ length: DISPATCH_BATCH_SIZE }, (_, i) => P({ id: `f${i}` }));
    const { store } = fakeStore([full, [P({ id: "last" })]]);
    const send: FiruxPayoutSend = async (b) => ({
      httpStatus: 201,
      json: { id: b.external_reference },
    });
    const s = await runDispersion({ enabled: true, store, send }, "cron");
    expect(s.claimed).toBe(DISPATCH_BATCH_SIZE + 1);
  });

  it("un error inesperado al enviar se reintenta", async () => {
    const { store, results } = fakeStore([[P()]]);
    await runDispersion(
      { enabled: true, store, send: async () => Promise.reject(new Error("boom")) },
      "auto",
    );
    expect(results[0]).toMatchObject({ status: "retry", error: "boom" });
  });
});

describe("handleDispatchRequest", () => {
  const deps = async (): Promise<DispersionDeps> => ({
    enabled: false,
    store: fakeStore([]).store,
    send: null,
  });
  const req = (auth?: string) =>
    new Request("https://humanix.lat/api/public/firux/dispatch", {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
      body: "{}",
    });
  it("exige el secreto", async () => {
    expect((await handleDispatchRequest(req(), { secret: undefined, deps })).status).toBe(503);
    expect(
      (await handleDispatchRequest(req("Bearer malo"), { secret: "s3cr3t", deps })).status,
    ).toBe(401);
    const ok = await handleDispatchRequest(req("Bearer s3cr3t"), { secret: "s3cr3t", deps });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ reason: "disabled" });
  });
});

describe("webhook de dispersión", () => {
  const SECRET = "whsec_test";
  const TS = 1_793_000_000;
  it("payout.paid cierra el pago y no toca cobros", async () => {
    const calls: unknown[] = [];
    const store: WebhookStore = {
      recordEvent: async () => true,
      markEvent: async () => undefined,
      applyPaid: async () => {
        throw new Error("no debe llamarse");
      },
      markCharge: async () => undefined,
      applyPayout: async (e) => {
        calls.push(e);
        return "paid";
      },
    };
    const body = JSON.stringify({
      id: "evt_1",
      type: "payout.paid",
      data: { id: "po_1", external_reference: "x" },
    });
    const sig = `v1=${await firuxSignatureFor(SECRET, String(TS), body)}`;
    const r = await handleFiruxWebhook(
      new Request("https://humanix.lat/api/public/firux/webhook", {
        method: "POST",
        headers: { "Firux-Timestamp": String(TS), "Firux-Signature": sig },
        body,
      }),
      { secret: SECRET, store, nowSeconds: () => TS },
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ result: "paid" });
    expect(calls).toEqual([{ payoutId: "po_1", reference: "x", status: "paid", reason: null }]);
  });
});
