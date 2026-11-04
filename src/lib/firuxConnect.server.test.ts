import { describe, expect, it } from "vitest";
import { FIRUX_CONNECT_TERMS_VERSION } from "./firuxConnect";
import {
  completeConnect,
  connectStatus,
  disconnect,
  startConnect,
  type ConnectDeps,
  type ConnectionRecord,
} from "./firuxConnect.server";

const PRO = "22222222-2222-4222-8222-222222222222";
const FAM = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-04T15:00:00Z");
const STATE = "a".repeat(64);

function world(over: Partial<ConnectDeps> = {}) {
  const rows = new Map<string, ConnectionRecord>();
  let t = NOW;
  const exchanged: string[] = [];
  const deps: ConnectDeps = {
    enabled: true,
    store: {
      hasRole: async (u) => u === PRO,
      get: async (id) => rows.get(id) ?? null,
      upsert: async (id, patch) => {
        const prev = rows.get(id) ?? {
          professional_id: id,
          firux_account_id: null,
          status: "pending",
          commission_terms_version: null,
          commission_accepted_at: null,
          connect_state_hash: null,
          connect_state_expires_at: null,
        };
        rows.set(id, { ...prev, ...patch } as ConnectionRecord);
      },
    },
    authorizeUrl: (state) => `https://pay.firux.co/connect/authorize?state=${state}`,
    exchange: async (code) => {
      exchanged.push(code);
      return code === "good"
        ? { ok: true, accountId: "acct_9" }
        : { ok: false, code: "invalid", status: 400 };
    },
    now: () => t,
    randomState: () => STATE,
    sha256: async (s) => `h:${s}`,
    ...over,
  };
  return { deps, rows, exchanged, advance: (ms: number) => (t += ms) };
}

const accept = { acceptTerms: true, termsVersion: FIRUX_CONNECT_TERMS_VERSION };

describe("Conectar con Firux Pay", () => {
  it("con el flag apagado nada funciona y la tarjeta no se muestra", async () => {
    const w = world({ enabled: false });
    expect((await connectStatus(w.deps, PRO)).view).toEqual({ state: "disabled" });
    expect(await startConnect(w.deps, PRO, accept)).toMatchObject({ ok: false, code: "disabled" });
    expect(await completeConnect(w.deps, PRO, { code: "good", state: STATE })).toMatchObject({
      ok: false,
    });
    expect(w.rows.size).toBe(0);
  });

  it("solo profesionales, y solo aceptando la comisión vigente", async () => {
    const w = world();
    expect(await startConnect(w.deps, FAM, accept)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await startConnect(w.deps, PRO, { ...accept, acceptTerms: false })).toMatchObject({
      code: "terms_required",
    });
    expect(await startConnect(w.deps, PRO, { ...accept, termsVersion: "viejo" })).toMatchObject({
      code: "terms_required",
    });
  });

  it("sin credenciales de conexión configuradas: no_configured", async () => {
    const w = world({ authorizeUrl: null });
    expect(await startConnect(w.deps, PRO, accept)).toMatchObject({
      ok: false,
      code: "not_configured",
    });
  });

  it("flujo completo: acepta, va a Firux, vuelve y queda activo", async () => {
    const w = world();
    const s = await startConnect(w.deps, PRO, accept);
    expect(s).toEqual({ ok: true, url: `https://pay.firux.co/connect/authorize?state=${STATE}` });
    const pending = w.rows.get(PRO)!;
    expect(pending.status).toBe("pending");
    expect(pending.connect_state_hash).toBe(`h:${STATE}`); // nunca el state en claro
    expect(pending.commission_terms_version).toBe(FIRUX_CONNECT_TERMS_VERSION);

    const c = await completeConnect(w.deps, PRO, { code: "good", state: STATE });
    expect(c).toEqual({ ok: true, accountId: "acct_9" });
    expect(w.rows.get(PRO)).toMatchObject({
      status: "active",
      firux_account_id: "acct_9",
      connect_state_hash: null,
    });
    expect((await connectStatus(w.deps, PRO)).view).toEqual({
      state: "connected",
      accountId: "acct_9",
    });
  });

  it("el state es de un solo uso, vence y debe coincidir", async () => {
    const w = world();
    await startConnect(w.deps, PRO, accept);
    expect(
      await completeConnect(w.deps, PRO, { code: "good", state: "b".repeat(64) }),
    ).toMatchObject({
      code: "invalid_state",
    });
    expect(await completeConnect(w.deps, PRO, { code: "good", state: STATE })).toMatchObject({
      ok: true,
    });
    expect(await completeConnect(w.deps, PRO, { code: "good", state: STATE })).toMatchObject({
      code: "invalid_state",
    });

    const w2 = world();
    await startConnect(w2.deps, PRO, accept);
    w2.advance(16 * 60_000);
    expect(await completeConnect(w2.deps, PRO, { code: "good", state: STATE })).toMatchObject({
      code: "invalid_state",
    });
    expect(w2.exchanged).toEqual([]);
  });

  it("si Firux rechaza el código, no queda activa", async () => {
    const w = world();
    await startConnect(w.deps, PRO, accept);
    expect(await completeConnect(w.deps, PRO, { code: "bad", state: STATE })).toMatchObject({
      code: "provider_error",
    });
    expect(w.rows.get(PRO)!.status).toBe("pending");
  });

  it("reconectar no corta una conexión activa; desconectar la revoca", async () => {
    const w = world();
    await startConnect(w.deps, PRO, accept);
    await completeConnect(w.deps, PRO, { code: "good", state: STATE });
    await startConnect(w.deps, PRO, accept);
    expect(w.rows.get(PRO)!.status).toBe("active");
    expect(await disconnect(w.deps, PRO)).toEqual({ ok: true });
    expect(w.rows.get(PRO)!.status).toBe("revoked");
    expect((await connectStatus(w.deps, PRO)).view).toEqual({ state: "not_connected" });
  });
});
