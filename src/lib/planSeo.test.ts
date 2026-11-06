import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTITUTION_PLANS, MIN_BOOKING_COP } from "./commissionMatrix";
import { FREE_COMMISSION_PCT } from "./plans";
import { PLAN_IMAGES, priceValidUntil, pricingServiceLd } from "./planSeo";
import { serviceLd } from "./seo-landing";
import * as seo from "./seo";

const NOW = new Date("2026-11-06T12:00:00Z");
const ld = pricingServiceLd(NOW);
const offers = ld.hasOfferCatalog.itemListElement;

/** Recorre un JSON-LD y devuelve todos los nodos con @type. */
function nodes(x: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(x)) x.forEach((v) => nodes(v, out));
  else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if ("@type" in o) out.push(o);
    Object.values(o).forEach((v) => nodes(v, out));
  }
  return out;
}
const types = (o: Record<string, unknown>) => [o["@type"]].flat() as string[];

describe("/planes es un Service con catálogo de ofertas, no Product (Search Console 6 nov)", () => {
  it("no hay ningún Product: Google deja de pedir GTIN, envío, devoluciones y reseñas", () => {
    expect(nodes(ld).some((n) => types(n).includes("Product"))).toBe(false);
    expect(ld["@type"]).toBe("Service");
  });

  it("lleva image rastreable y existente en public/", () => {
    expect(ld.image.length).toBeGreaterThan(0);
    for (const url of PLAN_IMAGES) {
      expect(url).toMatch(/^https:\/\/humanix\.lat\/.+\.(png|jpg|webp)$/);
      expect(existsSync(`public/${url.replace("https://humanix.lat/", "")}`), url).toBe(true);
    }
  });

  it("cada oferta tiene precio en COP, validFrom y vigencia futura", () => {
    expect(offers.length).toBe(4);
    for (const o of offers) {
      expect(o.priceCurrency).toBe("COP");
      expect(Number.isFinite(Number(o.price))).toBe(true);
      expect(o.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.priceValidUntil > NOW.toISOString().slice(0, 10)).toBe(true);
      expect(o.itemOffered["@type"]).toBe("Service");
    }
  });

  it("precios y comisión salen del catálogo real", () => {
    expect(offers[0].price).toBe("0");
    expect(offers[1].price).toBe("0");
    expect(offers[1].description).toContain(`${FREE_COMMISSION_PCT} %`);
    expect(offers[2].price).toBe(String(INSTITUTION_PLANS.small.annualCOP));
    expect(offers[3].price).toBe(String(INSTITUTION_PLANS.large.annualCOP));
  });

  it("la vigencia del precio nunca queda en el pasado", () => {
    expect(priceValidUntil(new Date("2026-11-02T00:00:00Z"))).toBe("2027-12-31");
    expect(priceValidUntil(new Date("2027-01-01T00:00:00Z"))).toBe("2028-12-31");
  });
});

describe("landings de servicio", () => {
  const s = serviceLd({
    name: "Enfermería en Bogotá",
    description: "x",
    path: "/enfermeria-bogota",
    areaName: "Bogotá",
  });

  it("Service con image y oferta desde el turno mínimo real, sin conteos inventados", () => {
    expect(s["@type"]).toBe("Service");
    expect(s.image.length).toBeGreaterThan(0);
    expect(s.offers.price).toBe(String(MIN_BOOKING_COP));
    expect(s.offers.validFrom).toBeTruthy();
    expect(s.offers).not.toHaveProperty("offerCount");
    expect(s.offers).not.toHaveProperty("highPrice");
  });
});

describe("sin reseñas inventadas ni tipos que exijan reseñas", () => {
  it("no existe la ficha WebApplication (Google le exige aggregateRating)", () => {
    expect(seo).not.toHaveProperty("webApplicationLd");
  });

  it("ningún JSON-LD global declara calificaciones", () => {
    for (const d of [seo.organizationLd(), seo.websiteLd(), seo.localBusinessLd()]) {
      const flat = JSON.stringify(d);
      expect(flat).not.toContain("aggregateRating");
      expect(flat).not.toContain('"review"');
    }
  });

  it("ninguna ruta publica Product, AggregateOffer inventada ni og:image SVG", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory()
          ? walk(p)
          : /\.tsx?$/.test(f) && !/\.test\./.test(f)
            ? [p]
            : [];
      });
    for (const f of [...walk("src/routes"), ...walk("src/components"), ...walk("src/lib")]) {
      const src = readFileSync(f, "utf8");
      expect(src.includes('"@type": "Product"'), f).toBe(false);
      expect(src.includes("offerCount"), f).toBe(false);
      expect(/og\/[\w-]+\.svg/.test(src), f).toBe(false);
    }
  });
});
