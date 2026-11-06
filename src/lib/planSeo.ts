// Datos estructurados (schema.org) de los planes en /planes. Lógica pura y probada (`planSeo.test.ts`).
//
// Humanix vende un servicio (cuidado a domicilio y una plataforma), no un producto físico. Antes cada plan era un `Product` y Google
// lo trataba como ficha de comerciante: pedía image, GTIN o marca, shippingDetails, hasMerchantReturnPolicy, aggregateRating y
// review (Search Console, 6 nov 2026). Ahora /planes publica un `Service` con un catálogo de ofertas (`OfferCatalog`): sin envíos,
// sin devoluciones de mercancía, sin código de barras y sin reseñas inventadas. Cada oferta lleva vigencia (`validFrom`,
// `priceValidUntil`) y su precio sale del catálogo real.
import { FREE_COMMISSION_PCT, PLAN_CATALOG, type PlanKey } from "./plans";
import { INSTITUTION_PLANS } from "./commissionMatrix";
import {
  PRICES_VALID_FROM,
  SITE_IMAGES,
  SITE_NAME,
  SITE_URL,
  priceValidUntil,
  providerRef,
} from "./seo";

/** Imágenes rastreables de los planes (las del sitio: 1200×630 y logo cuadrado). */
export const PLAN_IMAGES = SITE_IMAGES;
export { priceValidUntil };

export const PLAN_LD_ITEMS: ReadonlyArray<{ key: PlanKey; description: string }> = [
  {
    key: "family_premium_monthly",
    description:
      "Para familias: gratis y sin comisión. Paga tus turnos con Bre-B o en efectivo; círculo familiar, alertas y SOS.",
  },
  {
    key: "pro_monthly",
    description: `Para profesionales: sin mensualidad, comisión desde ${FREE_COMMISSION_PCT} % que baja con tus turnos y pago a tu llave Bre-B.`,
  },
  {
    key: "institution_monthly",
    description:
      "Para IPS y clínicas: plan anual por tamaño de sede, multiusuario, agenda inteligente y monitoreo a escala.",
  },
];

type OfferInput = { name: string; description: string; price: number; billing?: "year" };

/** Una oferta del catálogo: el plan es un `Service` ofrecido por Humanix, nunca un `Product`. */
export function planOfferLd(o: OfferInput, now: Date = new Date()) {
  return {
    "@type": "Offer",
    name: o.name,
    description: o.description,
    url: `${SITE_URL}/planes`,
    price: String(o.price),
    priceCurrency: "COP",
    ...(o.billing === "year"
      ? {
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: o.price,
            priceCurrency: "COP",
            unitCode: "ANN",
            unitText: "año",
          },
        }
      : {}),
    availability: "https://schema.org/InStock",
    validFrom: PRICES_VALID_FROM,
    priceValidUntil: priceValidUntil(now),
    seller: { "@id": `${SITE_URL}/#organization` },
    itemOffered: {
      "@type": "Service",
      name: o.name,
      description: o.description,
      provider: { "@id": `${SITE_URL}/#organization` },
    },
  } as const;
}

/** Ofertas publicadas: Familia ($0), Profesional ($0 de mensualidad) e Institución por tamaño de sede (pago anual). */
export function planOffers(now: Date = new Date()) {
  const desc = Object.fromEntries(PLAN_LD_ITEMS.map((p) => [p.key, p.description])) as Record<
    PlanKey,
    string
  >;
  const label = (k: PlanKey) => `${SITE_NAME} ${PLAN_CATALOG[k].label}`;
  return [
    planOfferLd(
      {
        name: label("family_premium_monthly"),
        description: desc.family_premium_monthly,
        price: PLAN_CATALOG.family_premium_monthly.amountCOP,
      },
      now,
    ),
    planOfferLd(
      {
        name: label("pro_monthly"),
        description: desc.pro_monthly,
        price: PLAN_CATALOG.pro_monthly.amountCOP,
      },
      now,
    ),
    ...(["small", "large"] as const).map((size) =>
      planOfferLd(
        {
          name: `${label("institution_monthly")} · ${INSTITUTION_PLANS[size].label}`,
          description: `${desc.institution_monthly} ${INSTITUTION_PLANS[size].pct} % de comisión al profesional.`,
          price: INSTITUTION_PLANS[size].annualCOP,
          billing: "year",
        },
        now,
      ),
    ),
  ];
}

/** JSON-LD de /planes: un `Service` con su catálogo de planes. */
export function pricingServiceLd(now: Date = new Date()) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${SITE_URL}/planes#service`,
    name: `Planes ${SITE_NAME}`,
    serviceType: "Plataforma de cuidado a domicilio y talento humano en salud",
    description:
      "Planes de Humanix para familias, profesionales de la salud e instituciones en Colombia. Pagos con Bre-B o en efectivo.",
    url: `${SITE_URL}/planes`,
    image: [...SITE_IMAGES],
    brand: { "@type": "Brand", name: SITE_NAME },
    provider: providerRef(),
    areaServed: { "@type": "Country", name: "Colombia" },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `Planes ${SITE_NAME}`,
      itemListElement: planOffers(now),
    },
  } as const;
}
