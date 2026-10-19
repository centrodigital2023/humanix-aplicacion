import { describe, expect, it } from "vitest";
import {
  dbPaymentStatus,
  processMercadoPagoPayment,
  resolveUserId,
} from "../../supabase/functions/_shared/mpPayment";
import { addOneMonth } from "./planBilling";
import { DAY, NOW, USER, creditsPayment, deps, fakeDb, planPayment } from "./mpPayment.testkit";

describe("dbPaymentStatus — estados de Mercado Pago que no existen en el enum de producción", () => {
  it("guarda equivalentes en vez de romper la escritura", () => {
    expect(dbPaymentStatus("approved")).toBe("approved");
    expect(dbPaymentStatus("in_process")).toBe("in_process");
    expect(dbPaymentStatus("charged_back")).toBe("refunded");
    expect(dbPaymentStatus("in_mediation")).toBe("in_process");
    expect(dbPaymentStatus("authorized")).toBe("pending");
    expect(dbPaymentStatus("algo_nuevo")).toBe("pending");
    expect(dbPaymentStatus(undefined)).toBe("pending");
  });
});

describe("resolveUserId", () => {
  it("toma el usuario que fijó nuestro servidor y rechaza lo que no es un UUID", () => {
    expect(resolveUserId(planPayment())).toBe(USER);
    expect(resolveUserId(creditsPayment({ metadata: {} }))).toBe(USER);
    expect(resolveUserId({ external_reference: "x", metadata: {} })).toBeNull();
  });
});

describe("processMercadoPagoPayment — plan", () => {
  it("activa un plan nuevo por un mes, marca el pago y avisa a la persona", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(out).toMatchObject({ result: "activated", kind: "new", plan: "pro_monthly" });
    const sub = db.t.mp_subscriptions[0];
    expect(sub).toMatchObject({ user_id: USER, plan: "pro_monthly", status: "active", amount: 29000 });
    expect(Date.parse(String(sub.current_period_end))).toBe(addOneMonth(NOW));
    expect(db.t.mp_payments[0]).toMatchObject({
      mp_payment_id: "9001",
      mp_preference_id: "pref-1",
      status: "approved",
    });
    expect(db.t.mp_payments[0].paid_at).toBeTruthy();
    expect(db.t.payment_webhook_events[0]).toMatchObject({
      external_event_id: "9001:approved",
      processed: true,
      error_code: null,
      signature_valid: true,
    });
    expect(db.t.notifications).toHaveLength(1);
  });

  it("el mismo pago otra vez (aviso repetido o regreso del checkout) no suma otro mes", async () => {
    const db = fakeDb();
    await processMercadoPagoPayment(planPayment(), deps(db.rest));
    const end = db.t.mp_subscriptions[0].current_period_end;
    const again = await processMercadoPagoPayment(planPayment(), deps(db.rest, NOW + 60_000, "return"));
    expect(again).toEqual({ result: "already_applied" });
    expect(db.t.mp_subscriptions[0].current_period_end).toBe(end);
    expect(db.t.notifications).toHaveLength(1);
  });

  it("dos avisos simultáneos del mismo pago aplican el plan UNA sola vez", async () => {
    const db = fakeDb();
    // Ya tenía Pro vigente: una renovación aplicada dos veces sumaría dos meses.
    const end0 = NOW + 10 * DAY;
    db.t.mp_subscriptions.push({
      user_id: USER,
      plan: "pro_monthly",
      status: "active",
      current_period_end: new Date(end0).toISOString(),
    });
    const [a, b] = await Promise.all([
      processMercadoPagoPayment(planPayment(), deps(db.rest)),
      processMercadoPagoPayment(planPayment(), deps(db.rest, NOW, "return")),
    ]);
    const results = [a.result, b.result].sort();
    expect(results).toEqual(["activated", "already_applied"]);
    expect(Date.parse(String(db.t.mp_subscriptions[0].current_period_end))).toBe(addOneMonth(end0));
    expect(db.t.notifications).toHaveLength(1);
  });

  it("renovar con el plan vigente suma el mes desde el vencimiento, sin perder días", async () => {
    const db = fakeDb();
    const end0 = NOW + 5 * DAY;
    db.t.mp_subscriptions.push({
      user_id: USER,
      plan: "pro_monthly",
      status: "active",
      current_period_end: new Date(end0).toISOString(),
    });
    const out = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(out).toMatchObject({ result: "activated", kind: "renew" });
    expect(Date.parse(String(db.t.mp_subscriptions[0].current_period_end))).toBe(addOneMonth(end0));
  });

  it("un monto menor al precio no activa nada y queda para revisión", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(
      planPayment({ transaction_amount: 1000 }),
      deps(db.rest),
    );
    expect(out).toEqual({ result: "rejected", error: "amount_mismatch" });
    expect(db.t.mp_subscriptions).toHaveLength(0);
    expect(db.t.mp_payments[0].paid_at).toBeNull();
    expect(db.t.payment_webhook_events[0]).toMatchObject({
      processed: true,
      error_code: "amount_mismatch",
    });
  });

  it("otra moneda o monto cero se rechazan sin reclamar el pago", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(planPayment({ currency_id: "USD" }), deps(db.rest));
    expect(out).toEqual({ result: "rejected", error: "invalid_amount_or_currency" });
    expect(db.t.mp_payments[0].paid_at).toBeNull();
  });

  it("si activar falla a mitad, libera el pago y el reintento lo activa", async () => {
    let failSubs = true;
    const db = fakeDb({
      failOn: (path, method) => failSubs && method === "POST" && path.startsWith("mp_subscriptions"),
    });
    await expect(processMercadoPagoPayment(planPayment(), deps(db.rest))).rejects.toThrow();
    expect(db.t.mp_payments[0].paid_at).toBeNull();
    expect(db.t.payment_webhook_events[0].processed).toBe(false);
    failSubs = false;
    const retry = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(retry.result).toBe("activated");
    expect(db.t.mp_subscriptions[0]).toMatchObject({ status: "active", plan: "pro_monthly" });
  });

  it("una notificación que falla no deshace la activación", async () => {
    const db = fakeDb({ failOn: (path) => path.startsWith("notifications") });
    const out = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(out.result).toBe("activated");
    expect(db.t.payment_webhook_events[0].processed).toBe(true);
  });

  it("un pago rechazado no le quita a nadie un plan vigente", async () => {
    const db = fakeDb();
    db.t.mp_subscriptions.push({
      user_id: USER,
      plan: "pro_monthly",
      status: "active",
      current_period_end: new Date(NOW + 3 * DAY).toISOString(),
    });
    const out = await processMercadoPagoPayment(
      planPayment({ id: 9002, status: "rejected" }),
      deps(db.rest),
    );
    expect(out).toEqual({ result: "failed", status: "rejected" });
    expect(db.t.mp_subscriptions[0].status).toBe("active");
  });

  it("un intento rechazado sin plan vigente deja la suscripción en «rejected»", async () => {
    const db = fakeDb();
    db.t.mp_subscriptions.push({ user_id: USER, plan: "pro_monthly", status: "pending" });
    await processMercadoPagoPayment(planPayment({ status: "rejected" }), deps(db.rest));
    expect(db.t.mp_subscriptions[0].status).toBe("rejected");
  });

  it("pendiente → aprobado: el segundo aviso activa (eventos distintos por estado)", async () => {
    const db = fakeDb();
    const p1 = await processMercadoPagoPayment(planPayment({ status: "in_process" }), deps(db.rest));
    expect(p1).toEqual({ result: "pending", status: "in_process" });
    expect(db.t.mp_subscriptions).toHaveLength(0);
    const p2 = await processMercadoPagoPayment(planPayment(), deps(db.rest));
    expect(p2.result).toBe("activated");
    expect(db.t.mp_payments).toHaveLength(1);
    expect(db.t.mp_payments[0].status).toBe("approved");
  });

  it("estados fuera del enum (contracargo, mediación, autorizado) se guardan sin romper", async () => {
    for (const [status, stored, result] of [
      ["charged_back", "refunded", "reversed"],
      ["in_mediation", "in_process", "pending"],
      ["authorized", "pending", "pending"],
    ] as const) {
      const db = fakeDb();
      const out = await processMercadoPagoPayment(planPayment({ status }), deps(db.rest));
      expect(out.result).toBe(result);
      expect(db.t.mp_payments[0].status).toBe(stored);
    }
  });

  it("un pago sin usuario reconocible no toca nada", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(
      planPayment({ external_reference: "hack", metadata: { plan: "pro_monthly" } }),
      deps(db.rest),
    );
    expect(out).toEqual({ result: "rejected", error: "unknown_user" });
    expect(db.t.mp_payments).toHaveLength(0);
    expect(db.t.mp_subscriptions).toHaveLength(0);
  });

  it("un evento ya procesado con error se informa igual, sin reprocesar", async () => {
    const db = fakeDb();
    await processMercadoPagoPayment(planPayment({ transaction_amount: 1 }), deps(db.rest));
    const again = await processMercadoPagoPayment(
      planPayment({ transaction_amount: 1 }),
      deps(db.rest),
    );
    expect(again).toEqual({ result: "rejected", error: "amount_mismatch" });
  });
});

describe("processMercadoPagoPayment — créditos IA", () => {
  it("acredita el paquete una sola vez", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(creditsPayment(), deps(db.rest));
    expect(out).toEqual({ result: "credited", credits: 330 });
    expect(db.t.ai_credit_topups).toEqual([{ mp_payment_id: "7001", credits: 330 }]);
    const again = await processMercadoPagoPayment(creditsPayment(), deps(db.rest, NOW, "return"));
    expect(again).toEqual({ result: "already_applied" });
    expect(db.t.ai_credit_topups).toHaveLength(1);
    expect(db.t.mp_subscriptions).toHaveLength(0);
  });

  it("un pago menor al precio del paquete no acredita", async () => {
    const db = fakeDb();
    const out = await processMercadoPagoPayment(
      creditsPayment({ transaction_amount: 4900 }),
      deps(db.rest),
    );
    expect(out).toEqual({ result: "rejected", error: "amount_mismatch" });
    expect(db.t.ai_credit_topups).toHaveLength(0);
  });

  it("un rechazo de créditos no toca la suscripción", async () => {
    const db = fakeDb();
    db.t.mp_subscriptions.push({ user_id: USER, plan: "pro_monthly", status: "pending" });
    await processMercadoPagoPayment(creditsPayment({ status: "rejected" }), deps(db.rest));
    expect(db.t.mp_subscriptions[0].status).toBe("pending");
  });
});

