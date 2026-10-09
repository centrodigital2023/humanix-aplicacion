// Agenda de turnos de EPS / IPS / clínicas / hospitales / geriátricos vista por el profesional.
//
// Seguridad: el servidor (`list_open_institution_offers`) ya filtró lo privado — la dirección exacta, el
// teléfono y las notas de acceso NO viajan en estas filas; se obtienen con `reveal_offer_contact` (plan
// de pago, tras postularse) o aparecen en la reserva una vez aceptada. Aquí solo se normaliza, se puntúa
// de forma explicable y se presenta. Los pesos del puntaje son los mismos que en el hub de familias.

import { cityKey } from "./marketplaceInsights";
import { normalizeText } from "./pqrsRules";
import {
  bogotaDayKey,
  bogotaDayLabel,
  careFitText,
  formatShiftRange,
  hoursBetween,
  overlaps,
  urgencyOf,
  type MatchResult,
  type ProContext,
  type ProIntro,
  type Urgency,
} from "./opportunities";
import {
  contractTotal,
  isOfferModality,
  type ApplicationStatus,
  type OfferModality,
  type PartyRole,
} from "./institutionNegotiation";

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

// ─── Filas del servidor ──────────────────────────────────────────────────────

export interface OfferShiftRow {
  id: string;
  starts_at: string;
  ends_at: string;
  positions: number;
  filled: number;
}

/** Fila que devuelve `public.list_open_institution_offers()` (nunca trae dirección ni teléfono). */
export interface InstitutionOfferRow {
  offer_id: string;
  institution_user_id: string;
  institution_name: string | null;
  institution_type: string | null;
  institution_verified: boolean | null;
  title: string;
  description: string | null;
  city: string | null;
  service_area: string | null;
  specialty_required: string | null;
  requirements: string[] | null;
  modality: string;
  amount: number;
  is_urgent: boolean | null;
  start_date: string | null;
  end_date: string | null;
  positions_total: number | null;
  positions_filled: number | null;
  shifts: OfferShiftRow[] | null;
  created_at: string;
  lat: number | null;
  lng: number | null;
  my_application_id: string | null;
  my_status: string | null;
  my_awaiting: string | null;
  my_amount: number | null;
  rating_count: number | null;
  rating_avg: number | string | null;
  completed_services: number | null;
}

export interface InstitutionOffer {
  id: string;
  institutionId: string;
  institutionName: string;
  institutionType: string | null;
  verified: boolean;
  title: string;
  description: string | null;
  city: string;
  serviceArea: string | null;
  specialty: string | null;
  requirements: string[];
  modality: OfferModality;
  amount: number;
  urgent: boolean;
  /** Turnos abiertos con cupo, por orden de inicio. Vacío = oferta antigua sin agenda. */
  shifts: OfferShiftRow[];
  hasAgenda: boolean;
  firstStart: string | null;
  lastEnd: string | null;
  totalHours: number;
  positionsOpen: number;
  positionsTotal: number;
  createdAt: string;
  rating: { stars: number | null; ratings: number };
  completedServices: number;
  /** Postulación vigente (pendiente o aceptada) de este profesional, si existe. */
  application: {
    id: string;
    status: ApplicationStatus;
    awaiting: PartyRole;
    amount: number | null;
  } | null;
  /** Última postulación del profesional si ya se cerró (retirada, vencida o rechazada). */
  lastClosedStatus: ApplicationStatus | null;
}

const isStatus = (v: unknown): v is ApplicationStatus =>
  v === "pending" || v === "accepted" || v === "rejected" || v === "withdrawn";

export function normalizeOfferRow(r: InstitutionOfferRow): InstitutionOffer {
  const shifts = [...(r.shifts ?? [])].sort((a, b) => ms(a.starts_at) - ms(b.starts_at));
  const stars = r.rating_avg == null ? null : Number(r.rating_avg);
  const modality: OfferModality = isOfferModality(r.modality) ? r.modality : "shift";
  const status = isStatus(r.my_status) ? r.my_status : null;
  const active = status === "pending" || status === "accepted";
  const totalHours = shifts.reduce((n, s) => n + hoursBetween(s.starts_at, s.ends_at), 0);
  return {
    id: r.offer_id,
    institutionId: r.institution_user_id,
    institutionName: (r.institution_name ?? "").trim() || "Institución de salud",
    institutionType: r.institution_type,
    verified: Boolean(r.institution_verified),
    title: r.title,
    description: r.description,
    city: r.city ?? "",
    serviceArea: r.service_area,
    specialty: r.specialty_required,
    requirements: r.requirements ?? [],
    modality,
    amount: r.amount,
    urgent: Boolean(r.is_urgent),
    shifts,
    hasAgenda: shifts.length > 0,
    firstStart: shifts[0]?.starts_at ?? r.start_date,
    lastEnd: shifts.length ? shifts[shifts.length - 1].ends_at : r.end_date,
    totalHours: Math.round(totalHours * 100) / 100,
    positionsOpen: shifts.reduce((n, s) => n + Math.max(0, s.positions - s.filled), 0),
    positionsTotal: Math.max(0, r.positions_total ?? 0),
    createdAt: r.created_at,
    rating: {
      stars: stars != null && Number.isFinite(stars) ? stars : null,
      ratings: Math.max(0, r.rating_count ?? 0),
    },
    completedServices: Math.max(0, r.completed_services ?? 0),
    application:
      active && r.my_application_id
        ? {
            id: r.my_application_id,
            status,
            awaiting: r.my_awaiting === "professional" ? "professional" : "institution",
            amount: r.my_amount,
          }
        : null,
    lastClosedStatus: !active && status ? status : null,
  };
}

// ─── Valor y duración ────────────────────────────────────────────────────────

/**
 * Valor por hora equivalente para comparar con la tarifa del profesional. Solo existe cuando se puede
 * calcular de forma honesta: por hora (directo) o por turno con agenda. Mensual y paquete → null.
 */
export function hourlyEquivalent(offer: InstitutionOffer): number | null {
  if (offer.modality === "hour") return offer.amount;
  if (offer.modality === "shift" && offer.shifts.length > 0 && offer.totalHours > 0) {
    return Math.round((offer.amount * offer.shifts.length) / offer.totalHours);
  }
  return null;
}

/** Total estimado si el profesional cubre TODOS los turnos abiertos al valor publicado. */
export function estimatedOfferTotal(offer: InstitutionOffer, amount = offer.amount): number | null {
  if (offer.modality === "month" || offer.modality === "package") return amount;
  if (!offer.hasAgenda) return null;
  return contractTotal(
    offer.modality,
    amount,
    offer.shifts.map((s) => ({ hours: hoursBetween(s.starts_at, s.ends_at) })),
  );
}

// ─── Compatibilidad explicable ───────────────────────────────────────────────

export interface OfferMatch extends MatchResult {
  conflictingShiftIds: string[];
  freeShiftIds: string[];
}

const GENERAL_CARE_HOME = "Cuidado general en casa, abierto a varios perfiles";

export function scoreOffer(offer: InstitutionOffer, pro: ProContext): OfferMatch {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  // Ciudad (30)
  const city = cityKey(offer.city);
  const proCities = new Set(pro.cities.map((c) => cityKey(c)).filter(Boolean));
  if (!city) {
    score += 15;
  } else if (proCities.has(city)) {
    score += 30;
    reasons.push("Está en tu zona de servicio");
  } else {
    warnings.push("Fuera de tus ciudades de servicio");
  }

  // Especialidad (30)
  const fit = careFitText(
    `${offer.specialty ?? ""} ${offer.serviceArea ?? ""} ${offer.title}`,
    pro,
    "La institución no especificó la especialidad",
  );
  score += fit.points;
  if (fit.reason)
    reasons.push(
      fit.reason === GENERAL_CARE_HOME ? "Turno general, abierto a varios perfiles" : fit.reason,
    );
  if (fit.warning) warnings.push(fit.warning.replace("El tipo de cuidado", "El perfil pedido"));

  // Valor (20)
  const hourly = hourlyEquivalent(offer);
  if (hourly == null || pro.hourlyRate == null || pro.hourlyRate <= 0) {
    score += 10;
  } else {
    const ratio = hourly / pro.hourlyRate;
    if (ratio >= 1) {
      score += 20;
      reasons.push("Paga igual o más que tu tarifa");
    } else if (ratio >= 0.9) {
      score += 15;
      reasons.push(`Cerca de tu tarifa (${Math.round((1 - ratio) * 100)}% menos)`);
    } else if (ratio >= 0.75) {
      score += 8;
      warnings.push(
        `Paga ${Math.round((1 - ratio) * 100)}% menos que tu tarifa: puedes proponer otro valor`,
      );
    } else {
      warnings.push(
        `Paga ${Math.round((1 - ratio) * 100)}% menos que tu tarifa: negocia o déjala pasar`,
      );
    }
  }

  // Agenda (10)
  const conflictingShiftIds: string[] = [];
  const freeShiftIds: string[] = [];
  for (const s of offer.shifts) {
    const clash = pro.busy.some((b) =>
      overlaps(ms(s.starts_at), ms(s.ends_at), ms(b.start), ms(b.end)),
    );
    (clash ? conflictingShiftIds : freeShiftIds).push(s.id);
  }
  const conflict = offer.hasAgenda && freeShiftIds.length === 0;
  if (!offer.hasAgenda) {
    score += 5;
    warnings.push("Horario por coordinar con la institución");
  } else if (conflict) {
    warnings.push("Todos los turnos se cruzan con servicios que ya tienes confirmados");
  } else if (conflictingShiftIds.length > 0) {
    score += 5;
    warnings.push(
      `${conflictingShiftIds.length} de ${offer.shifts.length} turnos se cruzan con tu agenda: puedes postularte a los demás`,
    );
  } else {
    score += 10;
    reasons.push("Sin cruces con tu agenda");
  }

  // Confianza en la institución (10) — sin historial no se penaliza.
  let trust = 0;
  if (offer.verified) {
    trust += 4;
    reasons.push("Institución verificada por Humanix");
  } else {
    warnings.push("Institución aún sin verificar");
  }
  const { stars, ratings } = offer.rating;
  if (stars != null && ratings >= 3) {
    const txt = `${stars.toFixed(1)} · ${ratings} reseñas`;
    if (stars >= 4.5) {
      trust += 6;
      reasons.push(`Institución con excelente reputación (${txt})`);
    } else if (stars >= 4) {
      trust += 4;
      reasons.push(`Institución bien calificada (${txt})`);
    } else if (stars >= 3.5) {
      trust += 2;
    } else {
      warnings.push(`Institución con calificación baja (${txt})`);
    }
  } else {
    trust += 3;
  }
  score += Math.min(10, trust);

  if (conflict) score = Math.min(score, 40);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    score >= 80 ? "Excelente" : score >= 60 ? "Buena" : score >= 40 ? "Posible" : "Baja";
  return { score, label, reasons, warnings, conflict, conflictingShiftIds, freeShiftIds };
}

export interface RankedOffer {
  offer: InstitutionOffer;
  match: OfferMatch;
  urgency: Urgency;
}

const URGENCY_RANK: Record<Urgency, number> = { now: 0, today: 1, tomorrow: 2, week: 3, later: 4 };

export function rankOffers(
  offers: InstitutionOffer[],
  pro: ProContext,
  now = Date.now(),
): RankedOffer[] {
  return offers
    .map((offer) => ({
      offer,
      match: scoreOffer(offer, pro),
      urgency: offer.firstStart ? urgencyOf(offer.firstStart, now) : ("later" as Urgency),
    }))
    .sort(
      (a, b) =>
        Number(a.match.conflict) - Number(b.match.conflict) ||
        Number(b.offer.urgent) - Number(a.offer.urgent) ||
        b.match.score - a.match.score ||
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        ms(a.offer.firstStart) - ms(b.offer.firstStart),
    );
}

export interface OfferSummary {
  offers: number;
  shifts: number;
  hours: number;
  potentialEarnings: number;
  urgent: number;
  conflicts: number;
}

/** Resumen de lo que el profesional aún puede tomar (sin las ofertas a las que ya se postuló). */
export function summarizeOffers(rows: RankedOffer[]): OfferSummary {
  const free = rows.filter((r) => !r.match.conflict && !r.offer.application);
  return {
    offers: free.length,
    shifts: free.reduce((n, r) => n + r.match.freeShiftIds.length, 0),
    hours:
      Math.round(
        free.reduce(
          (n, r) =>
            n +
            r.offer.shifts
              .filter((s) => r.match.freeShiftIds.includes(s.id))
              .reduce((h, s) => h + hoursBetween(s.starts_at, s.ends_at), 0),
          0,
        ) * 100,
      ) / 100,
    potentialEarnings: free.reduce((n, r) => n + (estimatedOfferTotal(r.offer) ?? 0), 0),
    urgent: free.filter((r) => r.offer.urgent || r.urgency === "now" || r.urgency === "today")
      .length,
    conflicts: rows.filter((r) => r.match.conflict).length,
  };
}

// ─── Filtros y vista por día ─────────────────────────────────────────────────

export interface OfferFilters {
  city: string;
  query: string;
  modality: OfferModality | "all";
  /** Valor por hora equivalente mínimo; las ofertas sin equivalente no se descartan. */
  minHourly: number | null;
  urgentOnly: boolean;
  verifiedOnly: boolean;
  hideConflicts: boolean;
  hideApplied: boolean;
  sort: "match" | "soonest" | "pay";
}

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  city: "",
  query: "",
  modality: "all",
  minHourly: null,
  urgentOnly: false,
  verifiedOnly: false,
  hideConflicts: false,
  hideApplied: false,
  sort: "match",
};

export function applyOfferFilters(items: RankedOffer[], f: OfferFilters): RankedOffer[] {
  const q = normalizeText(f.query);
  const city = cityKey(f.city);
  const out = items.filter(({ offer, match, urgency }) => {
    if (city && cityKey(offer.city) !== city) return false;
    if (f.modality !== "all" && offer.modality !== f.modality) return false;
    if (
      q &&
      !normalizeText(
        `${offer.title} ${offer.institutionName} ${offer.specialty ?? ""} ${offer.serviceArea ?? ""} ${offer.description ?? ""}`,
      ).includes(q)
    ) {
      return false;
    }
    if (f.minHourly != null) {
      const h = hourlyEquivalent(offer);
      if (h != null && h < f.minHourly) return false;
    }
    if (f.urgentOnly && !offer.urgent && urgency !== "now" && urgency !== "today") return false;
    if (f.verifiedOnly && !offer.verified) return false;
    if (f.hideConflicts && match.conflict) return false;
    if (f.hideApplied && offer.application) return false;
    return true;
  });
  if (f.sort === "soonest") {
    return [...out].sort((a, b) => ms(a.offer.firstStart) - ms(b.offer.firstStart));
  }
  if (f.sort === "pay") {
    const pay = (r: RankedOffer) => estimatedOfferTotal(r.offer) ?? 0;
    return [...out].sort((a, b) => pay(b) - pay(a));
  }
  return out;
}

export function distinctOfferCities(offers: InstitutionOffer[]): string[] {
  const seen = new Map<string, string>();
  for (const o of offers) {
    const key = cityKey(o.city);
    if (key && !seen.has(key)) seen.set(key, o.city);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "es"));
}

export interface OfferDayGroup<T> {
  dayKey: string;
  label: string;
  items: T[];
}

/** Agrupa por el día (en Colombia) del primer turno; las ofertas sin agenda van al final. */
export function groupOffersByDay<T extends { offer: InstitutionOffer }>(
  items: T[],
): OfferDayGroup<T>[] {
  const groups = new Map<string, OfferDayGroup<T>>();
  const sorted = [...items].sort((a, b) => {
    const x = ms(a.offer.firstStart);
    const y = ms(b.offer.firstStart);
    if (Number.isNaN(x) && Number.isNaN(y)) return 0;
    if (Number.isNaN(x)) return 1;
    if (Number.isNaN(y)) return -1;
    return x - y;
  });
  for (const it of sorted) {
    const iso = it.offer.firstStart;
    const dayKey = iso ? bogotaDayKey(iso) : "";
    const key = dayKey || "sin-fecha";
    let g = groups.get(key);
    if (!g) {
      g = {
        dayKey: key,
        label: dayKey && iso ? bogotaDayLabel(iso) : "Horario por coordinar",
        items: [],
      };
      groups.set(key, g);
    }
    g.items.push(it);
  }
  return [...groups.values()];
}

/** Etiqueta corta de la postulación vigente para la tarjeta. */
export function applicationBadge(
  offer: InstitutionOffer,
): { label: string; tone: "ok" | "warn" | "muted" } | null {
  const a = offer.application;
  if (!a) {
    if (offer.lastClosedStatus === "rejected")
      return { label: "La institución respondió tu postulación", tone: "muted" };
    return null;
  }
  if (a.status === "accepted") return { label: "Aceptado: revisa tu reserva", tone: "ok" };
  return a.awaiting === "professional"
    ? { label: "Te respondieron: contraoferta pendiente", tone: "warn" }
    : { label: "Postulación enviada", tone: "muted" };
}

/**
 * Borrador del mensaje de postulación: breve, con lo que le importa a una institución (especialidad,
 * experiencia, verificación RETHUS y turnos) y sin datos de contacto ni de pago.
 */
export function buildOfferApplicationDraft(
  offer: Pick<InstitutionOffer, "title" | "institutionName"> & { shifts: OfferShiftRow[] },
  pro: ProIntro,
  selectedShiftIds?: string[],
): string {
  const first = (pro.name ?? "").trim().split(/\s+/)[0] || "un profesional";
  const chosen = selectedShiftIds?.length
    ? offer.shifts.filter((s) => selectedShiftIds.includes(s.id))
    : offer.shifts;
  const bits: string[] = [`Hola, soy ${first}`];
  if (pro.specialty) bits[0] += `, ${pro.specialty}`;
  if (pro.yearsExperience && pro.yearsExperience > 0) {
    bits[0] += ` con ${pro.yearsExperience} ${pro.yearsExperience === 1 ? "año" : "años"} de experiencia`;
  }
  bits[0] += pro.rethusVerified ? " y RETHUS verificado." : ".";
  bits.push(`Me interesa «${offer.title}» en ${offer.institutionName}.`);
  if (chosen.length === 1)
    bits.push(
      `Puedo cubrir el turno del ${formatShiftRange(chosen[0].starts_at, chosen[0].ends_at)}.`,
    );
  else if (chosen.length > 1) bits.push(`Puedo cubrir ${chosen.length} de los turnos publicados.`);
  bits.push("Quedo atento a su respuesta.");
  return bits.join(" ");
}
