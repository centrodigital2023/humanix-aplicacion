// Catálogo de planes: claves, precios, funciones y permisos. Fuente única para la interfaz. Va de la mano de:
//   - supabase/migrations/20261103160000_breb_wallet_commission.sql (`plan_key_for`, comisión y billetera en SQL)
//   - src/lib/commissionMatrix.ts (matriz de comisiones, probada)
//   - src/routes/planes.tsx (página de precios)
//
// Modelo (aprobado el 3 nov 2026, pagos por Bre-B con Wompi, sin Mercado Pago):
//   Familia       Gratis, con todas sus funciones (nivel `family_premium_monthly`). La familia nunca paga comisión.
//   Profesional   Gratis, con todas sus funciones (nivel `pro_monthly`). Comisión por turno: 15 % (0–19 turnos en
//                 30 días), 12 % (20–59) o 10 % (60 o más). Primer turno de cada pareja: exonerado hasta $30.000.
//   Institución   Plan anual por tamaño de sede: $290.000/mes (1 a 9 profesionales, 12 % de comisión) o $490.000/mes
//                 (10 o más, 10 %), cobrado en un solo pago al año.
//
// Las claves `essential_monthly` y `pro_premium_monthly` ya no se venden; se conservan para no romper filas antiguas
// ni las funciones SQL que las nombran.

import { INSTITUTION_PLANS, PRO_TIERS, type InstitutionSize } from "./commissionMatrix";

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

/** Lo que tiene cualquier cuenta con perfil (familia, profesional o institución): contacto directo y verificación.
 * `no_commission` ya no lo abre ningún plan: la comisión la decide la matriz (`commissionMatrix.ts`). */
const PAID_BASE: PlanFeature[] = [
  ...FREE_FEATURES,
  "view_full_names",
  "unlimited_applications",
  "whatsapp_contact",
  "view_address",
  "live_geo_eta",
  "rethus_antifraud",
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
  // Herramientas que antes eran de Premium y ahora tiene todo profesional (no dependen del servidor).
  "pro_reputation_lab",
  "career_coach",
  "career_passport",
  "ai_message_suggestions",
  "priority_antifraud",
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

const COPf = (n: number) => `$${n.toLocaleString("es-CO")}`;

/** Orden de los planes (decide qué es «más» en `hasAtLeast`). Igual que `plan_tier_rank` en SQL. */
const PLAN_TIER: Record<PlanKey, number> = {
  free: 0,
  essential_monthly: 1,
  pro_monthly: 2,
  family_premium_monthly: 3,
  pro_premium_monthly: 4,
  institution_monthly: 5,
};

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    label: "Gratis",
    tier: 0,
    segment: null,
    amountCOP: 0,
    priceLabel: "$0",
    priceNote: "siempre",
    audience: "Para conocer Humanix sin compromiso.",
    revenue: "Sin costo.",
    features: FREE_FEATURES,
    featuresLabel: ["Crear tu perfil", "Buscar y conocer profesionales", "Asistente IA básico"],
  },
  family_premium_monthly: {
    key: "family_premium_monthly",
    label: "Familia",
    tier: PLAN_TIER.family_premium_monthly,
    segment: "family",
    amountCOP: 0,
    priceLabel: "$0",
    priceNote: "siempre",
    audience: "Para familias que cuidan a alguien que quieren.",
    revenue: "Gratis y sin comisión: pagas solo el valor del turno.",
    highlight: true,
    features: FAMILY_PREMIUM_FEATURES,
    featuresLabel: [
      "Sin comisión: pagas solo el valor del turno",
      "Paga con Bre-B desde la app de tu banco, o en efectivo al profesional",
      "Acuerdos digitales, bitácora del cuidado, historia exportable (Excel/CSV) y alertas en tu celular",
      "Círculo familiar: hasta 10 personas siguen los servicios",
      "Ubicación en vivo, botón SOS y reportes para el médico",
      "Panel de familia inteligente: informe de bienestar, comparador de postulaciones, presupuesto y radar de cobertura",
    ],
  },
  pro_monthly: {
    key: "pro_monthly",
    label: "Profesional",
    tier: PLAN_TIER.pro_monthly,
    segment: "professional",
    amountCOP: 0,
    priceLabel: "$0",
    priceNote: "sin mensualidad",
    audience: "Para profesionales del cuidado que quieren más turnos.",
    revenue: "Sin mensualidad: una comisión por turno que baja mientras más trabajas.",
    highlight: true,
    features: PRO_FEATURES,
    featuresLabel: [
      `Comisión que baja contigo: ${PRO_TIERS.map((t) => `${t.pct} %`)
        .reverse()
        .join(" → ")}`,
      "Tu primer turno con cada familia nueva: sin comisión (hasta $30.000)",
      "Recibe tu pago en segundos a tu llave Bre-B",
      "Acceso a ofertas: «Mi semana» con turnos compatibles, postulaciones ilimitadas y contacto directo",
      "Panel inteligente: tus ingresos reales, tu tarifa frente al mercado y descanso sugerido",
      "Pasaporte profesional con QR y coach de carrera",
    ],
  },
  institution_monthly: {
    key: "institution_monthly",
    label: "Institucional",
    tier: PLAN_TIER.institution_monthly,
    segment: "institution",
    amountCOP: INSTITUTION_PLANS.small.monthlyCOP,
    priceLabel: `Desde ${COPf(INSTITUTION_PLANS.small.monthlyCOP)}`,
    priceNote: "/mes · pago anual",
    audience: "IPS, clínicas, hospitales y agencias de cuidado.",
    revenue: `Plan anual por sede: ${INSTITUTION_PLANS.small.pct} % o ${INSTITUTION_PLANS.large.pct} % de comisión al profesional.`,
    // La institución tiene todo lo de los demás planes, más lo suyo.
    features: uniq([...FAMILY_PREMIUM_FEATURES, ...PRO_PREMIUM_FEATURES, ...INSTITUTION_OWN]),
    featuresLabel: [
      "Multiusuario con roles (RR. HH., evaluador, admin)",
      "Vacantes y pipeline de candidatos con scoring IA; detección de inconsistencias en CVs y RETHUS",
      "Bolsa de créditos IA mensual",
      "Soporte prioritario y onboarding asistido",
      "Centro de gestión inteligente: costos y proyección, calidad y cumplimiento (puntualidad, parte del turno, contratos y RETHUS), equipo confiable, pronóstico de cobertura a 14 días e informe para la gerencia",
      "Agenda inteligente de 7 días: riesgo de inasistencia por profesional, reporte de utilización de 30 días y exportación a CSV e iCal",
      "Pacientes y monitoreo clínico a escala: hasta 1.000 pacientes y 300 en monitoreo con NEWS2 (Free: 5 y 3), relojes y sensores conectados, escalamiento automático de alertas sin atender, seguimientos automáticos de cada caso, relevo de turno I-PASS guardado en la historia y exportación de la historia en FHIR y CSV",
    ],
  },
  // ── Claves antiguas (ya no se venden) ──
  essential_monthly: {
    key: "essential_monthly",
    label: "Familiar (anterior)",
    tier: PLAN_TIER.essential_monthly,
    segment: "family",
    amountCOP: 0,
    priceLabel: "$0",
    priceNote: "",
    audience: "Plan anterior.",
    revenue: "Ya no se vende.",
    features: FAMILIAR_FEATURES,
    featuresLabel: [],
  },
  pro_premium_monthly: {
    key: "pro_premium_monthly",
    label: "Premium Profesional (anterior)",
    tier: PLAN_TIER.pro_premium_monthly,
    segment: "professional",
    amountCOP: 0,
    priceLabel: "$0",
    priceNote: "",
    audience: "Plan anterior.",
    revenue: "Ya no se vende.",
    features: PRO_PREMIUM_FEATURES,
    featuresLabel: [],
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

/** El plan que ve cada perfil en /planes. */
export const PLANS_FOR_SEGMENT: Record<PlanSegment, PlanKey[]> = {
  family: ["family_premium_monthly"],
  professional: ["pro_monthly"],
  institution: ["institution_monthly"],
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

/** Comisión más alta de la matriz (profesional con menos de 20 turnos en 30 días). La real: `commissionQuote`. */
export const FREE_COMMISSION_PCT = PRO_TIERS[PRO_TIERS.length - 1].pct;

/**
 * Comisión de un servicio (`booking_commission_pct` en SQL): si contrata una institución con plan, 12 % o 10 % según el
 * tamaño de su sede; si no, el escalón del profesional por turnos completados en los últimos 30 días (15/12/10 %).
 */
export function bookingCommissionPct(
  proCompletedLast30d: number,
  institutionPlan: InstitutionSize | null = null,
): number {
  if (institutionPlan) return INSTITUTION_PLANS[institutionPlan].pct;
  const n = Math.max(0, Math.floor(proCompletedLast30d || 0));
  return PRO_TIERS.find((t) => n >= t.minShifts)!.pct;
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

// ── Plan institucional ────────────────────────────────────────────────────────

export type { InstitutionSize };
export const INSTITUTION_PLAN_SIZES: InstitutionSize[] = ["small", "large"];
export { INSTITUTION_PLANS };

// ── Estado del plan del usuario (lo que lee `usePlan`) ────────────────────────
// Misma regla que `plan_key_for()` en SQL: institución con plan anual vigente → Institucional; si no, el nivel del
// perfil (profesional → `pro_monthly`, familia → `family_premium_monthly`); sin perfil → Free.

export type SubscriptionSnapshot = {
  plan: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  current_period_end: string | null;
};

/** Claves del plan pagado que guarda la base (`hx_paid_plans()`). */
export const PAID_PLAN_KEYS = [
  "institution_small_annual",
  "institution_large_annual",
  "institution_monthly",
] as const;

export type NormalizedPlan = {
  plan: PlanKey;
  status: string | null;
  amount: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  /** Tamaño del plan institucional vigente (nulo si no hay). */
  institutionSize: InstitutionSize | null;
};

function activeInstitutionPlan(row: SubscriptionSnapshot | null | undefined, now: number): boolean {
  if (!row) return false;
  const active = row.status === "active" || row.status === "approved";
  const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;
  const stillInPeriod = !row.current_period_end || !Number.isFinite(end) || end > now;
  return (
    active && stillInPeriod && (PAID_PLAN_KEYS as readonly string[]).includes(String(row.plan))
  );
}

export function effectivePlan(
  roles: readonly string[] | null | undefined,
  row: SubscriptionSnapshot | null | undefined,
  now: number = Date.now(),
): NormalizedPlan {
  const base = {
    status: row?.status ?? null,
    amount: null,
    currency: null,
    currentPeriodEnd: row?.current_period_end ?? null,
    institutionSize: null,
  };
  if (activeInstitutionPlan(row, now)) {
    return {
      plan: "institution_monthly",
      status: row!.status,
      amount: row!.amount ?? null,
      currency: row!.currency ?? null,
      currentPeriodEnd: row!.current_period_end ?? null,
      institutionSize: row!.plan === "institution_large_annual" ? "large" : "small",
    };
  }
  const r = roles ?? [];
  if (r.includes("professional")) return { ...base, plan: "pro_monthly" };
  if (r.includes("family")) return { ...base, plan: "family_premium_monthly" };
  return { ...base, plan: "free" };
}

export type PlanValidity = {
  /** Días que quedan (el último día cuenta como 1); `null` si no hay plan pagado o fecha. */
  daysLeft: number | null;
  /** Quedan 30 días o menos: momento de recordar con calma la renovación del año. */
  renewSoon: boolean;
  /** «Vigente hasta el 15 de noviembre» o `null`. */
  line: string | null;
};

/** El plan institucional es anual: se recuerda renovar en el último mes. */
export const RENEW_REMINDER_DAYS = 30;

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

/** «15 de noviembre de 2027», en hora de Colombia y sin depender del ICU del navegador. */
export function longDateEs(t: number, withYear = false): string {
  const d = new Date(t - 5 * 3_600_000);
  return `${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]}${withYear ? ` de ${d.getUTCFullYear()}` : ""}`;
}

export function planValidity(
  p: Pick<NormalizedPlan, "plan" | "currentPeriodEnd">,
  now: number,
): PlanValidity {
  const end = p.currentPeriodEnd ? Date.parse(p.currentPeriodEnd) : NaN;
  if (p.plan !== "institution_monthly" || !Number.isFinite(end) || end <= now) {
    return { daysLeft: null, renewSoon: false, line: null };
  }
  const daysLeft = Math.ceil((end - now) / 86_400_000);
  return {
    daysLeft,
    renewSoon: daysLeft <= RENEW_REMINDER_DAYS,
    line: `Vigente hasta el ${longDateEs(end, true)}`,
  };
}
