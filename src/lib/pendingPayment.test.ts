import { beforeEach, describe, expect, it } from "vitest";
import { clearPendingPayment, readPendingPayment, savePendingPayment } from "./pendingPayment";

describe("pago pendiente al volver del banco", () => {
  beforeEach(() => localStorage.clear());

  it("se guarda y se lee en otra pestaña del mismo navegador, y se limpia", () => {
    savePendingPayment("123456", 1_000);
    expect(readPendingPayment(2_000)).toBe("123456");
    clearPendingPayment();
    expect(readPendingPayment(2_000)).toBeNull();
  });

  it("vence a las 2 horas y no acepta ids raros", () => {
    savePendingPayment("123456", 0);
    expect(readPendingPayment(2 * 60 * 60 * 1000 + 1)).toBeNull();
    savePendingPayment("abc", 0);
    expect(readPendingPayment(1)).toBe("123456");
  });
});
