// Código de referido que trae el enlace `humanix.lat/auth?ref=XXXXXXXX`. Se guarda en el navegador al llegar y se aplica
// en la base (`apply_referral_code`, siempre para auth.uid()) apenas hay sesión: al registrarse con la sesión abierta, o
// después de confirmar el correo. La recompensa la da el cobro cuando la persona paga su primer plan.

export const REFERRAL_STORAGE_KEY = "humanix_ref_code";

/** Lo que responde `apply_referral_code`. Todas son finales: el código guardado ya no sirve para otro intento. */
export type ReferralApplyResult =
  "applied" | "invalid_code" | "own_code" | "already_referred" | "not_new" | "circular";

const FINAL: readonly string[] = [
  "applied",
  "invalid_code",
  "own_code",
  "already_referred",
  "not_new",
  "circular",
];

/** Código válido (8 letras o números, sin importar mayúsculas ni espacios) o `null`. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

export interface ReferralStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Guarda el código del enlace (si es válido). Devuelve el que queda guardado. */
export function rememberReferralCode(storage: ReferralStorage, raw: unknown): string | null {
  const code = normalizeReferralCode(raw);
  if (code) storage.setItem(REFERRAL_STORAGE_KEY, code);
  return code ?? normalizeReferralCode(storage.getItem(REFERRAL_STORAGE_KEY));
}

export type ApplyReferralRpc = (code: string) => Promise<{ data: unknown; error: unknown }>;

/**
 * Aplica el código guardado, si hay. Lo borra cuando la base dio una respuesta final; si la llamada falló (sin red,
 * función aún no desplegada), lo conserva para el próximo inicio de sesión. Nunca lanza: no bloquea la entrada.
 */
export async function applyStoredReferralCode(
  storage: ReferralStorage,
  rpc: ApplyReferralRpc,
): Promise<ReferralApplyResult | null> {
  let code: string | null = null;
  try {
    code = normalizeReferralCode(storage.getItem(REFERRAL_STORAGE_KEY));
    if (!code) {
      storage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    const { data, error } = await rpc(code);
    if (error || typeof data !== "string" || !FINAL.includes(data)) return null;
    storage.removeItem(REFERRAL_STORAGE_KEY);
    return data as ReferralApplyResult;
  } catch {
    return null;
  }
}
