import { describe, expect, it } from "vitest";
import {
  cancelLabel,
  cancelMoneyNote,
  serviceActions,
  validateIssue,
  type ActionBooking,
} from "./serviceActions";

const b = (over: Partial<ActionBooking> = {}): ActionBooking => ({
  status: "confirmed",
  payment_method: "DIGITAL_BREB",
  paid_at: null,
  total_amount: 120000,
  platform_fee_amount: 18000,
  escrow_status: null,
  ...over,
});

describe("serviceActions", () => {
  it("el círculo de cuidado no ve acciones", () => {
    for (const status of ["pending", "confirmed", "in_route", "in_progress"])
      expect(serviceActions("viewer", b({ status }))).toEqual([]);
  });

  it("pedido: reprogramar y cancelar (sin chat ni reporte)", () => {
    expect(serviceActions("client", b({ status: "pending" }))).toEqual(["reschedule", "cancel"]);
    expect(serviceActions("professional", b({ status: "pending" }))).toEqual([
      "reschedule",
      "cancel",
    ]);
  });

  it("aceptado: escribir, reprogramar, reportar y cancelar", () => {
    expect(serviceActions("client", b())).toEqual(["contact", "reschedule", "report", "cancel"]);
  });

  it("en camino: ya no se reprograma", () => {
    expect(serviceActions("professional", b({ status: "in_route" }))).toEqual([
      "contact",
      "report",
      "cancel",
    ]);
  });

  it("cuidando: la familia confirma que terminó; nadie cancela", () => {
    expect(serviceActions("client", b({ status: "in_progress" }))).toEqual([
      "confirm_finish",
      "contact",
      "report",
    ]);
    expect(serviceActions("professional", b({ status: "in_progress" }))).toEqual([
      "contact",
      "report",
    ]);
  });

  it("terminado o cancelado: sin acciones aquí (el reclamo vive en la tarjeta de pago)", () => {
    expect(serviceActions("client", b({ status: "completed", escrow_status: "held" }))).toEqual([
      "contact",
    ]);
    expect(serviceActions("client", b({ status: "cancelled" }))).toEqual([]);
  });

  it("el profesional rechaza lo que aún no aceptó", () => {
    expect(cancelLabel("professional", "pending")).toBe("Rechazar");
    expect(cancelLabel("professional", "confirmed")).toBe("Cancelar");
    expect(cancelLabel("client", "pending")).toBe("Cancelar");
  });
});

describe("cancelMoneyNote", () => {
  it("Bre-B pagado y retenido: se devuelve completo", () => {
    const paid = b({ paid_at: "2026-11-04T10:00:00Z", escrow_status: "held" });
    expect(cancelMoneyNote("client", paid)).toMatch(/Te devolvemos .*120\.000/);
    expect(cancelMoneyNote("professional", paid)).toMatch(/Le devolvemos .*120\.000/);
  });

  it("Bre-B ya entregado al profesional (directo): lo gestiona el equipo", () => {
    const direct = b({ paid_at: "2026-11-04T10:00:00Z", escrow_status: "released" });
    expect(cancelMoneyNote("client", direct)).toMatch(/equipo de Humanix/);
  });

  it("Bre-B sin pagar: no se cobra", () => {
    expect(cancelMoneyNote("client", b())).toMatch(/no se cobra/);
  });

  it("efectivo: el profesional recupera la comisión apartada", () => {
    const cash = b({ payment_method: "CASH" });
    expect(cancelMoneyNote("professional", cash)).toMatch(/liberamos .*18\.000/);
    expect(cancelMoneyNote("professional", { ...cash, status: "pending" })).toMatch(/no se cobra/);
    expect(cancelMoneyNote("client", cash)).toMatch(/no pagas nada/);
  });
});

describe("validateIssue", () => {
  it("exige tipo y detalle", () => {
    expect(validateIssue("", "hola mundo").ok).toBe(false);
    expect(validateIssue("late", "  ok ").ok).toBe(false);
    expect(validateIssue("late", "x".repeat(501)).ok).toBe(false);
    expect(validateIssue("no_show", "  No ha llegado  ")).toEqual({
      ok: true,
      kind: "no_show",
      detail: "No ha llegado",
    });
  });
});
