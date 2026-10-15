// Saldo de créditos IA calculado desde las filas que la persona ya puede leer — lógica pura.
//
// En producción no existe la función `get_total_ai_credits_balance` (ver docs/VERIFICACION_PAGOS.md). Mientras no
// se aplique, el panel calcula el saldo de los paquetes comprados (`ai_credit_topups`): créditos vigentes menos los
// usados. El cupo mensual del plan no se puede calcular sin la función, así que se muestra en 0 (nunca se inventa).

export interface TopupRow {
  credits: number | null;
  credits_used: number | null;
  expires_at: string | null;
}

export interface ExtraCredits {
  extra_total: number;
  extra_used: number;
  extra_remaining: number;
}

/** Créditos de paquetes vigentes: comprados, usados y disponibles (nunca negativos). */
export function extraCreditsFromTopups(rows: readonly TopupRow[], now: number): ExtraCredits {
  let total = 0;
  let used = 0;
  for (const r of rows) {
    const exp = r.expires_at ? Date.parse(r.expires_at) : NaN;
    if (!Number.isFinite(exp) || exp <= now) continue;
    const c = Math.max(0, Math.floor(Number(r.credits) || 0));
    const u = Math.min(c, Math.max(0, Math.floor(Number(r.credits_used) || 0)));
    total += c;
    used += u;
  }
  return { extra_total: total, extra_used: used, extra_remaining: total - used };
}
