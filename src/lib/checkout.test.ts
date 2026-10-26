import { describe, expect, it } from "vitest";
import { checkoutErrorMessage, payModeOf, payPageHref, readErrorPayload } from "./checkout";

const httpError = (status: number, body: unknown) => ({
  name: "FunctionsHttpError",
  context: new Response(JSON.stringify(body), { status }),
});

describe("ir a pagar dentro de Humanix", () => {
  it("lleva a /pagar con el plan, la forma de pago y el panel de regreso", () => {
    expect(payPageHref("pro_monthly")).toBe("/pagar?plan=pro_monthly");
    expect(
      payPageHref("essential_monthly", { mode: "recurring", returnTo: "/dashboard/familia" }),
    ).toBe("/pagar?plan=essential_monthly&modo=recurrente&from=%2Fdashboard%2Ffamilia");
  });

  it("la forma de pago de la URL: solo «recurrente» es cobro automático", () => {
    expect(payModeOf("recurrente")).toBe("recurring");
    expect(payModeOf(undefined)).toBe("once");
    expect(payModeOf("otra")).toBe("once");
  });
});

describe("mensajes del servidor", () => {
  it("plan desconocido", () => {
    expect(checkoutErrorMessage({ error: "unknown_plan" }, "pro_monthly")).toMatch(
      /no está disponible/,
    );
  });

  it("formulario incompleto o pagos sin configurar: mensajes sin detalles técnicos", () => {
    expect(checkoutErrorMessage({ error: "invalid_form" }, "pro_monthly")).toMatch(
      /Revisa los datos/,
    );
    expect(checkoutErrorMessage({ error: "not_configured" }, "pro_monthly")).toMatch(
      /configurando/,
    );
    expect(checkoutErrorMessage(null, "pro_monthly")).not.toMatch(/error|mp_/i);
  });

  it("bajar de plan sin fecha o con un plan raro sigue siendo claro", () => {
    expect(checkoutErrorMessage({ error: "downgrade_while_active" }, "essential_monthly")).toBe(
      "Tu plan actual sigue vigente. Podrás pasar a Familiar cuando termine: así no pierdes lo que ya pagaste.",
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
