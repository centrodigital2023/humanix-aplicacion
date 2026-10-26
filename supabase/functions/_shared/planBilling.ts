// Lógica de cobro y vigencia de planes — módulo puro (sin APIs de Deno) para que lo usen las Edge Functions
// `mp-create-subscription` y `mp-webhook`, la interfaz (vía `src/lib/planBilling.ts`) y las pruebas de Vitest.
//
// Cómo funciona el cobro hoy, en COP, con dos formas de pagar el mismo plan:
//  - «once» (por defecto): un mes con Checkout Pro (`/checkout/preferences`). Admite PSE, Nequi, tarjeta y efectivo
//    sin cuenta de Mercado Pago; no se renueva solo.
//  - «recurring»: suscripción (`/preapproval`) que cobra un mes cada mes con tarjeta hasta que la persona la cancela.
//    Mercado Pago no cobra PSE de forma recurrente, por eso no es la opción por defecto.
// Cada pago aprobado suma un mes; el webhook (o la confirmación al volver) es lo único que activa un plan en
// `mp_subscriptions`.
//
// Reglas que este módulo hace cumplir (todas probadas en `src/lib/planBilling.test.ts`):
//  1. Se activa el plan que se PAGÓ (lo fija nuestro servidor en la preferencia), nunca el que esté guardado en la
//     fila en ese momento. Antes, abrir el pago de un plan caro y pagar uno barato activaba el caro.
//  2. El monto pagado debe cubrir el precio del plan pagado; si no, no se activa nada.
//  3. Abrir un pago no toca un plan vigente: solo se marca «pendiente» a quien no tiene plan.
//  4. Con un plan vigente no se puede bajar de plan (se hace cuando termine); renovar el mismo plan suma un mes desde
//     el vencimiento; subir de plan convierte los días que quedaban al valor del plan nuevo (no se pierden).
//  5. Un pago rechazado o cancelado no le quita a nadie un plan que sigue vigente.
//  6. Con una suscripción activa del mismo plan no se abre otra (sería un cobro doble).
//  7. El plan Institucional se cobra por sedes activas (las cuenta el servidor) y puede pagarse anual: 12 meses por el
//     precio de 10. Los demás planes son un mes al precio de la tabla (`PLAN_PRICE_COP`).

export const PAID_PLANS = [
  "essential_monthly",
  "pro_monthly",
  "family_premium_monthly",
  "pro_premium_monthly",
  "institution_monthly",
] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/**
 * Precio mensual en COP (tabla de precios de oct 2026). Debe coincidir con `PLAN_CATALOG` de `src/lib/plans.ts` (hay una
 * prueba que lo exige). La clave `essential_monthly` es el plan Familiar: se conserva la clave para no tocar las filas
 * que ya existen en `mp_subscriptions` ni las funciones SQL que la usan.
 *  - Familia: Familiar 9.900 · Premium Familiar 24.900
 *  - Profesional: Pro 19.900 · Premium 39.900
 *  - Institución: desde 299.000 (1 sede) + 50.000 por sede adicional; anual = 12 meses por el precio de 10
 */
export const PLAN_PRICE_COP: Record<PaidPlan, number> = {
  essential_monthly: 9900,
  pro_monthly: 19900,
  family_premium_monthly: 24900,
  pro_premium_monthly: 39900,
  institution_monthly: 299000,
};

/**
 * Precios con los que se vendieron estos planes antes de la tabla de oct 2026. Las suscripciones de Mercado Pago creadas
 * entonces siguen cobrando ese valor: sus cobros se aceptan y el plan se renueva igual (nadie pierde su plan por el
 * cambio de precios).
 */
export const LEGACY_PRICE_COP: Partial<Record<PaidPlan, number>> = {
  essential_monthly: 9000,
  pro_monthly: 29000,
};

/** Orden por precio: decide qué es subir y qué es bajar de plan. */
export const PLAN_TIER: Record<string, number> = {
  free: 0,
  essential_monthly: 1,
  pro_monthly: 2,
  family_premium_monthly: 3,
  pro_premium_monthly: 4,
  institution_monthly: 5,
};

export const PLAN_LABEL: Record<PaidPlan, string> = {
  essential_monthly: "Familiar",
  pro_monthly: "Pro",
  family_premium_monthly: "Premium Familiar",
  pro_premium_monthly: "Premium Profesional",
  institution_monthly: "Institucional",
};

export const PLAN_TITLE: Record<PaidPlan, string> = {
  essential_monthly: "Humanix Familiar · mensual",
  pro_monthly: "Humanix Pro · mensual",
  family_premium_monthly: "Humanix Premium Familiar · mensual",
  pro_premium_monthly: "Humanix Premium Profesional · mensual",
  institution_monthly: "Humanix Institucional · mensual",
};

/** Título del pago único de un mes (Checkout Pro). */
export const PLAN_TITLE_ONCE: Record<PaidPlan, string> = {
  essential_monthly: "Humanix Familiar · 1 mes",
  pro_monthly: "Humanix Pro · 1 mes",
  family_premium_monthly: "Humanix Premium Familiar · 1 mes",
  pro_premium_monthly: "Humanix Premium Profesional · 1 mes",
  institution_monthly: "Humanix Institucional · 1 mes",
};

// ─── Plan Institucional: sedes y ciclo anual ──────────────────────────────────

export type BillingCycle = "monthly" | "annual";

export const INSTITUTION_PRICING = {
  /** Precio mensual con la sede principal incluida (COP). */
  baseCOP: 299_000,
  /** Cada sede adicional, por mes (COP). */
  extraBranchCOP: 50_000,
  includedBranches: 1,
  /** Tope de sedes (el mismo de `guard_institution_branches` en SQL). */
  maxBranches: 200,
  /** Contrato anual: 12 meses de servicio por el precio de 10. */
  annualMonths: 12,
  annualPaidMonths: 10,
} as const;

/** Ciclo pedido por la web («anual»/«annual»); cualquier otra cosa es mensual. */
export function billingCycleOf(v: unknown): BillingCycle {
  return v === "annual" || v === "anual" ? "annual" : "monthly";
}

/** Lo que se cobra por un plan: lo calcula siempre el servidor (nunca un monto que venga del navegador). */
export interface PlanQuote {
  plan: PaidPlan;
  cycle: BillingCycle;
  /** Sedes activas cobradas (1 en los planes que no son institucionales). */
  branches: number;
  /** Meses de servicio que da el pago: 1, o 12 en el contrato anual. */
  months: number;
  /** Valor mensual antes del descuento anual. */
  monthlyCOP: number;
  /** Total a cobrar en este pago. */
  amount: number;
}

function branchCount(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, INSTITUTION_PRICING.maxBranches);
}

/**
 * Cuánto cuesta un pago de `plan`. Solo el plan Institucional tiene sedes y ciclo anual; los demás son siempre un mes al
 * precio de la tabla.
 */
export function planQuote(
  plan: PaidPlan,
  opts: { cycle?: unknown; branches?: unknown } = {},
): PlanQuote {
  if (plan !== "institution_monthly") {
    const price = PLAN_PRICE_COP[plan];
    return { plan, cycle: "monthly", branches: 1, months: 1, monthlyCOP: price, amount: price };
  }
  const p = INSTITUTION_PRICING;
  const branches = branchCount(opts.branches);
  const cycle = billingCycleOf(opts.cycle);
  const monthlyCOP = p.baseCOP + Math.max(0, branches - p.includedBranches) * p.extraBranchCOP;
  return cycle === "annual"
    ? {
        plan,
        cycle,
        branches,
        months: p.annualMonths,
        monthlyCOP,
        amount: monthlyCOP * p.annualPaidMonths,
      }
    : { plan, cycle, branches, months: 1, monthlyCOP, amount: monthlyCOP };
}

/**
 * Nombre del cobro en Mercado Pago. Con una sola sede y ciclo mensual es el mismo de siempre (`PLAN_TITLE`/
 * `PLAN_TITLE_ONCE`); las sedes y el ciclo anual van en el nombre para que cada combinación tenga su propio plan de
 * suscripción en Mercado Pago.
 */
export function quoteTitle(q: PlanQuote, mode: CheckoutMode): string {
  if (q.plan !== "institution_monthly" || (q.branches === 1 && q.cycle === "monthly")) {
    return mode === "recurring" ? PLAN_TITLE[q.plan] : PLAN_TITLE_ONCE[q.plan];
  }
  const sedes = q.branches > 1 ? ` · ${q.branches} sedes` : "";
  const period =
    mode === "recurring"
      ? q.cycle === "annual"
        ? " · anual"
        : " · mensual"
      : q.cycle === "annual"
        ? ` · ${INSTITUTION_PRICING.annualMonths} meses (pagas ${INSTITUTION_PRICING.annualPaidMonths})`
        : " · 1 mes";
  return `Humanix Institucional${sedes}${period}`;
}

/** Meses que da un pago según la metadata que fijó el servidor: 12 (anual) o 1. */
export function monthsOf(v: unknown): number {
  return Number(v) === INSTITUTION_PRICING.annualMonths ? INSTITUTION_PRICING.annualMonths : 1;
}

/**
 * Lo mínimo que puede valer un pago de `plan` por `months` meses: el precio más bajo con el que se ha vendido ese plan
 * (el actual o el de antes) por los meses que se pagan (en el anual, 10).
 */
export function minAcceptedPrice(plan: PaidPlan, months: number): number {
  const monthly = Math.min(PLAN_PRICE_COP[plan], LEGACY_PRICE_COP[plan] ?? Infinity);
  return months === INSTITUTION_PRICING.annualMonths
    ? monthly * INSTITUTION_PRICING.annualPaidMonths
    : monthly;
}

export type CheckoutMode = "once" | "recurring";

/** Forma de pago pedida por la web; cualquier otra cosa es el pago único (el que admite PSE). */
export function checkoutModeOf(v: unknown): CheckoutMode {
  return v === "recurring" ? "recurring" : "once";
}

const DAY_MS = 86_400_000;

export function isPaidPlan(v: unknown): v is PaidPlan {
  return typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);
}

export function tierOfPlan(plan: string | null | undefined): number {
  return (plan && PLAN_TIER[plan]) || 0;
}

/** Fila de `mp_subscriptions` (solo lo que hace falta aquí). */
export interface SubscriptionRow {
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  /** Suscripción de Mercado Pago que cobra este plan cada mes (null = sin cobro automático). */
  mp_preapproval_id?: string | null;
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return Date.parse(iso);
}

/**
 * El plan de pago vigente ahora, o `null`. Misma regla que `get_user_plan()` en SQL y que `usePlan`: estado
 * `active`/`approved` y sin vencer (una fila sin fecha de fin cuenta como vigente).
 */
export function activePaidPlan(
  row: SubscriptionRow | null | undefined,
  now: number,
): PaidPlan | null {
  if (!row || !isPaidPlan(row.plan)) return null;
  if (row.status !== "active" && row.status !== "approved") return null;
  const end = ms(row.current_period_end);
  if (Number.isFinite(end) && end <= now) return null;
  return row.plan;
}

/** Suma un mes calendario (UTC), sin saltar de mes: el 31 de enero pasa al 28/29 de febrero. */
export function addOneMonth(t: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const lastOfNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const out = new Date(t);
  out.setUTCDate(1);
  out.setUTCMonth(m + 1);
  out.setUTCDate(Math.min(d.getUTCDate(), lastOfNext));
  return out.getTime();
}

/** Suma `months` meses calendario (UTC) sin saltar de mes. */
export function addMonths(t: number, months: number): number {
  let out = t;
  for (let i = 0; i < months; i++) out = addOneMonth(out);
  return out;
}

// ─── Abrir un pago ─────────────────────────────────────────────────────────────

export type CheckoutDecision =
  | {
      ok: true;
      plan: PaidPlan;
      amount: number;
      /** Lo que se cobra (sedes, ciclo y meses en el plan Institucional). */
      quote: PlanQuote;
      /** Escribir la fila «pendiente»: solo si no hay un plan vigente que se pueda pisar. */
      writePending: boolean;
      kind: "new" | "renew" | "upgrade";
    }
  | { ok: false; error: "unknown_plan" }
  | { ok: false; error: "already_subscribed"; current: PaidPlan; endsAt: string | null }
  | { ok: false; error: "downgrade_while_active"; current: PaidPlan; endsAt: string | null };

/**
 * Qué hacer cuando alguien pide pagar `requested`. Sin plan pedido se mantiene el valor de siempre (Pro). `opts` solo
 * cuenta en el plan Institucional: ciclo pedido y sedes activas (las cuenta el servidor, nunca el navegador).
 */
export function checkoutDecision(
  row: SubscriptionRow | null | undefined,
  requested: unknown,
  now: number,
  opts: { cycle?: unknown; branches?: unknown } = {},
): CheckoutDecision {
  const plan = requested === undefined || requested === null ? "pro_monthly" : requested;
  if (!isPaidPlan(plan)) return { ok: false, error: "unknown_plan" };
  const current = activePaidPlan(row, now);
  const quote = planQuote(plan, opts);
  const amount = quote.amount;
  if (!current) return { ok: true, plan, amount, quote, writePending: true, kind: "new" };
  if (tierOfPlan(plan) < tierOfPlan(current)) {
    return {
      ok: false,
      error: "downgrade_while_active",
      current,
      endsAt: row?.current_period_end ?? null,
    };
  }
  if (plan === current && row?.mp_preapproval_id) {
    // Ya se cobra solo cada mes: otra suscripción del mismo plan sería un cobro doble.
    return {
      ok: false,
      error: "already_subscribed",
      current,
      endsAt: row.current_period_end ?? null,
    };
  }
  return {
    ok: true,
    plan,
    amount,
    quote,
    writePending: false,
    kind: plan === current ? "renew" : "upgrade",
  };
}

// ─── Pago aprobado ─────────────────────────────────────────────────────────────

/**
 * Días que quedaban del plan anterior, convertidos al valor del plan nuevo (redondeo hacia abajo). Subir de
 * Familiar a Premium Familiar con 20 días pendientes suma 7 días de Premium: 20 × 9.900 / 24.900.
 */
export function carryOverDays(from: PaidPlan, to: PaidPlan, remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  const days = remainingMs / DAY_MS;
  return Math.floor((days * PLAN_PRICE_COP[from]) / PLAN_PRICE_COP[to]);
}

/** Lo que NUESTRO servidor fijó en la preferencia (metadata e ítem): nunca viene del navegador. */
export interface PaidPayment {
  metadata?: Record<string, unknown> | null;
  additional_info?: { items?: Array<{ id?: unknown }> | null } | null;
  transaction_amount?: unknown;
  currency_id?: unknown;
}

/** Plan que se pagó: el `plan` de la metadata o, si falta, el id del ítem. */
export function paidPlanOf(payment: PaidPayment): PaidPlan | null {
  const fromMeta = payment.metadata?.plan;
  if (isPaidPlan(fromMeta)) return fromMeta;
  const fromItem = payment.additional_info?.items?.[0]?.id;
  return isPaidPlan(fromItem) ? fromItem : null;
}

export interface ActivationPatch {
  plan: PaidPlan;
  status: "active";
  amount: number;
  currency: "COP";
  current_period_end: string;
  next_payment_at: string;
  /** Solo cuando el pago viene de una suscripción: la que seguirá cobrando este plan. */
  mp_preapproval_id?: string;
}

export type ApprovalResult =
  | {
      ok: true;
      patch: ActivationPatch;
      kind: "new" | "renew" | "upgrade" | "change";
      carriedDays: number;
    }
  | { ok: false; error: "unknown_plan" | "amount_mismatch" | "currency_mismatch" };

/**
 * Cómo queda la suscripción tras un pago aprobado.
 *  - Nuevo (sin plan vigente): un mes (o 12 en el contrato anual) desde hoy.
 *  - Renovación (mismo plan vigente): los meses pagados desde el vencimiento actual (no se pierden días).
 *  - Subida de plan: los meses pagados desde hoy + los días que quedaban, convertidos al valor del plan nuevo.
 *  - Cambio a un plan menor con uno vigente (el checkout ya no lo permite; si llega, se respeta lo pagado): un mes
 *    desde hoy, sin días de arrastre.
 */
export function subscriptionAfterApproval(input: {
  row: SubscriptionRow | null | undefined;
  payment: PaidPayment;
  now: number;
}): ApprovalResult {
  const { row, payment, now } = input;
  const plan = paidPlanOf(payment);
  if (!plan) return { ok: false, error: "unknown_plan" };
  if (String(payment.currency_id ?? "COP") !== "COP")
    return { ok: false, error: "currency_mismatch" };
  const amount = Math.round(Number(payment.transaction_amount ?? 0));
  const months = monthsOf(payment.metadata?.months);
  // El precio lo fijó nuestro servidor al crear el cobro (sedes, ciclo, o el precio con el que se vendió una
  // suscripción antigua); nunca puede quedar por debajo de lo mínimo que se ha cobrado por ese plan.
  const metaPrice = Number(payment.metadata?.price_cop);
  const floor = minAcceptedPrice(plan, months);
  const expected =
    Number.isFinite(metaPrice) && metaPrice >= floor
      ? metaPrice
      : planQuote(plan, { cycle: months === 1 ? "monthly" : "annual" }).amount;
  if (!(amount > 0) || amount < expected) return { ok: false, error: "amount_mismatch" };

  const current = activePaidPlan(row, now);
  const end = ms(row?.current_period_end);
  let start = now;
  let carriedDays = 0;
  let kind: "new" | "renew" | "upgrade" | "change" = "new";
  if (current === plan) {
    kind = "renew";
    if (Number.isFinite(end) && end > now) start = end;
  } else if (current && tierOfPlan(plan) > tierOfPlan(current)) {
    kind = "upgrade";
    carriedDays = Number.isFinite(end) ? carryOverDays(current, plan, end - now) : 0;
  } else if (current) {
    kind = "change";
  }
  const periodEnd = addMonths(start, months) + carriedDays * DAY_MS;
  const iso = new Date(periodEnd).toISOString();
  const preapprovalId = payment.metadata?.preapproval_id;
  return {
    ok: true,
    kind,
    carriedDays,
    patch: {
      plan,
      status: "active",
      amount,
      currency: "COP",
      current_period_end: iso,
      next_payment_at: iso,
      ...(typeof preapprovalId === "string" && preapprovalId
        ? { mp_preapproval_id: preapprovalId }
        : {}),
    },
  };
}

/** Estado a guardar tras un pago rechazado o cancelado; `null` = no tocar (hay un plan vigente que se respeta). */
export function statusAfterFailure(
  row: SubscriptionRow | null | undefined,
  status: "rejected" | "cancelled",
  now: number,
): "rejected" | "cancelled" | null {
  return activePaidPlan(row, now) ? null : status;
}

// ─── Recompensa por referido ───────────────────────────────────────────────────

/** Lo que gana quien refiere cuando la persona referida paga su primer plan: un mes del plan Familiar. */
export const REFERRAL_REWARD_PLAN: PaidPlan = "essential_monthly";

export interface ReferralRewardPatch {
  plan: PaidPlan;
  status: "active";
  current_period_end: string;
  next_payment_at: string;
  /** Solo cuando se crea el plan de cero: un plan regalado no cobró nada. */
  amount?: 0;
  currency?: "COP";
}

/**
 * Cómo queda el plan de quien refiere tras ganar la recompensa (un mes del plan Familiar).
 *  - Sin plan vigente: Familiar por un mes desde hoy.
 *  - Con Familiar vigente: un mes más desde el vencimiento.
 *  - Con un plan mayor vigente: se conserva ese plan y se suman los días que vale un mes de Familiar al precio de
 *    ese plan (misma conversión que al subir de plan, con un mes de 30 días). Un mes de Familiar en Pro son 14 días.
 */
export function subscriptionAfterReferralReward(
  row: SubscriptionRow | null | undefined,
  now: number,
): { patch: ReferralRewardPatch; kind: "new" | "extend" | "convert"; days: number } {
  const current = activePaidPlan(row, now);
  const end = ms(row?.current_period_end);
  const iso = (t: number) => new Date(t).toISOString();
  if (!current) {
    const t = addOneMonth(now);
    return {
      kind: "new",
      days: Math.round((t - now) / DAY_MS),
      patch: {
        plan: REFERRAL_REWARD_PLAN,
        status: "active",
        amount: 0,
        currency: "COP",
        current_period_end: iso(t),
        next_payment_at: iso(t),
      },
    };
  }
  const from = Number.isFinite(end) && end > now ? end : now;
  if (current === REFERRAL_REWARD_PLAN) {
    const t = addOneMonth(from);
    return {
      kind: "extend",
      days: Math.round((t - from) / DAY_MS),
      patch: {
        plan: current,
        status: "active",
        current_period_end: iso(t),
        next_payment_at: iso(t),
      },
    };
  }
  const days = carryOverDays(REFERRAL_REWARD_PLAN, current, 30 * DAY_MS);
  const t = from + days * DAY_MS;
  return {
    kind: "convert",
    days,
    patch: { plan: current, status: "active", current_period_end: iso(t), next_payment_at: iso(t) },
  };
}

// ─── A qué panel vuelve cada perfil ────────────────────────────────────────────

export const RETURN_PATHS = [
  "/dashboard/profesional",
  "/dashboard/familia",
  "/dashboard/institucion",
] as const;

const ROLE_PATH: Record<string, (typeof RETURN_PATHS)[number]> = {
  institution: "/dashboard/institucion",
  family: "/dashboard/familia",
  professional: "/dashboard/profesional",
};

/**
 * Panel al que vuelve quien paga. Si el navegador pidió uno de la lista y corresponde a uno de sus roles, ese; si
 * no, el de su rol (institución, familia, profesional); si no tiene ninguno, el panel general.
 */
export function returnPathFor(roles: readonly string[], requested?: unknown): string {
  const own = ["institution", "family", "professional"]
    .filter((r) => roles.includes(r))
    .map((r) => ROLE_PATH[r]);
  if (typeof requested === "string" && own.includes(requested as (typeof RETURN_PATHS)[number])) {
    return requested;
  }
  return own[0] ?? "/dashboard";
}

// ─── Créditos IA ──────────────────────────────────────────────────────────────

/** Tope de créditos por compra: un número mayor es un dato dañado, no un paquete. */
export const MAX_CREDITS_PER_PURCHASE = 100_000;

export interface CreditGrant {
  credits: number;
  packId: string | null;
  validityDays: number;
  priceCop: number;
}

export type CreditGrantResult =
  | { ok: true; grant: CreditGrant }
  | { ok: false; error: "invalid_credits" | "amount_mismatch" | "currency_mismatch" };

/**
 * Qué acreditar por un pago de créditos aprobado. Todo sale de lo que fijó NUESTRO servidor en la preferencia
 * (`metadata`): créditos, paquete, vigencia y precio. El monto pagado debe cubrir ese precio. Las preferencias creadas
 * antes de guardar el precio (sin `price_cop`) solo exigen un monto positivo.
 */
export function creditsGrantFromPayment(payment: PaidPayment): CreditGrantResult {
  if (String(payment.currency_id ?? "COP") !== "COP")
    return { ok: false, error: "currency_mismatch" };
  const meta = payment.metadata ?? {};
  const credits = Number(meta.credits);
  if (!Number.isInteger(credits) || credits <= 0 || credits > MAX_CREDITS_PER_PURCHASE) {
    return { ok: false, error: "invalid_credits" };
  }
  const amount = Math.round(Number(payment.transaction_amount ?? 0));
  const price = Number(meta.price_cop);
  const expected = Number.isFinite(price) && price > 0 ? price : 1;
  if (!(amount > 0) || amount < expected) return { ok: false, error: "amount_mismatch" };
  const days = Number(meta.validity_days);
  return {
    ok: true,
    grant: {
      credits,
      packId: typeof meta.pack_id === "string" ? meta.pack_id : null,
      validityDays: Number.isInteger(days) && days >= 1 && days <= 730 ? days : 90,
      priceCop: amount,
    },
  };
}

/** Avisos de Mercado Pago que no son de un pago (p. ej. `merchant_order`): se reconocen y se ignoran. */
export function isPaymentTopic(topic: string | null): boolean {
  return topic === null || topic === "" || topic === "payment";
}

// ─── Suscripciones de Mercado Pago (/preapproval) ─────────────────────────────

/** Aviso de un cobro mensual de una suscripción (`/authorized_payments/{id}`). */
export const SUBSCRIPTION_PAYMENT_TOPIC = "subscription_authorized_payment";
/** Aviso de un cambio de estado de la suscripción (`/preapproval/{id}`): autorizada, pausada, cancelada. */
export const PREAPPROVAL_TOPIC = "subscription_preapproval";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `external_reference` de la suscripción: quién, qué plan y, si es anual, el ciclo; lo fija nuestro servidor.
 * `sub:<usuario>:<plan>` (mensual, como siempre) o `sub:<usuario>:<plan>:annual`.
 */
export function preapprovalReference(
  userId: string,
  plan: PaidPlan,
  cycle: BillingCycle = "monthly",
): string {
  return cycle === "annual" ? `sub:${userId}:${plan}:annual` : `sub:${userId}:${plan}`;
}

export function parsePreapprovalReference(
  ref: unknown,
): { userId: string; plan: PaidPlan; cycle: BillingCycle } | null {
  const parts = typeof ref === "string" ? ref.split(":") : [];
  if (parts[0] !== "sub" || (parts.length !== 3 && !(parts.length === 4 && parts[3] === "annual")))
    return null;
  const [, userId, plan] = parts;
  if (!UUID.test(userId) || !isPaidPlan(plan)) return null;
  return { userId, plan, cycle: parts.length === 4 ? "annual" : "monthly" };
}

/**
 * Cuerpo de `POST /preapproval` (suscripción sin plan asociado, estado `pending`): Mercado Pago devuelve un
 * `init_point` donde la persona elige el medio de pago y autoriza el cobro mensual. Sin plan asociado porque así
 * cada suscripción lleva a quién pertenece (`external_reference`), sin tarjetas en nuestro servidor.
 */
export function preapprovalRequest(input: {
  userId: string;
  plan: PaidPlan;
  email: string;
  backUrl: string;
  quote?: PlanQuote;
}) {
  const q = input.quote ?? planQuote(input.plan);
  return {
    reason: quoteTitle(q, "recurring"),
    external_reference: preapprovalReference(input.userId, input.plan, q.cycle),
    payer_email: input.email,
    auto_recurring: {
      frequency: q.months,
      frequency_type: "months",
      transaction_amount: q.amount,
      currency_id: "COP",
    },
    back_url: input.backUrl,
    status: "pending",
  };
}

/**
 * Cuerpo de `POST /checkout/preferences` para pagar UN mes (Checkout Pro). Sin excluir medios de pago: PSE, Nequi,
 * tarjeta y efectivo, como invitado. `binary_mode: false` deja PSE «pendiente» mientras el banco confirma.
 */
export function preferenceRequest(input: {
  userId: string;
  plan: PaidPlan;
  email: string | null;
  origin: string;
  returnPath: string;
  notificationUrl: string;
  quote?: PlanQuote;
}) {
  const { plan, origin } = input;
  const q = input.quote ?? planQuote(plan);
  const amount = q.amount;
  const from = encodeURIComponent(input.returnPath);
  return {
    items: [
      {
        id: plan,
        title: quoteTitle(q, "once"),
        quantity: 1,
        unit_price: amount,
        currency_id: "COP",
      },
    ],
    // Sin `payer`: un correo prellenado que tenga cuenta en Mercado Pago obliga a iniciar sesión y bloquea el botón
    // de pagar. Sin él, PSE, tarjeta y efectivo se pagan como invitado.
    back_urls: {
      success: `${origin}/pago/exito?tipo=plan&plan=${plan}&from=${from}`,
      failure: `${origin}/pago/fallo?tipo=plan&plan=${plan}&from=${from}`,
      pending: `${origin}/pago/exito?tipo=plan&plan=${plan}&estado=pending&from=${from}`,
    },
    auto_return: "approved",
    payment_methods: { excluded_payment_types: [], excluded_payment_methods: [], installments: 1 },
    binary_mode: false,
    external_reference: input.userId,
    notification_url: input.notificationUrl,
    statement_descriptor: "HUMANIX",
    // Lo que el webhook usa para activar: el plan, el precio y los meses que fijó este servidor.
    metadata: quoteMetadata(input.userId, q),
  };
}

/** Metadata de un cobro: lo único que el webhook usa para activar el plan (lo fija este servidor). */
export function quoteMetadata(userId: string, q: PlanQuote) {
  return {
    user_id: userId,
    plan: q.plan,
    price_cop: q.amount,
    months: q.months,
    cycle: q.cycle,
    branches: q.branches,
  };
}

/** Lo que importa de `GET /preapproval/{id}`. */
export interface MpPreapproval {
  id?: unknown;
  status?: unknown;
  external_reference?: unknown;
  payer_email?: unknown;
  auto_recurring?: { transaction_amount?: unknown; currency_id?: unknown } | null;
}

/**
 * Un cobro de una suscripción no trae la metadata de una preferencia: se la pone el servidor a partir de la
 * suscripción consultada en Mercado Pago (nunca del aviso). `null` si la suscripción no es nuestra o no es en COP.
 */
export function withSubscriptionMetadata<P extends PaidPayment>(
  payment: P,
  preapproval: MpPreapproval,
): P | null {
  const ref = parsePreapprovalReference(preapproval.external_reference);
  const id = typeof preapproval.id === "string" ? preapproval.id : "";
  if (!ref || !id) return null;
  if (String(preapproval.auto_recurring?.currency_id ?? "COP") !== "COP") return null;
  const months = ref.cycle === "annual" ? INSTITUTION_PRICING.annualMonths : 1;
  // El valor de la suscripción lo fijó nuestro servidor al crearla (sedes, ciclo o el precio de ese momento); si no
  // llega o es menor que lo mínimo que se ha cobrado por ese plan, se exige el precio de hoy.
  const recurring = Math.round(Number(preapproval.auto_recurring?.transaction_amount));
  const price =
    Number.isFinite(recurring) && recurring >= minAcceptedPrice(ref.plan, months)
      ? recurring
      : planQuote(ref.plan, { cycle: ref.cycle }).amount;
  return {
    ...payment,
    metadata: {
      ...(payment.metadata ?? {}),
      user_id: ref.userId,
      plan: ref.plan,
      price_cop: price,
      months,
      cycle: ref.cycle,
      preapproval_id: id,
    },
  };
}

/** Id de la suscripción a la que pertenece un pago, si Mercado Pago lo indica. */
export function preapprovalIdOfPayment(payment: {
  metadata?: Record<string, unknown> | null;
  point_of_interaction?: unknown;
}): string | null {
  const fromMeta = payment.metadata?.preapproval_id;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  const poi = payment.point_of_interaction as
    { transaction_data?: { subscription_id?: unknown } | null } | null | undefined;
  const fromPoi = poi?.transaction_data?.subscription_id;
  return typeof fromPoi === "string" && fromPoi ? fromPoi : null;
}

/**
 * Qué escribir en `mp_subscriptions` cuando cambia el estado de una suscripción. El plan pagado sigue vigente hasta
 * su vencimiento aunque se cancele: solo se deja de cobrar. `null` = nada que escribir.
 *  - `authorized`: se guarda como la suscripción de la persona (si es la del plan que tiene o no tiene plan).
 *  - `cancelled`/`paused`: si era la suscripción guardada, se quita (ya no se renueva sola).
 */
export function subscriptionAfterPreapprovalStatus(
  row: SubscriptionRow | null | undefined,
  preapproval: { id: string; status: string; plan: PaidPlan },
  now: number,
): { mp_preapproval_id: string | null } | null {
  if (preapproval.status === "cancelled" || preapproval.status === "paused") {
    return row?.mp_preapproval_id === preapproval.id ? { mp_preapproval_id: null } : null;
  }
  if (preapproval.status === "authorized") {
    if (row?.mp_preapproval_id === preapproval.id) return null;
    const current = activePaidPlan(row, now);
    // El cambio a un plan mayor queda guardado cuando se aprueba su primer cobro (ver `subscriptionAfterApproval`).
    if (current && current !== preapproval.plan) return null;
    return { mp_preapproval_id: preapproval.id };
  }
  return null;
}

// ─── Pago dentro de Humanix (Checkout Bricks) ─────────────────────────────────
//
// La persona paga en /pagar con los formularios de Mercado Pago (Payment Brick y Card Payment Brick). El navegador
// solo manda lo que el formulario recogió (token de la tarjeta, banco de PSE, documento); el servidor arma el cobro
// con el plan, el precio y la referencia que fija él mismo. Nunca se usa un monto que venga del navegador.

/**
 * Cuerpo de `POST /preapproval_plan`: el plan de suscripción de Mercado Pago para un plan de Humanix (y, en el
 * Institucional, para sus sedes y su ciclo: el anual cobra cada 12 meses).
 */
export function subscriptionPlanRequest(planOrQuote: PaidPlan | PlanQuote, backUrl: string) {
  const q = typeof planOrQuote === "string" ? planQuote(planOrQuote) : planOrQuote;
  return {
    reason: quoteTitle(q, "recurring"),
    auto_recurring: {
      frequency: q.months,
      frequency_type: "months",
      transaction_amount: q.amount,
      currency_id: "COP",
    },
    back_url: backUrl,
  };
}

/** Lo que importa de un plan de suscripción de Mercado Pago (`/preapproval_plan`). */
export interface MpSubscriptionPlan {
  id?: unknown;
  status?: unknown;
  reason?: unknown;
  date_created?: unknown;
  auto_recurring?: { transaction_amount?: unknown; currency_id?: unknown } | null;
}

/**
 * El plan de suscripción ya creado para `plan`: activo, con el mismo nombre, precio y moneda. Si hubiera varios
 * (dos personas lo crearon a la vez), siempre el más antiguo, para que todas las suscripciones queden en uno.
 */
export function findSubscriptionPlan(
  results: readonly MpSubscriptionPlan[] | null | undefined,
  planOrQuote: PaidPlan | PlanQuote,
): string | null {
  const q = typeof planOrQuote === "string" ? planQuote(planOrQuote) : planOrQuote;
  const match = (results ?? [])
    .filter(
      (p) =>
        typeof p.id === "string" &&
        p.id &&
        p.status === "active" &&
        p.reason === quoteTitle(q, "recurring") &&
        Number(p.auto_recurring?.transaction_amount) === q.amount &&
        String(p.auto_recurring?.currency_id ?? "") === "COP",
    )
    .sort((a, b) => String(a.date_created ?? "").localeCompare(String(b.date_created ?? "")));
  return (match[0]?.id as string | undefined) ?? null;
}

/**
 * Cuerpo de `POST /preapproval` con plan asociado: la tarjeta ya viene como token del formulario de Mercado Pago y
 * la suscripción nace autorizada, sin que la persona tenga que entrar a su cuenta de Mercado Pago.
 */
export function cardSubscriptionRequest(input: {
  subscriptionPlanId: string;
  userId: string;
  plan: PaidPlan;
  email: string;
  cardTokenId: string;
  backUrl: string;
  quote?: PlanQuote;
}) {
  const q = input.quote ?? planQuote(input.plan);
  return {
    preapproval_plan_id: input.subscriptionPlanId,
    reason: quoteTitle(q, "recurring"),
    external_reference: preapprovalReference(input.userId, input.plan, q.cycle),
    payer_email: input.email,
    card_token_id: input.cardTokenId,
    back_url: input.backUrl,
    status: "authorized",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[0-9a-zA-Z_-]{8,128}$/;
const METHOD_RE = /^[a-z0-9_]{2,40}$/;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v);
}

export function isCardToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_RE.test(v);
}

const str = (v: unknown, max = 120): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** Medio de pago de un mes según lo que mandó el formulario. */
export type BrickMethod = "card" | "pse" | "ticket";

export function brickMethodOf(form: Record<string, unknown>): BrickMethod | null {
  const method = str(form.payment_method_id, 40) ?? "";
  if (!METHOD_RE.test(method)) return null;
  if (method === "pse") return "pse";
  if (isCardToken(form.token)) return "card";
  // Efecty y otros pagos en efectivo: sin token ni banco.
  return "ticket";
}

export type BrickPaymentBuild =
  | { ok: true; method: BrickMethod; body: Record<string, unknown> }
  | { ok: false; error: "invalid_form" };

/**
 * Cuerpo de `POST /v1/payments` para pagar UN mes desde el Payment Brick. Del formulario solo se toman los datos del
 * medio de pago y de quien paga; el plan, el precio, la referencia y los avisos los fija el servidor.
 * PSE además necesita la IP de quien paga y una URL de regreso: el banco abre su propia página y luego vuelve.
 */
export function brickPaymentRequest(input: {
  form: Record<string, unknown>;
  userId: string;
  plan: PaidPlan;
  accountEmail: string | null;
  accountName?: string | null;
  accountPhone?: string | null;
  accountCity?: string | null;
  ip: string;
  callbackUrl: string;
  notificationUrl: string;
  quote?: PlanQuote;
}): BrickPaymentBuild {
  const { form, plan, userId } = input;
  const q = input.quote ?? planQuote(plan);
  const method = brickMethodOf(form);
  if (!method) return { ok: false, error: "invalid_form" };
  const payerIn = (form.payer ?? {}) as Record<string, unknown>;
  const idIn = (payerIn.identification ?? {}) as Record<string, unknown>;
  const email = isEmail(payerIn.email) ? payerIn.email : input.accountEmail;
  if (!email) return { ok: false, error: "invalid_form" };

  const payer: Record<string, unknown> = { email };
  const idType = str(idIn.type, 20);
  const idNumber = str(idIn.number, 30);
  if (idType && idNumber) payer.identification = { type: idType, number: idNumber };
  // PSE exige nombre y apellido, pero el formulario de Mercado Pago no los pide: se toman de la cuenta.
  const nameParts = (
    str(input.accountName, 120) ?? email.split("@")[0].replace(/[^\p{L} ]+/gu, " ")
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstName = str(payerIn.first_name, 60) ?? (nameParts[0] || "Cliente");
  const lastName =
    str(payerIn.last_name, 60) ??
    (nameParts.length > 1 ? nameParts.slice(1).join(" ").slice(0, 60) : "Humanix");
  if (firstName) payer.first_name = firstName;
  if (lastName) payer.last_name = lastName;

  const body: Record<string, unknown> = {
    transaction_amount: q.amount,
    description: quoteTitle(q, "once"),
    payment_method_id: str(form.payment_method_id, 40),
    payer,
    external_reference: userId,
    notification_url: input.notificationUrl,
    statement_descriptor: "HUMANIX",
    binary_mode: false,
    metadata: quoteMetadata(userId, q),
  };

  if (method === "card") {
    const installments = Math.trunc(Number(form.installments ?? 1));
    body.token = form.token;
    body.installments = installments >= 1 && installments <= 36 ? installments : 1;
    const issuer = str(form.issuer_id, 20);
    if (issuer) body.issuer_id = issuer;
  }

  if (method === "pse") {
    const details = (form.transaction_details ?? {}) as Record<string, unknown>;
    const bank = str(details.financial_institution, 20);
    const entity = payerIn.entity_type === "association" ? "association" : "individual";
    if (!bank || !idType || !idNumber || !firstName || !lastName) {
      return { ok: false, error: "invalid_form" };
    }
    payer.entity_type = entity;
    const address = (payerIn.address ?? {}) as Record<string, unknown>;
    const addr: Record<string, string> = {};
    for (const k of [
      "zip_code",
      "street_name",
      "street_number",
      "neighborhood",
      "city",
      "federal_unit",
    ]) {
      const v = str(address[k], 80);
      if (v) addr[k] = v;
    }
    // PSE (Mercado Pago Colombia) rechaza el cobro ("BankTransfers Api fail") sin dirección y teléfono, pero el
    // formulario mínimo no los pide: se completan con datos de la cuenta o valores neutros.
    const city = str(input.accountCity, 60) ?? "Bogotá";
    payer.address = {
      zip_code: "110111",
      street_name: "Calle",
      street_number: "1",
      neighborhood: "Centro",
      city,
      federal_unit: city,
      ...addr,
    };
    const phone = (payerIn.phone ?? {}) as Record<string, unknown>;
    const phoneNumber =
      str(phone.number, 20) ??
      (str(input.accountPhone, 20) ?? "").replace(/\D/g, "").replace(/^57(?=\d{10}$)/, "") ??
      "";
    payer.phone = {
      area_code: str(phone.area_code, 6) ?? "57",
      number: /^\d{7,10}$/.test(phoneNumber) ? phoneNumber : "3000000000",
    };
    body.transaction_details = { financial_institution: bank };
    const ip = /^[0-9a-f.:]{3,45}$/i.test(input.ip) ? input.ip : "127.0.0.1";
    body.additional_info = { ip_address: ip };
    body.callback_url = input.callbackUrl;
  }

  return { ok: true, method, body };
}

/** Lo que la página /pagar necesita saber del pago recién creado. */
export interface BrickPaymentView {
  paymentId: string;
  status: string;
  statusDetail: string | null;
  /** PSE: la página del banco. */
  redirectUrl: string | null;
  /** Efectivo: el código o recibo para pagar en un punto. */
  voucherUrl: string | null;
}

export function brickPaymentView(
  payment: {
    id?: unknown;
    status?: unknown;
    status_detail?: unknown;
    transaction_details?: { external_resource_url?: unknown } | null;
  },
  method: BrickMethod,
): BrickPaymentView {
  const url = payment.transaction_details?.external_resource_url;
  const safe = typeof url === "string" && /^https:\/\//.test(url) ? url : null;
  return {
    paymentId: String(payment.id ?? ""),
    status: String(payment.status ?? "pending"),
    statusDetail: typeof payment.status_detail === "string" ? payment.status_detail : null,
    redirectUrl: method === "pse" ? safe : null,
    voucherUrl: method === "ticket" ? safe : null,
  };
}
