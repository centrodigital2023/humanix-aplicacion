import { describe, expect, it } from "vitest";
import { FEATURE_MIN_PLAN, PLAN_CATALOG, PLAN_ORDER } from "./plans";
import {
  PAID_PLANS,
  PLAN_PRICE_COP,
  PLAN_TIER,
  activePaidPlan,
  addOneMonth,
  carryOverDays,
  checkoutDecision,
  creditsGrantFromPayment,
  isPaymentTopic,
  MAX_CREDITS_PER_PURCHASE,
  paidPlanOf,
  returnPathFor,
  statusAfterFailure,
  subscriptionAfterApproval,
  type SubscriptionRow,
} from "./planBilling";

const NOW = Date.parse("2026-10-15T15:00:00Z");
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const row = (plan: string, status: string, endOffsetDays: number | null): SubscriptionRow => ({
  plan,
  status,
  current_period_end: endOffsetDays === null ? null : iso(NOW + endOffsetDays * DAY),
});
const pay = (plan: string, amount: number, extra: object = {}) => ({
  metadata: { plan, user_id: "u" },
  transaction_amount: amount,
  currency_id: "COP",
  ...extra,
});

describe("catálogo: el servidor y la interfaz cobran lo mismo", () => {
  it("cada plan de pago tiene el mismo precio y nivel en los dos lados", () => {
    for (const p of PAID_PLANS) {
      expect(PLAN_PRICE_COP[p]).toBe(PLAN_CATALOG[p].amountCOP);
      expect(PLAN_TIER[p]).toBe(PLAN_CATALOG[p].tier);
    }
    expect(PLAN_TIER.free).toBe(PLAN_CATALOG.free.tier);
    expect([...PAID_PLANS]).toEqual(PLAN_ORDER.filter((p) => p !== "free"));
  });

  it("cada función premium la abre un plan que existe", () => {
    for (const min of Object.values(FEATURE_MIN_PLAN)) expect(PLAN_ORDER).toContain(min);
  });

  it("los niveles suben con el precio", () => {
    const paid = [...PAID_PLANS].sort((a, b) => PLAN_TIER[a] - PLAN_TIER[b]);
    for (let i = 1; i < paid.length; i++) {
      expect(PLAN_PRICE_COP[paid[i]]).toBeGreaterThan(PLAN_PRICE_COP[paid[i - 1]]);
    }
  });
});

describe("plan vigente (misma regla que get_user_plan en SQL)", () => {
  it("activo o aprobado y sin vencer", () => {
    expect(activePaidPlan(row("pro_monthly", "active", 5), NOW)).toBe("pro_monthly");
    expect(activePaidPlan(row("pro_monthly", "approved", 5), NOW)).toBe("pro_monthly");
    expect(activePaidPlan(row("pro_monthly", "active", null), NOW)).toBe("pro_monthly");
  });

  it("vencido, pendiente, rechazado, desconocido o sin fila: ninguno", () => {
    expect(activePaidPlan(row("pro_monthly", "active", -1), NOW)).toBeNull();
    expect(activePaidPlan(row("pro_monthly", "active", 0), NOW)).toBeNull();
    expect(activePaidPlan(row("pro_monthly", "pending", 5), NOW)).toBeNull();
    expect(activePaidPlan(row("pro_monthly", "rejected", 5), NOW)).toBeNull();
    expect(activePaidPlan(row("gold", "active", 5), NOW)).toBeNull();
    expect(activePaidPlan(row("free", "active", 5), NOW)).toBeNull();
    expect(activePaidPlan(null, NOW)).toBeNull();
  });
});

describe("un mes calendario", () => {
  it("suma un mes sin saltarse febrero", () => {
    expect(iso(addOneMonth(Date.parse("2026-01-31T10:00:00Z")))).toBe("2026-02-28T10:00:00.000Z");
    expect(iso(addOneMonth(Date.parse("2028-01-31T10:00:00Z")))).toBe("2028-02-29T10:00:00.000Z");
    expect(iso(addOneMonth(Date.parse("2026-10-15T15:00:00Z")))).toBe("2026-11-15T15:00:00.000Z");
    expect(iso(addOneMonth(Date.parse("2026-12-31T00:00:00Z")))).toBe("2027-01-31T00:00:00.000Z");
  });
});

describe("abrir un pago", () => {
  it("sin plan vigente: se cobra el precio del catálogo y se marca pendiente", () => {
    expect(checkoutDecision(null, "essential_monthly", NOW)).toEqual({
      ok: true,
      plan: "essential_monthly",
      amount: 9000,
      writePending: true,
      kind: "new",
    });
    expect(checkoutDecision(row("pro_monthly", "active", -3), "pro_monthly", NOW)).toMatchObject({
      writePending: true,
      kind: "new",
    });
  });

  it("con plan vigente NUNCA se escribe «pendiente» (abrir el pago no quita el plan)", () => {
    const r = row("pro_monthly", "active", 10);
    expect(checkoutDecision(r, "pro_monthly", NOW)).toMatchObject({
      ok: true,
      writePending: false,
      kind: "renew",
    });
    expect(checkoutDecision(r, "institution_monthly", NOW)).toMatchObject({
      ok: true,
      writePending: false,
      kind: "upgrade",
    });
  });

  it("no se baja de plan con uno vigente: se dice hasta cuándo dura", () => {
    const r = row("pro_monthly", "active", 10);
    expect(checkoutDecision(r, "essential_monthly", NOW)).toEqual({
      ok: false,
      error: "downgrade_while_active",
      current: "pro_monthly",
      endsAt: r.current_period_end,
    });
  });

  it("un plan desconocido o «free» se rechaza; sin plan se mantiene Pro (compatibilidad)", () => {
    expect(checkoutDecision(null, "gold", NOW)).toEqual({ ok: false, error: "unknown_plan" });
    expect(checkoutDecision(null, "free", NOW)).toEqual({ ok: false, error: "unknown_plan" });
    expect(checkoutDecision(null, 42, NOW)).toEqual({ ok: false, error: "unknown_plan" });
    expect(checkoutDecision(null, undefined, NOW)).toMatchObject({ ok: true, plan: "pro_monthly" });
  });
});

describe("pago aprobado: qué plan se activa", () => {
  it("solo escribe columnas que existen en producción (mp_subscriptions)", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: pay("pro_monthly", 29000),
      now: NOW,
    });
    const PROD_COLUMNS = [
      "plan",
      "status",
      "amount",
      "currency",
      "current_period_end",
      "next_payment_at",
    ];
    expect(out.ok && Object.keys(out.patch).sort()).toEqual([...PROD_COLUMNS].sort());
  });

  it("activa el plan PAGADO, no el que esté en la fila (cierra la escalada de plan)", () => {
    // Abrió el pago de IPS (la fila quedó así) pero pagó el Esencial.
    const r = row("institution_monthly", "pending", null);
    const out = subscriptionAfterApproval({
      row: r,
      payment: pay("essential_monthly", 9000),
      now: NOW,
    });
    expect(out).toMatchObject({
      ok: true,
      kind: "new",
      patch: { plan: "essential_monthly", status: "active" },
    });
  });

  it("si la metadata no trae el plan, lo toma del ítem que fijó el servidor", () => {
    expect(paidPlanOf({ additional_info: { items: [{ id: "pro_monthly" }] } })).toBe("pro_monthly");
    expect(
      paidPlanOf({ metadata: { plan: "nope" }, additional_info: { items: [{ id: "x" }] } }),
    ).toBeNull();
    expect(
      subscriptionAfterApproval({
        row: null,
        payment: { transaction_amount: 29000, additional_info: { items: [{ id: "pro_monthly" }] } },
        now: NOW,
      }),
    ).toMatchObject({ ok: true, patch: { plan: "pro_monthly" } });
  });

  it("sin plan reconocible no se activa nada", () => {
    expect(subscriptionAfterApproval({ row: null, payment: pay("gold", 9000), now: NOW })).toEqual({
      ok: false,
      error: "unknown_plan",
    });
  });

  it("un monto menor al precio no activa nada", () => {
    expect(
      subscriptionAfterApproval({ row: null, payment: pay("pro_monthly", 9000), now: NOW }),
    ).toEqual({
      ok: false,
      error: "amount_mismatch",
    });
    expect(
      subscriptionAfterApproval({ row: null, payment: pay("pro_monthly", 0), now: NOW }),
    ).toEqual({
      ok: false,
      error: "amount_mismatch",
    });
  });

  it("respeta el precio que fijó el servidor al crear el pago (si después cambia el catálogo)", () => {
    const p = pay("pro_monthly", 25000, { metadata: { plan: "pro_monthly", price_cop: 25000 } });
    expect(subscriptionAfterApproval({ row: null, payment: p, now: NOW })).toMatchObject({
      ok: true,
    });
  });

  it("otra moneda no activa nada", () => {
    expect(
      subscriptionAfterApproval({
        row: null,
        payment: pay("pro_monthly", 29000, { currency_id: "USD" }),
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "currency_mismatch" });
  });

  it("nuevo: un mes desde hoy", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: pay("essential_monthly", 9000),
      now: NOW,
    });
    expect(out.ok && out.patch.current_period_end).toBe("2026-11-15T15:00:00.000Z");
  });

  it("renovar antes de tiempo suma desde el vencimiento: no se pierden días", () => {
    const r = row("pro_monthly", "active", 10); // vence el 25 oct
    const out = subscriptionAfterApproval({ row: r, payment: pay("pro_monthly", 29000), now: NOW });
    expect(out).toMatchObject({ ok: true, kind: "renew", carriedDays: 0 });
    expect(out.ok && out.patch.current_period_end).toBe("2026-11-25T15:00:00.000Z");
  });

  it("renovar un plan ya vencido empieza hoy", () => {
    const r = row("pro_monthly", "active", -4);
    const out = subscriptionAfterApproval({ row: r, payment: pay("pro_monthly", 29000), now: NOW });
    expect(out).toMatchObject({ ok: true, kind: "new" });
    expect(out.ok && out.patch.current_period_end).toBe("2026-11-15T15:00:00.000Z");
  });

  it("subir de plan convierte los días que quedaban al valor del plan nuevo", () => {
    const r = row("essential_monthly", "active", 20);
    const out = subscriptionAfterApproval({ row: r, payment: pay("pro_monthly", 29000), now: NOW });
    // 20 × 9.000 / 29.000 = 6,2 → 6 días
    expect(out).toMatchObject({ ok: true, kind: "upgrade", carriedDays: 6 });
    expect(out.ok && out.patch.current_period_end).toBe("2026-11-21T15:00:00.000Z");
  });

  it("si llega un pago de un plan menor con uno vigente, se respeta lo pagado sin arrastre", () => {
    const r = row("pro_monthly", "active", 20);
    const out = subscriptionAfterApproval({
      row: r,
      payment: pay("essential_monthly", 9000),
      now: NOW,
    });
    expect(out).toMatchObject({
      ok: true,
      kind: "change",
      carriedDays: 0,
      patch: { plan: "essential_monthly" },
    });
  });

  it("siempre deja el plan activo y con el monto real", () => {
    const out = subscriptionAfterApproval({
      row: null,
      payment: pay("pro_monthly", 29000.4),
      now: NOW,
    });
    expect(out.ok && out.patch).toMatchObject({
      status: "active",
      amount: 29000,
      currency: "COP",
    });
  });
});

describe("días de arrastre", () => {
  it("nunca negativos y redondeados hacia abajo", () => {
    expect(carryOverDays("essential_monthly", "pro_monthly", -DAY)).toBe(0);
    expect(carryOverDays("essential_monthly", "pro_monthly", 0)).toBe(0);
    expect(carryOverDays("pro_monthly", "institution_monthly", 30 * DAY)).toBe(2);
    expect(carryOverDays("essential_monthly", "pro_monthly", 3 * DAY)).toBe(0);
  });
});

describe("pago rechazado o cancelado", () => {
  it("no le quita a nadie un plan vigente", () => {
    expect(statusAfterFailure(row("pro_monthly", "active", 8), "rejected", NOW)).toBeNull();
    expect(statusAfterFailure(row("pro_monthly", "approved", 8), "cancelled", NOW)).toBeNull();
  });

  it("sin plan vigente sí se registra", () => {
    expect(statusAfterFailure(row("pro_monthly", "pending", null), "rejected", NOW)).toBe(
      "rejected",
    );
    expect(statusAfterFailure(row("pro_monthly", "active", -1), "cancelled", NOW)).toBe(
      "cancelled",
    );
    expect(statusAfterFailure(null, "rejected", NOW)).toBe("rejected");
  });
});

describe("a qué panel vuelve quien paga", () => {
  it("al de su rol, aunque el navegador pida otro", () => {
    expect(returnPathFor(["family"])).toBe("/dashboard/familia");
    expect(returnPathFor(["professional"], "/dashboard/familia")).toBe("/dashboard/profesional");
    expect(returnPathFor(["institution"])).toBe("/dashboard/institucion");
  });

  it("si tiene varios roles, respeta el que pidió entre los suyos", () => {
    expect(returnPathFor(["professional", "family"], "/dashboard/familia")).toBe(
      "/dashboard/familia",
    );
    expect(returnPathFor(["professional", "family"])).toBe("/dashboard/familia");
  });

  it("sin rol conocido va al panel general (nunca a una ruta externa)", () => {
    expect(returnPathFor([], "https://malo.example")).toBe("/dashboard");
    expect(returnPathFor(["superadmin"], "/dashboard/profesional")).toBe("/dashboard");
  });
});

describe("créditos IA: qué se acredita por un pago aprobado", () => {
  const credits = (meta: object, amount = 15000, currency = "COP") => ({
    metadata: { type: "credits", user_id: "u", ...meta },
    transaction_amount: amount,
    currency_id: currency,
  });

  it("acredita lo que fijó el servidor: créditos, paquete, vigencia y el monto real", () => {
    expect(
      creditsGrantFromPayment(
        credits({ credits: 120, pack_id: "starter", validity_days: 60, price_cop: 15000 }),
      ),
    ).toEqual({
      ok: true,
      grant: { credits: 120, packId: "starter", validityDays: 60, priceCop: 15000 },
    });
  });

  it("un monto menor al precio del paquete no acredita nada", () => {
    expect(creditsGrantFromPayment(credits({ credits: 120, price_cop: 15000 }, 1000))).toEqual({
      ok: false,
      error: "amount_mismatch",
    });
    expect(creditsGrantFromPayment(credits({ credits: 120 }, 0))).toEqual({
      ok: false,
      error: "amount_mismatch",
    });
  });

  it("créditos imposibles (cero, negativos, decimales o exagerados) no se acreditan", () => {
    for (const c of [0, -5, 1.5, "x", null, MAX_CREDITS_PER_PURCHASE + 1]) {
      expect(creditsGrantFromPayment(credits({ credits: c, price_cop: 15000 })).ok).toBe(false);
    }
  });

  it("otra moneda no acredita nada", () => {
    expect(creditsGrantFromPayment(credits({ credits: 10 }, 15000, "USD"))).toEqual({
      ok: false,
      error: "currency_mismatch",
    });
  });

  it("vigencia fuera de rango vuelve a 90 días; sin paquete queda en null", () => {
    const g = creditsGrantFromPayment(credits({ credits: 10, validity_days: 9999 }));
    expect(g.ok && g.grant).toMatchObject({ validityDays: 90, packId: null });
  });

  it("solo se procesan avisos de pagos (no merchant_order)", () => {
    expect(isPaymentTopic("payment")).toBe(true);
    expect(isPaymentTopic(null)).toBe(true);
    expect(isPaymentTopic("merchant_order")).toBe(false);
    expect(isPaymentTopic("subscription_preapproval")).toBe(false);
  });
});
