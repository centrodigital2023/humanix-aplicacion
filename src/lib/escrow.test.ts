import { describe, expect, it } from "vitest";
import {
  canClientDecide,
  canPayBooking,
  CONFIRM_MESSAGE,
  escrowStage,
  hoursToRelease,
  isConfirmResult,
  isReportResult,
  releaseInWords,
  validateDisputeReason,
} from "./escrow";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const inH = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe("escrowStage", () => {
  it("efectivo nunca se retiene", () => {
    expect(escrowStage({ status: "completed", payment_method: "CASH", escrow_status: null })).toBe(
      "cash",
    );
  });
  it("Bre-B sin pagar", () => {
    expect(escrowStage({ status: "pending", payment_method: "DIGITAL_BREB" })).toBe("unpaid");
  });
  it("pagado y el turno sigue abierto: protegido", () => {
    for (const status of ["pending", "confirmed", "in_route", "in_progress"]) {
      expect(escrowStage({ status, escrow_status: "held", paid_at: inH(-1) })).toBe("protected");
    }
  });
  it("terminado y retenido: espera a la familia", () => {
    expect(escrowStage({ status: "completed", escrow_status: "held", paid_at: inH(-5) })).toBe(
      "awaiting_client",
    );
  });
  it("estados finales", () => {
    expect(escrowStage({ status: "completed", escrow_status: "released" })).toBe("released");
    expect(escrowStage({ status: "completed", escrow_status: "disputed" })).toBe("disputed");
    expect(escrowStage({ status: "cancelled", escrow_status: "refunding" })).toBe("refunding");
    expect(escrowStage({ status: "cancelled", escrow_status: "refunded" })).toBe("refunded");
  });
  it("pagado sin estado aún (antes de la migración): protegido", () => {
    expect(escrowStage({ status: "confirmed", paid_at: inH(-1), escrow_status: null })).toBe(
      "protected",
    );
  });
});

describe("plazo de la familia", () => {
  it("horas que quedan, hacia arriba", () => {
    expect(hoursToRelease(inH(23.2), NOW)).toBe(24);
    expect(hoursToRelease(inH(0.1), NOW)).toBe(1);
    expect(hoursToRelease(inH(-1), NOW)).toBe(0);
    expect(hoursToRelease(null, NOW)).toBe(0);
    expect(hoursToRelease("no-es-fecha", NOW)).toBe(0);
  });
  it("puede decidir solo con el turno terminado, retenido y dentro del plazo", () => {
    const b = { status: "completed", escrow_status: "held", release_due_at: inH(5) };
    expect(canClientDecide(b, NOW)).toBe(true);
    expect(canClientDecide({ ...b, release_due_at: inH(-0.1) }, NOW)).toBe(false);
    expect(canClientDecide({ ...b, escrow_status: "released" }, NOW)).toBe(false);
    expect(canClientDecide({ ...b, status: "in_progress" }, NOW)).toBe(false);
  });
  it("en palabras", () => {
    expect(releaseInWords(1)).toBe("en menos de 1 h");
    expect(releaseInWords(7)).toBe("en 7 h");
  });
});

describe("cuándo se puede pagar", () => {
  it("desde que se pide el turno (pending) hasta que termina", () => {
    for (const status of ["pending", "confirmed", "in_route", "in_progress", "completed"]) {
      expect(canPayBooking({ status, payment_method: "DIGITAL_BREB" })).toBe(true);
    }
  });
  it("nunca cancelado, efectivo o ya pagado", () => {
    expect(canPayBooking({ status: "cancelled", payment_method: "DIGITAL_BREB" })).toBe(false);
    expect(canPayBooking({ status: "pending", payment_method: "CASH" })).toBe(false);
    expect(canPayBooking({ status: "pending", paid_at: inH(-1) })).toBe(false);
  });
});

describe("respuestas de la base", () => {
  it("reconoce los resultados conocidos", () => {
    expect(isConfirmResult("released")).toBe(true);
    expect(isConfirmResult("otra")).toBe(false);
    expect(isReportResult("window_closed")).toBe(true);
    expect(isReportResult(null)).toBe(false);
    expect(CONFIRM_MESSAGE.released).toMatch(/Liberamos/);
  });
  it("valida el reclamo como la base", () => {
    expect(validateDisputeReason("  no ")).toMatchObject({ ok: false });
    expect(validateDisputeReason("x".repeat(501))).toMatchObject({ ok: false });
    expect(validateDisputeReason("  No llegó a la hora  ")).toEqual({
      ok: true,
      value: "No llegó a la hora",
    });
  });
});
