// «Mi oferta de servicio»: lo que el profesional publica de sí mismo (`public.professional_service_offers`) y lo que ven las familias y las
// instituciones (`public.list_open_service_offers`, migración 20261013110000_professional_panel.sql).
//
// La base decide (RLS, moderación en el servidor, tope de 5 vigentes y «bloqueada» solo del personal); esto da el aviso al instante
// y explica los errores. Nada aquí manda teléfono ni dirección: la lista que ven los demás no los trae, el nombre llega abreviado sin
// sesión y el contacto se desbloquea según el plan (reglas de siempre). Los pagos se hacen solo en la página web.

import { z } from "zod";
import { cityKey } from "./marketplaceInsights";
import { normalizeText } from "./pqrsRules";
import {
  OFFER_ISSUE_MESSAGE,
  checkOfferText,
  offerIssueFromError,
  type OfferIssue,
} from "./contentModeration";
import {
  MODALITY_BOUNDS,
  MODALITY_LABEL,
  isOfferModality,
  type OfferModality,
} from "./institutionNegotiation";
import { STATUS_LABEL, type PinStatus } from "./liveMap";
import { formatCOP } from "./pricing";
import { distanceBandRank, trustFromColumns, type TrustSummary } from "./trustScore";

/** Máximo de ofertas de servicio vigentes (abiertas o en pausa) por profesional. Igual que el disparador de la base. */
export const MAX_ACTIVE_SERVICE_OFFERS = 5;

export type ServiceOfferStatus = "open" | "paused" | "closed";

export const SERVICE_STATUS_LABEL: Record<ServiceOfferStatus, string> = {
  open: "Publicada",
  paused: "En pausa",
  closed: "Cerrada",
};

// ─── Mis ofertas (la tabla, por RLS: solo las del profesional) ───────────────

export interface ServiceOfferRow {
  id: string;
  professional_id: string;
  title: string;
  description: string | null;
  specialty: string | null;
  modality: string;
  amount: number;
  city: string;
  available_from: string;
  available_until: string | null;
  status: string;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export interface MyServiceOffer {
  id: string;
  title: string;
  description: string;
  specialty: string;
  modality: OfferModality;
  amount: number;
  city: string;
  availableFrom: string;
  availableUntil: string | null;
  status: ServiceOfferStatus;
  /** Bloqueada por el equipo de Humanix: el profesional no la puede reabrir. */
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  /** ¿Se está mostrando ahora a familias e instituciones? (abierta, no bloqueada y vigente) */
  visible: boolean;
}

const isStatus = (v: unknown): v is ServiceOfferStatus =>
  v === "open" || v === "paused" || v === "closed";

export function normalizeMyOfferRow(r: ServiceOfferRow, now = Date.now()): MyServiceOffer {
  const status: ServiceOfferStatus = isStatus(r.status) ? r.status : "closed";
  const until = r.available_until ? new Date(r.available_until).getTime() : null;
  const expired = until != null && Number.isFinite(until) && until <= now;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    specialty: r.specialty ?? "",
    modality: isOfferModality(r.modality) ? r.modality : "hour",
    amount: r.amount,
    city: r.city,
    availableFrom: r.available_from,
    availableUntil: r.available_until,
    status,
    blocked: Boolean(r.blocked),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    visible: status === "open" && !r.blocked && !expired,
  };
}

/** Vigentes: las que cuentan para el tope (abiertas o en pausa). */
export function countActiveServiceOffers(offers: Array<Pick<MyServiceOffer, "status">>): number {
  return offers.filter((o) => o.status === "open" || o.status === "paused").length;
}

/** Texto de la situación de una oferta propia, para la tarjeta. */
export function myOfferHeadline(o: MyServiceOffer, now = Date.now()): string {
  if (o.blocked) return "Bloqueada por Humanix: escríbenos por PQRS si crees que fue un error";
  if (o.status === "closed") return "Cerrada: ya no se muestra";
  if (o.status === "paused") return "En pausa: no se muestra hasta que la reanudes";
  const until = o.availableUntil ? new Date(o.availableUntil).getTime() : null;
  if (until != null && until <= now) return "Venció: ya no se muestra";
  return "Publicada: familias e instituciones la ven con tu Trust Score";
}

// ─── Formulario (react-hook-form + Zod) ──────────────────────────────────────

const TITLE_MIN = 5;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 800;
const SPECIALTY_MAX = 80;
const CITY_MIN = 2;
const CITY_MAX = 80;
/** Piso y techo absolutos del servidor (`amount BETWEEN 1000 AND 20000000`). */
const SERVER_AMOUNT = { min: 1_000, max: 20_000_000 } as const;

/** Fin del día (hora de Colombia, UTC−5) de una fecha `YYYY-MM-DD`, como instante. Cadena vacía o inválida → null. */
export function availableUntilToIso(date: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date ?? "").trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T23:59:59-05:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** La fecha `YYYY-MM-DD` (hora de Colombia) de un instante, para el campo de fecha del formulario. */
export function isoToBogotaDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t - 5 * 3_600_000).toISOString().slice(0, 10) : "";
}

export function amountRangeMessage(modality: OfferModality): string {
  const { floor, cap } = MODALITY_BOUNDS[modality];
  return `El valor ${MODALITY_LABEL[modality]} debe estar entre ${formatCOP(floor)} y ${formatCOP(cap)}.`;
}

/** Valida el formulario antes de enviarlo; la base vuelve a revisar todo (moderación incluida) al guardar. */
export function buildServiceOfferSchema(now = Date.now()) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(TITLE_MIN, `El título debe tener al menos ${TITLE_MIN} caracteres.`)
        .max(TITLE_MAX, `Máximo ${TITLE_MAX} caracteres.`),
      description: z.string().max(DESCRIPTION_MAX, `Máximo ${DESCRIPTION_MAX} caracteres.`),
      specialty: z.string().trim().max(SPECIALTY_MAX, `Máximo ${SPECIALTY_MAX} caracteres.`),
      modality: z.enum(["hour", "shift", "month", "package"]),
      amount: z
        .number({ error: "Escribe el valor de tu servicio." })
        .int("Escribe un valor en pesos, sin decimales.")
        .min(SERVER_AMOUNT.min, `El valor mínimo es ${formatCOP(SERVER_AMOUNT.min)}.`)
        .max(SERVER_AMOUNT.max, `El valor máximo es ${formatCOP(SERVER_AMOUNT.max)}.`),
      city: z
        .string()
        .trim()
        .min(CITY_MIN, "Indica la ciudad donde ofreces tu servicio.")
        .max(CITY_MAX, `Máximo ${CITY_MAX} caracteres.`),
      availableUntil: z.string(),
    })
    .superRefine((v, ctx) => {
      const { floor, cap } = MODALITY_BOUNDS[v.modality];
      if (Number.isFinite(v.amount) && (v.amount < floor || v.amount > cap)) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: amountRangeMessage(v.modality) });
      }
      if (v.availableUntil.trim()) {
        const iso = availableUntilToIso(v.availableUntil);
        if (!iso) {
          ctx.addIssue({
            code: "custom",
            path: ["availableUntil"],
            message: "Elige una fecha válida.",
          });
        } else if (new Date(iso).getTime() <= now) {
          ctx.addIssue({
            code: "custom",
            path: ["availableUntil"],
            message: "La fecha hasta la que ofreces tu servicio debe ser de hoy en adelante.",
          });
        }
      }
      // Moderación de primera línea, igual que el disparador de la base (ofensivo, venta de artículos, ajeno a salud/cuidado,
      // teléfonos, correos, enlaces, direcciones y datos de pago). Todos los textos juntos: «es de salud o cuidado» mira el conjunto.
      const check = checkOfferText([v.title, v.description, v.specialty], {
        requireCare: true,
        checkContact: true,
      });
      if (!check.ok) {
        const path =
          check.issue === "contact" || check.issue === "offtopic" ? "description" : "title";
        ctx.addIssue({ code: "custom", path: [path], message: check.message });
      }
    });
}

export type ServiceOfferFormValues = z.infer<ReturnType<typeof buildServiceOfferSchema>>;

export const EMPTY_SERVICE_OFFER_FORM: ServiceOfferFormValues = {
  title: "",
  description: "",
  specialty: "",
  modality: "hour",
  amount: 0,
  city: "",
  availableUntil: "",
};

/** Valores iniciales del formulario: los de una oferta existente, o los del perfil del profesional para una nueva. */
export function serviceOfferFormDefaults(
  existing: MyServiceOffer | null,
  profile?: { specialty?: string | null; city?: string | null; hourlyRate?: number | null },
): ServiceOfferFormValues {
  if (existing) {
    return {
      title: existing.title,
      description: existing.description,
      specialty: existing.specialty,
      modality: existing.modality,
      amount: existing.amount,
      city: existing.city,
      availableUntil: isoToBogotaDate(existing.availableUntil),
    };
  }
  return {
    ...EMPTY_SERVICE_OFFER_FORM,
    specialty: profile?.specialty?.trim() ?? "",
    city: profile?.city?.trim() ?? "",
    amount: profile?.hourlyRate && profile.hourlyRate > 0 ? Math.round(profile.hourlyRate) : 0,
  };
}

/** Lo que se manda a la tabla (sin dueño ni estado: el dueño lo fija la política y el estado empieza «abierta»). */
export function toServiceOfferPayload(v: ServiceOfferFormValues) {
  return {
    title: v.title.trim(),
    description: v.description.trim() || null,
    specialty: v.specialty.trim() || null,
    modality: v.modality,
    amount: v.amount,
    city: v.city.trim(),
    available_until: availableUntilToIso(v.availableUntil),
  };
}

// ─── Errores del servidor → mensaje para la persona ──────────────────────────

export interface ServerErrorLike {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}

export const SERVICE_OFFER_LIMIT_MESSAGE = `Ya tienes ${MAX_ACTIVE_SERVICE_OFFERS} ofertas de servicio vigentes. Cierra o elimina una para publicar otra.`;

export type ServiceOfferErrorKind =
  | OfferIssue
  | "limit"
  | "review"
  | "forbidden"
  | "invalid"
  | "other";

export function classifyServiceOfferError(err: ServerErrorLike | null | undefined): {
  kind: ServiceOfferErrorKind;
  message: string;
} {
  const issue = offerIssueFromError(err);
  if (issue) return { kind: issue, message: OFFER_ISSUE_MESSAGE[issue] };
  const msg = err?.message ?? "";
  if (
    (err?.hint ?? "") === "service_offer_limit" ||
    /ya tienes \d+ ofertas de servicio/i.test(msg)
  ) {
    return { kind: "limit", message: SERVICE_OFFER_LIMIT_MESSAGE };
  }
  if (/cuenta est[aá] en revisi[oó]n/i.test(msg)) {
    return {
      kind: "review",
      message:
        "Tu cuenta está en revisión: por ahora no puedes publicar ofertas. Escríbenos por PQRS.",
    };
  }
  if (err?.code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return {
      kind: "forbidden",
      message: "Solo los profesionales con sesión iniciada pueden publicar una oferta de servicio.",
    };
  }
  if (err?.code === "23514" || err?.code === "23502") {
    return { kind: "invalid", message: "Revisa los datos de tu oferta: alguno no es válido." };
  }
  return { kind: "other", message: msg || "No pudimos guardar tu oferta. Inténtalo de nuevo." };
}

// ─── Lo que ven las familias y las instituciones ─────────────────────────────

/** Fila que devuelve `public.list_open_service_offers()` (sin teléfono ni dirección). */
export interface ServiceOfferFeedRow {
  offer_id: string;
  professional_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_specialty: string | null;
  title: string;
  description: string | null;
  specialty: string | null;
  modality: string;
  amount: number;
  city: string;
  available_from: string;
  available_until: string | null;
  created_at: string;
  avg_rating: number | string | null;
  total_jobs: number | null;
  rethus_verified: boolean | null;
  verified: boolean | null;
  trust_score: number | null;
  trust_level: string | null;
  trust_enough: boolean | null;
  availability_status: string | null;
  live: boolean | null;
  distance_band_km: number | null;
}

export interface ServiceOffer {
  id: string;
  professionalId: string;
  name: string;
  avatarUrl: string | null;
  profileSpecialty: string | null;
  title: string;
  description: string;
  specialty: string;
  modality: OfferModality;
  amount: number;
  city: string;
  availableFrom: string;
  availableUntil: string | null;
  createdAt: string;
  /** Promedio de estrellas (null mientras no tenga calificaciones) y servicios completados. */
  rating: { stars: number | null; jobs: number };
  rethusVerified: boolean;
  verified: boolean;
  /** Trust Score del profesional: el de la validación con IA («Sin validar» mientras no exista). */
  trust: TrustSummary;
  availability: PinStatus;
  live: boolean;
  /** Tope del rango de cercanía (2, 5, 10, 20, 50 o 100); null si no se puede medir. */
  distanceBand: number | null;
}

const asStatus = (v: string | null | undefined): PinStatus =>
  v === "available" || v === "busy" ? v : "unavailable";

export function normalizeServiceOfferRow(r: ServiceOfferFeedRow): ServiceOffer {
  const stars = r.avg_rating == null ? null : Number(r.avg_rating);
  return {
    id: r.offer_id,
    professionalId: r.professional_id,
    name: (r.display_name ?? "").trim() || "Profesional de la salud",
    avatarUrl: r.avatar_url,
    profileSpecialty: r.profile_specialty,
    title: r.title,
    description: r.description ?? "",
    specialty: (r.specialty ?? "").trim() || (r.profile_specialty ?? "").trim(),
    modality: isOfferModality(r.modality) ? r.modality : "hour",
    amount: r.amount,
    city: r.city,
    availableFrom: r.available_from,
    availableUntil: r.available_until,
    createdAt: r.created_at,
    rating: {
      stars: stars != null && Number.isFinite(stars) && stars > 0 ? stars : null,
      jobs: Math.max(0, r.total_jobs ?? 0),
    },
    rethusVerified: Boolean(r.rethus_verified),
    verified: Boolean(r.verified),
    trust: trustFromColumns(r.trust_score, r.trust_level, r.trust_enough, r.verified),
    availability: asStatus(r.availability_status),
    live: Boolean(r.live),
    distanceBand: r.distance_band_km ?? null,
  };
}

/** Valor por hora, solo cuando la oferta es por hora (por turno, mes o paquete no tienen equivalente honesto sin conocer las horas). */
export function serviceOfferHourly(o: Pick<ServiceOffer, "modality" | "amount">): number | null {
  return o.modality === "hour" ? o.amount : null;
}

export function serviceOfferPriceLabel(o: Pick<ServiceOffer, "modality" | "amount">): string {
  return `${formatCOP(o.amount)} ${MODALITY_LABEL[o.modality]}`;
}

export interface ServiceOfferFilters {
  query: string;
  city: string;
  modality: OfferModality | "all";
  /** Solo los que están disponibles ahora (no ocupados ni fuera de servicio). */
  availableOnly: boolean;
  /** Solo con RETHUS verificado. */
  rethusOnly: boolean;
  /** Valor por hora máximo; las ofertas que no son por hora no se descartan. */
  maxHourly: number | null;
  /** nearest = más cerca · trust = mayor Trust Score · rating = mejor calificados · price = más económicos por hora · recent = más nuevas. */
  sort: "nearest" | "trust" | "rating" | "price" | "recent";
}

export const DEFAULT_SERVICE_FILTERS: ServiceOfferFilters = {
  query: "",
  city: "",
  modality: "all",
  availableOnly: false,
  rethusOnly: false,
  maxHourly: null,
  sort: "nearest",
};

export function hasActiveServiceFilters(f: ServiceOfferFilters): boolean {
  return (
    f.query !== "" ||
    f.city !== "" ||
    f.modality !== "all" ||
    f.availableOnly ||
    f.rethusOnly ||
    f.maxHourly != null
  );
}

const AVAILABILITY_RANK: Record<PinStatus, number> = { available: 0, busy: 1, unavailable: 2 };
/** null va siempre al final, también al ordenar de menor a mayor. */
const desc = (v: number | null | undefined) => (v == null ? Number.NEGATIVE_INFINITY : v);
const asc = (v: number | null | undefined) => (v == null ? Number.POSITIVE_INFINITY : v);

export function applyServiceOfferFilters(
  items: ServiceOffer[],
  f: ServiceOfferFilters,
): ServiceOffer[] {
  const q = normalizeText(f.query);
  const city = cityKey(f.city);
  const out = items.filter((o) => {
    if (city && cityKey(o.city) !== city) return false;
    if (f.modality !== "all" && o.modality !== f.modality) return false;
    if (
      q &&
      !normalizeText(
        `${o.title} ${o.name} ${o.specialty} ${o.profileSpecialty ?? ""} ${o.description}`,
      ).includes(q)
    ) {
      return false;
    }
    if (f.availableOnly && o.availability !== "available") return false;
    if (f.rethusOnly && !o.rethusVerified) return false;
    if (f.maxHourly != null) {
      const h = serviceOfferHourly(o);
      if (h != null && h > f.maxHourly) return false;
    }
    return true;
  });

  const byTrust = (a: ServiceOffer, b: ServiceOffer) => desc(b.trust.score) - desc(a.trust.score);
  const byRating = (a: ServiceOffer, b: ServiceOffer) =>
    desc(b.rating.stars) - desc(a.rating.stars) || b.rating.jobs - a.rating.jobs;
  switch (f.sort) {
    case "nearest":
      // Por rango de distancia; dentro del mismo rango, disponibles primero, luego el mejor Trust Score y la mejor calificación.
      return [...out].sort(
        (a, b) =>
          distanceBandRank(a.distanceBand) - distanceBandRank(b.distanceBand) ||
          AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] ||
          byTrust(a, b) ||
          byRating(a, b),
      );
    case "trust":
      return [...out].sort((a, b) => byTrust(a, b) || byRating(a, b));
    case "rating":
      return [...out].sort((a, b) => byRating(a, b) || byTrust(a, b));
    case "price":
      return [...out].sort(
        (a, b) => asc(serviceOfferHourly(a)) - asc(serviceOfferHourly(b)) || byTrust(a, b),
      );
    case "recent":
      return [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    default:
      return out;
  }
}

export function distinctServiceOfferCities(offers: ServiceOffer[]): string[] {
  const seen = new Map<string, string>();
  for (const o of offers) {
    const key = cityKey(o.city);
    if (key && !seen.has(key)) seen.set(key, o.city);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
}

export interface ServiceOfferSummary {
  total: number;
  available: number;
  live: number;
  /** El valor por hora más bajo y más alto entre las que son por hora. */
  hourly: { min: number; max: number } | null;
  nearestBand: number | null;
}

export function summarizeServiceOffers(offers: ServiceOffer[]): ServiceOfferSummary {
  const hourly = offers.map(serviceOfferHourly).filter((h): h is number => h != null);
  const bands = offers.map((o) => o.distanceBand).filter((b): b is number => b != null);
  return {
    total: offers.length,
    available: offers.filter((o) => o.availability === "available").length,
    live: offers.filter((o) => o.live).length,
    hourly: hourly.length ? { min: Math.min(...hourly), max: Math.max(...hourly) } : null,
    nearestBand: bands.length ? Math.min(...bands) : null,
  };
}

export const AVAILABILITY_LABEL = STATUS_LABEL;
