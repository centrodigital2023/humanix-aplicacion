// Datos estructurados (schema.org) de los planes en /planes. Lógica pura y probada (`planSeo.test.ts`).
//
// Google Search Console marcaba los planes como «no válidos» para resultados enriquecidos: «Falta el campo "image"». Cada Product lleva
// ahora `image` (imágenes publicadas en humanix.lat: la de compartir 1200×630 y el logo cuadrado), `brand` y una oferta en COP.
import { FREE_COMMISSION_PCT, PLAN_CATALOG, type PlanKey } from "./plans";
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE_URL } from "./seo";

/** Imágenes rastreables para cada plan: horizontal (1200×630) y cuadrada (logo 1018×1024). */
export const PLAN_IMAGES = [SOCIAL_IMAGE_URL, `${SITE_URL}/logo-humanix.png`] as const;

/** Vigencia del precio publicada: fin del año siguiente al de la fecha dada (así nunca queda vencida en el buscador). */
export function priceValidUntil(now: Date = new Date()): string {
  return `${now.getUTCFullYear() + 1}-12-31`;
}

export const PLAN_LD_ITEMS: ReadonlyArray<{ key: PlanKey; description: string }> = [
  {
    key: "free",
    description: `Plan gratuito: busca, solicita y contrata. Comisión del ${FREE_COMMISSION_PCT} % al profesional.`,
  },
  {
    key: "essential_monthly",
    description: "Para familias: sin comisión, acuerdos digitales, bitácora y alertas.",
  },
  {
    key: "family_premium_monthly",
    description: "Para familias: seguimiento avanzado, círculo familiar y SOS.",
  },
  { key: "pro_monthly", description: "Para profesionales: 0 % de comisión, mejor visibilidad y ofertas." },
  {
    key: "pro_premium_monthly",
    description: "Para profesionales: prioridad alta, badge destacado y más IA.",
  },
  { key: "institution_monthly", description: "Para IPS y clínicas: multiusuario, vacantes, agenda y sedes." },
];

export function planProductLd(position: number, key: PlanKey, description: string, now: Date = new Date()) {
  const plan = PLAN_CATALOG[key];
  return {
    "@type": "ListItem",
    position,
    item: {
      "@type": "Product",
      name: `${SITE_NAME} ${plan.label}`,
      description,
      image: [...PLAN_IMAGES],
      brand: { "@type": "Brand", name: SITE_NAME },
      url: `${SITE_URL}/planes`,
      offers: {
        "@type": "Offer",
        price: String(plan.amountCOP),
        priceCurrency: "COP",
        availability: "https://schema.org/InStock",
        priceValidUntil: priceValidUntil(now),
        url: `${SITE_URL}/planes`,
      },
    },
  };
}

export function pricingProductLd(now: Date = new Date()) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Planes ${SITE_NAME}`,
    url: `${SITE_URL}/planes`,
    itemListElement: PLAN_LD_ITEMS.map((p, i) => planProductLd(i + 1, p.key, p.description, now)),
  };
}
