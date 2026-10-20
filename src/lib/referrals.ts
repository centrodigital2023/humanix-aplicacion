// Referidos — lógica pura de presentación.
//
// El servidor decide todo lo que importa (migración 20261020150000_referrals_security.sql): el código propio
// (`get_or_create_referral_code`, solo para auth.uid()), quién usó un código (`apply_referral_code`, siempre para
// auth.uid()) y la recompensa (`grant_referral_reward`, solo el servidor, con mp_subscriptions). Aquí solo se limpia el
// código del enlace, se decide si el intento terminó y se cuentan las filas para la tarjeta.

/** Misma forma que la restricción de `referral_codes.code` en la base. */
export const REFERRAL_CODE_RE = /^[A-Z0-9]{6,12}$/;

/** Clave de localStorage donde se guarda el código del enlace ?ref= hasta que haya sesión. */
export const PENDING_REFERRAL_KEY = "humanix_ref_code";

/** Código del enlace → forma canónica (mayúsculas, sin espacios) o `null` si no puede ser un código. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_RE.test(code) ? code : null;
}

/** Respuestas de `apply_referral_code`. */
export const APPLY_RESULTS = [
  "applied",
  "invalid_code",
  "self_referral",
  "already_referred",
  "not_eligible",
] as const;
export type ApplyResult = (typeof APPLY_RESULTS)[number];

/**
 * ¿El intento terminó? Cualquier respuesta del servidor es definitiva (se borra el código guardado); un error de red o
 * de sesión no lo es (se reintenta en la próxima sesión).
 */
export function isFinalApplyResult(result: unknown): result is ApplyResult {
  return typeof result === "string" && (APPLY_RESULTS as readonly string[]).includes(result);
}

export interface ReferralStats {
  /** Personas que se registraron con el enlace. */
  invited: number;
  /** De ellas, cuántas ya pagaron un plan. */
  subscribed: number;
  /** Meses ganados (uno por recompensa aplicada). */
  monthsEarned: number;
}

/** Filas de `referrals` (columna status) de quien refiere → números de la tarjeta. */
export function referralStats(rows: unknown): ReferralStats {
  const stats: ReferralStats = { invited: 0, subscribed: 0, monthsEarned: 0 };
  if (!Array.isArray(rows)) return stats;
  for (const r of rows as Array<{ status?: unknown }>) {
    const status = r?.status;
    if (status === "registered" || status === "subscribed" || status === "rewarded") {
      stats.invited += 1;
      if (status !== "registered") stats.subscribed += 1;
      if (status === "rewarded") stats.monthsEarned += 1;
    }
  }
  return stats;
}
