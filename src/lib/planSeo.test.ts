import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FREE_COMMISSION_PCT, PLAN_CATALOG } from "./plans";
import { PLAN_IMAGES, PLAN_LD_ITEMS, priceValidUntil, pricingProductLd } from "./planSeo";

const ld = pricingProductLd(new Date("2026-11-02T12:00:00Z"));
const items = ld.itemListElement.map((e) => e.item);

describe("datos estructurados de /planes — válidos para Google", () => {
  it("cada plan es un Product con nombre, image, brand y oferta en COP", () => {
    expect(items.length).toBe(PLAN_LD_ITEMS.length);
    for (const p of items) {
      expect(p["@type"]).toBe("Product");
      expect(p.name).toMatch(/^Humanix \S/);
      expect(p.image.length).toBeGreaterThan(0);
      for (const img of p.image) expect(img).toMatch(/^https:\/\/humanix\.lat\/.+\.(png|jpg|webp)$/);
      expect(p.brand).toEqual({ "@type": "Brand", name: "Humanix" });
      expect(p.offers.priceCurrency).toBe("COP");
      expect(Number.isFinite(Number(p.offers.price))).toBe(true);
    }
  });

  it("los planes que reportó Search Console tienen image", () => {
    for (const name of ["Humanix Familiar", "Humanix Free", "Humanix Institucional"]) {
      const p = items.find((i) => i.name === name);
      expect(p, name).toBeDefined();
      expect(p!.image.length).toBeGreaterThan(0);
    }
  });

  it("las imágenes existen en el sitio publicado (carpeta public)", () => {
    for (const url of PLAN_IMAGES) {
      expect(existsSync(`public/${url.replace("https://humanix.lat/", "")}`), url).toBe(true);
    }
  });

  it("precios y comisión salen del catálogo, no escritos a mano", () => {
    for (const e of PLAN_LD_ITEMS) {
      const p = items.find((i) => i.name === `Humanix ${PLAN_CATALOG[e.key].label}`)!;
      expect(p.offers.price).toBe(String(PLAN_CATALOG[e.key].amountCOP));
    }
    expect(items[0].description).toContain(`${FREE_COMMISSION_PCT} %`);
  });

  it("la vigencia del precio nunca queda en el pasado", () => {
    expect(priceValidUntil(new Date("2026-11-02T00:00:00Z"))).toBe("2027-12-31");
    expect(priceValidUntil(new Date("2027-01-01T00:00:00Z"))).toBe("2028-12-31");
  });
});

describe("sin reseñas inventadas en los datos estructurados", () => {
  it("la ficha de la plataforma no declara calificaciones", async () => {
    const { webApplicationLd } = await import("./seo");
    expect(webApplicationLd()).not.toHaveProperty("aggregateRating");
  });
});
