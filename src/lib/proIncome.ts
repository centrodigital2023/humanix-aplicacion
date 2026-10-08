// Planificador de ingresos del profesional independiente. Funciones puras y ESTIMATIVAS:
// no son asesoría tributaria ni de seguridad social. Los porcentajes de aportes cambian por decreto
// (y la reforma pensional puede modificarlos); por eso viven en `CO_RULES` con el año a la vista y
// la interfaz muestra siempre los supuestos y un descargo.

import { MAX_HOURLY_RATE, MIN_HOURLY_RATE, SMMLV_2026 } from "./negotiation";

export const CO_RULES = {
  year: 2026,
  smmlv: SMMLV_2026,
  /** Base de cotización de un independiente por prestación de servicios: 40 % del ingreso. */
  ibcShare: 0.4,
  /** Tope de la base de cotización, en salarios mínimos. */
  ibcCapSmmlv: 25,
  health: 0.125,
  pension: 0.16,
  /** Tarifa ARL por clase de riesgo (I a V). Depende de la actividad: consulta tu ARL. */
  arl: { 1: 0.00522, 2: 0.01044, 3: 0.02436, 4: 0.0435, 5: 0.0696 } as Record<ArlClass, number>,
  weeksPerMonth: 52 / 12,
} as const;

export type ArlClass = 1 | 2 | 3 | 4 | 5;

export const INCOME_DISCLAIMER =
  "Estimación orientativa con las reglas de 2026. No incluye impuesto de renta ni deducciones, y los " +
  "porcentajes pueden cambiar por decreto o por la reforma pensional. Confirma con tu contador o tu EPS/AFP.";

/** Porcentaje del Fondo de Solidaridad y Subsistencia pensional según la base, en SMMLV. */
export function solidarityRate(ibcInSmmlv: number): number {
  if (ibcInSmmlv < 4) return 0;
  if (ibcInSmmlv < 16) return 0.01;
  if (ibcInSmmlv < 17) return 0.012;
  if (ibcInSmmlv < 18) return 0.014;
  if (ibcInSmmlv < 19) return 0.016;
  if (ibcInSmmlv < 20) return 0.018;
  return 0.02;
}

export interface IncomeInput {
  hoursPerWeek: number;
  hourlyRate: number;
  /** Comisión de plataforma: 12 en plan Free, 0 en planes de pago. */
  commissionPct: number;
  /** Si cotiza como independiente (salud, pensión, ARL). */
  paysContributions: boolean;
  arlClass?: ArlClass;
}

export interface Contributions {
  applicable: boolean;
  ibc: number;
  health: number;
  pension: number;
  arl: number;
  solidarity: number;
  total: number;
}

export interface IncomeProjection {
  hoursPerMonth: number;
  /** Lo que pagan las familias en el mes. */
  grossMonthly: number;
  commission: number;
  /** Ingreso del profesional después de la comisión. */
  billedMonthly: number;
  contributions: Contributions;
  netMonthly: number;
  netPerHour: number;
  belowMinimumWage: boolean;
  notes: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function monthlyContributions(
  billedMonthly: number,
  arlClass: ArlClass = 1,
  paysContributions = true,
): Contributions {
  const none: Contributions = {
    applicable: false,
    ibc: 0,
    health: 0,
    pension: 0,
    arl: 0,
    solidarity: 0,
    total: 0,
  };
  // Con ingresos menores a un salario mínimo la obligación puede ser distinta (cotización por semanas
  // o Piso de Protección Social): no se inventa una cifra.
  if (!paysContributions || billedMonthly < CO_RULES.smmlv) return none;
  const ibc = Math.round(
    clamp(billedMonthly * CO_RULES.ibcShare, CO_RULES.smmlv, CO_RULES.smmlv * CO_RULES.ibcCapSmmlv),
  );
  const health = Math.round(ibc * CO_RULES.health);
  const pension = Math.round(ibc * CO_RULES.pension);
  const arl = Math.round(ibc * CO_RULES.arl[arlClass]);
  const solidarity = Math.round(ibc * solidarityRate(ibc / CO_RULES.smmlv));
  return {
    applicable: true,
    ibc,
    health,
    pension,
    arl,
    solidarity,
    total: health + pension + arl + solidarity,
  };
}

export function projectIncome(input: IncomeInput): IncomeProjection {
  const hoursPerMonth = Math.round(safe(input.hoursPerWeek) * CO_RULES.weeksPerMonth * 10) / 10;
  const grossMonthly = Math.round(safe(input.hourlyRate) * hoursPerMonth);
  const pct = clamp(input.commissionPct, 0, 100);
  const commission = Math.round((grossMonthly * pct) / 100);
  const billedMonthly = grossMonthly - commission;
  const contributions = monthlyContributions(
    billedMonthly,
    input.arlClass ?? 1,
    input.paysContributions,
  );
  const netMonthly = billedMonthly - contributions.total;
  const notes: string[] = [];
  if (input.paysContributions && !contributions.applicable && billedMonthly > 0) {
    notes.push(
      "Con ingresos por debajo de un salario mínimo la forma de cotizar puede ser distinta (por semanas o Piso de Protección Social). Consulta tu EPS/AFP.",
    );
  }
  if (contributions.applicable && contributions.ibc === CO_RULES.smmlv) {
    notes.push("Tu base de cotización quedó en el mínimo legal (1 salario mínimo).");
  }
  return {
    hoursPerMonth,
    grossMonthly,
    commission,
    billedMonthly,
    contributions,
    netMonthly,
    netPerHour: hoursPerMonth > 0 ? Math.round(netMonthly / hoursPerMonth) : 0,
    belowMinimumWage: netMonthly < CO_RULES.smmlv,
    notes,
  };
}

/**
 * Menor tarifa por hora (en pasos de COP 100) con la que el neto mensual alcanza la meta. Se recorre
 * linealmente porque el neto NO es monótono: al llegar a un salario mínimo de ingreso empiezan los
 * aportes obligatorios y el neto da un salto hacia abajo.
 */
export function requiredHourlyRate(args: {
  targetNetMonthly: number;
  hoursPerWeek: number;
  commissionPct: number;
  paysContributions: boolean;
  arlClass?: ArlClass;
}): { rate: number | null; reachable: boolean } {
  if (safe(args.targetNetMonthly) === 0 || safe(args.hoursPerWeek) === 0) {
    return { rate: null, reachable: false };
  }
  for (let rate = MIN_HOURLY_RATE; rate <= MAX_HOURLY_RATE; rate += 100) {
    const p = projectIncome({ ...args, hourlyRate: rate });
    if (p.netMonthly >= args.targetNetMonthly) return { rate, reachable: true };
  }
  return { rate: null, reachable: false };
}

// ─── ¿Me conviene un plan de pago? (comisión vs. mensualidad) ────────────────

export const FREE_COMMISSION_PCT = 12;

export interface PlanComparison {
  commissionAvoided: number;
  planPrice: number;
  /** Ahorro mensual del plan frente a Free (negativo = no compensa). */
  monthlySavings: number;
  /** Facturación mensual a partir de la cual el plan compensa. */
  breakEvenMonthly: number | null;
  worthIt: boolean;
}

export function comparePaidPlan(args: {
  grossMonthly: number;
  planPrice: number;
  freeCommissionPct?: number;
}): PlanComparison {
  const pct = args.freeCommissionPct ?? FREE_COMMISSION_PCT;
  const gross = safe(args.grossMonthly);
  const commissionAvoided = Math.round((gross * pct) / 100);
  const monthlySavings = commissionAvoided - args.planPrice;
  return {
    commissionAvoided,
    planPrice: args.planPrice,
    monthlySavings,
    breakEvenMonthly: pct > 0 ? Math.ceil((args.planPrice * 100) / pct) : null,
    worthIt: monthlySavings > 0,
  };
}

// ─── Avance de la meta del mes ───────────────────────────────────────────────

export function goalProgress(args: { confirmedHours: number; targetHours: number }): {
  pct: number;
  remainingHours: number;
} {
  const target = safe(args.targetHours);
  if (target === 0) return { pct: 0, remainingHours: 0 };
  const done = safe(args.confirmedHours);
  return {
    pct: Math.min(100, Math.round((done / target) * 100)),
    remainingHours: Math.max(0, Math.round((target - done) * 10) / 10),
  };
}
