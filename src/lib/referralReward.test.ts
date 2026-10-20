import { describe, expect, it } from "vitest";
import {
  applyReferralReward,
  processMercadoPagoPayment,
} from "../../supabase/functions/_shared/mpPayment";
import { addOneMonth, subscriptionAfterReferralReward } from "./planBilling";
import { DAY, NOW, USER, deps, fakeDb, planPayment } from "./mpPayment.testkit";

const REFERRER = "99999999-8888-4777-8666-555555555555";
const iso = (t: number) => new Date(t).toISOString();

describe("subscriptionAfterReferralReward — un mes de Esencial para quien refiere", () => {
  it("sin plan vigente: Esencial por un mes desde hoy, sin cobro", () => {
    const out = subscriptionAfterReferralReward(null, NOW);
    expect(out.kind).toBe("new");
    expect(out.patch).toMatchObject({ plan: "essential_monthly", status: "active", amount: 0 });
    expect(Date.parse(out.patch.current_period_end)).toBe(addOneMonth(NOW));
  });

  it("un plan vencido cuenta como sin plan", () => {
    const row = { plan: "pro_monthly", status: "active", current_period_end: iso(NOW - DAY) };
    expect(subscriptionAfterReferralReward(row, NOW).patch.plan).toBe("essential_monthly");
  });

  it("con Esencial vigente: un mes más desde el vencimiento, sin tocar el monto pagado", () => {
    const end = NOW + 10 * DAY;
    const out = subscriptionAfterReferralReward(
      { plan: "essential_monthly", status: "active", current_period_end: iso(end) },
      NOW,
    );
    expect(out.kind).toBe("extend");
    expect(Date.parse(out.patch.current_period_end)).toBe(addOneMonth(end));
    expect(out.patch).not.toHaveProperty("amount");
  });

  it("con un plan mayor vigente: conserva el plan y suma lo que vale un mes de Esencial (9 días de Pro)", () => {
    const end = NOW + 10 * DAY;
    const out = subscriptionAfterReferralReward(
      { plan: "pro_monthly", status: "active", current_period_end: iso(end) },
      NOW,
    );
    expect(out).toMatchObject({ kind: "convert", days: 9 });
    expect(out.patch.plan).toBe("pro_monthly");
    expect(Date.parse(out.patch.current_period_end)).toBe(end + 9 * DAY);
    expect(out.patch).not.toHaveProperty("amount");
  });

  it("nunca baja de plan a nadie", () => {
    const out = subscriptionAfterReferralReward(
      { plan: "institution_monthly", status: "active", current_period_end: iso(NOW + DAY) },
      NOW,
    );
    expect(out.patch.plan).toBe("institution_monthly");
    expect(out.days).toBeGreaterThanOrEqual(0);
  });
});

const referral = () => ({ referrer_id: REFERRER, referred_id: USER, status: "registered" });

describe("applyReferralReward", () => {
  it("reclama la fila, extiende el plan de quien refirió y le avisa sin decir quién fue", async () => {
    const db = fakeDb();
    db.t.referrals.push(referral());
    const out = await applyReferralReward(USER, "9001", deps(db.rest));
    expect(out).toMatchObject({ result: "rewarded", referrerId: REFERRER, kind: "new" });
    expect(db.t.referrals[0]).toMatchObject({ status: "rewarded", reward_mp_payment_id: "9001" });
    expect(db.t.mp_subscriptions[0]).toMatchObject({
      user_id: REFERRER,
      plan: "essential_monthly",
    });
    const note = db.t.notifications.find((n) => n.user_id === REFERRER);
    expect(note).toMatchObject({ type: "referral_reward" });
    expect(String(note?.body)).not.toContain(USER);
  });

  it("solo una vez por persona referida", async () => {
    const db = fakeDb();
    db.t.referrals.push(referral());
    await applyReferralReward(USER, "9001", deps(db.rest));
    const first = db.t.mp_subscriptions[0].current_period_end;
    expect(await applyReferralReward(USER, "9002", deps(db.rest))).toEqual({ result: "none" });
    expect(db.t.mp_subscriptions[0].current_period_end).toBe(first);
  });

  it("sin referido no hace nada", async () => {
    const db = fakeDb();
    expect(await applyReferralReward(USER, "9001", deps(db.rest))).toEqual({ result: "none" });
    expect(db.t.mp_subscriptions).toHaveLength(0);
  });

  it("si escribir el plan falla, libera el reclamo para reintentar", async () => {
    const db = fakeDb({ failOn: (p, m) => p.startsWith("mp_subscriptions") && m === "POST" });
    db.t.referrals.push(referral());
    await expect(applyReferralReward(USER, "9001", deps(db.rest))).rejects.toThrow();
    expect(db.t.referrals[0]).toMatchObject({ status: "registered", rewarded_at: null });
  });

  it("una notificación fallida no deshace la recompensa", async () => {
    const db = fakeDb({ failOn: (p) => p.startsWith("notifications") });
    db.t.referrals.push(referral());
    expect((await applyReferralReward(USER, "9001", deps(db.rest))).result).toBe("rewarded");
    expect(db.t.mp_subscriptions[0]).toMatchObject({ user_id: REFERRER });
  });
});

describe("processMercadoPagoPayment — recompensa por referido", () => {
  it("el primer plan pagado por la persona referida premia a quien la refirió", async () => {
    const db = fakeDb();
    db.t.referrals.push(referral());
    const out = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(out).toMatchObject({ result: "activated", plan: "pro_monthly" });
    expect(db.t.mp_subscriptions.map((r) => r.user_id).sort()).toEqual([USER, REFERRER].sort());
    expect(db.t.referrals[0].status).toBe("rewarded");
  });

  it("si la recompensa falla, el pago de la persona referida igual queda aplicado", async () => {
    const db = fakeDb({ failOn: (p) => p.startsWith("referrals") });
    db.t.referrals.push(referral());
    const out = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(out.result).toBe("activated");
    expect(db.t.mp_subscriptions[0]).toMatchObject({ user_id: USER, plan: "pro_monthly" });
    expect(db.t.mp_payments[0].paid_at).not.toBeNull();
  });

  it("un pago repetido no premia dos veces", async () => {
    const db = fakeDb();
    db.t.referrals.push(referral());
    await processMercadoPagoPayment(planPayment(), deps(db.rest));
    const end = db.t.mp_subscriptions.find((r) => r.user_id === REFERRER)?.current_period_end;
    await processMercadoPagoPayment(planPayment(), deps(db.rest, NOW, "return"));
    expect(db.t.mp_subscriptions.find((r) => r.user_id === REFERRER)?.current_period_end).toBe(end);
  });
});
