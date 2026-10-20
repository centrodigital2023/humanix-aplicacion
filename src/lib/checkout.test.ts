import { describe, expect, it, vi } from "vitest";
import { startCheckout } from "./checkout";

describe("pasarela retirada", () => {
  it.each(["essential_monthly", "pro_monthly", "institution_monthly"] as const)(
    "no permite comprar %s",
    async (plan) => {
      const invoke = vi
        .fn()
        .mockResolvedValue({ data: { init_point: "https://example.com/pay" }, error: null });
      const startOnce = vi.fn().mockResolvedValue({ ok: true, url: "https://example.com/pay" });
      expect((await startCheckout(invoke, { plan, startOnce })).ok).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
      expect(startOnce).not.toHaveBeenCalled();
    },
  );
  it("no permite crear suscripciones automáticas", async () => {
    const invoke = vi.fn();
    expect((await startCheckout(invoke, { plan: "pro_monthly", mode: "recurring" })).ok).toBe(
      false,
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
