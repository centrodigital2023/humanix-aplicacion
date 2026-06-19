// Plan catalog — canonical source of truth for plan keys, tiers, prices and
// features. Keep this file in sync with:
//   - src/routes/planes.tsx (UI)
//   - supabase/functions/mp-create-subscription/index.ts (pricing server-side)
//   - supabase/migrations/.../plans_logic.sql (plan_tier_rank)

export type PlanKey = "free" | "essential_monthly" | "pro_monthly" | "institution_monthly";

export type PlanFeature =
  | "profile"
  | "apply_offers"
  | "ai_basic"
  | "inbox_accepted"
  | "view_full_names"
  | "unlimited_applications"
  | "whatsapp_contact"
  | "live_geo_eta"
  | "rethus_antifraud"
  | "no_commission"
  | "visibility_boost"
  | "career_coach"
  | "ai_message_suggestions"
  | "priority_antifraud"
  | "ai_credits"
  | "multi_user_roles"
  | "pipeline_scoring"
  | "cv_rethus_consistency"
  | "priority_support"
  | "branch_billing";

export type PlanDef = {
  key: PlanKey;
  label: string;
  tier: 0 | 1 | 2 | 3;
  amountCOP: number;
  priceLabel: string;
  priceNote: string;
  audience: string;
  highlight?: boolean;
  features: PlanFeature[];
  featuresLabel: string[]; // user-facing copy, order-matched to `features`
};

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    label: "Free",
    tier: 0,
    amountCOP: 0,
    priceLabel: "COP 0",
    priceNote: "siempre",
    audience: "Para conocer Humanix sin compromiso.",
    features: ["profile", "apply_offers", "ai_basic", "inbox_accepted"],
    featuresLabel: [
      "Crear perfil profesional o familiar",
      "Buscar y aplicar a ofertas abiertas",
      "Asistente IA básico (preguntas generales)",
      "Mensajería 1:1 cuando se acepta una aplicación",
    ],
  },
  essential_monthly: {
    key: "essential_monthly",
    label: "Esencial",
    tier: 1,
    amountCOP: 9000,
    priceLabel: "COP 9.000",
    priceNote: "/mes",
    audience: "Familias y profesionales que quieren todo activo.",
    highlight: true,
    features: [
      "unlimited_applications",
      "whatsapp_contact",
      "live_geo_eta",
      "rethus_antifraud",
      "no_commission",
    ],
    featuresLabel: [
      "Match IA en menos de 150 ms",
      "Buzón de postulaciones ilimitado",
      "Contacto directo por WhatsApp con la otra parte",
      "Geolocalización en vivo y ETA",
      "Verificación RETHUS y anti-fraude IA incluida",
      "Sin comisión: el profesional cobra directo al cliente",
    ],
  },
  pro_monthly: {
    key: "pro_monthly",
    label: "Pro Profesional",
    tier: 2,
    amountCOP: 29000,
    priceLabel: "COP 29.000",
    priceNote: "/mes",
    audience: "Profesionales que quieren visibilidad máxima.",
    features: ["visibility_boost", "career_coach", "ai_message_suggestions", "priority_antifraud"],
    featuresLabel: [
      "Todo lo del Esencial",
      "Boost de visibilidad en búsquedas",
      "Coach de carrera 24/7 (mejorar perfil y Trust Score)",
      "Sugerencias IA en cada mensaje",
      "Validación anti-fraude IA prioritaria",
    ],
  },
  institution_monthly: {
    key: "institution_monthly",
    label: "IPS Mejorado",
    tier: 3,
    amountCOP: 299_000,
    priceLabel: "Desde COP 299.000",
    priceNote: "/mes · 1 sede incluida",
    audience: "Redes de IPS, clínicas y hospitales con varias sedes.",
    features: [
      "ai_credits",
      "multi_user_roles",
      "pipeline_scoring",
      "cv_rethus_consistency",
      "priority_support",
      "branch_billing",
    ],
    featuresLabel: [
      "Bolsa de créditos IA mensual",
      "Multi-usuario con roles (HR, evaluador, admin)",
      "Pipeline de candidatos con scoring IA",
      "Detección de inconsistencias en CVs y RETHUS",
      "Soporte prioritario y onboarding asistido",
      "Cobro por sucursales: COP 299.000 base + COP 50.000 por sede adicional",
    ],
  },
};

export const PLAN_ORDER: PlanKey[] = [
  "free",
  "essential_monthly",
  "pro_monthly",
  "institution_monthly",
];

// Which minimum plan unlocks each feature. Used by the `usePlan` hook to
// answer `can(feature)` without spreading feature checks around the codebase.
export const FEATURE_MIN_PLAN: Record<PlanFeature, PlanKey> = {
  // Free-tier
  profile: "free",
  apply_offers: "free",
  ai_basic: "free",
  inbox_accepted: "free",
  // Essential+ (ver nombres completos de otros usuarios)
  view_full_names: "essential_monthly",
  unlimited_applications: "essential_monthly",
  whatsapp_contact: "essential_monthly",
  live_geo_eta: "essential_monthly",
  rethus_antifraud: "essential_monthly",
  no_commission: "essential_monthly",
  // Pro+
  visibility_boost: "pro_monthly",
  career_coach: "pro_monthly",
  ai_message_suggestions: "pro_monthly",
  priority_antifraud: "pro_monthly",
  // Institution
  ai_credits: "institution_monthly",
  multi_user_roles: "institution_monthly",
  pipeline_scoring: "institution_monthly",
  cv_rethus_consistency: "institution_monthly",
  priority_support: "institution_monthly",
  branch_billing: "institution_monthly",
};

export function tierOf(plan: PlanKey | string | null | undefined): number {
  if (!plan) return 0;
  const def = PLAN_CATALOG[plan as PlanKey];
  return def ? def.tier : 0;
}

export function hasAtLeast(
  currentPlan: PlanKey | string | null | undefined,
  minPlan: PlanKey,
): boolean {
  return tierOf(currentPlan) >= tierOf(minPlan);
}

export function canUseFeature(
  currentPlan: PlanKey | string | null | undefined,
  feature: PlanFeature,
): boolean {
  return hasAtLeast(currentPlan, FEATURE_MIN_PLAN[feature]);
}

export const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

// ── Lógica de cobro institucional ─────────────────────────────────────────────

export type BillingCycle = "monthly" | "annual";

export type InstitutionBillingConfig = {
  /** Precio base mensual del plan institución (COP) */
  basePriceCOP: number;
  /** Precio por cada sucursal adicional más allá de la primera (COP/mes) */
  extraBranchCOP: number;
  /** Precio por cada profesional asociado más allá del límite incluido (COP/mes) */
  extraProfessionalCOP: number;
  /** Número de profesionales incluidos en el plan base */
  includedProfessionals: number;
  /** Número de sucursales incluidas en el plan base */
  includedBranches: number;
  /** Descuento en fracción por ciclo anual (ej: 0.20 = 20%) */
  annualDiscount: number;
  /** Días de período de prueba gratuito */
  trialDays: number;
  /** Días de gracia antes de suspender por falta de pago */
  graceDays: number;
};

/**
 * Plan IPS Mejorado — cobro por sucursales.
 * Pensado para redes de IPS/clínicas con varias sedes: precio base cubre la
 * sede principal + el cupo de profesionales, y cada sede adicional se cobra
 * aparte (más caro que un profesional extra porque implica un nuevo "tenant"
 * operativo: agenda, cumplimiento y KPIs propios en el dashboard EPS).
 */
export const INSTITUTION_BILLING: InstitutionBillingConfig = {
  basePriceCOP: 299_000,
  extraBranchCOP: 50_000,
  extraProfessionalCOP: 5_000,
  includedProfessionals: 10,
  includedBranches: 1,
  annualDiscount: 0.20,
  trialDays: 14,
  graceDays: 7,
};

export type InstitutionBillingBreakdown = {
  baseCOP: number;
  extraBranchesCOP: number;
  extraProfessionalsCOP: number;
  subtotalMonthlyCOP: number;
  annualDiscountCOP: number;
  totalCOP: number;
  cycle: BillingCycle;
  /** Resumen legible para mostrar al usuario */
  lines: Array<{ label: string; amountCOP: number }>;
};

/** Calcula el total a cobrar a una institución según su configuración. */
export function calculateInstitutionBilling(opts: {
  branches: number;
  professionals: number;
  cycle: BillingCycle;
}): InstitutionBillingBreakdown {
  const cfg = INSTITUTION_BILLING;
  const { branches, professionals, cycle } = opts;

  const extraBranches = Math.max(0, branches - cfg.includedBranches);
  const extraPros = Math.max(0, professionals - cfg.includedProfessionals);

  const baseCOP = cfg.basePriceCOP;
  const extraBranchesCOP = extraBranches * cfg.extraBranchCOP;
  const extraProfessionalsCOP = extraPros * cfg.extraProfessionalCOP;
  const subtotalMonthlyCOP = baseCOP + extraBranchesCOP + extraProfessionalsCOP;

  const months = cycle === "annual" ? 12 : 1;
  const rawTotal = subtotalMonthlyCOP * months;
  const annualDiscountCOP = cycle === "annual" ? Math.round(rawTotal * cfg.annualDiscount) : 0;
  const totalCOP = rawTotal - annualDiscountCOP;

  const lines: InstitutionBillingBreakdown["lines"] = [
    { label: `Plan Institución base (${cfg.includedBranches} sede, ${cfg.includedProfessionals} profesionales)`, amountCOP: baseCOP },
  ];
  if (extraBranches > 0) {
    lines.push({ label: `${extraBranches} sede${extraBranches > 1 ? "s" : ""} adicional${extraBranches > 1 ? "es" : ""}`, amountCOP: extraBranchesCOP });
  }
  if (extraPros > 0) {
    lines.push({ label: `${extraPros} profesional${extraPros > 1 ? "es" : ""} adicional${extraPros > 1 ? "es" : ""}`, amountCOP: extraProfessionalsCOP });
  }
  if (cycle === "annual") {
    lines.push({ label: "Descuento anual (−20%)", amountCOP: -annualDiscountCOP });
  }

  return {
    baseCOP,
    extraBranchesCOP,
    extraProfessionalsCOP,
    subtotalMonthlyCOP,
    annualDiscountCOP,
    totalCOP,
    cycle,
    lines,
  };
}

/** Estados posibles de una suscripción */
export type SubscriptionStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled";

/** Determina si la suscripción está en buen estado para acceder a la plataforma */
export function isSubscriptionAccessible(status: SubscriptionStatus): boolean {
  return status === "trial" || status === "active" || status === "past_due";
}
