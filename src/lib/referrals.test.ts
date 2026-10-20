import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APPLY_RESULTS,
  isFinalApplyResult,
  normalizeReferralCode,
  REFERRAL_CODE_RE,
  referralStats,
} from "./referrals";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261020150000_referrals_security.sql");

/** Cuerpo de una función de la migración (entre su CREATE y el siguiente `$$;`). */
function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `falta ${name} en la migración`).toBeGreaterThanOrEqual(0);
  return MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
}

describe("normalizeReferralCode", () => {
  it("acepta el código del enlace sin importar mayúsculas ni espacios", () => {
    expect(normalizeReferralCode("23de5d36")).toBe("23DE5D36");
    expect(normalizeReferralCode("  ABCD1234 ")).toBe("ABCD1234");
  });

  it("rechaza lo que no puede ser un código", () => {
    for (const bad of [
      "",
      "abc",
      "ABCD-1234",
      "ABCD1234ABCD9",
      "x'; drop table x; --",
      null,
      undefined,
      12345678,
      {},
    ]) {
      expect(normalizeReferralCode(bad)).toBeNull();
    }
  });

  it("usa la misma forma que la restricción de referral_codes en la base", () => {
    expect(MIGRATION).toContain(`CHECK (code ~ '${REFERRAL_CODE_RE.source}')`);
    expect(functionBody("apply_referral_code")).toContain(`'${REFERRAL_CODE_RE.source}'`);
  });
});

describe("isFinalApplyResult", () => {
  it("cualquier respuesta del servidor termina el intento", () => {
    for (const r of APPLY_RESULTS) expect(isFinalApplyResult(r)).toBe(true);
  });

  it("lo demás (error, vacío, desconocido) se reintenta", () => {
    for (const r of [null, undefined, "", "error", 1, { result: "applied" }]) {
      expect(isFinalApplyResult(r)).toBe(false);
    }
  });

  it("las respuestas son las mismas que devuelve apply_referral_code", () => {
    const returned = [...functionBody("apply_referral_code").matchAll(/RETURN '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(new Set(returned)).toEqual(new Set(APPLY_RESULTS));
  });
});

describe("referralStats", () => {
  it("cuenta invitados, suscritos y meses ganados", () => {
    const rows = [
      { status: "registered" },
      { status: "registered" },
      { status: "subscribed" },
      { status: "rewarded" },
      { status: "rewarded" },
    ];
    expect(referralStats(rows)).toEqual({ invited: 5, subscribed: 3, monthsEarned: 2 });
  });

  it("ignora filas sin referido (diseño anterior) y entradas raras", () => {
    expect(referralStats([{ status: "pending" }, { status: "otro" }, null, {}])).toEqual({
      invited: 0,
      subscribed: 0,
      monthsEarned: 0,
    });
    expect(referralStats(null)).toEqual({ invited: 0, subscribed: 0, monthsEarned: 0 });
  });
});

describe("seguridad de la migración", () => {
  it("apply_referral_code solo recibe el código y usa auth.uid()", () => {
    expect(MIGRATION).toContain("DROP FUNCTION IF EXISTS public.apply_referral_code(text, uuid);");
    expect(MIGRATION).toMatch(
      /CREATE OR REPLACE FUNCTION public\.apply_referral_code\(p_code text\)/,
    );
    expect(functionBody("apply_referral_code")).toContain("v_uid      uuid := auth.uid();");
  });

  it("get_or_create_referral_code solo sirve para la propia cuenta", () => {
    expect(functionBody("get_or_create_referral_code")).toContain(
      "IF p_user_id IS DISTINCT FROM v_uid THEN",
    );
  });

  it("los clientes solo leen referrals: sin políticas ni privilegios de escritura", () => {
    expect(MIGRATION).toContain(
      'DROP POLICY IF EXISTS "referrals_update_system" ON public.referrals;',
    );
    expect(MIGRATION).toContain(
      'DROP POLICY IF EXISTS "referrals_insert_own"    ON public.referrals;',
    );
    expect(MIGRATION).not.toMatch(
      /CREATE POLICY[^;]*ON public\.referrals FOR (INSERT|UPDATE|DELETE|ALL)/,
    );
    expect(MIGRATION).toContain("REVOKE ALL ON public.referrals FROM PUBLIC, anon, authenticated;");
    expect(MIGRATION).not.toMatch(
      /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON public\.referrals TO authenticated/,
    );
  });

  it("la recompensa usa mp_subscriptions y solo la da el servidor", () => {
    const body = functionBody("grant_referral_reward");
    expect(body).toContain("public.mp_subscriptions");
    expect(body).not.toMatch(/public\.subscriptions\b/);
    expect(MIGRATION).toContain(
      "REVOKE ALL ON FUNCTION public.grant_referral_reward(uuid) FROM PUBLIC, anon, authenticated;",
    );
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.grant_referral_reward(uuid) TO service_role;",
    );
  });

  it("la función de recompensa ya no toca la tabla vieja subscriptions", () => {
    const edge = read("../../supabase/functions/apply-referral-reward/index.ts");
    expect(edge).not.toMatch(/from\("subscriptions"\)/);
    expect(edge).toContain('rpc("grant_referral_reward"');
  });

  it("el registro no envía el id de usuario al aplicar el código", () => {
    const hook = read("../hooks/use-pending-referral.ts");
    expect(hook).toContain('rpc("apply_referral_code", { p_code: code })');
    expect(read("../routes/auth.tsx")).not.toContain("p_new_user_id");
  });
});
