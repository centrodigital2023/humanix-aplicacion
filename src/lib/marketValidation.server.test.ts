import { beforeEach, describe, expect, it } from "vitest";
import {
  LIMITS_SERVER,
  handleRedeem,
  handleSendOtp,
  handleSubmit,
  handleVerifyOtp,
  makeBenefitCode,
  makeOtp,
  type Db,
  type MarketDeps,
} from "./marketValidation.server";

// ── Base de datos falsa en memoria (lo justo para los filtros que usa el servidor) ─────────────────────
type Row = Record<string, unknown>;
type Err = { code: string; message: string };

class FakeDb {
  tables: Record<string, Row[]> = {
    validation_responses: [],
    validation_otps: [],
    function_execution_logs: [],
  };
  clock: () => number = () => NOW;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  rpcImpl: (name: string, args: Record<string, unknown>) => unknown = () => ({
    ok: true,
    plan: "essential_monthly",
    ends_at: "2026-11-11T15:00:00Z",
  });
  users: Record<string, string> = { "tok-user": "user-1" };
  beforeUpdate?: (table: string, rows: Row[]) => void;
  updateError?: (table: string, patch: Row) => Err | null;

  auth = {
    getUser: async (token: string) => ({
      data: { user: this.users[token] ? { id: this.users[token] } : null },
    }),
  };
  rpc = async (name: string, args: Record<string, unknown>) => {
    this.rpcCalls.push({ name, args });
    const r = this.rpcImpl(name, args);
    return r === undefined ? { data: null, error: { code: "XX000" } } : { data: r, error: null };
  };
  from(table: string) {
    return new Builder(this, table);
  }
  uniqueError(table: string, next: Row, self: Row | null): Err | null {
    if (table !== "validation_responses") return null;
    const others = this.tables[table].filter((r) => r !== self);
    if (next.promo_code && others.some((r) => r.promo_code === next.promo_code)) {
      return {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "validation_responses_promo_code_key"',
      };
    }
    if (
      next.promo_code &&
      next.contact_key &&
      others.some((r) => r.promo_code && r.contact_key === next.contact_key)
    ) {
      return {
        code: "23505",
        message: 'duplicate key value violates unique constraint "uq_validation_benefit_contact"',
      };
    }
    return null;
  }
}

const DEFAULTS: Record<string, Row> = {
  validation_responses: {
    promo_code: null,
    contact_verified_at: null,
    verified_channel: null,
    benefit_status: "none",
    benefit_expires_at: null,
    premium_activated: false,
    redeemed_by: null,
    user_id: null,
  },
  validation_otps: { attempts: 0, verified_at: null },
};

class Builder {
  op: "select" | "insert" | "update" | "delete" = "select";
  filters: Array<(r: Row) => boolean> = [];
  patch: Row = {};
  rows: Row[] = [];
  returning = false;
  head = false;
  orderKey?: string;
  asc = true;
  lim?: number;
  constructor(
    private db: FakeDb,
    private table: string,
  ) {}
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op === "insert" || this.op === "update") this.returning = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(v: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(v) ? v : [v];
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.patch = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  gte(k: string, v: unknown) {
    this.filters.push((r) => r[k] !== null && r[k] !== undefined && String(r[k]) >= String(v));
    return this;
  }
  lt(k: string, v: unknown) {
    this.filters.push((r) => r[k] !== null && r[k] !== undefined && String(r[k]) < String(v));
    return this;
  }
  is(k: string, v: null) {
    this.filters.push((r) => (r[k] ?? null) === v);
    return this;
  }
  not(k: string, _op: string, _v: null) {
    this.filters.push((r) => r[k] !== null && r[k] !== undefined);
    return this;
  }
  order(k: string, o?: { ascending?: boolean }) {
    this.orderKey = k;
    this.asc = o?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    return this.exec("maybe");
  }
  single() {
    return this.exec("single");
  }
  then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
    return this.exec("many").then(res, rej);
  }
  private async exec(mode: "maybe" | "single" | "many") {
    const tbl = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const match = () => tbl.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      const out: Row[] = [];
      for (const row of this.rows) {
        const full: Row = {
          id: crypto.randomUUID(),
          created_at: new Date(this.db.clock()).toISOString(),
          ...(DEFAULTS[this.table] ?? {}),
          ...row,
        };
        const err = this.db.uniqueError(this.table, full, null);
        if (err) return { data: null, error: err };
        tbl.push(full);
        out.push(full);
      }
      if (mode === "single") return { data: { ...out[0] }, error: null };
      return { data: this.returning ? out : null, error: null };
    }
    if (this.op === "update") {
      const rows = match();
      this.db.beforeUpdate?.(this.table, rows);
      const err = this.db.updateError?.(this.table, this.patch);
      if (err) return { data: null, error: err };
      const fresh = match(); // el filtro se evalúa al ejecutar (así se simulan las carreras)
      for (const r of fresh) {
        const e = this.db.uniqueError(this.table, { ...r, ...this.patch }, r);
        if (e) return { data: null, error: e };
      }
      fresh.forEach((r) => Object.assign(r, this.patch));
      return { data: this.returning ? fresh.map((r) => ({ id: r.id })) : null, error: null };
    }
    if (this.op === "delete") {
      const rows = match();
      this.db.tables[this.table] = tbl.filter((r) => !rows.includes(r));
      return { data: null, error: null };
    }
    let rows = match();
    if (this.orderKey) {
      const k = this.orderKey;
      rows = [...rows].sort(
        (a, b) =>
          ((a[k] as string) < (b[k] as string) ? -1 : (a[k] as string) > (b[k] as string) ? 1 : 0) *
          (this.asc ? 1 : -1),
      );
    }
    if (this.lim !== undefined) rows = rows.slice(0, this.lim);
    if (this.head) return { data: null, count: rows.length, error: null };
    const data = rows.map((r) => ({ ...r }));
    if (mode === "maybe") return { data: data[0] ?? null, error: null };
    if (mode === "single") {
      return data[0]
        ? { data: data[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "sin filas" } };
    }
    return { data, error: null, count: data.length };
  }
}

// ── Entorno de cada prueba ─────────────────────────────────────────────────────────────────────────
const NOW = Date.parse("2026-10-11T15:00:00Z");
let db: FakeDb;
let headers: Record<string, string>;
let clock: number;
let fetchCalls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }>;
let fetchOk: boolean;

const stubFetch = (async (url: string, init?: RequestInit) => {
  fetchCalls.push({
    url,
    body: JSON.parse(String(init?.body ?? "{}")),
    auth: new Headers(init?.headers).get("authorization"),
  });
  return new Response("{}", { status: fetchOk ? 200 : 400 });
}) as unknown as typeof fetch;

const deps = (over: Partial<MarketDeps> = {}): MarketDeps => ({
  admin: db as unknown as Db,
  header: (n) => headers[n.toLowerCase()],
  salt: "salt-test",
  otp: { resendKey: "re_key", whatsappToken: "wa-token", whatsappPhoneId: "999" },
  now: () => clock,
  fetch: stubFetch,
  ...over,
});

const goodForm = (over: Record<string, unknown> = {}) => ({
  fullName: "Marta Rojas Díaz",
  profile: "familia",
  contact: "marta@correo.com",
  city: "Bogotá",
  serviceOffer: "Busco una auxiliar de enfermería para mi mamá en las noches",
  painPoint: "No encuentro a nadie de confianza y las agencias cobran mucho y no responden rápido",
  targetAudience: "Hijos de 40 años que trabajan todo el día",
  dailyChange: "Podría trabajar tranquila sabiendo que alguien verificado la acompaña",
  paysCurrently: "no",
  alternatives: ["Grupos de WhatsApp", "", ""],
  searchChannels: ["whatsapp_groups"],
  searchChannelsOther: "",
  willingnessPct: 60,
  comments: "Necesito ver antecedentes judiciales",
  consent: true,
  website: "",
  startedAt: NOW - 120_000,
  ...over,
});

const responses = () => db.tables.validation_responses;
const otps = () => db.tables.validation_otps;

beforeEach(() => {
  db = new FakeDb();
  clock = NOW;
  db.clock = () => clock;
  headers = { "x-forwarded-for": "9.9.9.9" };
  fetchCalls = [];
  fetchOk = true;
});

// ── Enviar el formulario ───────────────────────────────────────────────────────────────────────────
describe("handleSubmit", () => {
  it("guarda la respuesta con los datos limpios y sin la IP en claro", async () => {
    const r = await handleSubmit(goodForm(), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.contact).toEqual({ kind: "email", masked: "ma***@correo.com" });
    expect(responses()).toHaveLength(1);
    const row = responses()[0];
    expect(row).toMatchObject({
      profile_type: "familia",
      full_name: "Marta Rojas Díaz",
      email: "marta@correo.com",
      whatsapp: null,
      contact_key: "marta@correo.com",
      city: "Bogotá",
      service_offer: "Busco una auxiliar de enfermería para mi mamá en las noches",
      pays_currently: "no",
      alternatives: ["Grupos de WhatsApp"],
      competitors: "Grupos de WhatsApp",
      search_channels: ["whatsapp_groups"],
      willingness_pct: 60,
      consent_version: "2026-10",
      user_id: null,
    });
    expect(row.key_benefit).toBe(
      "Podría trabajar tranquila sabiendo que alguien verificado la acompaña",
    );
    expect(row.consent_at).toBe(new Date(NOW).toISOString());
    expect(typeof row.signal_score).toBe("number");
    expect(String(row.ip_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("9.9.9.9");
    // lo que decide el beneficio nunca lo fija quien envía
    expect(row.promo_code ?? null).toBeNull();
    expect(row.contact_verified_at ?? null).toBeNull();
    expect(row.premium_activated).toBe(false);
  });

  it("normaliza el WhatsApp a 57XXXXXXXXXX", async () => {
    const r = await handleSubmit(goodForm({ contact: "(300) 123-4567" }), deps());
    expect(r.ok && r.contact).toEqual({ kind: "whatsapp", masked: "+57 300 *** 567" });
    expect(responses()[0]).toMatchObject({
      whatsapp: "573001234567",
      email: null,
      contact_key: "573001234567",
    });
  });

  it("rechaza lo inválido y dice qué campos corregir", async () => {
    const r = await handleSubmit(
      goodForm({ fullName: "Marta", contact: "hola", willingnessPct: 200 }),
      deps(),
    );
    expect(r).toMatchObject({ ok: false, error: "validation" });
    if (!r.ok && r.error === "validation")
      expect(r.fields).toEqual(expect.arrayContaining(["fullName", "contact", "willingnessPct"]));
    expect(responses()).toHaveLength(0);
  });

  it("exige el consentimiento", async () => {
    const r = await handleSubmit(goodForm({ consent: false }), deps());
    expect(r).toMatchObject({ ok: false, error: "validation", fields: ["consent"] });
  });

  it("el campo trampa lleno simula éxito sin guardar nada", async () => {
    const r = await handleSubmit(goodForm({ website: "http://spam.example" }), deps());
    expect(r.ok).toBe(true);
    expect(responses()).toHaveLength(0);
  });

  it("un envío imposiblemente rápido simula éxito sin guardar", async () => {
    const r = await handleSubmit(goodForm({ startedAt: NOW - 2_000 }), deps());
    expect(r.ok).toBe(true);
    expect(responses()).toHaveLength(0);
    const ok = await handleSubmit(goodForm({ startedAt: NOW - 9_000 }), deps());
    expect(ok.ok).toBe(true);
    expect(responses()).toHaveLength(1);
  });

  it("no premia respuestas sin sentido", async () => {
    const r = await handleSubmit(
      goodForm({
        serviceOffer: "asdfg asdfg asdfg asdfg",
        painPoint: "jjjjjjj kkkkkkk lllllll mmmmmmm nnnnnnn",
      }),
      deps(),
    );
    expect(r).toMatchObject({ ok: false, error: "low_quality" });
    if (!r.ok && r.error === "low_quality")
      expect(r.fields).toEqual(expect.arrayContaining(["serviceOffer", "painPoint"]));
    expect(responses()).toHaveLength(0);
  });

  it("limita por IP (5 por hora) y por contacto (3 por hora)", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await handleSubmit(
        goodForm({
          contact: `p${i}@correo.com`,
          serviceOffer: `Busco una auxiliar de enfermería número ${i}`,
        }),
        deps(),
      );
      expect(r.ok).toBe(true);
    }
    const blockedIp = await handleSubmit(
      goodForm({
        contact: "nuevo@correo.com",
        serviceOffer: "Busco enfermera para otro familiar mío",
      }),
      deps(),
    );
    expect(blockedIp).toEqual({ ok: false, error: "rate_limited" });

    headers = { "x-forwarded-for": "8.8.8.8" };
    db.tables.validation_responses = [];
    for (let i = 0; i < 3; i++) {
      headers["x-forwarded-for"] = `7.7.7.${i}`;
      const r = await handleSubmit(
        goodForm({
          contact: "mismo@correo.com",
          serviceOffer: `Busco una auxiliar de enfermería número ${i}`,
        }),
        deps(),
      );
      expect(r.ok).toBe(true);
    }
    headers["x-forwarded-for"] = "7.7.7.9";
    const blockedContact = await handleSubmit(
      goodForm({
        contact: "Mismo@Correo.com",
        serviceOffer: "Busco enfermera para otro familiar mío",
      }),
      deps(),
    );
    expect(blockedContact).toEqual({ ok: false, error: "rate_limited" });
  });

  it("reenviar lo mismo reutiliza la respuesta de las últimas 24 horas", async () => {
    const a = await handleSubmit(goodForm(), deps());
    const b = await handleSubmit(goodForm(), deps());
    expect(a.ok && b.ok && a.responseId === b.responseId).toBe(true);
    expect(responses()).toHaveLength(1);
    clock = NOW + 25 * 3_600_000;
    const c = await handleSubmit(goodForm({ startedAt: clock - 120_000 }), deps());
    expect(c.ok && a.ok && c.responseId !== a.responseId).toBe(true);
    expect(responses()).toHaveLength(2);
  });

  it("vincula la cuenta solo si el token es válido", async () => {
    headers.authorization = "Bearer tok-user";
    await handleSubmit(goodForm(), deps());
    expect(responses()[0].user_id).toBe("user-1");
    headers.authorization = "Bearer falso";
    await handleSubmit(
      goodForm({
        contact: "otra@correo.com",
        serviceOffer: "Busco una auxiliar de enfermería de día",
      }),
      deps(),
    );
    expect(responses()[1].user_id).toBeNull();
  });

  it("rechaza cuerpos desmesurados y falla sin sal", async () => {
    expect(await handleSubmit(goodForm({ comments: "x".repeat(25_000) }), deps())).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(await handleSubmit(goodForm(), deps({ salt: undefined }))).toEqual({
      ok: false,
      error: "server",
    });
  });

  it("registra la ejecución sin datos personales", async () => {
    await handleSubmit(goodForm(), deps());
    const log = db.tables.function_execution_logs[0];
    expect(log).toMatchObject({ function_name: "market-validation-submit", status: "success" });
    expect(JSON.stringify(log)).not.toContain("marta@correo.com");
  });
});

// ── Enviar el código ───────────────────────────────────────────────────────────────────────────────
const submitOk = async (over: Record<string, unknown> = {}) => {
  const r = await handleSubmit(goodForm(over), deps());
  if (!r.ok) throw new Error("no se pudo crear la respuesta de prueba");
  return r.responseId;
};

describe("handleSendOtp", () => {
  it("envía el código por correo y guarda solo su huella", async () => {
    const id = await submitOk();
    const r = await handleSendOtp({ responseId: id }, deps());
    expect(r).toEqual({
      ok: true,
      channel: "email",
      masked: "ma***@correo.com",
      resendInSeconds: 30,
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.resend.com/emails");
    expect(fetchCalls[0].auth).toBe("Bearer re_key");
    const html = String(fetchCalls[0].body.html);
    const code = html.match(/(\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const row = otps()[0];
    expect(row.code ?? null).toBeNull();
    expect(String(row.code_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(String(code));
    expect(row.expires_at).toBe(new Date(NOW + 15 * 60_000).toISOString());
    expect(row.contact).toBe("marta@correo.com");
    expect(row.channel).toBe("email");
  });

  it("por WhatsApp usa la plantilla aprobada cuando existe", async () => {
    const id = await submitOk({ contact: "300 123 4567" });
    const r = await handleSendOtp(
      { responseId: id },
      deps({
        otp: { whatsappToken: "wa-token", whatsappPhoneId: "999", whatsappTemplate: "humanix_otp" },
      }),
    );
    expect(r).toMatchObject({ ok: true, channel: "whatsapp", masked: "+57 300 *** 567" });
    expect(fetchCalls[0].url).toBe("https://graph.facebook.com/v21.0/999/messages");
    expect(fetchCalls[0].auth).toBe("Bearer wa-token");
    const body = fetchCalls[0].body as {
      to: string;
      type: string;
      template: {
        name: string;
        language: { code: string };
        components: Array<{ type: string; parameters: Array<{ text: string }> }>;
      };
    };
    expect(body.to).toBe("573001234567");
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("humanix_otp");
    expect(body.template.language.code).toBe("es");
    const code = body.template.components[0].parameters[0].text;
    expect(code).toMatch(/^\d{6}$/);
    expect(body.template.components[1].parameters[0].text).toBe(code);
  });

  it("sin plantilla envía texto simple (solo funciona dentro de las 24 horas de WhatsApp)", async () => {
    const id = await submitOk({ contact: "300 123 4567" });
    await handleSendOtp({ responseId: id }, deps());
    expect((fetchCalls[0].body as { type: string }).type).toBe("text");
  });

  it("si el canal no está configurado o falla, no deja códigos guardados", async () => {
    const id = await submitOk();
    expect(await handleSendOtp({ responseId: id }, deps({ otp: {} }))).toEqual({
      ok: false,
      error: "channel_unavailable",
    });
    expect(otps()).toHaveLength(0);
    fetchOk = false;
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "send_failed",
    });
    expect(otps()).toHaveLength(0);
  });

  it("valida la entrada y el estado de la respuesta", async () => {
    expect(await handleSendOtp({ responseId: "no-es-uuid" }, deps())).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await handleSendOtp({ responseId: crypto.randomUUID() }, deps())).toEqual({
      ok: false,
      error: "not_found",
    });
    const id = await submitOk();
    clock = NOW + 25 * 3_600_000;
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "not_found",
    });
    clock = NOW;
    responses()[0].contact_verified_at = new Date(NOW).toISOString();
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "already_verified",
    });
  });

  it("aplica espera entre reenvíos y topes por respuesta, contacto e IP", async () => {
    const id = await submitOk();
    expect((await handleSendOtp({ responseId: id }, deps())).ok).toBe(true);
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "rate_limited",
    }); // aún no pasan 30 s
    for (let i = 1; i < LIMITS_SERVER.otpPerResponse; i++) {
      clock += 31_000;
      expect((await handleSendOtp({ responseId: id }, deps())).ok).toBe(true);
    }
    clock += 31_000;
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "rate_limited",
    }); // tope por respuesta
  });

  it("limita por IP aunque cambien de respuesta", async () => {
    for (let i = 0; i < LIMITS_SERVER.otpPerIpHour; i++) {
      db.tables.validation_otps.push({
        id: `o${i}`,
        response_id: crypto.randomUUID(),
        contact: `x${i}@t.co`,
        ip_hash: null,
        created_at: new Date(NOW - 1000).toISOString(),
      });
    }
    const id = await submitOk();
    const ipHash = String(responses()[0].ip_hash);
    db.tables.validation_otps.forEach((o) => (o.ip_hash = ipHash));
    expect(await handleSendOtp({ responseId: id }, deps())).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it("permite corregir el contacto y envía al nuevo", async () => {
    const id = await submitOk({ contact: "300 123 4567" });
    const r = await handleSendOtp({ responseId: id, contact: "Nueva@Correo.com" }, deps());
    expect(r).toMatchObject({ ok: true, channel: "email" });
    expect(responses()[0]).toMatchObject({
      email: "nueva@correo.com",
      whatsapp: null,
      contact_key: "nueva@correo.com",
    });
    expect(otps()[0].contact).toBe("nueva@correo.com");
    expect(await handleSendOtp({ responseId: id, contact: "no-vale" }, deps())).toEqual({
      ok: false,
      error: "validation",
    });
  });
});

// ── Verificar el código ────────────────────────────────────────────────────────────────────────────
const sendAndGetCode = async (id: string, over: Partial<MarketDeps> = {}): Promise<string> => {
  fetchCalls = [];
  clock += 31_000;
  const r = await handleSendOtp({ responseId: id }, deps(over));
  if (!r.ok) throw new Error(`no se pudo enviar: ${r.error}`);
  return String(fetchCalls[0].body.html).match(/(\d{6})/)![1];
};

describe("handleVerifyOtp", () => {
  it("con el código correcto verifica el contacto y entrega un código del beneficio", async () => {
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    const r = await handleVerifyOtp({ responseId: id, code }, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.benefit).toBe("available");
    expect(r.promoCode).toMatch(
      /^MLP-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/,
    );
    expect(r.expiresAt).toBe(new Date(clock + 60 * 86_400_000).toISOString());
    expect(r.redeemed).toBeNull();
    expect(responses()[0]).toMatchObject({
      verified_channel: "email",
      benefit_status: "available",
      promo_code: r.promoCode,
    });
    expect(responses()[0].contact_verified_at).toBe(new Date(clock).toISOString());
    expect(otps()[0].verified_at).toBe(new Date(clock).toISOString());
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("un código incorrecto cuenta el intento y a los 5 bloquea hasta el correcto", async () => {
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await handleVerifyOtp({ responseId: id, code: wrong }, deps());
    expect(first).toEqual({ ok: false, error: "invalid_code", remaining: 4 });
    for (let i = 0; i < 4; i++) await handleVerifyOtp({ responseId: id, code: wrong }, deps());
    expect(otps()[0].attempts).toBe(5);
    expect(await handleVerifyOtp({ responseId: id, code }, deps())).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
    expect(responses()[0].contact_verified_at ?? null).toBeNull();
  });

  it("un código vencido o inexistente no sirve", async () => {
    const id = await submitOk();
    expect(await handleVerifyOtp({ responseId: id, code: "123456" }, deps())).toEqual({
      ok: false,
      error: "no_code",
    });
    const code = await sendAndGetCode(id);
    clock += 16 * 60_000;
    expect(await handleVerifyOtp({ responseId: id, code }, deps())).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await handleVerifyOtp({ responseId: id, code: "12" }, deps())).toEqual({
      ok: false,
      error: "validation",
    });
    expect(
      await handleVerifyOtp({ responseId: crypto.randomUUID(), code: "123456" }, deps()),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("un código ya usado no vale dos veces", async () => {
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    await handleVerifyOtp({ responseId: id, code }, deps());
    responses()[0].contact_verified_at = null; // simula una repetición del mismo código
    expect(await handleVerifyOtp({ responseId: id, code }, deps())).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("si ya estaba verificada devuelve el estado actual (recargar la página)", async () => {
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    const a = await handleVerifyOtp({ responseId: id, code }, deps());
    const b = await handleVerifyOtp({ responseId: id, code: "000000" }, deps());
    expect(a.ok && b.ok && a.promoCode === b.promoCode).toBe(true);
  });

  it("el mismo contacto recibe el mismo código aunque envíe otra respuesta", async () => {
    const id1 = await submitOk();
    const c1 = await sendAndGetCode(id1);
    const v1 = await handleVerifyOtp({ responseId: id1, code: c1 }, deps());
    clock += 2 * 3_600_000;
    const id2 = await submitOk({
      serviceOffer: "Busco una auxiliar de enfermería para mi suegra de día",
      startedAt: clock - 120_000,
    });
    const c2 = await sendAndGetCode(id2);
    const v2 = await handleVerifyOtp({ responseId: id2, code: c2 }, deps());
    expect(v1.ok && v2.ok && v1.promoCode === v2.promoCode).toBe(true);
    expect(responses().filter((r) => r.promo_code).length).toBe(1);
    expect(responses().find((r) => r.id === id2)?.benefit_status).toBe("duplicate_contact");
    expect(responses().find((r) => r.id === id2)?.contact_verified_at).toBeTruthy();
  });

  it("si el beneficio del contacto ya se canjeó o venció, no entrega otro", async () => {
    const id1 = await submitOk();
    const c1 = await sendAndGetCode(id1);
    await handleVerifyOtp({ responseId: id1, code: c1 }, deps());
    const first = responses().find((r) => r.id === id1)!;

    clock += 2 * 3_600_000;
    first.redeemed_by = "user-9";
    const id2 = await submitOk({
      serviceOffer: "Busco una auxiliar de enfermería para mi suegra de día",
      startedAt: clock - 120_000,
    });
    const c2 = await sendAndGetCode(id2);
    expect(await handleVerifyOtp({ responseId: id2, code: c2 }, deps())).toMatchObject({
      ok: true,
      benefit: "already_redeemed",
      promoCode: null,
    });

    first.redeemed_by = null;
    first.benefit_expires_at = new Date(clock - 1000).toISOString();
    const id3 = await submitOk({
      serviceOffer: "Busco una auxiliar de enfermería para mi tía de tarde",
      startedAt: clock - 120_000,
    });
    const c3 = await sendAndGetCode(id3);
    expect(await handleVerifyOtp({ responseId: id3, code: c3 }, deps())).toMatchObject({
      ok: true,
      benefit: "expired",
      promoCode: null,
    });
  });

  it("con sesión activa intenta el canje de inmediato y vincula la cuenta", async () => {
    headers.authorization = "Bearer tok-user";
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    const r = await handleVerifyOtp({ responseId: id, code }, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.redeemed).toEqual({
      ok: true,
      plan: "essential_monthly",
      endsAt: "2026-11-11T15:00:00Z",
    });
    expect(db.rpcCalls).toEqual([
      { name: "redeem_validation_benefit", args: { p_user: "user-1", p_code: r.promoCode } },
    ]);
    expect(responses()[0].user_id).toBe("user-1");
  });

  it("si el canje automático falla (ya tiene plan), el código queda disponible", async () => {
    db.rpcImpl = () => ({ ok: false, error: "plan_active" });
    headers.authorization = "Bearer tok-user";
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    const r = await handleVerifyOtp({ responseId: id, code }, deps());
    expect(r).toMatchObject({
      ok: true,
      benefit: "available",
      redeemed: { ok: false, error: "plan_active" },
    });
    expect(responses()[0].benefit_status).toBe("available");
  });

  it("peticiones en paralelo no adivinan el código: el contador usa control de concurrencia", async () => {
    const id = await submitOk();
    const code = await sendAndGetCode(id);
    db.beforeUpdate = (table, rows) => {
      if (table === "validation_otps" && rows[0]) rows[0].attempts = Number(rows[0].attempts) + 1; // otra petición ganó la carrera
    };
    expect(await handleVerifyOtp({ responseId: id, code }, deps())).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(responses()[0].contact_verified_at ?? null).toBeNull();
  });

  it("si dos verificaciones del mismo contacto chocan, gana la primera", async () => {
    const id1 = await submitOk();
    const c1 = await sendAndGetCode(id1);
    const v1 = await handleVerifyOtp({ responseId: id1, code: c1 }, deps());
    clock += 2 * 3_600_000;
    const id2 = await submitOk({
      serviceOffer: "Busco una auxiliar de enfermería para mi suegra de día",
      startedAt: clock - 120_000,
    });
    const c2 = await sendAndGetCode(id2);
    // el primer código aparece justo después de la comprobación previa
    let first = true;
    const original = db.from.bind(db);
    db.from = ((t: string) => {
      const b = original(t);
      if (t === "validation_responses" && first) {
        first = false;
        const realMaybe = b.maybeSingle.bind(b);
        b.maybeSingle = (() =>
          b.op === "select" && b.filters.length > 2
            ? Promise.resolve({ data: null, error: null })
            : realMaybe()) as typeof b.maybeSingle;
      }
      return b;
    }) as typeof db.from;
    const v2 = await handleVerifyOtp({ responseId: id2, code: c2 }, deps());
    db.from = original;
    expect(v1.ok && v2.ok).toBe(true);
    if (v1.ok && v2.ok) expect(v2.promoCode).toBe(v1.promoCode);
  });
});

// ── Canje ───────────────────────────────────────────────────────────────────────────────────────────
describe("handleRedeem", () => {
  it("llama al canje con la persona identificada en el servidor", async () => {
    const r = await handleRedeem({ code: "mlp-abcde-fghjk " }, "user-7", {
      admin: db as unknown as Db,
    });
    expect(r).toEqual({ ok: true, plan: "essential_monthly", endsAt: "2026-11-11T15:00:00Z" });
    expect(db.rpcCalls[0]).toEqual({
      name: "redeem_validation_benefit",
      args: { p_user: "user-7", p_code: "mlp-abcde-fghjk" },
    });
  });

  it("traduce los motivos de rechazo", async () => {
    for (const error of [
      "invalid_code",
      "not_verified",
      "already_redeemed",
      "expired",
      "user_already_rewarded",
      "plan_active",
    ] as const) {
      db.rpcImpl = () => ({ ok: false, error });
      expect(
        await handleRedeem({ code: "MLP-AAAAA-BBBBB" }, "u", { admin: db as unknown as Db }),
      ).toEqual({ ok: false, error });
    }
  });

  it("entrada inválida o error de base de datos", async () => {
    expect(await handleRedeem({ code: "x" }, "u", { admin: db as unknown as Db })).toEqual({
      ok: false,
      error: "invalid_code",
    });
    expect(await handleRedeem({}, "u", { admin: db as unknown as Db })).toEqual({
      ok: false,
      error: "invalid_code",
    });
    db.rpcImpl = () => undefined;
    expect(
      await handleRedeem({ code: "MLP-AAAAA-BBBBB" }, "u", { admin: db as unknown as Db }),
    ).toEqual({ ok: false, error: "server" });
  });
});

// ── Aleatoriedad ────────────────────────────────────────────────────────────────────────────────────
describe("códigos aleatorios", () => {
  it("el código de 6 dígitos y el del beneficio usan el generador inyectado sin sesgo", () => {
    let n = 0;
    const d = deps({ random: (len) => Uint8Array.from({ length: len }, () => n++ % 256) });
    expect(makeOtp(d)).toMatch(/^\d{6}$/);
    expect(makeBenefitCode(d)).toMatch(/^MLP-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    // bytes por encima del límite se descartan: 255 % 10 habría sesgado hacia 0-5
    const high = deps({
      random: () => Uint8Array.from([255, 254, 252, 5].concat(Array(28).fill(255))),
    });
    expect(makeOtp(high)).toBe("555555");
  });

  it("el código del beneficio no usa letras ni números ambiguos", () => {
    const d = deps();
    for (let i = 0; i < 200; i++) expect(makeBenefitCode(d).slice(4)).not.toMatch(/[ILO01]/);
  });
});
