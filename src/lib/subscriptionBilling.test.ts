// Suscripciones de Mercado Pago (/preapproval): cuerpo de la suscripción, cobros mensuales, cambio de plan,
// cancelación y regreso del checkout. Sin Postgres ni Mercado Pago: base falsa de `mpPayment.testkit`.
import { describe, expect, it, vi } from "vitest";
import {
  PLAN_PRICE_COP,
  addOneMonth,
  checkoutDecision,
  parsePreapprovalReference,
  preapprovalIdOfPayment,
  preapprovalReference,
  preapprovalRequest,
  subscriptionAfterPreapprovalStatus,
  withSubscriptionMetadata,
  type MpPreapproval,
} from "./planBilling";
import {
  processMercadoPagoPayment,
  resolveUserId,
} from "../../supabase/functions/_shared/mpPayment";
import { confirmReturnedSubscription, preapprovalIdFromSearch } from "./paymentReturn";
import { checkoutErrorMessage } from "./checkout";
import { normalizeSubscription, planValidity } from "./plans";
import { DAY, NOW, USER, deps, fakeDb } from "./mpPayment.testkit";

const PRE_ID = "2c938084726fca480172750000000000";
const iso = (t: number) => new Date(t).toISOString();

const preapproval = (over: Partial<MpPreapproval> = {}): MpPreapproval => ({
  id: PRE_ID,
  status: "authorized",
  external_reference: preapprovalReference(USER, "pro_monthly"),
  auto_recurring: { transaction_amount: 29000, currency_id: "COP" },
  ...over,
});

// Un cobro de suscripción: sin la metadata de una preferencia.
const charge = (id = 5001, over: Record<string, unknown> = {}) => ({
  id,
  status: "approved",
  transaction_amount: 29000,
  currency_id: "COP",
  metadata: {},
  ...over,
});

describe("referencia y cuerpo de la suscripción", () => {
  it("la referencia dice de quién y de qué plan, y solo se acepta la nuestra", () => {
    const ref = preapprovalReference(USER, "essential_monthly");
    expect(parsePreapprovalReference(ref)).toEqual({ userId: USER, plan: "essential_monthly" });
    expect(parsePreapprovalReference(`sub:${USER}:gold`)).toBeNull();
    expect(parsePreapprovalReference("sub:no-uuid:pro_monthly")).toBeNull();
    expect(parsePreapprovalReference(USER)).toBeNull();
    expect(parsePreapprovalReference(null)).toBeNull();
  });

  it("cobra cada mes el precio del servidor, en COP, y queda pendiente hasta que la persona autoriza", () => {
    const body = preapprovalRequest({
      userId: USER,
      plan: "pro_monthly",
      email: "a@b.co",
      backUrl: "https://humanix.lat/pago/exito",
    });
    expect(body).toMatchObject({
      external_reference: `sub:${USER}:pro_monthly`,
      payer_email: "a@b.co",
      status: "pending",
      back_url: "https://humanix.lat/pago/exito",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: PLAN_PRICE_COP.pro_monthly,
        currency_id: "COP",
      },
    });
  });

  it("no abre otra suscripción del mismo plan si ya se renueva sola", () => {
    const row = {
      plan: "pro_monthly",
      status: "active",
      current_period_end: iso(NOW + 10 * DAY),
      mp_preapproval_id: PRE_ID,
    };
    expect(checkoutDecision(row, "pro_monthly", NOW)).toMatchObject({
      ok: false,
      error: "already_subscribed",
    });
    // Sin renovación automática (pago único antiguo) sí puede suscribirse; subir de plan también.
    expect(checkoutDecision({ ...row, mp_preapproval_id: null }, "pro_monthly", NOW)).toMatchObject(
      {
        ok: true,
        kind: "renew",
      },
    );
    expect(checkoutDecision(row, "institution_monthly", NOW)).toMatchObject({
      ok: true,
      kind: "upgrade",
    });
    expect(checkoutErrorMessage({ error: "already_subscribed" }, "pro_monthly")).toMatch(
      /se renueva solo/,
    );
  });
});

describe("withSubscriptionMetadata / preapprovalIdOfPayment", () => {
  it("pone usuario, plan y precio desde la suscripción consultada", () => {
    const out = withSubscriptionMetadata(charge(), preapproval());
    expect(out?.metadata).toEqual({
      user_id: USER,
      plan: "pro_monthly",
      price_cop: 29000,
      preapproval_id: PRE_ID,
    });
  });

  it("rechaza una suscripción ajena o en otra moneda", () => {
    expect(withSubscriptionMetadata(charge(), preapproval({ external_reference: "x" }))).toBeNull();
    expect(
      withSubscriptionMetadata(
        charge(),
        preapproval({ auto_recurring: { transaction_amount: 10, currency_id: "ARS" } }),
      ),
    ).toBeNull();
  });

  it("encuentra la suscripción de un pago en la metadata o en point_of_interaction", () => {
    expect(preapprovalIdOfPayment({ metadata: { preapproval_id: "abc" } })).toBe("abc");
    expect(
      preapprovalIdOfPayment({
        metadata: {},
        point_of_interaction: { transaction_data: { subscription_id: "def" } },
      }),
    ).toBe("def");
    expect(preapprovalIdOfPayment({ metadata: {} })).toBeNull();
  });

  it("resolveUserId entiende la referencia de suscripción", () => {
    expect(resolveUserId({ external_reference: `sub:${USER}:pro_monthly`, metadata: {} })).toBe(
      USER,
    );
  });
});

describe("cobros mensuales", () => {
  it("el primer cobro activa el plan un mes y guarda la suscripción", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(), preapproval())!,
      deps(db.rest),
    );
    expect(out).toMatchObject({ result: "activated", kind: "new", recurring: true });
    expect(db.t.mp_subscriptions[0]).toMatchObject({
      plan: "pro_monthly",
      status: "active",
      mp_preapproval_id: PRE_ID,
    });
    expect(Date.parse(String(db.t.mp_subscriptions[0].current_period_end))).toBe(addOneMonth(NOW));
    expect(String(db.t.notifications[0].body)).toMatch(/Se renueva solo cada mes/);
  });

  it("cada cobro siguiente suma un mes desde el vencimiento; el mismo cobro dos veces no", async () => {
    const db = fakeDb();
    await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(5001), preapproval())!,
      deps(db.rest),
    );
    const firstEnd = Date.parse(String(db.t.mp_subscriptions[0].current_period_end));
    const later = firstEnd - DAY;
    const second = withSubscriptionMetadata(charge(5002), preapproval())!;
    expect(await processMercadoPagoPayment(second, deps(db.rest, later))).toMatchObject({
      kind: "renew",
    });
    expect(Date.parse(String(db.t.mp_subscriptions[0].current_period_end))).toBe(
      addOneMonth(firstEnd),
    );
    expect(await processMercadoPagoPayment(second, deps(db.rest, later + 1000))).toEqual({
      result: "already_applied",
    });
  });

  it("subir de plan cancela la suscripción anterior para no cobrar dos veces", async () => {
    const db = fakeDb();
    db.t.mp_subscriptions.push({
      user_id: USER,
      plan: "essential_monthly",
      status: "active",
      current_period_end: iso(NOW + 20 * DAY),
      mp_preapproval_id: "old-essential",
    });
    const cancelPreapproval = vi.fn(async () => undefined);
    const out = await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(), preapproval())!,
      { ...deps(db.rest), cancelPreapproval },
    );
    expect(out).toMatchObject({ result: "activated", kind: "upgrade" });
    expect(cancelPreapproval).toHaveBeenCalledWith("old-essential");
    expect(db.t.mp_subscriptions[0].mp_preapproval_id).toBe(PRE_ID);
  });

  it("si cancelar la anterior falla, el plan nuevo queda igual", async () => {
    const db = fakeDb();
    db.t.mp_subscriptions.push({
      user_id: USER,
      plan: "essential_monthly",
      status: "active",
      current_period_end: iso(NOW + 5 * DAY),
      mp_preapproval_id: "old",
    });
    const out = await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(), preapproval())!,
      {
        ...deps(db.rest),
        cancelPreapproval: async () => {
          throw new Error("mp down");
        },
      },
    );
    expect(out.result).toBe("activated");
    expect(db.t.mp_subscriptions[0].plan).toBe("pro_monthly");
  });

  it("el primer cobro de una persona referida premia a quien la invitó, una sola vez", async () => {
    const REFERRER = "99999999-8888-4777-8666-555555555555";
    const db = fakeDb();
    db.t.referrals.push({ referrer_id: REFERRER, referred_id: USER, status: "registered" });
    await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(5001), preapproval())!,
      deps(db.rest),
    );
    await processMercadoPagoPayment(
      withSubscriptionMetadata(charge(5002), preapproval())!,
      deps(db.rest, NOW + 31 * DAY),
    );
    const reward = db.t.mp_subscriptions.filter((r) => r.user_id === REFERRER);
    expect(reward).toHaveLength(1);
    expect(reward[0]).toMatchObject({ plan: "essential_monthly", status: "active" });
    expect(db.t.referrals[0]).toMatchObject({ status: "rewarded", reward_mp_payment_id: "5001" });
  });
});

describe("subscriptionAfterPreapprovalStatus", () => {
  const active = {
    plan: "pro_monthly",
    status: "active",
    current_period_end: iso(NOW + 10 * DAY),
    mp_preapproval_id: PRE_ID,
  };

  it("cancelar o pausar la suscripción guardada quita la renovación, no el plan", () => {
    for (const status of ["cancelled", "paused"]) {
      expect(
        subscriptionAfterPreapprovalStatus(
          active,
          { id: PRE_ID, status, plan: "pro_monthly" },
          NOW,
        ),
      ).toEqual({ mp_preapproval_id: null });
    }
    // Otra suscripción (p. ej. la anterior a un cambio de plan) no toca nada.
    expect(
      subscriptionAfterPreapprovalStatus(
        active,
        { id: "otra", status: "cancelled", plan: "pro_monthly" },
        NOW,
      ),
    ).toBeNull();
  });

  it("autorizada: se guarda si es del plan que tiene o si no tiene plan", () => {
    const legacy = { ...active, mp_preapproval_id: null };
    expect(
      subscriptionAfterPreapprovalStatus(
        legacy,
        { id: "n", status: "authorized", plan: "pro_monthly" },
        NOW,
      ),
    ).toEqual({ mp_preapproval_id: "n" });
    expect(
      subscriptionAfterPreapprovalStatus(
        legacy,
        { id: "n", status: "authorized", plan: "institution_monthly" },
        NOW,
      ),
    ).toBeNull();
    expect(
      subscriptionAfterPreapprovalStatus(
        null,
        { id: "n", status: "authorized", plan: "pro_monthly" },
        NOW,
      ),
    ).toEqual({ mp_preapproval_id: "n" });
  });
});

describe("confirmReturnedSubscription — regreso del checkout", () => {
  const base = (db: ReturnType<typeof fakeDb>, over: Record<string, unknown> = {}) => ({
    preapprovalId: PRE_ID,
    userId: USER,
    rest: db.rest,
    now: () => NOW,
    fetchPreapproval: async () => preapproval(),
    fetchLatestPayment: async () => charge() as never,
    ...over,
  });

  it("lee el id de la URL de regreso", () => {
    expect(preapprovalIdFromSearch(new URLSearchParams(`preapproval_id=${PRE_ID}`))).toBe(PRE_ID);
    expect(preapprovalIdFromSearch(new URLSearchParams("preapproval_id=<script>"))).toBeNull();
  });

  it("activa el plan con el primer cobro", async () => {
    const db = fakeDb();
    expect(await confirmReturnedSubscription(base(db))).toMatchObject({
      ok: true,
      state: "active",
      plan: "pro_monthly",
    });
  });

  it("sin cobro todavía: pendiente; suscripción ajena: prohibido; cancelada: no se completó", async () => {
    const db = fakeDb();
    expect(
      await confirmReturnedSubscription(base(db, { fetchLatestPayment: async () => null })),
    ).toEqual({
      ok: true,
      state: "pending",
    });
    expect(
      await confirmReturnedSubscription(
        base(db, { userId: "99999999-8888-4777-8666-555555555555" }),
      ),
    ).toEqual({ ok: false, code: "forbidden" });
    expect(
      await confirmReturnedSubscription(
        base(db, { fetchPreapproval: async () => preapproval({ status: "cancelled" }) }),
      ),
    ).toEqual({ ok: true, state: "failed" });
    expect(await confirmReturnedSubscription(base(db, { preapprovalId: "../x" }))).toEqual({
      ok: false,
      code: "invalid",
    });
  });
});

describe("vigencia con renovación automática", () => {
  it("dice cuándo se renueva y no recuerda renovar", () => {
    const row = {
      plan: "pro_monthly",
      status: "active",
      amount: 29000,
      currency: "COP",
      current_period_end: iso(NOW + 2 * DAY),
      mp_preapproval_id: PRE_ID,
    };
    const norm = normalizeSubscription(row, NOW);
    expect(norm.autoRenew).toBe(true);
    const v = planValidity(norm, NOW);
    expect(v.renewSoon).toBe(false);
    expect(v.line).toMatch(/^Se renueva el/);
    expect(planValidity({ ...norm, autoRenew: false }, NOW).renewSoon).toBe(true);
  });
});
