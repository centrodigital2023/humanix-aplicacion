import { describe, expect, it } from "vitest";
import { proVisibility, visibilityProgress, type ProVisibilityInput } from "./proVisibility";

const full: ProVisibilityInput = {
  published: true,
  active: true,
  blocked: false,
  hasLocation: true,
  available: true,
  hasVisibleServiceOffer: true,
};
const v = (over: Partial<ProVisibilityInput>) => proVisibility({ ...full, ...over });

describe("¿me ven en el mapa?", () => {
  it("todo en orden: visible, disponible, con los 4 pasos completos", () => {
    const r = v({});
    expect(r.status).toBe("visible");
    expect(r.onMap).toBe(true);
    expect(r.searchable).toBe(true);
    expect(r.headline).toBe("Te ven en el mapa: disponible");
    expect(visibilityProgress(r)).toEqual({ done: 4, total: 4 });
    expect(r.steps.every((s) => s.done && s.hint === null && s.action === null)).toBe(true);
  });

  it("no disponible no lo oculta: sigue en el mapa, marcado como no disponible", () => {
    const r = v({ available: false });
    expect(r.status).toBe("visible");
    expect(r.onMap).toBe(true);
    expect(r.headline).toBe("Estás en el mapa, marcado como no disponible");
    const step = r.steps.find((s) => s.key === "available");
    expect(step).toMatchObject({ done: false, action: "availability" });
  });

  it("sin publicar: ni mapa ni buscador, y el paso lleva al perfil", () => {
    const r = v({ published: false });
    expect(r.status).toBe("hidden");
    expect(r.onMap).toBe(false);
    expect(r.searchable).toBe(false);
    expect(r.steps.find((s) => s.key === "published")).toMatchObject({
      done: false,
      action: "profile",
    });
  });

  it("sin zona guardada: sale en el buscador pero no como punto en el mapa", () => {
    const r = v({ hasLocation: false });
    expect(r.status).toBe("hidden");
    expect(r.onMap).toBe(false);
    expect(r.searchable).toBe(true);
    expect(r.detail).toMatch(/guarda tu zona/i);
    expect(r.steps.find((s) => s.key === "location")?.hint).toMatch(/nunca tu dirección/);
  });

  it("cuenta oculta (active = false): aparece el paso para volver a mostrarse", () => {
    const r = v({ active: false });
    expect(r.status).toBe("hidden");
    expect(r.searchable).toBe(false);
    expect(r.steps[0]).toMatchObject({ key: "active", done: false, action: "show" });
    expect(visibilityProgress(r)).toEqual({ done: 4, total: 5 });
    // Nulo se lee como activo (igual que COALESCE(active, true) en la base).
    expect(v({ active: null }).status).toBe("visible");
    expect(v({ active: null }).steps.some((s) => s.key === "active")).toBe(false);
  });

  it("cuenta en revisión: no aparece y lo dice con el camino a seguir", () => {
    const r = v({ blocked: true });
    expect(r.status).toBe("blocked");
    expect(r.onMap).toBe(false);
    expect(r.searchable).toBe(false);
    expect(r.headline).toBe("Tu cuenta está en revisión");
    expect(r.detail).toMatch(/PQRS/);
  });

  it("sin oferta de servicio: no afecta el mapa, pero sugiere publicarla", () => {
    const r = v({ hasVisibleServiceOffer: false });
    expect(r.status).toBe("visible");
    expect(r.steps.find((s) => s.key === "offer")).toMatchObject({ done: false, action: "offer" });
    expect(visibilityProgress(r)).toEqual({ done: 3, total: 4 });
  });

  it("perfil nuevo: todo pendiente y cada paso apunta a una acción distinta", () => {
    const r = v({
      published: false,
      hasLocation: false,
      available: false,
      hasVisibleServiceOffer: false,
    });
    expect(visibilityProgress(r)).toEqual({ done: 0, total: 4 });
    expect(r.steps.map((s) => s.action)).toEqual(["profile", "profile", "availability", "offer"]);
  });
});
