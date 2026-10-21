import { describe, expect, it, vi } from "vitest";
import { goToBank, isFramed } from "./bankRedirect";

const win = (framed: boolean) => {
  const self = {};
  return { self, top: framed ? {} : self, location: { assign: vi.fn() } };
};

describe("salir a la página del banco (PSE)", () => {
  it("fuera de un marco navega en la misma pestaña", () => {
    const w = win(false);
    expect(goToBank("https://registro.pse.com.co/x", w)).toBe(true);
    expect(w.location.assign).toHaveBeenCalledWith("https://registro.pse.com.co/x");
  });

  it("dentro de un marco no carga PSE en el marco: pide abrir el banco en otra pestaña", () => {
    const w = win(true);
    expect(goToBank("https://registro.pse.com.co/x", w)).toBe(false);
    expect(w.location.assign).not.toHaveBeenCalled();
  });

  it("si no se puede leer la ventana principal, se asume que está en un marco", () => {
    const w = {
      self: {},
      get top(): unknown {
        throw new Error("blocked");
      },
    };
    expect(isFramed(w)).toBe(true);
  });
});
