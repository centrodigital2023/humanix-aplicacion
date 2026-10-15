import { describe, expect, it } from "vitest";
import { RENEW_REMINDER_DAYS, longDateEs, normalizeSubscription, planValidity } from "./plans";

const NOW = Date.parse("2026-10-15T15:00:00Z");
const DAY = 86_400_000;
const sub = (over: object = {}) => ({
  plan: "pro_monthly",
  status: "active",
  amount: 29000,
  currency: "COP",
  current_period_end: new Date(NOW + 10 * DAY).toISOString(),
  cancel_at_period_end: false,
  ...over,
});

describe("estado del plan (misma regla que get_user_plan en SQL)", () => {
  it("sin fila es Free", () => {
    expect(normalizeSubscription(null, NOW)).toMatchObject({
      plan: "free",
      status: null,
      currentPeriodEnd: null,
    });
  });

  it("activo o aprobado y vigente da el plan", () => {
    expect(normalizeSubscription(sub(), NOW).plan).toBe("pro_monthly");
    expect(normalizeSubscription(sub({ status: "approved" }), NOW).plan).toBe("pro_monthly");
    expect(normalizeSubscription(sub({ current_period_end: null }), NOW).plan).toBe("pro_monthly");
  });

  it("vencido, pendiente o rechazado es Free, pero conserva el estado y la fecha para mostrarlos", () => {
    const expired = normalizeSubscription(
      sub({ current_period_end: new Date(NOW - DAY).toISOString() }),
      NOW,
    );
    expect(expired).toMatchObject({ plan: "free", status: "active", amount: null });
    expect(expired.currentPeriodEnd).not.toBeNull();
    expect(normalizeSubscription(sub({ status: "pending" }), NOW)).toMatchObject({
      plan: "free",
      status: "pending",
    });
    expect(normalizeSubscription(sub({ status: "rejected" }), NOW).plan).toBe("free");
  });

  it("un plan desconocido o «free» activo es Free (nada se abre por un texto raro)", () => {
    expect(normalizeSubscription(sub({ plan: "gold" }), NOW).plan).toBe("free");
    expect(normalizeSubscription(sub({ plan: "free" }), NOW).plan).toBe("free");
    expect(normalizeSubscription(sub({ plan: null }), NOW).plan).toBe("free");
  });
});

describe("vigencia del plan", () => {
  it("sin plan o sin fecha no hay vigencia que mostrar", () => {
    expect(planValidity({ plan: "free", currentPeriodEnd: null }, NOW)).toEqual({
      daysLeft: null,
      renewSoon: false,
      line: null,
    });
    expect(planValidity({ plan: "pro_monthly", currentPeriodEnd: null }, NOW).line).toBeNull();
  });

  it("cuenta los días que quedan (el último cuenta como uno) y dice hasta cuándo", () => {
    const v = planValidity(
      { plan: "pro_monthly", currentPeriodEnd: "2026-11-15T15:00:00.000Z" },
      NOW,
    );
    expect(v).toEqual({ daysLeft: 31, renewSoon: false, line: "Vigente hasta el 15 de noviembre" });
    expect(
      planValidity(
        { plan: "pro_monthly", currentPeriodEnd: new Date(NOW + 2 * 3_600_000).toISOString() },
        NOW,
      ).daysLeft,
    ).toBe(1);
  });

  it("recuerda renovar solo en los últimos días", () => {
    const at = (d: number) =>
      planValidity(
        { plan: "essential_monthly", currentPeriodEnd: new Date(NOW + d * DAY).toISOString() },
        NOW,
      );
    expect(at(RENEW_REMINDER_DAYS).renewSoon).toBe(true);
    expect(at(RENEW_REMINDER_DAYS + 1).renewSoon).toBe(false);
  });

  it("la fecha es la de Colombia (medianoche UTC aún es el día anterior en Bogotá)", () => {
    expect(longDateEs(Date.parse("2026-11-16T03:00:00Z"))).toBe("15 de noviembre");
    expect(longDateEs(Date.parse("2026-11-16T06:00:00Z"))).toBe("16 de noviembre");
  });
});
