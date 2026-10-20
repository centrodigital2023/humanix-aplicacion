// Procesar un pago de Mercado Pago YA CONSULTADO en su API: una sola lógica para el webhook (`mp-webhook`) y para la
// confirmación cuando la persona vuelve del checkout (`src/lib/payments.functions.ts`).
//
// No depende de Deno ni de Node: solo `fetch` vía `rest` (PostgREST con la clave de servicio) y `crypto.subtle`.
// Probado en `src/lib/mpPayment.test.ts`.
//
// Garantías:
// - Un pago aprobado se aplica UNA sola vez aunque lleguen dos avisos a la vez (o el aviso y la confirmación al
//   volver): `mp_payments.paid_at` se reclama con un PATCH condicional (`paid_at=is.null`), y solo quien lo gana aplica.
//   Si aplicar falla, el reclamo se libera para que el reintento lo haga.
// - Un estado que no existe en el enum `mp_payment_status` de producción (authorized, in_mediation, charged_back) se
//   guarda con su equivalente: antes rompía la escritura y Mercado Pago reintentaba sin fin.
// - Una notificación al usuario que falla no deshace ni repite una activación.
// - El primer plan que paga una persona referida le da un mes de Esencial a quien la refirió (`applyReferralReward`),
//   una sola vez por persona referida. Si falla, el pago de la persona referida sigue aplicado.
import {
  PLAN_LABEL,
  creditsGrantFromPayment,
  statusAfterFailure,
  subscriptionAfterApproval,
  subscriptionAfterReferralReward,
  type PaidPayment,
  type SubscriptionRow,
} from "./planBilling.ts";

/** Valores del enum `public.mp_payment_status` en producción (verificado el 19 oct 2026). */
export const DB_PAYMENT_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "refunded",
  "in_process",
] as const;
export type DbPaymentStatus = (typeof DB_PAYMENT_STATUSES)[number];

/** Estado de Mercado Pago → valor que acepta la base. El estado original queda en `raw_payload`. */
export function dbPaymentStatus(status: unknown): DbPaymentStatus {
  const s = String(status ?? "");
  if ((DB_PAYMENT_STATUSES as readonly string[]).includes(s)) return s as DbPaymentStatus;
  if (s === "charged_back") return "refunded";
  if (s === "in_mediation") return "in_process";
  return "pending"; // authorized y cualquier estado nuevo: no es un pago confirmado
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MpPayment extends PaidPayment {
  id?: string | number;
  status?: string;
  external_reference?: string | null;
  preference_id?: string | null;
  description?: string | null;
  [key: string]: unknown;
}

/** El usuario sale de lo que fijó NUESTRO servidor al crear la preferencia (metadata o external_reference). */
export function resolveUserId(payment: MpPayment): string | null {
  const ref = String(payment.external_reference ?? "");
  const fromRef = ref.startsWith("credits:") ? ref.split(":")[1] : ref;
  const candidate = String(payment.metadata?.user_id ?? fromRef ?? "");
  return UUID_RE.test(candidate) ? candidate : null;
}

export function isCreditsPayment(payment: MpPayment): boolean {
  return (
    String(payment.external_reference ?? "").startsWith("credits:") ||
    payment.metadata?.type === "credits"
  );
}

export type RestFn = (
  path: string,
  init?: RequestInit & { allowConflict?: boolean },
) => Promise<Response>;

/** PostgREST con la clave de servicio. Lanza si la respuesta no es 2xx (salvo 409 con `allowConflict`). */
export function makeRest(supabaseUrl: string, serviceRoleKey: string): RestFn {
  return async (path, init = {}) => {
    const { allowConflict, ...rest } = init;
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...rest,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
    });
    if (!res.ok && !(allowConflict && res.status === 409)) {
      throw new Error(`rest ${path.split("?")[0]} ${res.status}`);
    }
    return res;
  };
}

export type ProcessOutcome =
  | {
      result: "activated";
      kind: "new" | "renew" | "upgrade" | "change";
      plan: string;
      periodEnd: string;
      carriedDays: number;
    }
  | { result: "credited"; credits: number }
  | { result: "already_applied" }
  | { result: "pending"; status: string }
  | { result: "failed"; status: "rejected" | "cancelled" }
  | { result: "reversed"; status: string }
  | { result: "rejected"; error: string };

export interface ProcessDeps {
  rest: RestFn;
  now: () => number;
  /** "webhook": firma verificada · "return": la persona volvió del checkout y el servidor consultó el pago. */
  source: "webhook" | "return";
  topic?: string | null;
}

async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function processMercadoPagoPayment(
  payment: MpPayment,
  deps: ProcessDeps,
): Promise<ProcessOutcome> {
  const { rest, now } = deps;
  const status = String(payment.status ?? "pending");
  const paymentId = String(payment.id ?? "");
  if (!paymentId) return { result: "rejected", error: "missing_payment_id" };
  const eventId = `${paymentId}:${status}`;
  const eventFilter = `provider=eq.mercadopago&external_event_id=eq.${encodeURIComponent(eventId)}`;

  // Idempotencia por (pago, estado): lo ya procesado no se repite.
  const existing = (await (
    await rest(`payment_webhook_events?${eventFilter}&select=processed,error_code`)
  ).json()) as Array<{ processed: boolean; error_code: string | null }>;
  if (existing?.[0]?.processed) {
    return existing[0].error_code
      ? { result: "rejected", error: existing[0].error_code }
      : { result: "already_applied" };
  }
  if (!existing?.length) {
    await rest("payment_webhook_events", {
      method: "POST",
      allowConflict: true,
      body: JSON.stringify({
        provider: "mercadopago",
        external_event_id: eventId,
        event_type: deps.source === "webhook" ? (deps.topic ?? "payment") : "return",
        signature_valid: deps.source === "webhook",
        payload_hash: await sha256Hex(JSON.stringify(payment)),
      }),
    });
  }

  const markProcessed = (errorCode: string | null) =>
    rest(`payment_webhook_events?${eventFilter}`, {
      method: "PATCH",
      body: JSON.stringify({
        processed: true,
        processed_at: new Date(now()).toISOString(),
        error_code: errorCode,
      }),
    });

  const userId = resolveUserId(payment);
  if (!userId) {
    await markProcessed("unknown_user");
    return { result: "rejected", error: "unknown_user" };
  }

  const isCredits = isCreditsPayment(payment);
  const amount = Math.round(Number(payment.transaction_amount ?? 0));
  const currency = String(payment.currency_id ?? "COP");

  // Sin paid_at: solo el reclamo de abajo lo fija (es el candado de «aplicado una vez»).
  await rest("mp_payments?on_conflict=mp_payment_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      mp_payment_id: paymentId,
      mp_preference_id: payment.preference_id ?? null,
      amount,
      currency,
      status: dbPaymentStatus(status),
      description: payment.description ?? null,
      raw_payload: payment,
    }),
  });

  const notify = async (row: Record<string, unknown>) => {
    try {
      await rest("notifications", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, ...row }),
      });
    } catch {
      // Una notificación fallida no deshace ni repite el pago.
    }
  };

  const reject = async (error: string): Promise<ProcessOutcome> => {
    await markProcessed(error);
    return { result: "rejected", error };
  };

  if (status === "approved") {
    // Validar ANTES de reclamar: lo que no corresponde a lo vendido no se aplica nunca.
    if (currency !== "COP" || amount <= 0) return reject("invalid_amount_or_currency");
    const credit = isCredits ? creditsGrantFromPayment(payment) : null;
    if (credit && !credit.ok) return reject(credit.error);

    const claimRes = await rest(
      `mp_payments?mp_payment_id=eq.${encodeURIComponent(paymentId)}&paid_at=is.null`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ paid_at: new Date(now()).toISOString() }),
      },
    );
    const claimed = ((await claimRes.json()) as unknown[]).length > 0;
    if (!claimed) {
      await markProcessed(null);
      return { result: "already_applied" };
    }
    const release = () =>
      rest(`mp_payments?mp_payment_id=eq.${encodeURIComponent(paymentId)}`, {
        method: "PATCH",
        body: JSON.stringify({ paid_at: null }),
      }).catch(() => undefined);

    let outcome: ProcessOutcome;
    try {
      if (credit && credit.ok) {
        const g = credit.grant;
        // Idempotente también en la base: índice único de ai_credit_topups.mp_payment_id (409 = ya acreditado).
        await rest("rpc/grant_ai_credits", {
          method: "POST",
          allowConflict: true,
          body: JSON.stringify({
            p_user_id: userId,
            p_pack_id: g.packId,
            p_credits: g.credits,
            p_price_cop: g.priceCop,
            p_mp_payment_id: paymentId,
            p_mp_preference_id: payment.preference_id ?? null,
            p_validity_days: g.validityDays,
          }),
        });
        outcome = { result: "credited", credits: g.credits };
      } else {
        const rows = (await (
          await rest(`mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end`)
        ).json()) as SubscriptionRow[];
        const result = subscriptionAfterApproval({ row: rows[0] ?? null, payment, now: now() });
        if (!result.ok) {
          await release();
          return reject(result.error);
        }
        await rest("mp_subscriptions?on_conflict=user_id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ user_id: userId, ...result.patch }),
        });
        outcome = {
          result: "activated",
          kind: result.kind,
          plan: result.patch.plan,
          periodEnd: result.patch.current_period_end,
          carriedDays: result.carriedDays,
        };
      }
    } catch (e) {
      await release();
      throw e;
    }

    if (outcome.result === "credited") {
      await notify({
        type: "credits_purchased",
        title: "✅ Créditos IA acreditados",
        body: `Se acreditaron ${outcome.credits} créditos IA en tu cuenta. ¡Empieza a usarlos!`,
        link: "/dashboard",
      });
    } else if (outcome.result === "activated") {
      const until = new Date(outcome.periodEnd).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        timeZone: "America/Bogota",
      });
      const label = PLAN_LABEL[outcome.plan as keyof typeof PLAN_LABEL] ?? outcome.plan;
      await notify({
        type: "payment_approved",
        title:
          outcome.kind === "renew" ? `✨ Renovaste ${label}` : `✨ Tu plan ${label} está activo`,
        body:
          outcome.carriedDays > 0
            ? `Vigente hasta el ${until}. Sumamos ${outcome.carriedDays} días por lo que te quedaba de tu plan anterior.`
            : `Vigente hasta el ${until}. Sin cobros automáticos: tú decides cuándo renovar.`,
        link: "/dashboard",
      });
      try {
        await applyReferralReward(userId, paymentId, deps);
      } catch {
        // La recompensa no deshace el pago de quien pagó; la fila del referido queda «registered» para reintentar.
      }
    }
    await markProcessed(null);
    return outcome;
  }

  if (status === "rejected" || status === "cancelled") {
    if (!isCredits) {
      // Un intento fallido no le quita a nadie un plan que sigue vigente.
      const rows = (await (
        await rest(`mp_subscriptions?user_id=eq.${userId}&select=plan,status,current_period_end`)
      ).json()) as SubscriptionRow[];
      const next = statusAfterFailure(rows[0] ?? null, status, now());
      if (next) {
        await rest(`mp_subscriptions?user_id=eq.${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
      }
    }
    await notify({
      type: `payment_${status}`,
      title: status === "rejected" ? "❌ Pago rechazado" : "Pago cancelado",
      body:
        status === "rejected"
          ? "No pudimos procesar tu pago con Mercado Pago. Puedes reintentar desde /planes."
          : "Tu pago fue cancelado.",
      link: "/planes",
    });
    await markProcessed(null);
    return { result: "failed", status };
  }

  // Reembolso o contracargo: queda registrado para revisión; el plan no se retira solo (decisión de negocio).
  if (status === "refunded" || status === "charged_back") {
    await markProcessed(null);
    return { result: "reversed", status };
  }

  // pending, in_process, authorized, in_mediation: se espera el siguiente aviso.
  await markProcessed(null);
  return { result: "pending", status };
}

export type ReferralRewardOutcome =
  | { result: "rewarded"; referrerId: string; kind: "new" | "extend" | "convert"; days: number }
  | { result: "none" };

/**
 * Recompensa a quien refirió a `referredId` cuando este paga su primer plan. Una sola vez por persona referida: la fila
 * de `referrals` se reclama con un PATCH condicional (`status=eq.registered`), igual que `mp_payments.paid_at`. Si
 * escribir el plan falla, el reclamo se libera y el error sube.
 */
export async function applyReferralReward(
  referredId: string,
  paymentId: string,
  deps: Pick<ProcessDeps, "rest" | "now">,
): Promise<ReferralRewardOutcome> {
  const { rest, now } = deps;
  const at = new Date(now()).toISOString();
  const claimRes = await rest(
    `referrals?referred_id=eq.${encodeURIComponent(referredId)}&status=eq.registered`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "rewarded",
        rewarded_at: at,
        reward_mp_payment_id: paymentId,
      }),
    },
  );
  const claimed = (await claimRes.json()) as Array<{ referrer_id: string }>;
  const referrerId = claimed[0]?.referrer_id;
  if (!referrerId) return { result: "none" };

  try {
    const rows = (await (
      await rest(`mp_subscriptions?user_id=eq.${referrerId}&select=plan,status,current_period_end`)
    ).json()) as SubscriptionRow[];
    const reward = subscriptionAfterReferralReward(rows[0] ?? null, now());
    await rest("mp_subscriptions?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ user_id: referrerId, ...reward.patch }),
    });
    try {
      const until = new Date(reward.patch.current_period_end).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        timeZone: "America/Bogota",
      });
      await rest("notifications", {
        method: "POST",
        body: JSON.stringify({
          user_id: referrerId,
          type: "referral_reward",
          title: "🎁 Ganaste un mes gratis",
          body:
            reward.kind === "convert"
              ? `Alguien que invitaste se suscribió. Sumamos ${reward.days} días a tu plan, vigente hasta el ${until}.`
              : `Alguien que invitaste se suscribió. Tu plan Esencial queda vigente hasta el ${until}.`,
          link: "/dashboard",
        }),
      });
    } catch {
      // Una notificación fallida no deshace la recompensa.
    }
    return { result: "rewarded", referrerId, kind: reward.kind, days: reward.days };
  } catch (e) {
    await rest(`referrals?referred_id=eq.${encodeURIComponent(referredId)}&status=eq.rewarded`, {
      method: "PATCH",
      body: JSON.stringify({ status: "registered", rewarded_at: null, reward_mp_payment_id: null }),
    }).catch(() => undefined);
    throw e;
  }
}
