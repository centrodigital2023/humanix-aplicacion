import { describe, expect, it } from "vitest";
import {
  STEP_UP_MAX_AGE_SECONDS,
  decodeJwtClaims,
  describeReadiness,
  fixableItems,
  identityMethodLabel,
  maskEmail,
  normalizeOtp,
  parseReadiness,
  stepUpFromClaims,
  stepUpSecondsLeft,
} from "./contractIdentity";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const sec = (offsetSeconds: number) => Math.floor(NOW / 1000) + offsetSeconds;

describe("stepUpFromClaims", () => {
  it("acepta un código confirmado hace pocos minutos", () => {
    const step = stepUpFromClaims({ amr: [{ method: "otp", timestamp: sec(-120) }] }, NOW);
    expect(step).toEqual({
      method: "email_otp",
      authenticated_at: new Date(sec(-120) * 1000).toISOString(),
      amr_method: "otp",
    });
  });

  it("toma el más reciente cuando hay varios", () => {
    const step = stepUpFromClaims(
      {
        amr: [
          { method: "password", timestamp: sec(-30) },
          { method: "otp", timestamp: sec(-500) },
          { method: "magiclink", timestamp: sec(-60) },
        ],
      },
      NOW,
    );
    expect(step?.amr_method).toBe("magiclink");
  });

  it("rechaza contraseña sola, códigos viejos y marcas del futuro", () => {
    expect(stepUpFromClaims({ amr: [{ method: "password", timestamp: sec(-5) }] }, NOW)).toBeNull();
    expect(
      stepUpFromClaims(
        { amr: [{ method: "otp", timestamp: sec(-(STEP_UP_MAX_AGE_SECONDS + 1)) }] },
        NOW,
      ),
    ).toBeNull();
    expect(stepUpFromClaims({ amr: [{ method: "otp", timestamp: sec(3_600) }] }, NOW)).toBeNull();
  });

  it("tolera un pequeño desfase de reloj", () => {
    expect(stepUpFromClaims({ amr: [{ method: "otp", timestamp: sec(60) }] }, NOW)).not.toBeNull();
  });

  it("no revienta con claims incompletos o raros", () => {
    for (const claims of [
      null,
      undefined,
      {},
      { amr: "otp" },
      { amr: [null, 5, "x", {}] },
      { amr: [{ method: "otp" }] },
      { amr: [{ method: "otp", timestamp: "ayer" }] },
      { amr: [{ method: 7, timestamp: sec(-5) }] },
    ]) {
      expect(stepUpFromClaims(claims as never, NOW)).toBeNull();
    }
  });

  it("calcula los segundos que quedan de validez", () => {
    const step = stepUpFromClaims({ amr: [{ method: "otp", timestamp: sec(-100) }] }, NOW);
    expect(stepUpSecondsLeft(step, NOW)).toBe(STEP_UP_MAX_AGE_SECONDS - 100);
    expect(stepUpSecondsLeft(null, NOW)).toBe(0);
    expect(stepUpSecondsLeft(step, NOW + 3_600_000)).toBe(0);
  });
});

describe("correo y código", () => {
  it("enmascara el correo", () => {
    expect(maskEmail("maria@gmail.com")).toBe("ma***@gmail.com");
    expect(maskEmail("a@x.co")).toBe("a***@x.co");
    expect(maskEmail("")).toBe("tu correo");
    expect(maskEmail(null)).toBe("tu correo");
    expect(maskEmail("sin-arroba")).toBe("tu correo");
  });

  it("normaliza el código de 6 a 8 dígitos", () => {
    expect(normalizeOtp("123456")).toBe("123456");
    expect(normalizeOtp(" 123 456 ")).toBe("123456");
    expect(normalizeOtp("12345678")).toBe("12345678");
    for (const bad of ["12345", "123456789", "12a456", "", "      "])
      expect(normalizeOtp(bad)).toBeNull();
  });
});

describe("readiness de identidad", () => {
  const raw = {
    party: "professional",
    ready: false,
    checks: [
      { id: "contract_open", ok: true },
      { id: "not_signed_yet", ok: true },
      { id: "full_name", ok: true },
      { id: "rethus", ok: false },
      { id: "not_blocked", ok: true },
    ],
    missing: ["rethus"],
  };

  it("convierte la respuesta del servidor", () => {
    const r = parseReadiness(raw);
    expect(r).toMatchObject({ party: "professional", ready: false, missing: ["rethus"] });
    expect(r?.checks).toHaveLength(5);
  });

  it("describe cada verificación y qué hacer", () => {
    const items = describeReadiness(parseReadiness(raw)!);
    const rethus = items.find((i) => i.id === "rethus")!;
    expect(rethus.ok).toBe(false);
    expect(rethus.fix).toContain("RETHUS");
    expect(rethus.href).toBe("/dashboard/profesional");
    expect(items.find((i) => i.id === "full_name")!.fix).toBeNull();
  });

  it("solo ofrece lo que la persona puede resolver", () => {
    const r = parseReadiness({
      ...raw,
      checks: [
        { id: "contract_open", ok: false },
        { id: "not_signed_yet", ok: true },
        { id: "rethus", ok: false },
      ],
    })!;
    expect(fixableItems(r).map((i) => i.id)).toEqual(["rethus"]);
  });

  it("institución: NIT, representante y verificación", () => {
    const r = parseReadiness({
      party: "institution",
      ready: false,
      checks: [
        { id: "institution_verified", ok: false },
        { id: "nit", ok: true },
        { id: "legal_representative", ok: false },
      ],
    })!;
    expect(fixableItems(r).map((i) => i.id)).toEqual([
      "institution_verified",
      "legal_representative",
    ]);
  });

  it("descarta respuestas mal formadas", () => {
    for (const bad of [null, 5, {}, { party: "otro", checks: [] }, { party: "institution" }]) {
      expect(parseReadiness(bad)).toBeNull();
    }
    expect(parseReadiness({ party: "institution", checks: [null, { id: 5 }] })?.checks).toEqual([]);
  });

  it("nombra los métodos de identidad registrados en la firma", () => {
    expect(identityMethodLabel("rethus_verified+email_otp")).toContain("RETHUS");
    expect(identityMethodLabel("institution_verified+email_otp")).toContain("NIT");
    expect(identityMethodLabel("otro")).toBe("otro");
  });
});

describe("decodeJwtClaims", () => {
  const b64url = (o: unknown) => {
    let binary = "";
    for (const byte of new TextEncoder().encode(JSON.stringify(o)))
      binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  it("lee el contenido del token sin verificarlo", () => {
    const token = `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", email: "mañana@x.co", amr: [{ method: "otp", timestamp: 1 }] })}.firma`;
    expect(decodeJwtClaims(token)).toMatchObject({ sub: "u1", email: "mañana@x.co" });
  });

  it("devuelve null con tokens vacíos o mal formados", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "a.b",
      "a.b.c.d",
      "x.%%%.z",
      `${b64url({})}.${b64url([1])}.z`,
    ]) {
      expect(decodeJwtClaims(bad as never)).toBeNull();
    }
  });

  it("encaja con stepUpFromClaims", () => {
    const ts = Math.floor(NOW / 1000) - 30;
    const token = `${b64url({})}.${b64url({ sub: "u1", amr: [{ method: "otp", timestamp: ts }] })}.z`;
    expect(stepUpFromClaims(decodeJwtClaims(token), NOW)?.amr_method).toBe("otp");
  });
});
