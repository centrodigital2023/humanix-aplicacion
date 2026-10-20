import { describe, expect, it, vi } from "vitest";
import {
  REFERRAL_STORAGE_KEY,
  applyStoredReferralCode,
  normalizeReferralCode,
  rememberReferralCode,
} from "./referralCode";

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

describe("normalizeReferralCode", () => {
  it("acepta 8 letras o números sin importar mayúsculas ni espacios", () => {
    expect(normalizeReferralCode(" ab12cd34 ")).toBe("AB12CD34");
  });
  it("rechaza lo demás", () => {
    for (const v of ["", "ABC", "AB12CD345", "AB-2CD34", "<script>", null, 42]) {
      expect(normalizeReferralCode(v)).toBeNull();
    }
  });
});

describe("rememberReferralCode", () => {
  it("guarda el código del enlace", () => {
    const s = memory();
    expect(rememberReferralCode(s, "ab12cd34")).toBe("AB12CD34");
    expect(s.m.get(REFERRAL_STORAGE_KEY)).toBe("AB12CD34");
  });
  it("sin enlace devuelve el guardado; un enlace dañado no lo pisa", () => {
    const s = memory({ [REFERRAL_STORAGE_KEY]: "AB12CD34" });
    expect(rememberReferralCode(s, undefined)).toBe("AB12CD34");
    expect(rememberReferralCode(s, "nope")).toBe("AB12CD34");
  });
});

describe("applyStoredReferralCode", () => {
  it("sin código guardado no llama a la base", async () => {
    const rpc = vi.fn();
    expect(await applyStoredReferralCode(memory(), rpc)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aplica el código y lo borra cuando la respuesta es final", async () => {
    for (const result of [
      "applied",
      "invalid_code",
      "own_code",
      "already_referred",
      "not_new",
      "circular",
    ]) {
      const s = memory({ [REFERRAL_STORAGE_KEY]: "AB12CD34" });
      const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
      expect(await applyStoredReferralCode(s, rpc)).toBe(result);
      expect(rpc).toHaveBeenCalledWith("AB12CD34");
      expect(s.m.has(REFERRAL_STORAGE_KEY)).toBe(false);
    }
  });

  it("si la llamada falla, lo conserva para el próximo inicio de sesión y no lanza", async () => {
    const s = memory({ [REFERRAL_STORAGE_KEY]: "AB12CD34" });
    expect(
      await applyStoredReferralCode(s, async () => ({ data: null, error: { message: "x" } })),
    ).toBeNull();
    expect(await applyStoredReferralCode(s, () => Promise.reject(new Error("offline")))).toBeNull();
    expect(
      await applyStoredReferralCode(s, async () => ({ data: "raro", error: null })),
    ).toBeNull();
    expect(s.m.get(REFERRAL_STORAGE_KEY)).toBe("AB12CD34");
  });

  it("un valor guardado dañado se descarta sin llamar a la base", async () => {
    const s = memory({ [REFERRAL_STORAGE_KEY]: "javascript:x" });
    const rpc = vi.fn();
    expect(await applyStoredReferralCode(s, rpc)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(s.m.has(REFERRAL_STORAGE_KEY)).toBe(false);
  });
});
