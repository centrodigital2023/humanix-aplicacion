import { describe, expect, it, vi } from "vitest";
import { checkoutErrorMessage, readErrorPayload, startCheckout } from "./checkout";

const httpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError",
  context: new Response(JSON.stringify(body), { status }),
});

describe("abrir el pago", () => {
  it("devuelve la URL de Mercado Pago y manda el plan, el precio del catálogo y el panel de regreso", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { init_point: "https://mp/ok" }, error: null });
    const r = await startCheckout(invoke, {
      plan: "essential_monthly",
      email: "a@b.co",
      returnTo: "/dashboard/familia",
    });
    expect(r).toEqual({ ok: true, url: "https://mp/ok" });
    expect(invoke).toHaveBeenCalledWith("mp-create-subscription", {
      body: {
        plan: "essential_monthly",
        amount: 9000,
        email: "a@b.co",
        return_to: "/dashboard/familia",
      },
    });
  });

  it("usa la URL de pruebas si no hay otra", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { sandbox_init_point: "https://mp/sb" }, error: null });
    expect(await startCheckout(invoke, { plan: "pro_monthly" })).toEqual({
      ok: true,
      url: "https://mp/sb",
    });
  });

  it("si el servidor no deja bajar de plan, explica hasta cuándo dura el actual", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: httpError(409, {
        error: "downgrade_while_active",
        current_plan: "pro_monthly",
        ends_at: "2026-11-15T15:00:00.000Z",
      }),
    });
    const r = await startCheckout(invoke, { plan: "essential_monthly" });
    expect(r).toEqual({
      ok: false,
      message:
        "Tu plan Pro Profesional sigue vigente hasta el 15 de noviembre. Podrás pasar a Esencial cuando termine: así no pierdes lo que ya pagaste.",
    });
  });

  it("sin URL, con error de red o con una excepción, un mensaje amable y sin detalles técnicos", async () => {
    const msgs = await Promise.all([
      startCheckout(vi.fn().mockResolvedValue({ data: {}, error: null }), { plan: "pro_monthly" }),
      startCheckout(vi.fn().mockResolvedValue({ data: null, error: new Error("fetch failed") }), {
        plan: "pro_monthly",
      }),
      startCheckout(vi.fn().mockRejectedValue(new Error("boom")), { plan: "pro_monthly" }),
    ]);
    for (const m of msgs) {
      expect(m.ok).toBe(false);
      if (!m.ok) {
        expect(m.message).toMatch(/Casi lo tenemos/);
        expect(m.message).not.toMatch(/fetch|boom|error/i);
      }
    }
  });
});

describe("mensajes del servidor", () => {
  it("plan desconocido", () => {
    expect(checkoutErrorMessage({ error: "unknown_plan" }, "pro_monthly")).toMatch(
      /no está disponible/,
    );
  });

  it("bajar de plan sin fecha o con un plan raro sigue siendo claro", () => {
    expect(checkoutErrorMessage({ error: "downgrade_while_active" }, "essential_monthly")).toBe(
      "Tu plan actual sigue vigente. Podrás pasar a Esencial cuando termine: así no pierdes lo que ya pagaste.",
    );
  });

  it("lee el cuerpo de un error de Edge Function y tolera lo que no lo es", async () => {
    expect(await readErrorPayload(httpError(400, { error: "unknown_plan" }))).toEqual({
      error: "unknown_plan",
    });
    expect(await readErrorPayload(new Error("x"))).toBeNull();
    expect(await readErrorPayload(null)).toBeNull();
    expect(
      await readErrorPayload({ context: new Response("no json", { status: 500 }) }),
    ).toBeNull();
  });
});
