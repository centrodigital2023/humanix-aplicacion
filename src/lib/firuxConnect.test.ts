import { describe, expect, it } from "vitest";
import {
  chooseChargeRoute,
  connectView,
  connectionUsable,
  FIRUX_CONNECT_TERMS_VERSION,
  isFiruxConnectEnabled,
  type FiruxConnectionRow,
} from "./firuxConnect";

const PRO = "22222222-2222-4222-8222-222222222222";
const active: FiruxConnectionRow = {
  professional_id: PRO,
  firux_account_id: "acct_123",
  status: "active",
  commission_terms_version: FIRUX_CONNECT_TERMS_VERSION,
  commission_accepted_at: "2026-11-04T10:00:00Z",
};
const booking = {
  total_amount: 120_000,
  platform_fee_amount: 18_000,
  payment_method: "DIGITAL_BREB",
};

describe("flag FIRUX_CONNECT_ENABLED", () => {
  it("apagado por defecto; solo valores explícitos lo encienden", () => {
    expect(isFiruxConnectEnabled({})).toBe(false);
    expect(isFiruxConnectEnabled({ FIRUX_CONNECT_ENABLED: "" })).toBe(false);
    expect(isFiruxConnectEnabled({ FIRUX_CONNECT_ENABLED: "false" })).toBe(false);
    expect(isFiruxConnectEnabled({ FIRUX_CONNECT_ENABLED: "true" })).toBe(true);
    expect(isFiruxConnectEnabled({ FIRUX_CONNECT_ENABLED: " 1 " })).toBe(true);
  });
});

describe("ruta del cobro del turno", () => {
  it("con el flag apagado siempre va por la llave de Humanix", () => {
    expect(chooseChargeRoute(booking, active, false)).toEqual({
      route: "platform",
      reason: "flag_off",
    });
  });

  it("conexión activa y comisión aceptada: cobro conectado con la comisión de la base", () => {
    expect(chooseChargeRoute(booking, active, true)).toEqual({
      route: "connected",
      accountId: "acct_123",
      applicationFeeCop: 18_000,
    });
  });

  it("primer turno exento: comisión 0 sigue siendo cobro conectado", () => {
    expect(chooseChargeRoute({ ...booking, platform_fee_amount: 0 }, active, true)).toMatchObject({
      route: "connected",
      applicationFeeCop: 0,
    });
  });

  it("la comisión nunca supera el total ni es negativa", () => {
    expect(
      chooseChargeRoute({ ...booking, platform_fee_amount: 999_999 }, active, true),
    ).toMatchObject({
      applicationFeeCop: 120_000,
    });
    expect(chooseChargeRoute({ ...booking, platform_fee_amount: -5 }, active, true)).toMatchObject({
      applicationFeeCop: 0,
    });
  });

  it("sin conexión usable o en efectivo: respaldo por la llave de Humanix (cola payouts)", () => {
    expect(chooseChargeRoute(booking, null, true)).toMatchObject({
      route: "platform",
      reason: "no_connection",
    });
    expect(chooseChargeRoute(booking, { ...active, status: "revoked" }, true)).toMatchObject({
      route: "platform",
    });
    expect(
      chooseChargeRoute(booking, { ...active, commission_terms_version: "viejo" }, true),
    ).toMatchObject({
      route: "platform",
    });
    expect(chooseChargeRoute({ ...booking, payment_method: "CASH" }, active, true)).toMatchObject({
      route: "platform",
      reason: "not_digital",
    });
  });
});

describe("estado que ve el profesional", () => {
  it("cubre cada caso", () => {
    expect(connectView(false, active)).toEqual({ state: "disabled" });
    expect(connectView(true, null)).toEqual({ state: "not_connected" });
    expect(connectView(true, { ...active, status: "revoked" })).toEqual({ state: "not_connected" });
    expect(connectView(true, { ...active, status: "pending", firux_account_id: null })).toEqual({
      state: "pending",
    });
    expect(connectView(true, { ...active, commission_accepted_at: null })).toEqual({
      state: "needs_terms",
    });
    expect(connectView(true, active)).toEqual({ state: "connected", accountId: "acct_123" });
    expect(connectionUsable(active)).toBe(true);
  });
});
