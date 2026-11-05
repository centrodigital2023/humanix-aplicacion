import { describe, expect, it } from "vitest";
import {
  applyWompiTransaction,
  chargeBooking,
  chargeInstitutionPlan,
  chargeTopup,
  syncWompiTransaction,
  type ApplyStore,
  type BookingForCharge,
  type ChargeDeps,
  type ChargeRow,
  type ChargeStore,
} from "./charges.server";
import { handleWompiWebhook, type WebhookStore } from "./wompiWebhook";

const FAMILY = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-05T12:00:00.000Z");

function memStore(bookings: BookingForCharge[] = [], roles: Record<string, string[]> = {}) {
  const charges: ChargeRow[] = [];
  let n = 0;
  const store: ChargeStore = {
    booking: async (id) => bookings.find((b) => b.id === id) ?? null,
    charge: async (id) => charges.find((c) => c.id === id) ?? null,
    hasRole: async (u, r) => (roles[u] ?? []).includes(r),
    openCharge: async (q) =>
      charges
        .filter(
          (c) =>
            c.kind === q.kind &&
            c.user_id === q.userId &&
            c.booking_id === q.bookingId &&
            c.status === "pending" &&
            Number(c.amount_cop) === q.amountCop &&
            c.checkout_url,
        )
        .at(-1) ?? null,
    insertCharge: async (row) => {
      n += 1;
      const c: ChargeRow = {
        id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`,
        provider_tx_id: null,
        status: "pending",
        checkout_url: null,
        expires_at: null,
        ...row,
      };
      charges.push(c);
      return c;
    },
    updateCharge: async (id, patch) => {
      const c = charges.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
  };
  return { store, charges };
}

const booking = (over: Partial<BookingForCharge> = {}): BookingForCharge => ({
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  client_id: FAMILY,
  professional_id: PRO,
  status: "pending",
  payment_method: "DIGITAL_BREB",
  total_amount: 100_000,
  paid_at: null,
  ...over,
});

const deps = (store: ChargeStore, now = NOW): ChargeDeps => ({
  store,
  wompi: {
    publicKey: "pub_test_abc",
    integritySecret: "test_integrity_x",
    redirectUrl: "https://humanix.lat/pago/exito",
  },
  now: () => now,
});

describe("chargeBooking", () => {
  it("la familia recibe el enlace firmado de Wompi con su cobro como referencia", async () => {
    const { store, charges } = memStore([booking()]);
    const r = await chargeBooking(deps(store), FAMILY, booking().id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new URL(r.charge.checkoutUrl!);
    expect(u.searchParams.get("reference")).toBe(charges[0].id);
    expect(u.searchParams.get("amount-in-cents")).toBe("10000000");
    expect(u.searchParams.get("public-key")).toBe("pub_test_abc");
    expect(u.searchParams.get("redirect-url")).toBe("https://humanix.lat/pago/exito");
    expect(r.charge.expiresAt).toBe("2026-11-06T12:00:00.000Z");
    expect(u.searchParams.get("expiration-time")).toBe("2026-11-06T12:00:00.000Z");
  });

  it("reutiliza el cobro abierto sin intento; uno con intento en Wompi o vencido se reemplaza", async () => {
    const { store, charges } = memStore([booking()]);
    const a = await chargeBooking(deps(store), FAMILY, booking().id);
    const b = await chargeBooking(deps(store), FAMILY, booking().id);
    if (!a.ok || !b.ok) throw new Error("bad");
    expect(b.charge.chargeId).toBe(a.charge.chargeId);
    charges[0].provider_tx_id = "12-1-1"; // la familia ya abrió el checkout: esa referencia está usada
    const c = await chargeBooking(deps(store), FAMILY, booking().id);
    if (!c.ok) throw new Error("bad");
    expect(c.charge.chargeId).not.toBe(a.charge.chargeId);
    const d = await chargeBooking(deps(store, NOW + 25 * 3_600_000), FAMILY, booking().id);
    if (!d.ok) throw new Error("bad");
    expect(d.charge.chargeId).not.toBe(c.charge.chargeId);
    expect(charges.find((x) => x.id === c.charge.chargeId)?.status).toBe("expired");
  });

  it("reglas: solo quien reservó, sin pagar, digital y en un estado pagable", async () => {
    const { store } = memStore([
      booking(),
      booking({ id: "b2", paid_at: "2026-11-05T00:00:00Z" }),
      booking({ id: "b3", payment_method: "CASH" }),
      booking({ id: "b4", status: "completed" }),
    ]);
    expect(await chargeBooking(deps(store), PRO, booking().id)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(await chargeBooking(deps(store), FAMILY, "nope")).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await chargeBooking(deps(store), FAMILY, "b2")).toEqual({
      ok: false,
      code: "already_paid",
    });
    expect(await chargeBooking(deps(store), FAMILY, "b3")).toEqual({
      ok: false,
      code: "cash_booking",
    });
    expect((await chargeBooking(deps(store), FAMILY, "b4")).ok).toBe(true);
    expect(await chargeBooking({ ...deps(store), wompi: null }, FAMILY, booking().id)).toEqual({
      ok: false,
      code: "not_configured",
    });
  });
});

describe("recarga y plan", () => {
  it("solo el profesional recarga y solo la institución paga el plan (monto de la base)", async () => {
    const { store, charges } = memStore([], { [PRO]: ["professional"], [FAMILY]: ["institution"] });
    expect(await chargeTopup(deps(store), FAMILY, 20_000)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect((await chargeTopup(deps(store), PRO, 20_000)).ok).toBe(true);
    expect(await chargeTopup(deps(store), PRO, 1_000)).toEqual({
      ok: false,
      code: "amount_out_of_range",
    });
    const plan = await chargeInstitutionPlan(deps(store), FAMILY, "small");
    expect(plan.ok && plan.charge.amountCop).toBe(3_480_000);
    expect(charges.find((c) => c.kind === "plan")?.plan_key).toBe("institution_small_annual");
    expect(await chargeInstitutionPlan(deps(store), PRO, "small")).toEqual({
      ok: false,
      code: "forbidden",
    });
  });
});

function applySpy() {
  const calls: string[] = [];
  const apply: ApplyStore = {
    applyPaid: async (id, tx, amount) => {
      calls.push(`paid:${id}:${tx}:${amount}`);
      return "applied";
    },
    markAttempt: async (id, tx, st) => {
      calls.push(`${st}:${id}:${tx}`);
    },
  };
  return { apply, calls };
}

describe("applyWompiTransaction", () => {
  const ref = "aaaaaaaa-0000-4000-8000-000000000001";
  it("APPROVED aplica; DECLINED/ERROR/VOIDED marcan el intento; referencia ajena se ignora", async () => {
    const { apply, calls } = applySpy();
    const tx = (status: string, reference = ref) => ({
      transactionId: "t1",
      reference,
      status,
      amountCop: 100_000,
    });
    expect(await applyWompiTransaction(apply, tx("APPROVED"))).toBe("applied");
    expect(await applyWompiTransaction(apply, tx("DECLINED"))).toBe("marked_failed");
    expect(await applyWompiTransaction(apply, tx("PENDING"))).toBe("pending");
    expect(await applyWompiTransaction(apply, tx("APPROVED", "MZQ3X2DE2SMX"))).toBe(
      "unknown_charge",
    );
    expect(calls).toEqual([`paid:${ref}:t1:100000`, `failed:${ref}:t1`, `pending:${ref}:t1`]);
  });
});

describe("syncWompiTransaction (regreso a /pago/exito)", () => {
  it("consulta Wompi y aplica solo si el cobro es de quien vuelve", async () => {
    const { store, charges } = memStore([booking()]);
    await chargeBooking(deps(store), FAMILY, booking().id);
    const id = charges[0].id;
    const { apply, calls } = applySpy();
    const fetchTx = async () => ({
      id: "t9",
      reference: id,
      status: "APPROVED",
      amount_in_cents: 10_000_000,
    });
    expect(await syncWompiTransaction({ store, apply, fetchTx }, PRO, "t9")).toEqual({ ok: false });
    expect(calls).toEqual([]);
    const r = await syncWompiTransaction({ store, apply, fetchTx }, FAMILY, "t9");
    expect(r).toMatchObject({ ok: true, kind: "booking" });
    expect(calls).toEqual([`paid:${id}:t9:100000`]);
    expect(await syncWompiTransaction({ store, apply, fetchTx: null }, FAMILY, "t9")).toEqual({
      ok: false,
    });
  });
});

describe("webhook de cobros", () => {
  const SECRET = "test_events_x";
  async function sha256Hex(s: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function event(status: string, reference: string, cents = 10_000_000) {
    const timestamp = 1793750000;
    const id = "1234-1793750000-1";
    const checksum = await sha256Hex(`${id}${status}${cents}${timestamp}${SECRET}`);
    return {
      body: JSON.stringify({
        event: "transaction.updated",
        data: { transaction: { id, amount_in_cents: cents, reference, status, currency: "COP" } },
        environment: "test",
        signature: {
          properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
          checksum,
        },
        timestamp,
      }),
      checksum,
    };
  }
  function store() {
    const { apply, calls } = applySpy();
    const events: string[] = [];
    const s: WebhookStore = {
      ...apply,
      recordEvent: async (e) => {
        events.push(e.id);
        return true;
      },
      markEvent: async () => undefined,
    };
    return { s, calls, events };
  }
  const post = (body: string, checksum?: string) =>
    new Request("https://humanix.lat/api/public/wompi/webhook", {
      method: "POST",
      headers: checksum ? { "X-Event-Checksum": checksum } : {},
      body,
    });
  const ref = "aaaaaaaa-0000-4000-8000-000000000001";

  it("APPROVED firmado aplica el pago con el monto en pesos", async () => {
    const { s, calls, events } = store();
    const e = await event("APPROVED", ref);
    const r = await handleWompiWebhook(post(e.body, e.checksum), { secret: SECRET, store: s });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ result: "applied" });
    expect(calls).toEqual([`paid:${ref}:1234-1793750000-1:100000`]);
    expect(events).toEqual(["1234-1793750000-1:APPROVED"]);
  });

  it("sin configurar 503; firma mala 401 y no toca nada", async () => {
    const { s, calls } = store();
    const e = await event("APPROVED", ref);
    expect((await handleWompiWebhook(post(e.body), { secret: undefined, store: s })).status).toBe(
      503,
    );
    expect((await handleWompiWebhook(post(e.body), { secret: "otro", store: s })).status).toBe(401);
    const tampered = e.body.replace("10000000", "100");
    expect((await handleWompiWebhook(post(tampered), { secret: SECRET, store: s })).status).toBe(
      401,
    );
    expect(calls).toEqual([]);
  });

  it("un error al aplicar responde 500 para que Wompi reintente", async () => {
    const { s } = store();
    s.applyPaid = async () => {
      throw new Error("db down");
    };
    const e = await event("APPROVED", ref);
    expect((await handleWompiWebhook(post(e.body), { secret: SECRET, store: s })).status).toBe(500);
  });
});
