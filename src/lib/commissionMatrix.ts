// Matriz de comisiones y reglas de billetera de Humanix. Lógica pura y probada (`commissionMatrix.test.ts`).
// La MISMA regla vive en SQL (`hx_commission_quote`, migración 20261103160000): estas funciones explican y anticipan, la base decide.
//
// Todo en pesos colombianos enteros (sin centavos).
//
// Quién paga: la comisión la paga siempre el profesional; la familia nunca paga comisión.
//   - Si contrata una familia: 15 % (0–19 turnos completados en los últimos 30 días), 12 % (20–59), 10 % (60 o más).
//   - Si contrata una institución con plan: 12 % (sede de 1 a 9 profesionales) o 10 % (10 o más).
//   - Primer turno de cada pareja (quien contrata, profesional): exonerado hasta $30.000 de comisión, si quien contrata se registró
//     hace 90 días o menos.
//
// Pago en efectivo (la familia le paga al profesional en mano): la comisión se descuenta de la billetera Humanix del profesional al
// terminar el turno. Para aceptar, saldo + cupo (hasta −$30.000) debe cubrir la comisión; por debajo de −$30.000 no acepta turnos.

export const MIN_BOOKING_COP = 45_000;
export const FIRUX_MIN_COP = 2_000;
export const FIRUX_MAX_COP = 12_000_000;
export const FIRST_SHIFT_EXEMPT_CAP_COP = 30_000;
export const FIRST_SHIFT_WINDOW_DAYS = 90;
export const WALLET_CREDIT_LIMIT_COP = -30_000;

export const PRO_TIERS = [
  { minShifts: 60, pct: 10, label: "Alta frecuencia" },
  { minShifts: 20, pct: 12, label: "Volumen" },
  { minShifts: 0, pct: 15, label: "Inicial" },
] as const;

export type InstitutionSize = "small" | "large";
export const INSTITUTION_PLANS = {
  small: {
    label: "Sede de 1 a 9 profesionales",
    monthlyCOP: 290_000,
    annualCOP: 3_480_000,
    pct: 12,
    maxPros: 9,
  },
  large: {
    label: "Sede de 10 o más profesionales",
    monthlyCOP: 490_000,
    annualCOP: 5_880_000,
    pct: 10,
    maxPros: null,
  },
} as const;

/** Escalón del profesional por turnos completados en los últimos 30 días. */
export function proTier(completedLast30d: number) {
  const n =
    Number.isFinite(completedLast30d) && completedLast30d > 0 ? Math.floor(completedLast30d) : 0;
  return PRO_TIERS.find((t) => n >= t.minShifts)!;
}

/** Cuántos turnos le faltan para el siguiente escalón (nulo si ya está en el más bajo de comisión). */
export function nextTier(completedLast30d: number): { shiftsToGo: number; pct: number } | null {
  const n = Math.max(0, Math.floor(completedLast30d || 0));
  if (n >= 60) return null;
  const target = n >= 20 ? 60 : 20;
  return { shiftsToGo: target - n, pct: target === 60 ? 10 : 12 };
}

export interface CommissionInput {
  totalCOP: number;
  /** Turnos que el profesional completó en los últimos 30 días. */
  proCompletedLast30d: number;
  /** Quien contrata es una institución con plan vigente: su tamaño. Nulo si es una familia o una institución sin plan. */
  institutionPlan: InstitutionSize | null;
  /** Turnos ya completados entre este profesional y quien contrata. */
  previousShiftsTogether: number;
  /** Días desde que quien contrata se registró. */
  clientAgeDays: number;
}

export interface CommissionQuote {
  pct: number;
  grossCOP: number;
  exemptCOP: number;
  feeCOP: number;
  netCOP: number;
  firstShift: boolean;
}

export function commissionQuote(i: CommissionInput): CommissionQuote {
  const total = Math.max(0, Math.round(i.totalCOP || 0));
  const pct = i.institutionPlan
    ? INSTITUTION_PLANS[i.institutionPlan].pct
    : proTier(i.proCompletedLast30d).pct;
  const gross = Math.round((total * pct) / 100);
  const firstShift =
    (i.previousShiftsTogether ?? 0) === 0 &&
    (i.clientAgeDays ?? Infinity) <= FIRST_SHIFT_WINDOW_DAYS;
  const exempt = firstShift ? Math.min(gross, FIRST_SHIFT_EXEMPT_CAP_COP) : 0;
  const fee = gross - exempt;
  return { pct, grossCOP: gross, exemptCOP: exempt, feeCOP: fee, netCOP: total - fee, firstShift };
}

export type CashCheck =
  | { ok: true; availableCOP: number }
  | { ok: false; reason: "blocked" | "insufficient"; availableCOP: number; missingCOP: number };

/**
 * ¿El profesional puede aceptar un turno en efectivo? Disponible = saldo + cupo (el cupo es hasta −$30.000).
 *  - Si el saldo ya está por debajo del cupo: bloqueado para turnos nuevos.
 *  - Si lo disponible no cubre la comisión: le falta recargar la diferencia.
 */
export function cashAcceptCheck(
  balanceCOP: number,
  feeCOP: number,
  creditLimitCOP = WALLET_CREDIT_LIMIT_COP,
): CashCheck {
  const available = Math.round(balanceCOP) - creditLimitCOP;
  if (balanceCOP < creditLimitCOP)
    return {
      ok: false,
      reason: "blocked",
      availableCOP: available,
      missingCOP: creditLimitCOP - balanceCOP,
    };
  if (available < feeCOP)
    return {
      ok: false,
      reason: "insufficient",
      availableCOP: available,
      missingCOP: feeCOP - available,
    };
  return { ok: true, availableCOP: available };
}

/** ¿Puede recibir turnos nuevos (de cualquier tipo)? Solo si su saldo no está por debajo del cupo. */
export function canTakeNewShifts(
  balanceCOP: number,
  creditLimitCOP = WALLET_CREDIT_LIMIT_COP,
): boolean {
  return balanceCOP >= creditLimitCOP;
}

/** Recarga sugerida: lo que falta, redondeado hacia arriba a miles y nunca menos que el mínimo de Firux. */
export function suggestedTopupCOP(missingCOP: number): number {
  const m = Math.max(FIRUX_MIN_COP, Math.ceil(Math.max(0, missingCOP) / 1000) * 1000);
  return Math.min(m, FIRUX_MAX_COP);
}

export const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
