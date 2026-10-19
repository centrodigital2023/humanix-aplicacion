import { describe, expect, it } from "vitest";
import { confirmReturnedPayment, paymentIdFromSearch, safeReturnPath } from "./paymentReturn";
import { creditsPayment, fakeDb, NOW, planPayment, USER } from "./mpPayment.testkit";
import type { MpPayment } from "../../supabase/functions/_shared/mpPayment";

describe("safeReturnPath — a dónde vuelve la persona", () => {
  it("acepta solo los paneles y rutas internas conocidas", () => {
    expect(safeReturnPath("/dashboard/profesional")).toBe("/dashboard/profesional");
    expect(safeReturnPath("%2Fdashboard%2Ffamilia")).toBe("/dashboard/familia");
    expect(safeReturnPath("/creditos")).toBe("/creditos");
  });
  it("nunca redirige fuera de Humanix ni ejecuta código", () => {
    for (const bad of [
      "javascript:alert(1)",
      "javascript%3Aalert(1)",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/dashboard/profesional?x=1",
      "%E0%A4%A",
      null,
      undefined,
      42,
    ]) {
      expect(safeReturnPath(bad)).toBe("/dashboard");
    }
  });
});

describe("paymentIdFromSearch", () => {
  it("lee payment_id o collection_id que agrega Mercado Pago", () => {
    expect(paymentIdFromSearch(new URLSearchParams("payment_id=123&status=approved"))).toBe("123");
    expect(paymentIdFromSearch(new URLSearchParams("collection_id=456"))).toBe("456");
    expect(paymentIdFromSearch(new URLSearchParams("payment_id=null&collection_id=789"))).toBe("789");
  });
  it("ignora lo que no es un id numérico", () => {
    expect(paymentIdFromSearch(new URLSearchParams("payment_id=null"))).toBeNull();
    expect(paymentIdFromSearch(new URLSearchParams("payment_id=1;drop"))).toBeNull();
    expect(paymentIdFromSearch(new URLSearchParams(""))).toBeNull();
  });
});

describe("confirmReturnedPayment — el servidor confirma al volver del checkout", () => {
  const run = (payment: MpPayment | null, db = fakeDb(), userId = USER, paymentId: unknown = "9001") =>
    confirmReturnedPayment({
      paymentId,
      userId,
      now: () => NOW,
      rest: db.rest,
      fetchPayment: async () => payment,
    });

  it("activa el plan aunque el webhook no haya llegado", async () => {
    const db = fakeDb();
    const out = await run(planPayment(), db);
    expect(out).toMatchObject({ ok: true, state: "active", plan: "pro_monthly" });
    expect(db.t.mp_subscriptions[0]).toMatchObject({ status: "active", plan: "pro_monthly" });
    expect(db.t.payment_webhook_events[0]).toMatchObject({
      event_type: "return",
      signature_valid: false,
    });
  });

  it("si el webhook ya lo aplicó, muestra el plan real sin volver a aplicarlo", async () => {
    const db = fakeDb();
    await run(planPayment(), db);
    const end = db.t.mp_subscriptions[0].current_period_end;
    const out = await run(planPayment(), db);
    expect(out).toMatchObject({ ok: true, state: "active", periodEnd: end });
    expect(db.t.mp_subscriptions[0].current_period_end).toBe(end);
  });

  it("créditos: confirma la cantidad comprada, una sola vez", async () => {
    const db = fakeDb();
    expect(await run(creditsPayment(), db, USER, "7001")).toEqual({
      ok: true,
      state: "credited",
      credits: 330,
    });
    expect(await run(creditsPayment(), db, USER, "7001")).toEqual({
      ok: true,
      state: "credited",
      credits: 330,
    });
    expect(db.t.ai_credit_topups).toHaveLength(1);
  });

  it("nadie puede confirmar el pago de otra persona", async () => {
    const db = fakeDb();
    const out = await run(planPayment(), db, "99999999-2222-4333-8444-555555555555");
    expect(out).toEqual({ ok: false, code: "forbidden" });
    expect(db.calls).toHaveLength(0);
  });

  it("pago inexistente, id inválido, pendiente, rechazado y para revisión", async () => {
    expect(await run(null)).toEqual({ ok: false, code: "not_found" });
    expect(await run(planPayment(), fakeDb(), USER, "abc")).toEqual({ ok: false, code: "invalid" });
    expect(await run(planPayment({ status: "in_process" }))).toEqual({ ok: true, state: "pending" });
    expect(await run(planPayment({ status: "rejected" }))).toEqual({ ok: true, state: "failed" });
    expect(await run(planPayment({ transaction_amount: 10 }))).toEqual({ ok: false, code: "review" });
  });
});
