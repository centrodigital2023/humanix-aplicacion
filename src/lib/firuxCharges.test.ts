import { describe, expect, it } from "vitest";
import { firuxSignatureFor } from "./firux";
import { FIRUX_CONNECT_TERMS_VERSION } from "./firuxConnect";
import {
  chargeBooking,
  chargeInstitutionPlan,
  chargeTopup,
  type BookingForCharge,
  type ChargeDeps,
  type ChargeRow,
  type ChargeStore,
} from "./firuxCharges.server";
import { handleFiruxWebhook, type WebhookStore } from "./firuxWebhook";

const FAM = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-03T15:00:00Z");

function world(over: Partial<BookingForCharge> = {}) {
  const booking: BookingForCharge = {
    id: "b0000000-0000-4000-8000-000000000001",
    client_id: FAM,
    status: "confirmed",
    payment_method: "DIGITAL_BREB",
    total_amount: 120_000,
    paid_at: null,
    ...over,
  };
  const charges: ChargeRow[] = [];
  const calls: Array<{ body: unknown; key: string }> = [];
  let n = 0;
  const store: ChargeStore = {
    booking: async (id) => (id === booking.id ? booking : null),
    hasRole: async (u, r) => (u === PRO && r === "professional") || (u === FAM && r === "family"),
    openCharge: async (q) =>
      charges.find(
        (c) =>
          c.kind === q.kind &&
          c.user_id === q.userId &&
          c.booking_id === q.bookingId &&
          c.status === "pending" &&
          c.amount_cop === q.amountCop &&
          c.firux_id,
      ) ?? null,
    chargeByFiruxId: async (id) => charges.find((c) => c.firux_id === id) ?? null,
    insertCharge: async (row) => {
      const c: ChargeRow = {
        id: `c${++n}`,
        firux_id: null,
        status: "pending",
        qr_emv: null,
        payment_url: null,
        expires_at: null,
        ...row,
      };
      charges.push(c);
      return c;
    },
    updateCharge: async (id, patch) => {
      Object.assign(
        charges.find((c) => c.id === id)!,
        patch,
      );
    },
  };
  const deps: ChargeDeps = {
    store,
    now: () => NOW,
    firux: async (body, key) => {
      calls.push({ body, key });
      return {
        id: `fx_${key}`,
        status: "PENDING",
        amount: body.amount,
        qr_emv: "000201010212...",
        payment_url: "https://pay.firux.co/c/1",
        expires_at: new Date(NOW + 15 * 60_000).toISOString(),
      };
    },
  };
  return { deps, charges, calls, booking };
}

describe("cobro del turno (familia)", () => {
  it("genera el QR con el monto de la base y el turno como referencia", async () => {
    const w = world();
    const r = await chargeBooking(w.deps, FAM, w.booking.id);
    expect(r).toMatchObject({
      ok: true,
      charge: {
        amountCop: 120_000,
        qrEmv: "000201010212...",
        paymentUrl: "https://pay.firux.co/c/1",
      },
    });
    expect(w.calls[0]).toEqual({
      body: {
        amount: 120_000,
        external_reference: w.booking.id,
        description: "Turno de cuidado Humanix",
        expires_at: "2026-11-04T15:00:00Z",
      },
      key: "c1",
    });
    expect(w.charges[0]).toMatchObject({
      kind: "booking",
      firux_id: "fx_c1",
      booking_id: w.booking.id,
    });
  });
  it("si ya hay un QR vigente, lo reutiliza (no cobra dos veces)", async () => {
    const w = world();
    await chargeBooking(w.deps, FAM, w.booking.id);
    const again = await chargeBooking(w.deps, FAM, w.booking.id);
    expect(again).toMatchObject({ ok: true, charge: { chargeId: "c1" } });
    expect(w.calls).toHaveLength(1);
  });
  it("un QR vencido se marca y se genera otro", async () => {
    const w = world();
    await chargeBooking(w.deps, FAM, w.booking.id);
    w.charges[0].expires_at = new Date(NOW - 60_000).toISOString();
    const r = await chargeBooking(w.deps, FAM, w.booking.id);
    expect(r).toMatchObject({ ok: true, charge: { chargeId: "c2" } });
    expect(w.charges[0].status).toBe("expired");
  });
  it("si Firux devuelve el mismo cobro pendiente (misma referencia), se usa ese y no choca", async () => {
    const w = world();
    await chargeBooking(w.deps, FAM, w.booking.id);
    w.charges[0].expires_at = new Date(NOW - 60_000).toISOString();
    w.deps.firux = async () => ({
      id: "fx_c1",
      status: "PENDING",
      amount: 120_000,
      qr_emv: "qr",
      payment_url: null,
    });
    const r = await chargeBooking(w.deps, FAM, w.booking.id);
    expect(r).toMatchObject({ ok: true, charge: { chargeId: "c1", status: "pending" } });
    expect(w.charges[1].status).toBe("failed");
  });
  it("409 de Firux en un turno: ya está pagado", async () => {
    const w = world();
    w.deps.firux = async () => {
      throw new Error("firux_409");
    };
    expect(await chargeBooking(w.deps, FAM, w.booking.id)).toEqual({
      ok: false,
      code: "already_paid",
    });
  });
  it("reglas: solo quien reservó, confirmado, digital y sin pagar", async () => {
    expect(await chargeBooking(world().deps, PRO, world().booking.id)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(await chargeBooking(world().deps, FAM, "otro")).toEqual({
      ok: false,
      code: "not_found",
    });
    const p = world({ status: "pending" });
    expect(await chargeBooking(p.deps, FAM, p.booking.id)).toEqual({
      ok: false,
      code: "not_payable",
    });
    const c = world({ payment_method: "CASH" });
    expect(await chargeBooking(c.deps, FAM, c.booking.id)).toEqual({
      ok: false,
      code: "cash_booking",
    });
    const d = world({ paid_at: "2026-11-03T10:00:00Z" });
    expect(await chargeBooking(d.deps, FAM, d.booking.id)).toEqual({
      ok: false,
      code: "already_paid",
    });
  });
  it("sin llave de Firux o si Firux falla: mensaje claro y el cobro queda fallido", async () => {
    const w = world();
    expect(await chargeBooking({ ...w.deps, firux: null }, FAM, w.booking.id)).toEqual({
      ok: false,
      code: "not_configured",
    });
    const f = world();
    f.deps.firux = async () => {
      throw new Error("firux_500");
    };
    expect(await chargeBooking(f.deps, FAM, f.booking.id)).toEqual({
      ok: false,
      code: "provider_error",
    });
    expect(f.charges[0].status).toBe("failed");
  });
});

describe("recarga y plan", () => {
  it("solo el profesional recarga, con referencia propia", async () => {
    const w = world();
    expect(await chargeTopup(w.deps, FAM, 20_000)).toEqual({ ok: false, code: "forbidden" });
    const r = await chargeTopup(w.deps, PRO, 20_000);
    expect(r).toMatchObject({ ok: true, charge: { amountCop: 20_000 } });
    expect(w.calls[0].body).toMatchObject({ external_reference: "c1", amount: 20_000 });
    expect(await chargeTopup(w.deps, PRO, 1_000)).toEqual({
      ok: false,
      code: "amount_out_of_range",
    });
  });
  it("el plan institucional cobra el año anticipado y solo a instituciones", async () => {
    const w = world();
    expect(await chargeInstitutionPlan(w.deps, PRO, "small")).toEqual({
      ok: false,
      code: "forbidden",
    });
    w.deps.store.hasRole = async (_u, r) => r === "institution";
    expect(await chargeInstitutionPlan(w.deps, "inst", "large")).toMatchObject({
      ok: true,
      charge: { amountCop: 5_880_000 },
    });
    expect(w.charges[0]).toMatchObject({ kind: "plan", plan_key: "institution_large_annual" });
  });
});

describe("aviso de Firux", () => {
  const SECRET = "whsec_test";
  const TS = 1793750000;
  async function call(body: string, store: WebhookStore | null, sig?: string) {
    const s = sig ?? `v1=${await firuxSignatureFor(SECRET, String(TS), body)}`;
    const req = new Request("https://humanix.lat/api/public/firux/webhook", {
      method: "POST",
      headers: { "Firux-Timestamp": String(TS), "Firux-Signature": s },
      body,
    });
    return handleFiruxWebhook(req, { secret: SECRET, store, nowSeconds: () => TS + 10 });
  }
  function fakeStore(result = "applied") {
    const log: string[] = [];
    const store: WebhookStore = {
      recordEvent: async (e) => {
        log.push(`record:${e.id}:${e.type}`);
        return true;
      },
      markEvent: async (id, processed, code) => {
        log.push(`mark:${id}:${processed}:${code}`);
      },
      applyPaid: async (id, amount) => {
        log.push(`paid:${id}:${amount}`);
        return result;
      },
      markCharge: async (id, status) => {
        log.push(`charge:${id}:${status}`);
      },
    };
    return { store, log };
  }
  const paid = JSON.stringify({
    id: "evt_1",
    type: "charge.paid",
    data: { charge_id: "fx_c1", external_reference: "b1", amount_paid: 120000 },
  });

  it("aplica el pago con firma válida", async () => {
    const { store, log } = fakeStore();
    const r = await call(paid, store);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: true, result: "applied" });
    expect(log).toEqual(["record:evt_1:charge.paid", "paid:fx_c1:120000", "mark:evt_1:true:null"]);
  });
  it("rechaza sin tocar nada si la firma no cuadra", async () => {
    const { store, log } = fakeStore();
    expect((await call(paid, store, "v1=deadbeef")).status).toBe(401);
    expect(log).toEqual([]);
  });
  it("pago incompleto o cobro desconocido: se acusa recibo y queda anotado", async () => {
    const { store, log } = fakeStore("underpaid");
    expect((await call(paid, store)).status).toBe(200);
    expect(log.at(-1)).toBe("mark:evt_1:false:underpaid");
  });
  it("vencido: el cobro pendiente se marca para ofrecer otro QR", async () => {
    const { store, log } = fakeStore();
    await call(
      JSON.stringify({ id: "evt_2", type: "charge.expired", data: { charge_id: "fx_c1" } }),
      store,
    );
    expect(log).toContain("charge:fx_c1:expired");
  });
  it("si la base falla responde 500 para que Firux reintente", async () => {
    const { store } = fakeStore();
    store.applyPaid = async () => {
      throw new Error("db down");
    };
    expect((await call(paid, store)).status).toBe(500);
  });
  it("el botón «Enviar prueba» de Firux (webhook.test) recibe 200 y no mueve nada", async () => {
    const { store, log } = fakeStore();
    const body = JSON.stringify({
      id: "evt_test",
      type: "webhook.test",
      livemode: false,
      data: { message: "hola" },
    });
    const r = await call(body, store);
    expect(r.status).toBe(200);
    expect(log).toEqual([]);
  });
  it("firma: vector de prueba oficial de la documentación de Firux", async () => {
    const body =
      '{"id":"evt_test_ejemplo","type":"webhook.test","livemode":false,"data":{"message":"hola"}}';
    expect(await firuxSignatureFor("whsec_ejemplo_123", "1791400000", body)).toBe(
      "e703ad33b45496ea12cb57643fdb783bce339b0550f7cd95ce3f661a47056159",
    );
  });
  it("sin secreto configurado no procesa", async () => {
    const req = new Request("https://x/", { method: "POST", body: paid });
    expect(
      (await handleFiruxWebhook(req, { secret: undefined, store: null, nowSeconds: () => TS }))
        .status,
    ).toBe(503);
  });
});

describe("Conectar con Firux Pay en el cobro del turno", () => {
  const ACTIVE = {
    professional_id: PRO,
    firux_account_id: "acct_pro",
    status: "active",
    commission_terms_version: FIRUX_CONNECT_TERMS_VERSION,
    commission_accepted_at: "2026-11-01T10:00:00Z",
  };

  function connected(
    opts: { enabled?: boolean; conn?: typeof ACTIVE | null; canCreate?: boolean } = {},
  ) {
    const w = world({ professional_id: PRO, platform_fee_amount: 18_000 });
    const lookups: string[] = [];
    const connectedCalls: Array<{ accountId: string; body: unknown; key: string }> = [];
    w.deps.connect = {
      enabled: opts.enabled ?? true,
      connection: async (id) => {
        lookups.push(id);
        return opts.conn === undefined ? ACTIVE : opts.conn;
      },
      firuxFor: (accountId) =>
        opts.canCreate === false
          ? null
          : async (body, key) => {
              connectedCalls.push({ accountId, body, key });
              return { id: `fxc_${key}`, status: "PENDING", amount: body.amount, qr_emv: "qr-c" };
            },
    };
    return { ...w, lookups, connectedCalls };
  }

  it("con conexión activa, el turno se cobra a nombre del profesional con la comisión de la base", async () => {
    const w = connected();
    const r = await chargeBooking(w.deps, FAM, w.booking.id);
    expect(r).toMatchObject({ ok: true, charge: { amountCop: 120_000, qrEmv: "qr-c" } });
    expect(w.calls).toHaveLength(0); // no se usó la llave de Humanix
    expect(w.connectedCalls[0]).toMatchObject({
      accountId: "acct_pro",
      key: "c1",
      body: { amount: 120_000, external_reference: w.booking.id, application_fee: 18_000 },
    });
    expect(w.charges[0]).toMatchObject({
      route: "connected",
      firux_account_id: "acct_pro",
      application_fee_cop: 18_000,
      firux_id: "fxc_c1",
    });
  });

  it("flag apagado: ni se consulta la conexión ni se escriben columnas nuevas (respaldo payouts)", async () => {
    const w = connected({ enabled: false });
    await chargeBooking(w.deps, FAM, w.booking.id);
    expect(w.lookups).toEqual([]);
    expect(w.calls).toHaveLength(1);
    expect(w.charges[0]).not.toHaveProperty("route");
    expect(w.calls[0].body).not.toHaveProperty("application_fee");
  });

  it("sin conexión usable, o si no se puede leer o crear, cae a la llave de Humanix", async () => {
    for (const w of [
      connected({ conn: null }),
      connected({ conn: { ...ACTIVE, status: "revoked" } }),
      connected({ canCreate: false }),
    ]) {
      const r = await chargeBooking(w.deps, FAM, w.booking.id);
      expect(r).toMatchObject({ ok: true });
      expect(w.calls).toHaveLength(1);
      expect(w.connectedCalls).toHaveLength(0);
    }
    const broken = connected();
    broken.deps.connect!.connection = async () => {
      throw new Error("db down");
    };
    expect(await chargeBooking(broken.deps, FAM, broken.booking.id)).toMatchObject({ ok: true });
    expect(broken.calls).toHaveLength(1);
  });

  it("recargas y planes nunca van por la cuenta conectada", async () => {
    const w = connected();
    await chargeTopup(w.deps, PRO, 20_000);
    expect(w.connectedCalls).toHaveLength(0);
    expect(w.lookups).toEqual([]);
  });

  it("con Conectar encendido, el cobro abierto se busca por ruta", async () => {
    const w = connected();
    const seen: unknown[] = [];
    const orig = w.deps.store.openCharge;
    w.deps.store.openCharge = async (q) => {
      seen.push(q.route);
      return orig(q);
    };
    await chargeBooking(w.deps, FAM, w.booking.id);
    expect(seen).toEqual(["connected"]);
  });
});
