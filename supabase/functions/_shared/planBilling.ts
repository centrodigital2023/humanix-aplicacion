// Lógica de cobro y vigencia de planes — módulo puro (sin APIs de Deno) para que lo usen las Edge Functions
// `mp-create-subscription` y `mp-webhook`, la interfaz (vía `src/lib/planBilling.ts`) y las pruebas de Vitest.
//
// Cómo funciona el cobro hoy: cada pago es una preferencia simple de Mercado Pago por UN mes (no hay cobro
// automático). El webhook es el único que activa un plan en `mp_subscriptions`.
//
// Reglas que este módulo hace cumplir (todas probadas en `src/lib/planBilling.test.ts`):
//  1. Se activa el plan que se PAGÓ (lo fija nuestro servidor en la preferencia), nunca el que esté guardado en la
//     fila en ese momento. Antes, abrir el pago de un plan caro y pagar uno barato activaba el caro.
//  2. El monto pagado debe cubrir el precio del plan pagado; si no, no se activa nada.
//  3. Abrir un pago no toca un plan vigente: solo se marca «pendiente» a quien no tiene plan.
//  4. Con un plan vigente no se puede bajar de plan (se hace cuando termine); renovar el mismo plan suma un mes desde
//     el vencimiento; subir de plan convierte los días que quedaban al valor del plan nuevo (no se pierden).
//  5. Un pago rechazado o cancelado no le quita a nadie un plan que sigue vigente.

export const PAID_PLANS = ["essential_monthly", "pro_monthly", "institution_monthly"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/** Precio mensual en COP. Debe coincidir con `PLAN_CATALOG` de `src/lib/plans.ts` (hay una prueba que lo exige). */
export const PLAN_PRICE_COP: Record<PaidPlan, number> = {
  essential_monthly: 9000,
  pro_monthly: 29000,
  institution_monthly: 299000,
};

export const PLAN_TIER: Record<string, number> = {
  free: 0,
  essential_monthly: 1,
  pro_monthly: 2,
  institution_monthly: 3,
};

export const PLAN_LABEL: Record<PaidPlan, string> = {
  essential_monthly: "Esencial",
  pro_monthly: "Pro Profesional",
  institution_monthly: "IPS Mejorado",
};

export const PLAN_TITLE: Record<PaidPlan, string> = {
  essential_monthly: "Humanix Esencial · 1 mes",
  pro_monthly: "Humanix Pro · 1 mes",
  institution_monthly: "Humanix IPS Mejorado · 1 mes",
};

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

// ─── Abrir un pago ─────────────────────────────────────────────────────────────

export type CheckoutDecision =
  | {
      ok: true;
      plan: PaidPlan;
      amount: number;
      /** Escribir la fila «pendiente»: solo si no hay un plan vigente que se pueda pisar. */
      writePending: boolean;
      kind: "new" | "renew" | "upgrade";
    }
  | { ok: false; error: "unknown_plan" }
  | { ok: false; error: "downgrade_while_active"; current: PaidPlan; endsAt: string | null };

/** Qué hacer cuando alguien pide pagar `requested`. Sin plan pedido se mantiene el valor de siempre (Pro). */
export function checkoutDecision(
  row: SubscriptionRow | null | undefined,
  requested: unknown,
  now: number,
): CheckoutDecision {
  const plan = requested === undefined || requested === null ? "pro_monthly" : requested;
  if (!isPaidPlan(plan)) return { ok: false, error: "unknown_plan" };
  const current = activePaidPlan(row, now);
  const amount = PLAN_PRICE_COP[plan];
  if (!current) return { ok: true, plan, amount, writePending: true, kind: "new" };
  if (tierOfPlan(plan) < tierOfPlan(current)) {
    return {
      ok: false,
      error: "downgrade_while_active",
      current,
      endsAt: row?.current_period_end ?? null,
    };
  }
  return {
    ok: true,
    plan,
    amount,
    writePending: false,
    kind: plan === current ? "renew" : "upgrade",
  };
}

// ─── Pago aprobado ─────────────────────────────────────────────────────────────

/**
 * Días que quedaban del plan anterior, convertidos al valor del plan nuevo (redondeo hacia abajo). Subir de
 * Esencial a Pro con 20 días pendientes suma 6 días de Pro: 20 × 9.000 / 29.000.
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
  cancel_at_period_end: false;
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
 *  - Nuevo (sin plan vigente): un mes desde hoy.
 *  - Renovación (mismo plan vigente): un mes desde el vencimiento actual (no se pierden días).
 *  - Subida de plan: un mes desde hoy + los días que quedaban, convertidos al valor del plan nuevo.
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
  const metaPrice = Number(payment.metadata?.price_cop);
  const expected = Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : PLAN_PRICE_COP[plan];
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
  const periodEnd = addOneMonth(start) + carriedDays * DAY_MS;
  const iso = new Date(periodEnd).toISOString();
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
      cancel_at_period_end: false,
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
