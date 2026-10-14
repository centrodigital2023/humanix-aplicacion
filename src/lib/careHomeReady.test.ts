import { describe, expect, it } from "vitest";
import { CARE_ROUTES } from "./careJourney";
import {
  HOME_GROUP_LABEL,
  HOME_ITEMS,
  homeProgress,
  pendingItems,
  sanitizeDone,
  toggleDone,
} from "./careHomeReady";

describe("casa lista: la lista de cada ruta", () => {
  it.each(CARE_ROUTES)("la ruta %s tiene ítems con ids únicos y prefijo propio", (r) => {
    const items = HOME_ITEMS[r];
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) expect(Object.keys(HOME_GROUP_LABEL)).toContain(i.group);
  });

  it("los ids son únicos entre todas las rutas", () => {
    const all = CARE_ROUTES.flatMap((r) => HOME_ITEMS[r].map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("solo logística: sin medicamentos, dosis ni indicaciones clínicas", () => {
    const text = CARE_ROUTES.flatMap((r) => HOME_ITEMS[r].map((i) => i.label)).join(" ");
    expect(text).not.toMatch(/\b(mg|ml|dosis|pastilla|inyecci[oó]n|suero|antibi[oó]tico)\b/i);
    expect(text).not.toMatch(/\b(tome|dale|administra|aplica|suministra)\b/i);
    expect(text).not.toMatch(/\$|\bCOP\b|pago|precio|whatsapp|@/i);
  });
});

describe("casa lista: avance", () => {
  const r = "postop" as const;
  const ids = HOME_ITEMS[r].map((i) => i.id);

  it("sin nada marcado: invita sin presionar", () => {
    const p = homeProgress(r, []);
    expect(p).toMatchObject({ done: 0, total: ids.length, pct: 0, complete: false });
    expect(p.line).toBe("Marca lo que ya tienes: no hace falta hacerlo todo hoy.");
  });

  it("avance parcial: muestra «N de M», nunca pendientes en rojo", () => {
    const p = homeProgress(r, ids.slice(0, 3));
    expect(p.line).toBe(`3 de ${ids.length}. Vas bien: lo que falta se puede repartir.`);
    expect(p.pct).toBe(Math.round((3 / ids.length) * 100));
    expect(p.line).not.toMatch(/falta(n)? urgente|atrasad|vencid|tarde/i);
  });

  it("el porcentaje se redondea al entero más cercano", () => {
    expect(homeProgress(r, ids.slice(0, 5)).pct).toBe(56); // 5 de 9 = 55,6 %
  });

  it("a un ítem de terminar todavía no está completa", () => {
    const p = homeProgress(r, ids.slice(0, ids.length - 1));
    expect(p.complete).toBe(false);
    expect(p.pct).toBeLessThan(100);
  });

  it("completa: lo celebra con calma", () => {
    const p = homeProgress(r, ids);
    expect(p.complete).toBe(true);
    expect(p.pct).toBe(100);
    expect(p.line).toBe("La casa está lista. Se nota el cariño.");
  });

  it("ids ajenos, repetidos o basura guardada no cuentan", () => {
    expect(homeProgress(r, [ids[0], ids[0], "elder-paths", "x"]).done).toBe(1);
    expect(sanitizeDone(r, "no es lista")).toEqual([]);
    expect(sanitizeDone(r, [1, null, {}, ids[1]])).toEqual([ids[1]]);
  });
});

describe("casa lista: marcar y repartir", () => {
  const r = "elder" as const;

  it("marcar y desmarcar alterna sin tocar lo demás", () => {
    const a = toggleDone(r, [], "elder-paths");
    expect(a).toEqual(["elder-paths"]);
    const b = toggleDone(r, a, "elder-light");
    expect(b).toEqual(["elder-paths", "elder-light"]);
    expect(toggleDone(r, b, "elder-paths")).toEqual(["elder-light"]);
  });

  it("un id de otra ruta no se puede marcar", () => {
    expect(toggleDone(r, [], "postop-bed")).toEqual([]);
  });

  it("lo pendiente conserva el orden de la lista", () => {
    const pend = pendingItems(r, ["elder-light"]);
    expect(pend).toHaveLength(HOME_ITEMS[r].length - 1);
    expect(pend.some((i) => i.id === "elder-light")).toBe(false);
    expect(pend[0].id).toBe("elder-paths");
  });

  it("no muta lo que recibe", () => {
    const given = Object.freeze(["elder-paths"]) as readonly string[];
    expect(() => toggleDone(r, given, "elder-light")).not.toThrow();
  });
});
