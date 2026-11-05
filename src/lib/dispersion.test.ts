import { describe, expect, it } from "vitest";
import { handleWompiPayoutWebhook, type PayoutWebhookStore } from "./wompiWebhook";
import {
  buildPayoutBody,
  classifyPayoutResponse,
  DISPATCH_BATCH_SIZE,
  isDispersionEnabled,
  keyFingerprint,
  mapLimit,
  parseWompiPayoutEvent,
  payoutsApiBase,
  wompiKey,
  type ClaimedPayout,
} from "./dispersion";
import {
  handleDispatchRequest,
  runDispersion,
  wompiSendPayout,
  type DispersionDeps,
  type DispersionStore,
  type WompiPayoutSend,
} from "./dispersion.server";

const ACCOUNT = "84a339e8-c277-45bd-b652-50f0b689edf7";

const P = (over: Partial<ClaimedPayout> = {}): ClaimedPayout => ({
  id: "33333333-3333-4333-8333-333333333333",
  professional_id: "22222222-2222-4222-8222-222222222222",
  booking_id: "11111111-1111-4111-8111-111111111111",
  amount_cop: 85_000,
  key_type: "phone",
  key_value: "3001234567",
  attempts: 0,
  batch_id: "44444444-4444-4444-8444-444444444444",
  idem_gen: 0,
  payee_name: "Laura Gómez",
  payee_email: "laura@example.com",
  ...over,
});

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("buildPayoutBody (Wompi POST /v2/payouts)", () => {
  it("un lote de una transacción a la llave Bre-B, en centavos, con el id del pago como referencia", () => {
    const r = buildPayoutBody(P(), ACCOUNT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toEqual({
      reference: r.idempotencyKey,
      accountId: ACCOUNT,
      paymentType: "PROVIDERS",
      transactions: [
        {
          key: "3001234567",
          amount: 8_500_000,
          name: "Laura Gómez",
          email: "laura@example.com",
          reference: P().id,
          description: "Pago Humanix por turno de cuidado",
        },
      ],
    });
    // Wompi: solo letras, números y guiones, máx. 64; la referencia empieza con el id del pago.
    expect(r.idempotencyKey).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    expect(r.idempotencyKey.startsWith(P().id)).toBe(true);
  });
  it("la llave de idempotencia no cambia entre reintentos; cambia con la llave Bre-B o con idem_gen", () => {
    const a = buildPayoutBody(P({ attempts: 0 }), ACCOUNT);
    const b = buildPayoutBody(P({ attempts: 3 }), ACCOUNT);
    const c = buildPayoutBody(P({ key_value: "3009999999" }), ACCOUNT);
    const d = buildPayoutBody(P({ idem_gen: 1 }), ACCOUNT);
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error("bad");
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(c.idempotencyKey);
    expect(a.idempotencyKey).not.toBe(d.idempotencyKey);
    expect(keyFingerprint("phone", "1")).toBe(keyFingerprint("phone", "1"));
  });
  it("normaliza la llave como la espera Wompi", () => {
    expect(wompiKey("alias", "laura.enf")).toBe("@laura.enf");
    expect(wompiKey("alias", "@laura")).toBe("@laura");
    expect(wompiKey("email", " Laura@Mail.com ")).toBe("laura@mail.com");
    expect(wompiKey("document", "1.085.123")).toBe("1085123");
  });
  it("sin llave, sin beneficiario, sin cuenta o con monto inválido no se envía", () => {
    expect(buildPayoutBody(P({ key_value: null }), ACCOUNT)).toEqual({
      ok: false,
      error: "missing_key",
    });
    expect(buildPayoutBody(P({ key_type: "otra" }), ACCOUNT)).toEqual({
      ok: false,
      error: "missing_key",
    });
    expect(buildPayoutBody(P({ payee_email: null }), ACCOUNT)).toEqual({
      ok: false,
      error: "missing_payee",
    });
    expect(buildPayoutBody(P(), "")).toEqual({ ok: false, error: "not_configured" });
    expect(buildPayoutBody(P({ amount_cop: 0 }), ACCOUNT)).toEqual({
      ok: false,
      error: "amount_out_of_range",
    });
  });
});

describe("classifyPayoutResponse", () => {
  it("201 aceptado; 201 con la transacción rechazada en validación = fallo", () => {
    expect(
      classifyPayoutResponse({
        httpStatus: 201,
        json: {
          status: 201,
          code: "OK",
          data: { payoutId: "po_1", transactions: 1, success: 1, failed: 0 },
        },
      }),
    ).toEqual({ status: "sent", providerId: "po_1" });
    expect(
      classifyPayoutResponse({
        httpStatus: 201,
        json: { data: { payoutId: "po_1", transactions: 1, success: 0, failed: 1 } },
      }),
    ).toEqual({
      status: "failed",
      providerId: "po_1",
      error: "wompi_rejected_transaction",
      definitive: true,
    });
  });
  it("400 es fallo; red/5xx reintenta con la misma llave; 401/403/429/sin saldo reintenta con otra", () => {
    expect(
      classifyPayoutResponse({
        httpStatus: 400,
        json: { code: "400", message: ["key must be a string"] },
      }),
    ).toMatchObject({ status: "failed", definitive: true });
    for (const s of [408, 500, 503]) {
      const o = classifyPayoutResponse({ httpStatus: s, json: null });
      expect(o.status).toBe("retry");
      expect("definitive" in o && o.definitive).toBeFalsy();
    }
    for (const s of [401, 403, 429])
      expect(classifyPayoutResponse({ httpStatus: s, json: null })).toMatchObject({
        status: "retry",
        definitive: true,
      });
    expect(
      classifyPayoutResponse({
        httpStatus: 400,
        json: { code: "EXC_008", message: "Saldo insuficiente" },
      }),
    ).toMatchObject({ status: "retry", definitive: true });
    expect(classifyPayoutResponse({ networkError: "ECONNRESET" }).status).toBe("retry");
  });
  it("409 EXC_032 = Wompi ya tiene ese pago: esperamos su aviso", () => {
    expect(
      classifyPayoutResponse({
        httpStatus: 409,
        json: {
          status: 409,
          code: "EXC_032",
          message: "La llave de idempotencia ya fue procesada.",
        },
      }),
    ).toEqual({ status: "sent" });
  });
});

describe("parseWompiPayoutEvent", () => {
  it("transaction.updated: APPROVED cierra, FAILED/REJECTED fallan, PROCESSING espera", () => {
    const tx = (status: string, extra: object = {}) =>
      JSON.stringify({
        event: "transaction.updated",
        data: {
          transaction: { id: "t1", payoutId: "po_1", amountInCents: 150000, status, ...extra },
        },
        signature: { properties: [], checksum: "" },
        timestamp: 1,
      });
    expect(parseWompiPayoutEvent(tx("APPROVED"))).toEqual({
      kind: "transaction",
      wompiId: "t1",
      payoutId: "po_1",
      reference: null,
      status: "paid",
      rawStatus: "APPROVED",
      reason: null,
    });
    expect(
      parseWompiPayoutEvent(
        tx("FAILED", { failureReason: { code: "C01", message: "La cuenta no existe" } }),
      )?.reason,
    ).toBe("C01 La cuenta no existe");
    expect(parseWompiPayoutEvent(tx("REJECTED"))?.status).toBe("failed");
    expect(parseWompiPayoutEvent(tx("PROCESSING"))?.status).toBe("pending");
  });
  it("payout.updated: TOTAL_PAYMENT cierra; REJECTED (sin saldo) vuelve a la cola", () => {
    const po = (status: string) =>
      JSON.stringify({
        event: "payout.updated",
        data: { payout: { id: "po_1", reference: "abc-1", status, amountInCents: 1 } },
      });
    expect(parseWompiPayoutEvent(po("TOTAL_PAYMENT"))).toMatchObject({
      kind: "payout",
      payoutId: "po_1",
      reference: "abc-1",
      status: "paid",
    });
    expect(parseWompiPayoutEvent(po("REJECTED"))?.status).toBe("retry");
    expect(parseWompiPayoutEvent(po("RARO"))).toBeNull();
    expect(parseWompiPayoutEvent("no json")).toBeNull();
  });
});

describe("flag y utilidades", () => {
  it("WOMPI_PAYOUTS_ENABLED y ambiente", () => {
    expect(isDispersionEnabled({})).toBe(false);
    expect(isDispersionEnabled({ WOMPI_PAYOUTS_ENABLED: "true" })).toBe(true);
    expect(isDispersionEnabled({ WOMPI_PAYOUTS_ENABLED: "no" })).toBe(false);
    expect(payoutsApiBase({})).toBe("https://api.payouts.wompi.co/v2");
    expect(payoutsApiBase({ WOMPI_PAYOUTS_ENV: "sandbox" })).toBe(
      "https://api.sandbox.payouts.wompi.co/v2",
    );
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
  it("wompiSendPayout manda los encabezados de Wompi", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return new Response(JSON.stringify({ data: { payoutId: "po_1", success: 1, failed: 0 } }), {
        status: 201,
      });
    }) as unknown as typeof fetch;
    const send = wompiSendPayout(
      { apiKey: "k", userPrincipalId: "u", baseUrl: "https://api.sandbox.payouts.wompi.co/v2" },
      fake,
    );
    const built = buildPayoutBody(P(), ACCOUNT);
    if (!built.ok) throw new Error("bad");
    const r = await send(built.body, built.idempotencyKey);
    expect(r).toMatchObject({ httpStatus: 201 });
    expect(seen!.url).toBe("https://api.sandbox.payouts.wompi.co/v2/payouts");
    expect(seen!.headers).toMatchObject({
      "x-api-key": "k",
      "user-principal-id": "u",
      "idempotency-key": built.idempotencyKey,
    });
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

const deps = (
  store: DispersionStore,
  send: WompiPayoutSend | null,
  enabled = true,
): DispersionDeps => ({
  enabled,
  store,
  send,
  accountId: ACCOUNT,
});

describe("runDispersion", () => {
  it("apagada o sin llave de Wompi no envía nada", async () => {
    const { store } = fakeStore([[P()]]);
    expect((await runDispersion(deps(store, null, false), "auto")).reason).toBe("disabled");
    expect((await runDispersion(deps(store, null), "auto")).reason).toBe("not_configured");
    expect(
      (
        await runDispersion(
          { ...deps(store, async () => ({ networkError: "x" })), accountId: "" },
          "auto",
        )
      ).reason,
    ).toBe("not_configured");
  });

  it("envía el lote en paralelo y anota cada resultado", async () => {
    const batch = [P({ id: "a" }), P({ id: "b", key_value: null }), P({ id: "c" }), P({ id: "d" })];
    const { store, results, finished } = fakeStore([batch]);
    const sent: string[] = [];
    const send: WompiPayoutSend = async (body, key) => {
      sent.push(key);
      const ref = body.transactions[0].reference;
      if (ref === "c") return { httpStatus: 503, json: null };
      if (ref === "d") return { httpStatus: 409, json: { code: "EXC_032" } };
      return { httpStatus: 201, json: { data: { payoutId: `po_${ref}`, success: 1, failed: 0 } } };
    };
    const s = await runDispersion(deps(store, send), "auto");
    expect(sent).toHaveLength(3); // «b» no tiene llave: no se envía
    expect(Object.fromEntries(results.map((r) => [r.id, r.status]))).toEqual({
      a: "sent",
      b: "failed",
      c: "retry",
      d: "sent",
    });
    expect(s).toMatchObject({ claimed: 4, sent: 2, retry: 1, failed: 1, totalCop: 170_000 });
    expect(finished).toEqual([P().batch_id]);
  });

  it("si la credencial no sirve o no hay saldo, no sigue enviando el resto", async () => {
    for (const reply of [
      { httpStatus: 401, json: null },
      { httpStatus: 400, json: { code: "EXC_008" } },
    ]) {
      const batch = Array.from({ length: 8 }, (_, i) => P({ id: `p${i}` }));
      const { store, results } = fakeStore([batch]);
      let calls = 0;
      const send: WompiPayoutSend = async () => {
        calls++;
        return reply;
      };
      await runDispersion(deps(store, send), "staff");
      expect(calls).toBeLessThan(8);
      expect(results.every((r) => r.status === "retry")).toBe(true);
    }
  });

  it("sigue con otro lote cuando el primero venía lleno", async () => {
    const full = Array.from({ length: DISPATCH_BATCH_SIZE }, (_, i) => P({ id: `f${i}` }));
    const { store } = fakeStore([full, [P({ id: "last" })]]);
    const send: WompiPayoutSend = async (b) => ({
      httpStatus: 201,
      json: { data: { payoutId: b.reference, success: 1, failed: 0 } },
    });
    const s = await runDispersion(deps(store, send), "cron");
    expect(s.claimed).toBe(DISPATCH_BATCH_SIZE + 1);
  });

  it("un error inesperado al enviar se reintenta", async () => {
    const { store, results } = fakeStore([[P()]]);
    await runDispersion(
      deps(store, async () => Promise.reject(new Error("boom"))),
      "auto",
    );
    expect(results[0]).toMatchObject({ status: "retry", error: "boom" });
  });
});

describe("handleDispatchRequest", () => {
  const d = async (): Promise<DispersionDeps> => deps(fakeStore([]).store, null, false);
  const req = (auth?: string) =>
    new Request("https://humanix.lat/api/public/wompi/dispatch", {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
      body: "{}",
    });
  it("exige el secreto", async () => {
    expect((await handleDispatchRequest(req(), { secret: undefined, deps: d })).status).toBe(503);
    expect(
      (await handleDispatchRequest(req("Bearer malo"), { secret: "s3cr3t", deps: d })).status,
    ).toBe(401);
    const ok = await handleDispatchRequest(req("Bearer s3cr3t"), { secret: "s3cr3t", deps: d });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ reason: "disabled" });
  });
});

describe("webhook de Pagos a Terceros", () => {
  const SECRET = "test_events_payouts";
  async function signed(payload: Record<string, unknown>, props: string[], values: string[]) {
    const timestamp = 1781056530000;
    const checksum = await sha256Hex(`${values.join("")}${timestamp}${SECRET}`);
    return JSON.stringify({ ...payload, signature: { properties: props, checksum }, timestamp });
  }
  const store = (calls: unknown[]): PayoutWebhookStore => ({
    recordEvent: async () => true,
    markEvent: async () => undefined,
    applyPayout: async (e) => {
      calls.push(e);
      return e.status;
    },
  });
  const post = (body: string, checksum?: string) =>
    new Request("https://humanix.lat/api/public/wompi/payouts-webhook", {
      method: "POST",
      headers: checksum ? { "X-Event-Checksum": checksum } : {},
      body,
    });

  it("transaction.updated APPROVED cierra el pago", async () => {
    const calls: unknown[] = [];
    const body = await signed(
      {
        event: "transaction.updated",
        data: {
          transaction: { id: "t1", payoutId: "po_1", amountInCents: 150000, status: "APPROVED" },
        },
      },
      ["transaction.id", "transaction.status", "transaction.amountInCents"],
      ["t1", "APPROVED", "150000"],
    );
    const r = await handleWompiPayoutWebhook(post(body), { secret: SECRET, store: store(calls) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ result: "paid" });
    expect(calls).toMatchObject([{ payoutId: "po_1", status: "paid" }]);
  });

  it("firma inválida → 401; PROCESSING se ignora", async () => {
    const calls: unknown[] = [];
    const body = await signed(
      {
        event: "transaction.updated",
        data: {
          transaction: { id: "t1", payoutId: "po_1", amountInCents: 1, status: "PROCESSING" },
        },
      },
      ["transaction.id", "transaction.status", "transaction.amountInCents"],
      ["t1", "PROCESSING", "1"],
    );
    expect(
      (await handleWompiPayoutWebhook(post(body), { secret: "otro", store: store(calls) })).status,
    ).toBe(401);
    const ok = await handleWompiPayoutWebhook(post(body), { secret: SECRET, store: store(calls) });
    expect(await ok.json()).toMatchObject({ result: "ignored" });
    expect(calls).toHaveLength(0);
  });
});
