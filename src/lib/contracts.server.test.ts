import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONDITIONS,
  TEMPLATE_V1,
  contractBodyHash,
  type ContractTerms,
} from "./contractTemplate";
import {
  clientIp,
  handleSign,
  mapSignatureError,
  type ContractDeps,
  type Db,
} from "./contracts.server";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const nowSec = Math.floor(NOW / 1000);
const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";
const PRO = "22222222-2222-4222-8222-222222222222";
const INST = "33333333-3333-4333-8333-333333333333";
const TERMS_HASH = "a".repeat(64);

const terms: ContractTerms = {
  template: TEMPLATE_V1,
  version: 1,
  contract_no: "HX-2026-000001",
  parties: {
    institution: {
      user_id: INST,
      name: "Clínica Santa Fe",
      type: "Clínica",
      nit: "900123456-7",
      legal_representative: "Ana Duarte",
      city: "Bogotá",
      verified: true,
    },
    professional: {
      user_id: PRO,
      name: "Laura Gómez",
      specialty: "Enfermería",
      rethus_number: "123",
      rethus_verified: true,
    },
  },
  object: {
    title: "Turnos UCI",
    description: null,
    specialty: "Enfermería",
    service_area: "UCI",
    city: "Bogotá",
    address: "Cra 7 # 1-1",
    modality: "shift",
    requirements: [],
  },
  shifts: [
    {
      no: 1,
      starts_at: "2026-10-10T23:00:00Z",
      ends_at: "2026-10-11T11:00:00Z",
      hours: 12,
      amount: 200_000,
    },
  ],
  economics: {
    agreed_amount: 200_000,
    posted_amount: 200_000,
    modality: "shift",
    currency: "COP",
    total_amount: 200_000,
    commission_pct: 0,
    professional_net: 200_000,
    payment_channel: "platform_web_only",
  },
  conditions: DEFAULT_CONDITIONS,
  legal: {
    signature_deadline: "2026-10-10T12:00:00Z",
    governing_law: "CO",
    esign_agreement: true,
    data_protection: "ley_1581_2012",
    dispute: "conciliacion_pqrs",
  },
  required_clauses: ["contract", "credentials", "confidentiality", "esign"],
  generated_at: "2026-10-09T14:00:00Z",
};
const ALL = ["contract", "credentials", "confidentiality", "esign"];

type RpcCall = { fn: string; args: Record<string, unknown> };

function fakeDb(opts: {
  row?: Record<string, unknown> | null;
  readError?: boolean;
  rpcResult?: { data?: unknown; error?: { message?: string; hint?: string; code?: string } | null };
}) {
  const calls: RpcCall[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              opts.row === undefined
                ? {
                    id: CONTRACT_ID,
                    terms,
                    terms_hash: TERMS_HASH,
                    template_version: TEMPLATE_V1,
                    institution_user_id: INST,
                    professional_id: PRO,
                  }
                : opts.row,
            error: opts.readError ? { message: "boom" } : null,
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return (
        opts.rpcResult ?? {
          data: {
            status: "partially_signed",
            party: "professional",
            signed_at: "2026-10-09T15:00:01Z",
            signature_hash: "f".repeat(64),
            fully_signed: false,
          },
          error: null,
        }
      );
    },
  } as unknown as Db;
  return { db, calls };
}

const headers: Record<string, string> = {
  "cf-connecting-ip": "203.0.113.9",
  "user-agent": "Mozilla/5.0 test",
};
const deps = (db: Db, over: Partial<ContractDeps> = {}): ContractDeps => ({
  admin: db,
  header: (n) => headers[n],
  salt: "sal-secreta",
  now: () => NOW,
  ...over,
});
const freshClaims = { sub: PRO, amr: [{ method: "otp", timestamp: nowSec - 30 }] };

async function body(): Promise<string> {
  return contractBodyHash(terms);
}

async function input(over: Record<string, unknown> = {}) {
  return {
    contractId: CONTRACT_ID,
    termsHash: TERMS_HASH,
    bodyHash: await body(),
    accepted: ALL,
    ...over,
  };
}

describe("handleSign", () => {
  it("firma y llama a record_contract_signature con el segundo factor y sin guardar la IP en claro", async () => {
    const { db, calls } = fakeDb({});
    const res = await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(db));
    expect(res).toMatchObject({
      ok: true,
      status: "partially_signed",
      fullySigned: false,
      party: "professional",
    });
    expect(calls).toHaveLength(1);
    const a = calls[0].args;
    expect(calls[0].fn).toBe("record_contract_signature");
    expect(a.p_signer_id).toBe(PRO);
    expect(a.p_terms_hash).toBe(TERMS_HASH);
    expect(a.p_accepted_clauses).toEqual(ALL);
    expect(a.p_step_up).toMatchObject({ method: "email_otp", amr_method: "otp" });
    expect(a.p_user_agent).toBe("Mozilla/5.0 test");
    expect(String(a.p_ip_hash)).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(a)).not.toContain("203.0.113.9");
  });

  it("el signer sale del token, nunca de lo que envía el cliente", async () => {
    const { db, calls } = fakeDb({});
    await handleSign(
      { ...(await input()), p_signer_id: INST, signerId: INST },
      { userId: PRO, claims: freshClaims },
      deps(db),
    );
    expect(calls[0].args.p_signer_id).toBe(PRO);
  });

  it("sin sal no guarda ninguna huella de IP", async () => {
    const { db, calls } = fakeDb({});
    await handleSign(
      await input(),
      { userId: PRO, claims: freshClaims },
      deps(db, { salt: undefined }),
    );
    expect(calls[0].args.p_ip_hash).toBeNull();
  });

  it("rechaza entradas mal formadas", async () => {
    const { db, calls } = fakeDb({});
    for (const bad of [
      null,
      {},
      { contractId: "x" },
      await input({ termsHash: "zz" }),
      await input({ bodyHash: "short" }),
      await input({ accepted: "esign" }),
    ]) {
      const res = await handleSign(bad, { userId: PRO, claims: freshClaims }, deps(db));
      expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(calls).toHaveLength(0);
  });

  it("exige un segundo factor reciente", async () => {
    const { db, calls } = fakeDb({});
    for (const claims of [
      { sub: PRO },
      { sub: PRO, amr: [{ method: "password", timestamp: nowSec - 5 }] },
      { sub: PRO, amr: [{ method: "otp", timestamp: nowSec - 3_600 }] },
    ]) {
      const res = await handleSign(await input(), { userId: PRO, claims }, deps(db));
      expect(res).toMatchObject({ ok: false, code: "step_up_required" });
    }
    expect(calls).toHaveLength(0);
  });

  it("no revela si el contrato existe cuando la persona no es parte", async () => {
    const { db: other } = fakeDb({});
    const outsider = await handleSign(
      await input(),
      { userId: "99999999-9999-4999-8999-999999999999", claims: freshClaims },
      deps(other),
    );
    const { db: none } = fakeDb({ row: null });
    const missing = await handleSign(
      await input(),
      { userId: PRO, claims: freshClaims },
      deps(none),
    );
    expect(outsider).toMatchObject({ ok: false, code: "not_found" });
    expect(missing).toMatchObject({ ok: false, code: "not_found" });
    expect((outsider as { message: string }).message).toBe(
      (missing as { message: string }).message,
    );
  });

  it("falla si no puede leer el contrato", async () => {
    const { db } = fakeDb({ readError: true });
    expect(
      await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(db)),
    ).toMatchObject({ ok: false, code: "failed" });
  });

  it("detecta que el contrato cambió desde que se abrió", async () => {
    const { db, calls } = fakeDb({});
    const res = await handleSign(
      await input({ termsHash: "b".repeat(64) }),
      { userId: PRO, claims: freshClaims },
      deps(db),
    );
    expect(res).toMatchObject({ ok: false, code: "terms_changed" });
    expect(calls).toHaveLength(0);
  });

  it("detecta que el texto visto no es el del contrato", async () => {
    const { db, calls } = fakeDb({});
    const res = await handleSign(
      await input({ bodyHash: "c".repeat(64) }),
      { userId: PRO, claims: freshClaims },
      deps(db),
    );
    expect(res).toMatchObject({ ok: false, code: "body_mismatch" });
    expect(calls).toHaveLength(0);
  });

  it("exige todas las declaraciones y dice cuáles faltan", async () => {
    const { db, calls } = fakeDb({});
    const res = await handleSign(
      await input({ accepted: ["contract", "esign"] }),
      { userId: PRO, claims: freshClaims },
      deps(db),
    );
    expect(res).toMatchObject({
      ok: false,
      code: "clauses_required",
      missing: ["credentials", "confidentiality"],
    });
    expect(calls).toHaveLength(0);
  });

  it("rechaza plantillas que esta versión no conoce", async () => {
    const { db } = fakeDb({
      row: {
        id: CONTRACT_ID,
        terms: { ...terms, template: "humanix-shift-v9" },
        terms_hash: TERMS_HASH,
        template_version: "humanix-shift-v9",
        institution_user_id: INST,
        professional_id: PRO,
      },
    });
    expect(
      await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(db)),
    ).toMatchObject({ ok: false, code: "unsupported_template" });
    const { db: broken } = fakeDb({
      row: {
        id: CONTRACT_ID,
        terms: { nada: true },
        terms_hash: TERMS_HASH,
        template_version: TEMPLATE_V1,
        institution_user_id: INST,
        professional_id: PRO,
      },
    });
    expect(
      await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(broken)),
    ).toMatchObject({ ok: false, code: "unsupported_template" });
  });

  it("traduce los errores de la base de datos", async () => {
    const cases: Array<[{ message: string; hint?: string; code?: string }, string]> = [
      [{ message: "x", hint: "identity_not_verified" }, "identity_not_verified"],
      [{ message: "x", hint: "contract_expired" }, "contract_expired"],
      [{ message: "x", hint: "contract_closed" }, "contract_closed"],
      [{ message: "x", hint: "terms_changed" }, "terms_changed"],
      [{ message: "Ya firmaste este contrato", code: "23505" }, "already_signed"],
      [{ message: "No participas en este contrato" }, "not_found"],
      [{ message: "boom" }, "failed"],
    ];
    for (const [error, code] of cases) {
      const { db } = fakeDb({ rpcResult: { data: null, error } });
      const res = await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(db));
      expect(res).toMatchObject({ ok: false, code });
    }
  });

  it("extrae qué verificaciones de identidad faltan", () => {
    expect(
      mapSignatureError({
        message: 'Tu identidad aún no está validada: ["rethus", "full_name"]',
        hint: "identity_not_verified",
      }),
    ).toMatchObject({ code: "identity_not_verified", missing: ["rethus", "full_name"] });
  });

  it("una respuesta inesperada del RPC no se toma como firma válida", async () => {
    const { db } = fakeDb({ rpcResult: { data: { status: "weird" }, error: null } });
    expect(
      await handleSign(await input(), { userId: PRO, claims: freshClaims }, deps(db)),
    ).toMatchObject({ ok: false, code: "failed" });
  });

  it("firma completa cuando es la segunda firma", async () => {
    const { db } = fakeDb({
      rpcResult: {
        data: {
          status: "active",
          party: "institution",
          signed_at: "2026-10-09T15:00:02Z",
          signature_hash: "e".repeat(64),
          fully_signed: true,
        },
        error: null,
      },
    });
    const res = await handleSign(
      await input(),
      {
        userId: INST,
        claims: { sub: INST, amr: [{ method: "magiclink", timestamp: nowSec - 10 }] },
      },
      deps(db),
    );
    expect(res).toMatchObject({
      ok: true,
      status: "active",
      fullySigned: true,
      party: "institution",
    });
  });
});

describe("clientIp", () => {
  it("prefiere el encabezado de Cloudflare, luego x-forwarded-for y x-real-ip", () => {
    expect(
      clientIp(
        (n) =>
          (
            ({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }) as Record<
              string,
              string
            >
          )[n],
      ),
    ).toBe("1.1.1.1");
    expect(
      clientIp((n) => (({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }) as Record<string, string>)[n]),
    ).toBe("2.2.2.2");
    expect(clientIp((n) => (({ "x-real-ip": "4.4.4.4" }) as Record<string, string>)[n])).toBe(
      "4.4.4.4",
    );
    expect(clientIp(() => undefined)).toBe("unknown");
  });
});
