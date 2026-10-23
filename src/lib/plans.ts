// Plan catalog — canonical source of truth for plan keys, prices, features and
// permissions. Keep this file in sync with:
//   - supabase/functions/_shared/planBilling.ts (precios que cobra el servidor; hay una prueba que lo exige)
//   - src/routes/planes.tsx (UI)
//   - supabase/migrations/20261023100000_plans_v2_pricing.sql (plan_key_for, comisión, cupos y créditos en SQL)
//
// Tabla de precios (oct 2026):
//   Familia      Free COP 0 · Familiar COP 9.900/mes · Premium Familiar COP 24.900/mes
//   Profesional  Free COP 0 · Pro COP 19.900/mes · Premium COP 39.900/mes
//   Institución  Institucional desde COP 299.000/mes (1 sede) · sede adicional COP 50.000/mes · anual: 12 meses por 10
// Comisión: en Free, Humanix cobra 10 % al profesional por cada servicio. No hay comisión si el profesional o quien
// contrata (familia o institución) tiene un plan de pago.
//
// La clave `essential_monthly` es el plan Familiar: se conserva para no tocar las filas de `mp_subscriptions` ni las
// funciones SQL que ya la usan.

import {
  INSTITUTION_PRICING,
  PLAN_PRICE_COP,
  PLAN_TIER,
  planQuote,
  type BillingCycle,
} from "./planBilling";

export type PlanKey =
  | "free"
  | "essential_monthly"
  | "pro_monthly"
  | "family_premium_monthly"
  | "pro_premium_monthly"
  | "institution_monthly";

/** A quién se le vende cada plan. `all` = Free, que existe para los tres perfiles. */
export type PlanSegment = "family" | "professional" | "institution";

export type PlanFeature =
  | "profile"
  | "apply_offers"
  | "ai_basic"
  | "inbox_accepted"
  | "view_full_names"
  | "unlimited_applications"
  | "whatsapp_contact"
  | "view_address"
  | "negotiate_rate"
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
  | "branch_billing"
  | "care_history_export"
  | "career_passport"
  | "family_wellbeing_report"
  | "smart_applicant_ranking"
  | "care_budget_forecast"
  | "coverage_radar"
  | "pro_income_pulse"
  | "pro_rest_guard"
  | "pro_week_planner"
  | "pro_reputation_lab"
  // Plan Familiar
  | "digital_agreements"
  | "care_log"
  | "care_alerts"
  // Plan Premium Familiar
  | "advanced_tracking"
  | "family_circle"
  | "doctor_reports"
  | "priority_alerts"
  | "sos_priority"
  | "dedicated_support"
  // Planes profesionales
  | "offers_access"
  | "priority_listing"
  | "verified_badge_featured"
  | "ai_credits_plus"
  // Institución
  | "inst_cost_intel"
  | "inst_quality_compliance"
  | "inst_team_reliability"
  | "inst_coverage_forecast"
  | "inst_executive_report"
  | "inst_care_scale"
  | "inst_devices"
  | "inst_alert_escalation"
  | "inst_care_followups"
  | "inst_shift_handoff"
  | "inst_care_export"
  | "inst_agenda_insights";

export type PlanDef = {
  key: PlanKey;
  label: string;
  /** Orden por precio: decide qué es subir y qué es bajar de plan. */
  tier: number;
  /** Perfil al que se vende (`null` = Free, para todos). */
  segment: PlanSegment | null;
  amountCOP: number;
  priceLabel: string;
  priceNote: string;
  audience: string;
  /** Cómo genera ingreso Humanix con este plan (la columna de la tabla de precios). */
  revenue: string;
  highlight?: boolean;
  /** TODAS las funciones que abre el plan (no solo las que agrega). */
  features: PlanFeature[];
  featuresLabel: string[]; // user-facing copy for the pricing card
};

// ── Funciones por plan ────────────────────────────────────────────────────────

const FREE_FEATURES: PlanFeature[] = ["profile", "apply_offers", "ai_basic", "inbox_accepted"];

/** Lo que tiene cualquier plan de pago: contacto directo, verificación y sin comisión. */
const PAID_BASE: PlanFeature[] = [
  ...FREE_FEATURES,
  "view_full_names",
  "unlimited_applications",
  "whatsapp_contact",
  "view_address",
  "live_geo_eta",
  "rethus_antifraud",
  "no_commission",
];

const FAMILIAR_FEATURES: PlanFeature[] = [
  ...PAID_BASE,
  // La familia también negocia el valor de lo que publica (la base lo exige con cualquier plan de pago).
  "negotiate_rate",
  "digital_agreements",
  "care_log",
  "care_alerts",
  "priority_support",
  "care_history_export",
  "family_wellbeing_report",
  "smart_applicant_ranking",
  "care_budget_forecast",
  "coverage_radar",
];

const FAMILY_PREMIUM_FEATURES: PlanFeature[] = [
  ...FAMILIAR_FEATURES,
  "advanced_tracking",
  "family_circle",
  "doctor_reports",
  "priority_alerts",
  "sos_priority",
  "dedicated_support",
];

const PRO_FEATURES: PlanFeature[] = [
  ...PAID_BASE,
  "negotiate_rate",
  "pro_income_pulse",
  "pro_rest_guard",
  "visibility_boost",
  "offers_access",
  "pro_week_planner",
];

const PRO_PREMIUM_FEATURES: PlanFeature[] = [
  ...PRO_FEATURES,
  "priority_listing",
  "verified_badge_featured",
  "ai_credits_plus",
  "pro_reputation_lab",
  "career_coach",
  "career_passport",
  "ai_message_suggestions",
  "priority_antifraud",
];

const INSTITUTION_OWN: PlanFeature[] = [
  "ai_credits",
  "multi_user_roles",
  "pipeline_scoring",
  "cv_rethus_consistency",
  "priority_support",
  "branch_billing",
  "inst_cost_intel",
  "inst_quality_compliance",
  "inst_team_reliability",
  "inst_coverage_forecast",
  "inst_executive_report",
  "inst_care_scale",
  "inst_devices",
  "inst_alert_escalation",
  "inst_care_followups",
  "inst_shift_handoff",
  "inst_care_export",
  "inst_agenda_insights",
];

const uniq = (xs: PlanFeature[]) => [...new Set(xs)];

/**
 * Quien pagó el plan Esencial (9.000, misma clave que hoy es Familiar) cuando era para familias y profesionales conserva
 * lo del profesional mientras su plan siga vigente: ingresos reales y descanso. Una familia no ve esas pantallas, así
 * que no cambia nada para ella.
 */
export const LEGACY_ESSENTIAL_FEATURES: PlanFeature[] = ["pro_income_pulse", "pro_rest_guard"];

const COPf = (n: number) => `COP ${n.toLocaleString("es-CO")}`;

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    label: "Free",
    tier: 0,
    segment: null,
    amountCOP: 0,
    priceLabel: "COP 0",
    priceNote: "siempre",
    audience: "Para conocer Humanix sin compromiso.",
    revenue: "Humanix cobra una comisión del 10 % al profesional por cada servicio.",
    features: FREE_FEATURES,
    featuresLabel: [
      "Crear perfil profesional o familiar",
      "Buscar, solicitar y contratar; recibir servicios",
      "Asistente IA básico (preguntas generales)",
      "Mensajería 1:1 cuando se acepta una aplicación",
      "Comisión del 10 % al profesional por cada servicio",
    ],
  },
  essential_monthly: {
    key: "essential_monthly",
    label: "Familiar",
    tier: PLAN_TIER.essential_monthly,
    segment: "family",
    amountCOP: PLAN_PRICE_COP.essential_monthly,
    priceLabel: COPf(PLAN_PRICE_COP.essential_monthly),
    priceNote: "/mes",
    audience: "Para familias que quieren cuidar sin comisiones.",
    revenue: "Suscripción mensual: los servicios que contratas no pagan comisión.",
    highlight: true,
    features: FAMILIAR_FEATURES,
    featuresLabel: [
      "Sin comisión en los servicios que contratas",
      "Acuerdos digitales con cada profesional",
      "Bitácora del cuidado y historia exportable (Excel/CSV)",
      "Alertas del cuidado en tu celular",
      "Contacto directo por WhatsApp, dirección y ubicación en vivo",
      "Panel de familia inteligente: informe de bienestar, comparador de postulaciones, presupuesto y radar de cobertura",
      "Soporte prioritario",
    ],
  },
  pro_monthly: {
    key: "pro_monthly",
    label: "Pro",
    tier: PLAN_TIER.pro_monthly,
    segment: "professional",
    amountCOP: PLAN_PRICE_COP.pro_monthly,
    priceLabel: COPf(PLAN_PRICE_COP.pro_monthly),
    priceNote: "/mes",
    audience: "Profesionales que quieren cobrar todo lo que trabajan.",
    revenue: "Suscripción mensual: 0 % de comisión en tus servicios.",
    highlight: true,
    features: PRO_FEATURES,
    featuresLabel: [
      "0 % de comisión: cobras el 100 % de cada servicio",
      "Mejor visibilidad en las búsquedas de familias e instituciones",
      "Acceso a ofertas: «Mi semana» con turnos compatibles, contacto directo y negociar el valor",
      "Postulaciones ilimitadas",
      "Panel inteligente: tus ingresos reales, tu tarifa frente al mercado y descanso sugerido",
    ],
  },
  family_premium_monthly: {
    key: "family_premium_monthly",
    label: "Premium Familiar",
    tier: PLAN_TIER.family_premium_monthly,
    segment: "family",
    amountCOP: PLAN_PRICE_COP.family_premium_monthly,
    priceLabel: COPf(PLAN_PRICE_COP.family_premium_monthly),
    priceNote: "/mes",
    audience: "Para familias que acompañan un cuidado exigente.",
    revenue: "Suscripción mensual con seguimiento avanzado y soporte dedicado.",
    features: FAMILY_PREMIUM_FEATURES,
    featuresLabel: [
      "Todo lo del plan Familiar",
      "Seguimiento avanzado del cuidado",
      "Círculo familiar: hasta 10 personas siguen los servicios",
      "Reportes para el médico (informe de bienestar)",
      "Alertas prioritarias y botón SOS con aviso a tu círculo",
      "Soporte dedicado",
    ],
  },
  pro_premium_monthly: {
    key: "pro_premium_monthly",
    label: "Premium Profesional",
    tier: PLAN_TIER.pro_premium_monthly,
    segment: "professional",
    amountCOP: PLAN_PRICE_COP.pro_premium_monthly,
    priceLabel: COPf(PLAN_PRICE_COP.pro_premium_monthly),
    priceNote: "/mes",
    audience: "Profesionales que quieren ser los primeros en aparecer.",
    revenue: "Suscripción mensual con prioridad alta y herramientas de reputación.",
    features: PRO_PREMIUM_FEATURES,
    featuresLabel: [
      "Todo lo del plan Pro",
      "Prioridad alta: apareces antes en las búsquedas",
      "Badge verificado destacado en tu perfil",
      "Más créditos de IA cada mes (1.000)",
      "Herramientas de reputación: tu reputación en detalle y pasaporte profesional con QR",
      "Coach de carrera y sugerencias IA en cada mensaje",
    ],
  },
  institution_monthly: {
    key: "institution_monthly",
    label: "Institucional",
    tier: PLAN_TIER.institution_monthly,
    segment: "institution",
    amountCOP: PLAN_PRICE_COP.institution_monthly,
    priceLabel: `Desde ${COPf(PLAN_PRICE_COP.institution_monthly)}`,
    priceNote: "/mes · 1 sede incluida",
    audience: "IPS, clínicas, hospitales y agencias de cuidado.",
    revenue: `Suscripción por sedes: ${COPf(INSTITUTION_PRICING.extraBranchCOP)}/mes por sede adicional; anual, 12 meses por el precio de 10.`,
    // La institución tiene todo lo de los demás planes, más lo suyo.
    features: uniq([...FAMILY_PREMIUM_FEATURES, ...PRO_PREMIUM_FEATURES, ...INSTITUTION_OWN]),
    featuresLabel: [
      "Multiusuario con roles (HR, evaluador, admin)",
      "Vacantes y pipeline de candidatos con scoring IA; detección de inconsistencias en CVs y RETHUS",
      "Bolsa de créditos IA mensual",
      "Soporte prioritario y onboarding asistido",
      `Cobro por sedes: ${COPf(INSTITUTION_PRICING.baseCOP)} con la sede principal + ${COPf(INSTITUTION_PRICING.extraBranchCOP)} por sede adicional`,
      `Contrato anual: ${INSTITUTION_PRICING.annualMonths} meses por el precio de ${INSTITUTION_PRICING.annualPaidMonths}`,
      "Centro de gestión inteligente: costos y proyección, calidad y cumplimiento (puntualidad, parte del turno, contratos y RETHUS), equipo confiable, pronóstico de cobertura a 14 días e informe para la gerencia",
      "Agenda inteligente de 7 días: riesgo de inasistencia por profesional, reporte de utilización de 30 días y exportación a CSV e iCal",
      "Pacientes y monitoreo clínico a escala: hasta 1.000 pacientes y 300 en monitoreo con NEWS2 (Free: 5 y 3), relojes y sensores conectados, escalamiento automático de alertas sin atender, seguimientos automáticos de cada caso, relevo de turno I-PASS guardado en la historia y exportación de la historia en FHIR y CSV",
    ],
  },
};

/** Todos los planes, del más barato al más caro. */
export const PLAN_ORDER: PlanKey[] = [
  "free",
  "essential_monthly",
  "pro_monthly",
  "family_premium_monthly",
  "pro_premium_monthly",
  "institution_monthly",
];

/** Los planes que ve cada perfil en /planes, en orden. */
export const PLANS_FOR_SEGMENT: Record<PlanSegment, PlanKey[]> = {
  family: ["free", "essential_monthly", "family_premium_monthly"],
  professional: ["free", "pro_monthly", "pro_premium_monthly"],
  institution: ["free", "institution_monthly"],
};

function planFeatures(plan: PlanKey): PlanFeature[] {
  const own = PLAN_CATALOG[plan].features;
  return plan === "essential_monthly" ? [...own, ...LEGACY_ESSENTIAL_FEATURES] : own;
}

/**
 * El plan más barato que abre cada función: es el que se ofrece en un candado cuando no se sabe el perfil de quien
 * mira. Con perfil, usar `upgradePlanFor`.
 */
export const FEATURE_MIN_PLAN = Object.fromEntries(
  ([...new Set(PLAN_ORDER.flatMap((k) => PLAN_CATALOG[k].features))] as PlanFeature[]).map((f) => [
    f,
    PLAN_ORDER.find((k) => PLAN_CATALOG[k].features.includes(f)) as PlanKey,
  ]),
) as Record<PlanFeature, PlanKey>;

/** Plan que se le ofrece a un perfil para abrir `feature`: el más barato de SUS planes que la incluye. */
export function upgradePlanFor(feature: PlanFeature, segment?: PlanSegment | null): PlanKey {
  if (segment) {
    const own = PLANS_FOR_SEGMENT[segment].find(
      (k) => k !== "free" && PLAN_CATALOG[k].features.includes(feature),
    );
    if (own) return own;
  }
  return FEATURE_MIN_PLAN[feature];
}

/** Perfil para ofrecer planes a partir de los roles de la cuenta (institución > profesional > familia). */
export function segmentOfRoles(roles: readonly string[] | null | undefined): PlanSegment | null {
  const r = roles ?? [];
  if (r.includes("institution")) return "institution";
  if (r.includes("professional")) return "professional";
  if (r.includes("family")) return "family";
  return null;
}

export function tierOf(plan: PlanKey | string | null | undefined): number {
  if (!plan) return 0;
  const def = PLAN_CATALOG[plan as PlanKey];
  return def ? def.tier : 0;
}

/** ¿El plan actual cuesta al menos lo que `minPlan`? Para permisos, usar `canUseFeature`. */
export function hasAtLeast(
  currentPlan: PlanKey | string | null | undefined,
  minPlan: PlanKey,
): boolean {
  return tierOf(currentPlan) >= tierOf(minPlan);
}

const FREE_SET = Object.fromEntries(FREE_FEATURES.map((f) => [f, true]));

export function canUseFeature(
  currentPlan: PlanKey | string | null | undefined,
  feature: PlanFeature,
): boolean {
  if (!currentPlan || !(currentPlan in PLAN_CATALOG)) return feature in FREE_SET;
  return planFeatures(currentPlan as PlanKey).includes(feature);
}

export function isPaidPlanKey(plan: PlanKey | string | null | undefined): boolean {
  return Boolean(plan) && plan !== "free" && (plan as string) in PLAN_CATALOG;
}

// ── Comisión, créditos IA y círculo familiar (espejo de las funciones SQL) ────

/** Comisión de Humanix al profesional por servicio cuando nadie tiene plan de pago (`platform_commission_pct`). */
export const FREE_COMMISSION_PCT = 10;

/**
 * Comisión de un servicio (`booking_commission_pct` en SQL): 0 % si el profesional o quien contrata tiene un plan de
 * pago; si no, 10 %.
 */
export function bookingCommissionPct(
  professionalPlan: PlanKey | string | null | undefined,
  clientPlan: PlanKey | string | null | undefined,
): number {
  return isPaidPlanKey(professionalPlan) || isPaidPlanKey(clientPlan) ? 0 : FREE_COMMISSION_PCT;
}

/** Créditos IA del mes por plan (`ai_credits_monthly_allowance`). */
export const AI_MONTHLY_CREDITS: Record<PlanKey, number> = {
  free: 30,
  essential_monthly: 150,
  pro_monthly: 400,
  family_premium_monthly: 300,
  pro_premium_monthly: 1000,
  institution_monthly: 2000,
};

/** Personas que se pueden invitar al círculo de cuidado (`hx_circle_limit`). */
export const CIRCLE_LIMIT: Record<PlanKey, number> = {
  free: 1,
  essential_monthly: 3,
  pro_monthly: 3,
  family_premium_monthly: 10,
  pro_premium_monthly: 3,
  institution_monthly: 10,
};

export const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

// ── Lógica de cobro institucional ─────────────────────────────────────────────
// Un solo cálculo para la interfaz y el servidor: `planQuote` (planBilling).

export type { BillingCycle };

export type InstitutionBillingConfig = {
  /** Precio base mensual del plan institución (COP), con la sede principal */
  basePriceCOP: number;
  /** Precio por cada sede adicional más allá de la primera (COP/mes) */
  extraBranchCOP: number;
  /** Número de sedes incluidas en el plan base */
  includedBranches: number;
  /** Meses de servicio del contrato anual */
  annualMonths: number;
  /** Meses que se pagan en el contrato anual (12 por 10) */
  annualPaidMonths: number;
  /** Descuento equivalente del contrato anual, en fracción (2/12 ≈ 0,167) */
  annualDiscount: number;
  /** Días de período de prueba gratuito */
  trialDays: number;
  /** Días de gracia antes de suspender por falta de pago */
  graceDays: number;
};

/** Plan Institucional — cobro por sedes y contrato anual (12 meses por el precio de 10). */
export const INSTITUTION_BILLING: InstitutionBillingConfig = {
  basePriceCOP: INSTITUTION_PRICING.baseCOP,
  extraBranchCOP: INSTITUTION_PRICING.extraBranchCOP,
  includedBranches: INSTITUTION_PRICING.includedBranches,
  annualMonths: INSTITUTION_PRICING.annualMonths,
  annualPaidMonths: INSTITUTION_PRICING.annualPaidMonths,
  annualDiscount:
    (INSTITUTION_PRICING.annualMonths - INSTITUTION_PRICING.annualPaidMonths) /
    INSTITUTION_PRICING.annualMonths,
  trialDays: 14,
  graceDays: 7,
};

export type InstitutionBillingBreakdown = {
  baseCOP: number;
  extraBranchesCOP: number;
  subtotalMonthlyCOP: number;
  annualDiscountCOP: number;
  totalCOP: number;
  /** Meses de servicio que cubre `totalCOP`. */
  months: number;
  cycle: BillingCycle;
  /** Resumen legible para mostrar al usuario */
  lines: Array<{ label: string; amountCOP: number }>;
};

/** Calcula el total a cobrar a una institución según sus sedes activas y el ciclo. */
export function calculateInstitutionBilling(opts: {
  branches: number;
  cycle: BillingCycle;
}): InstitutionBillingBreakdown {
  const cfg = INSTITUTION_BILLING;
  const q = planQuote("institution_monthly", { branches: opts.branches, cycle: opts.cycle });
  const extraBranches = Math.max(0, q.branches - cfg.includedBranches);
  const baseCOP = cfg.basePriceCOP;
  const extraBranchesCOP = extraBranches * cfg.extraBranchCOP;
  const subtotalMonthlyCOP = q.monthlyCOP;
  const annual = q.cycle === "annual";
  const annualDiscountCOP = annual ? subtotalMonthlyCOP * q.months - q.amount : 0;

  const lines: InstitutionBillingBreakdown["lines"] = [
    { label: `Plan Institucional (${cfg.includedBranches} sede incluida)`, amountCOP: baseCOP },
  ];
  if (extraBranches > 0) {
    lines.push({
      label: `${extraBranches} sede${extraBranches > 1 ? "s" : ""} adicional${extraBranches > 1 ? "es" : ""}`,
      amountCOP: extraBranchesCOP,
    });
  }
  if (annual) {
    lines.push({
      label: `× ${cfg.annualMonths} meses`,
      amountCOP: subtotalMonthlyCOP * (cfg.annualMonths - 1),
    });
    lines.push({
      label: `Contrato anual: ${cfg.annualMonths - cfg.annualPaidMonths} meses gratis`,
      amountCOP: -annualDiscountCOP,
    });
  }

  return {
    baseCOP,
    extraBranchesCOP,
    subtotalMonthlyCOP,
    annualDiscountCOP,
    totalCOP: q.amount,
    months: q.months,
    cycle: q.cycle,
    lines,
  };
}

/** Estados posibles de una suscripción */
export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended" | "cancelled";

/** Determina si la suscripción está en buen estado para acceder a la plataforma */
export function isSubscriptionAccessible(status: SubscriptionStatus): boolean {
  return status === "trial" || status === "active" || status === "past_due";
}

// ── Estado del plan del usuario (lo que lee `usePlan`) ────────────────────────
// Misma regla que `get_user_plan()` en SQL y que `activePaidPlan` en `planBilling`: plan de pago con estado
// `active`/`approved` y sin vencer. Cualquier otra cosa es Free (sin perder el estado y la fecha para mostrarlos).

export type SubscriptionSnapshot = {
  plan: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  current_period_end: string | null;
  cancel_at_period_end?: boolean | null;
  /** Suscripción de Mercado Pago que renueva el plan cada mes. */
  mp_preapproval_id?: string | null;
};

export type NormalizedPlan = {
  plan: PlanKey;
  status: string | null;
  amount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** El plan se cobra solo cada mes (suscripción de Mercado Pago activa). */
  autoRenew: boolean;
};

export function normalizeSubscription(
  row: SubscriptionSnapshot | null | undefined,
  now: number = Date.now(),
): NormalizedPlan {
  const free: NormalizedPlan = {
    plan: "free",
    status: row?.status ?? null,
    amount: null,
    currency: null,
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: false,
    autoRenew: false,
  };
  if (!row) return { ...free, status: null, currentPeriodEnd: null };
  const active = row.status === "active" || row.status === "approved";
  const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
  const stillInPeriod = !row.current_period_end || !Number.isFinite(end) || end > now;
  const known = typeof row.plan === "string" && row.plan in PLAN_CATALOG && row.plan !== "free";
  if (!active || !stillInPeriod || !known) return free;
  return {
    plan: row.plan as PlanKey,
    status: row.status,
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    autoRenew: Boolean(row.mp_preapproval_id),
  };
}

/** Días desde los que se recuerda renovar un plan sin renovación automática (si nadie renueva, pasa a Free). */
export const RENEW_REMINDER_DAYS = 5;

export type PlanValidity = {
  /** Días que quedan (redondeo hacia arriba: el último día cuenta como 1); `null` si no hay plan o fecha. */
  daysLeft: number | null;
  /** Quedan `RENEW_REMINDER_DAYS` días o menos: momento de recordar con calma. */
  renewSoon: boolean;
  /** «Vigente hasta el 15 de noviembre», «Se renueva el 15 de noviembre» o `null`. */
  line: string | null;
};

const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** «15 de noviembre», en hora de Colombia y sin depender del ICU del navegador. */
export function longDateEs(t: number): string {
  const d = new Date(t - 5 * 3_600_000);
  return `${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}`;
}

export function planValidity(
  p: Pick<NormalizedPlan, "plan" | "currentPeriodEnd"> & { autoRenew?: boolean },
  now: number,
): PlanValidity {
  const end = p.currentPeriodEnd ? Date.parse(p.currentPeriodEnd) : NaN;
  if (p.plan === "free" || !Number.isFinite(end) || end <= now) {
    return { daysLeft: null, renewSoon: false, line: null };
  }
  const daysLeft = Math.ceil((end - now) / 86_400_000);
  // Con renovación automática no hay nada que recordar: Mercado Pago cobra el mes siguiente.
  if (p.autoRenew) {
    return { daysLeft, renewSoon: false, line: `Se renueva el ${longDateEs(end)}` };
  }
  return {
    daysLeft,
    renewSoon: daysLeft <= RENEW_REMINDER_DAYS,
    line: `Vigente hasta el ${longDateEs(end)}`,
  };
}
