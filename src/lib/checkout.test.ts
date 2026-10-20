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
        mode: "once",
      },
    });
  });

  it("pide la suscripción con cobro automático solo si se elige", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { init_point: "https://mp/sub" }, error: null });
    await startCheckout(invoke, { plan: "pro_monthly", mode: "recurring" });
    expect(invoke.mock.calls[0][1].body.mode).toBe("recurring");
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

describe("pago único por la acción de servidor (PSE)", () => {
  it("usa la acción de servidor y no la Edge Function", async () => {
    const invoke = vi.fn();
    const startOnce = vi.fn().mockResolvedValue({ ok: true, url: "https://mp/pse" });
    const r = await startCheckout(invoke, { plan: "essential_monthly", returnTo: null, startOnce });
    expect(r).toEqual({ ok: true, url: "https://mp/pse" });
    expect(startOnce).toHaveBeenCalledWith({ plan: "essential_monthly", returnTo: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("muestra el motivo del servidor (p. ej. bajar de plan con uno vigente)", async () => {
    const invoke = vi.fn();
    const startOnce = vi.fn().mockResolvedValue({ ok: false, error: "downgrade_while_active" });
    const r = await startCheckout(invoke, { plan: "essential_monthly", startOnce });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/sigue vigente/) });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("si no está configurada o falla, usa la Edge Function", async () => {
    for (const fail of [
      () => Promise.resolve({ ok: false, error: "not_configured" }),
      () => Promise.reject(new Error("x")),
    ]) {
      const invoke = vi
        .fn()
        .mockResolvedValue({ data: { init_point: "https://mp/ef" }, error: null });
      const r = await startCheckout(invoke, { plan: "pro_monthly", startOnce: fail as never });
      expect(r).toEqual({ ok: true, url: "https://mp/ef" });
    }
  });

  it("la suscripción siempre va por la Edge Function", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue({ data: { init_point: "https://mp/sub" }, error: null });
    const startOnce = vi.fn();
    await startCheckout(invoke, { plan: "pro_monthly", mode: "recurring", startOnce });
    expect(startOnce).not.toHaveBeenCalled();
  });
});
