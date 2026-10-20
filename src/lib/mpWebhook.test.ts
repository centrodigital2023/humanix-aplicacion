import { afterEach, describe, expect, it, vi } from "vitest";
import { handleMercadoPagoWebhook, verifyMpSignature } from "./mpWebhook";
import { USER, fakeDb, planPayment } from "./mpPayment.testkit";

const SECRET = "secreto-de-prueba";
const SUPA = "https://db.example";

async function sign(id: string, requestId: string, ts: string, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`id:${id};request-id:${requestId};ts:${ts};`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ts=${ts},v1=${hex}`;
}

async function notice(id: string, opts: { type?: string; secret?: string } = {}) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-request-id": "req-1",
    "x-signature": await sign(id, "req-1", "1760000000", opts.secret),
  });
  return new Request(
    `https://humanix.lat/api/mercadopago/webhook?data.id=${id}&type=${opts.type ?? "payment"}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ type: opts.type ?? "payment", data: { id } }),
    },
  );
}

const env = { token: "APP_USR-x", secret: SECRET, supabaseUrl: SUPA, serviceKey: "srk" };

/** fetch falso: Mercado Pago responde `mp`, y la base de datos es la falsa de las pruebas de cobro. */
function stubFetch(mp: Record<string, unknown>, db = fakeDb()) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPA}/rest/v1/`)) {
      const path = url.slice(`${SUPA}/rest/v1/`.length);
      if (path.startsWith("function_execution_logs")) return new Response(null, { status: 201 });
      return db.rest(path, init);
    }
    seen.push(url);
    const path = url.replace("https://api.mercadopago.com", "");
    return path in mp
      ? new Response(JSON.stringify(mp[path]), { status: 200 })
      : new Response("{}", { status: 404 });
  });
  return { db, seen };
}

afterEach(() => vi.unstubAllGlobals());

describe("firma de los avisos de Mercado Pago", () => {
  it("acepta la firma correcta y rechaza otra clave, otro id o sin encabezados", async () => {
    const h = new Headers({ "x-request-id": "r", "x-signature": await sign("55", "r", "1") });
    expect(await verifyMpSignature(h, "55", SECRET)).toBe(true);
    expect(await verifyMpSignature(h, "56", SECRET)).toBe(false);
    expect(await verifyMpSignature(h, "55", "otra")).toBe(false);
    expect(await verifyMpSignature(new Headers(), "55", SECRET)).toBe(false);
  });
});

describe("webhook dentro de la app", () => {
  it("ignora avisos que no son de pagos ni suscripciones", async () => {
    const { seen } = stubFetch({});
    const r = await handleMercadoPagoWebhook(await notice("1", { type: "merchant_order" }), env);
    expect(r.status).toBe(200);
    expect(seen).toEqual([]);
  });

  it("sin claves responde 500 para que Mercado Pago reintente", async () => {
    stubFetch({});
    const r = await handleMercadoPagoWebhook(await notice("1"), { ...env, secret: undefined });
    expect(r.status).toBe(500);
  });

  it("una firma falsa no consulta nada ni activa nada", async () => {
    const { seen, db } = stubFetch({ "/v1/payments/9001": planPayment() });
    const r = await handleMercadoPagoWebhook(await notice("9001", { secret: "falsa" }), env);
    expect(r.status).toBe(401);
    expect(seen).toEqual([]);
    expect(db.t.mp_subscriptions).toEqual([]);
  });

  it("un pago aprobado activa el plan una sola vez aunque llegue dos veces", async () => {
    const { db } = stubFetch({ "/v1/payments/9001": planPayment() });
    expect((await handleMercadoPagoWebhook(await notice("9001"), env)).status).toBe(200);
    expect((await handleMercadoPagoWebhook(await notice("9001"), env)).status).toBe(200);
    expect(db.t.mp_subscriptions).toHaveLength(1);
    expect(db.t.mp_subscriptions[0]).toMatchObject({
      user_id: USER,
      plan: "pro_monthly",
      status: "active",
    });
    expect(db.t.notifications.filter((n) => n.type === "payment_approved")).toHaveLength(1);
  });

  it("si Mercado Pago no encuentra el pago, pide reintento", async () => {
    stubFetch({});
    expect((await handleMercadoPagoWebhook(await notice("404"), env)).status).toBe(502);
  });
});
