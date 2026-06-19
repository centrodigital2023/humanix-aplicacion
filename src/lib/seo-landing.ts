import { SITE_URL, SITE_NAME, SOCIAL_IMAGE_URL } from "@/lib/seo";

/** Catálogo de ciudades atendidas para landings SEO locales. */
export const CITIES = [
  { slug: "bogota", name: "Bogotá", region: "Cundinamarca" },
  { slug: "medellin", name: "Medellín", region: "Antioquia" },
  { slug: "cali", name: "Cali", region: "Valle del Cauca" },
  { slug: "barranquilla", name: "Barranquilla", region: "Atlántico" },
  { slug: "cartagena", name: "Cartagena", region: "Bolívar" },
  { slug: "bucaramanga", name: "Bucaramanga", region: "Santander" },
  { slug: "pereira", name: "Pereira", region: "Risaralda" },
] as const;

/** Catálogo de especialidades para landings de servicio. */
export const SPECIALTIES = [
  {
    slug: "cuidado-adulto-mayor",
    title: "Cuidado de Adulto Mayor a Domicilio",
    short: "Adulto mayor",
    keyword: "cuidado adulto mayor",
  },
  {
    slug: "cuidado-postoperatorio",
    title: "Cuidado Postoperatorio en Casa",
    short: "Postoperatorio",
    keyword: "cuidado postoperatorio",
  },
  {
    slug: "cuidado-pediatrico",
    title: "Cuidado Pediátrico Domiciliario",
    short: "Pediátrico",
    keyword: "enfermería pediátrica a domicilio",
  },
  {
    slug: "cuidado-paliativo",
    title: "Cuidado Paliativo en Casa",
    short: "Paliativo",
    keyword: "cuidados paliativos a domicilio",
  },
  {
    slug: "enfermeria-domiciliaria",
    title: "Enfermería Domiciliaria 24/7",
    short: "Enfermería 24/7",
    keyword: "enfermería domiciliaria",
  },
  {
    slug: "cuidador-domicilio",
    title: "Cuidador a Domicilio Verificado",
    short: "Cuidador",
    keyword: "cuidador a domicilio",
  },
  {
    slug: "auxiliar-enfermeria",
    title: "Auxiliar de Enfermería a Domicilio",
    short: "Auxiliar",
    keyword: "auxiliar de enfermería",
  },
] as const;

/** Construye JSON-LD `Service` para una landing de especialidad o ciudad. */
export function serviceLd(opts: {
  name: string;
  description: string;
  path: string;
  areaName?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    serviceType: opts.name,
    description: opts.description,
    provider: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
    areaServed: opts.areaName
      ? { "@type": "City", name: opts.areaName }
      : { "@type": "Country", name: "Colombia" },
    url: `${SITE_URL}${opts.path}`,
    image: SOCIAL_IMAGE_URL,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "COP",
      lowPrice: "25000",
      highPrice: "3500000",
      offerCount: "120",
    },
  } as const;
}

/** Construye JSON-LD `Article` para entradas de blog/recursos. */
export function articleLd(opts: {
  title: string;
  description: string;
  path: string;
  datePublished: string;
  dateModified?: string;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.title,
    description: opts.description,
    image: opts.image ?? SOCIAL_IMAGE_URL,
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/favicon.ico` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}${opts.path}` },
  } as const;
}