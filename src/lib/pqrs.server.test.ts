import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDraft, handleStatus, handleSubmit, type Db, type PqrsDeps } from "./pqrs.server";

// ── Cliente de base de datos falso: registra operaciones y responde según tabla.operación.
type Op = { table: string; op: string; args?: unknown; filters: Array<[string, unknown]> };
let ops: Op[] = [];
let results: Record<string, unknown> = {};
let rpcResults: Record<string, unknown> = {};

function builder(table: string) {
  const state: Op = { table, op: "select", filters: [] };
  const finish = () => {
    ops.push(state);
    const r = results[`${table}.${state.op}`];
    const value = typeof r === "function" ? (r as (s: Op) => unknown)(state) : r;
    return Promise.resolve(value ?? { data: null, error: null, count: 0 });
  };
  const b: Record<string, unknown> = {
    insert: (a: unknown) => ((state.op = "insert"), (state.args = a), b),
    update: (a: unknown) => ((state.op = "update"), (state.args = a), b),
    delete: () => ((state.op = "delete"), b),
    select: () => b,
    eq: (k: string, v: unknown) => (state.filters.push([k, v]), b),
    gte: (k: string, v: unknown) => (state.filters.push([k, v]), b),
    lt: (k: string, v: unknown) => (state.filters.push([k, v]), b),
    in: (k: string, v: unknown) => (state.filters.push([k, v]), b),
    limit: () => b,
    single: () => finish(),
    maybeSingle: () => finish(),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => finish().then(res, rej),
  };
  return b;
}

const fakeAdmin = {
  from: (t: string) => builder(t),
  rpc: async (name: string) => ({ data: rpcResults[name] ?? null, error: null }),
  auth: {
    getUser: async (token: string) => ({
      data: { user: token === "tok-user" ? { id: "user-1" } : null },
    }),
  },
} as unknown as Db;

let headers: Record<string, string> = {};
const deps = (): PqrsDeps => ({
  admin: fakeAdmin,
  header: (n) => headers[n.toLowerCase()],
  salt: "salt-test",
  ai: { apiKey: "ai-key", model: null },
});

const realFetch = globalThis.fetch;
const aiTool = (args: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
    }),
    { status: 200 },
  );
const stubAi = (r: () => Response) => {
  globalThis.fetch = (async () => r()) as typeof fetch;
};

const good = {
  type: "queja",
  subject: "Cobro duplicado",
  name: "Ana Pérez",
  email: "Ana@Correo.com",
  phone: "300 123 4567",
  description: "Me cobraron dos veces el plan mensual",
  consent: true,
  website: "",
};

beforeEach(() => {
  ops = [];
  headers = { "x-forwarded-for": "9.9.9.9" };
  results = {
    "pqrs_intake_attempts.select": { count: 0, data: null, error: null },
    "pqrs_tickets.insert": {
      data: {
        id: "t1",
        radicado: "PQRS-2026-000001",
        due_at: "2026-10-30T04:59:59.999Z",
        created_at: "2026-10-08T15:00:00Z",
      },
      error: null,
    },
    "user_roles.select": { data: [{ user_id: "s1" }, { user_id: "s2" }], error: null },
  };
  rpcResults = { is_staff: true };
  stubAi(() =>
    aiTool({
      topic: "facturacion",
      priority: "normal",
      sentiment: "negative",
      summary: "Cobro doble del plan",
    }),
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const tickets = (op: string) => ops.filter((o) => o.table === "pqrs_tickets" && o.op === op);

describe("handleSubmit", () => {
  it("radica, calcula el plazo, clasifica y devuelve el radicado", async () => {
    const r = await handleSubmit(good, deps());
    expect(r).toMatchObject({
      ok: true,
      accepted: false,
      radicado: "PQRS-2026-000001",
      emergency_notice: false,
    });
    const insert = tickets("insert")[0].args as Record<string, unknown>;
    expect(insert).toMatchObject({
      contact_email: "ana@correo.com",
      contact_phone: "3001234567",
      channel: "web",
      consent_data_processing: true,
      user_id: null,
    });
    expect(tickets("update")[0].args).toMatchObject({
      ai_category: "facturacion",
      ai_priority: "normal",
    });
    // Solo se guardan hashes: nunca la IP ni el correo en claro.
    const attempts = ops
      .filter((o) => o.table === "pqrs_intake_attempts" && o.op === "insert")
      .map((o) => JSON.stringify(o.args))
      .join("");
    expect(attempts).not.toContain("9.9.9.9");
    expect(attempts).not.toContain("correo.com");
    expect(ops.some((o) => o.table === "function_execution_logs")).toBe(true);
  });

  it("vincula la cuenta si hay sesión", async () => {
    headers.authorization = "Bearer tok-user";
    await handleSubmit(good, deps());
    expect((tickets("insert")[0].args as Record<string, unknown>).user_id).toBe("user-1");
  });

  it("rechaza datos inválidos sin tocar la base", async () => {
    const r = await handleSubmit({ ...good, email: "no-es-correo", consent: false }, deps());
    expect(r).toEqual({ ok: false, error: "validation", fields: ["email", "consent"] });
    expect(ops).toHaveLength(0);
  });

  it("el campo trampa parece éxito pero no crea ticket", async () => {
    expect(await handleSubmit({ ...good, website: "http://spam.example" }, deps())).toEqual({
      ok: true,
      accepted: true,
    });
    expect(tickets("insert")).toHaveLength(0);
  });

  it("limita por IP y por contacto", async () => {
    results["pqrs_intake_attempts.select"] = { count: 5, data: null, error: null };
    expect(await handleSubmit(good, deps())).toEqual({ ok: false, error: "rate_limited" });
    expect(tickets("insert")).toHaveLength(0);
  });

  it("descarta cuerpos enormes y exige la llave de servidor", async () => {
    expect(await handleSubmit({ ...good, description: "x".repeat(30_000) }, deps())).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(await handleSubmit(good, { ...deps(), salt: undefined })).toEqual({
      ok: false,
      error: "server",
    });
  });

  it("una señal crítica avisa al equipo de inmediato y sube la prioridad aunque la IA falle", async () => {
    stubAi(() => new Response("", { status: 500 }));
    const r = await handleSubmit(
      {
        ...good,
        subject: "Emergencia",
        description: "La paciente se cayó y no respira bien, necesitamos ayuda",
      },
      deps(),
    );
    expect(r).toMatchObject({ ok: true, emergency_notice: true });
    const insert = tickets("insert")[0].args as Record<string, unknown>;
    expect(insert).toMatchObject({ safety_level: "critical", ai_priority: "urgent" });
    const notif = ops.find((o) => o.table === "notifications" && o.op === "insert")!.args as Array<
      Record<string, unknown>
    >;
    expect(notif.map((n) => n.user_id)).toEqual(["s1", "s2"]);
    expect(notif[0].type).toBe("pqrs_critical");
  });

  it("una clasificación urgente de la IA también avisa al equipo, una sola vez", async () => {
    stubAi(() =>
      aiTool({
        topic: "fraude",
        priority: "urgent",
        sentiment: "very_negative",
        summary: "Fraude",
      }),
    );
    await handleSubmit(good, deps());
    expect(ops.filter((o) => o.table === "notifications")).toHaveLength(1);
  });

  it("si falla la base responde error de servidor sin romper", async () => {
    results["pqrs_tickets.insert"] = { data: null, error: { code: "XX000" } };
    expect(await handleSubmit(good, deps())).toEqual({ ok: false, error: "server" });
  });
});

describe("handleStatus", () => {
  const row = {
    radicado: "PQRS-2026-000001",
    status: "resolved",
    type: "queja",
    created_at: "2026-10-01T00:00:00Z",
    due_at: "2026-10-20T00:00:00Z",
    resolved_at: "2026-10-05T00:00:00Z",
    resolution: "Listo",
    contact_email: "Ana@Correo.com",
  };

  it("muestra el estado solo si el correo coincide exactamente (sin comodines)", async () => {
    results["pqrs_tickets.select"] = { data: row, error: null };
    const ok = await handleStatus(
      { radicado: " pqrs-2026-000001 ", email: "ana@correo.com" },
      deps(),
    );
    expect(ok).toMatchObject({ ok: true, found: true, status: "resolved", resolution: "Listo" });
    expect(JSON.stringify(ok)).not.toContain("contact_email");
    expect(
      await handleStatus({ radicado: "PQRS-2026-000001", email: "otra@correo.com" }, deps()),
    ).toEqual({
      ok: true,
      found: false,
    });
    // «%» no es comodín: la comparación es exacta en código y la consulta no usa ILIKE.
    expect(
      await handleStatus({ radicado: "PQRS-2026-000001", email: "%@correo.com" }, deps()),
    ).toEqual({ ok: true, found: false });
    expect(
      ops
        .filter((o) => o.table === "pqrs_tickets")
        .every((o) => o.filters.every(([col]) => col === "radicado")),
    ).toBe(true);
  });

  it("oculta la resolución mientras el caso sigue abierto", async () => {
    results["pqrs_tickets.select"] = { data: { ...row, status: "open" }, error: null };
    const r = await handleStatus({ radicado: "PQRS-2026-000001", email: "ana@correo.com" }, deps());
    expect(r).toMatchObject({ found: true, resolution: null });
  });

  it("valida el formato del radicado y limita las consultas", async () => {
    expect(await handleStatus({ radicado: "123", email: "a@b.co" }, deps())).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await handleStatus("no-es-objeto", deps())).toEqual({ ok: false, error: "validation" });
    results["pqrs_intake_attempts.select"] = { count: 20, data: null, error: null };
    expect(await handleStatus({ radicado: "PQRS-2026-000001", email: "a@b.co" }, deps())).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });
});

describe("handleDraft", () => {
  const TICKET = "11111111-1111-4111-8111-111111111111";
  const ticket = {
    id: TICKET,
    radicado: "PQRS-2026-000001",
    subject: "Cobro",
    description: "Cobro doble",
    type: "reclamo",
    due_at: "2026-10-30T04:59:59.999Z",
    ai_summary: null,
  };
  const draft = (over: Record<string, unknown> = {}) =>
    aiTool({
      subject: "Respuesta",
      body: "Recibimos tu solicitud PQRS-2026-000001.",
      next_steps: [],
      missing_info: [],
      escalate: false,
      ...over,
    });
  const run = () => handleDraft({ ticket_id: TICKET }, "staff-1", deps());

  beforeEach(() => {
    results["ai_credits_ledger.select"] = { count: 0, data: null, error: null };
    results["pqrs_tickets.select"] = { data: ticket, error: null };
  });

  it("solo el staff puede pedir borradores", async () => {
    rpcResults.is_staff = false;
    expect(await run()).toEqual({ ok: false, error: "forbidden", message: "No autorizado" });
    expect(ops.some((o) => o.table === "pqrs_tickets")).toBe(false);
  });

  it("guarda el borrador, cobra el crédito y registra la ejecución", async () => {
    stubAi(() => draft());
    expect((await run()).ok).toBe(true);
    expect(tickets("update")[0].args).toMatchObject({
      ai_reply_draft: "Recibimos tu solicitud PQRS-2026-000001.",
    });
    expect(
      ops.find((o) => o.table === "ai_credits_ledger" && o.op === "insert")!.args,
    ).toMatchObject({
      user_id: "staff-1",
      feature: "pqrs-assistant",
    });
  });

  it("un borrador con instrucciones de pago se bloquea y NO se guarda", async () => {
    stubAi(() => draft({ body: "Haz una transferencia a nuestra cuenta de ahorros" }));
    const r = await run();
    expect(r.ok && r.draft.flagged).toBe(true);
    expect(tickets("update")).toHaveLength(0);
  });

  it("valida el id, el límite por hora y los errores de la IA", async () => {
    expect(await handleDraft({ ticket_id: "no-uuid" }, "staff-1", deps())).toMatchObject({
      ok: false,
      error: "invalid",
    });
    results["ai_credits_ledger.select"] = { count: 30, data: null, error: null };
    expect(await run()).toMatchObject({ ok: false, error: "rate_limited" });
    results["ai_credits_ledger.select"] = { count: 0, data: null, error: null };
    stubAi(() => new Response("", { status: 402 }));
    expect(await run()).toMatchObject({ ok: false, error: "no_credits" });
    results["pqrs_tickets.select"] = { data: null, error: null };
    expect(await run()).toMatchObject({ ok: false, error: "not_found" });
  });
});
