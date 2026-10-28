// Mapas en vivo: filas de las funciones seguras de la base (`map_professionals`, `map_open_demand`, `map_institutions`,
// `get_live_counts`; migración 20261012210000_live_map.sql) → lo que pintan los mapas y las barras de contadores.
//
// La base decide qué se ve y con qué precisión (posición siempre en cuadrícula de ~1 km, sin teléfono ni dirección). Aquí solo se
// normalizan sus filas, se ordenan por cercanía y se traducen a textos. Nada de esto inventa posiciones: una cuenta sin ubicación
// no aparece como pin (sí cuenta en los totales).

import { distanceKm, type LatLng } from "./geo";
import { formatCOP } from "./pricing";
import { trustFromColumns, type TrustSummary } from "./trustScore";

export type PinStatus = "available" | "busy" | "unavailable";

/**
 * Estado documental de quien sale en el mapa (columna `verification_status`, migración 20261024120000_map_verification.sql):
 *  - "verified": documentos completos y validados → pin activo, se puede pedir o asignar.
 *  - "pending": documentos incompletos o en revisión → pin ámbar «Documentos pendientes», sin contratación directa.
 */
export type VerificationStatus = "verified" | "pending";

/** Normaliza la columna; si la base aún no la trae (migración sin aplicar), decide el respaldo que se le pase. */
export function verificationFrom(
  v: string | null | undefined,
  fallbackVerified: boolean,
): VerificationStatus {
  if (v === "verified" || v === "pending") return v;
  return fallbackVerified ? "verified" : "pending";
}

export const STATUS_LABEL: Record<PinStatus, string> = {
  available: "Disponible",
  busy: "Ocupado",
  unavailable: "No disponible",
};

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const status = (v: string | null | undefined): PinStatus =>
  v === "available" || v === "busy" ? v : "unavailable";

// ─── Profesionales ───────────────────────────────────────────────────────────

export interface MapProfessionalRow {
  pro_id: string;
  display_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  sub_specialties: string[] | null;
  gender: string | null;
  years_experience: number | null;
  hourly_rate: number | null;
  avg_rating: number | string | null;
  trust_score: number | null;
  rethus_verified: boolean | null;
  verified: boolean | null;
  home_city: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  live: boolean | null;
  last_seen: string | null;
  /** Opcional mientras la migración 20261024120000 no esté aplicada. */
  verification_status?: string | null;
}

export interface MapProfessional {
  id: string;
  name: string;
  avatarUrl: string | null;
  specialty: string | null;
  subSpecialties: string[];
  gender: string | null;
  yearsExperience: number | null;
  hourlyRate: number | null;
  rating: number | null;
  trust: TrustSummary;
  rethus: boolean;
  verified: boolean;
  city: string | null;
  lat: number | null;
  lng: number | null;
  status: PinStatus;
  live: boolean;
  lastSeen: string | null;
  verification: VerificationStatus;
}

export function fromProfessionalRow(r: MapProfessionalRow): MapProfessional {
  const rating = num(r.avg_rating);
  return {
    id: r.pro_id,
    name: r.display_name?.trim() || "Profesional",
    avatarUrl: r.avatar_url,
    specialty: r.specialty,
    subSpecialties: r.sub_specialties ?? [],
    gender: r.gender,
    yearsExperience: r.years_experience,
    hourlyRate: r.hourly_rate && r.hourly_rate > 0 ? r.hourly_rate : null,
    rating: rating != null && rating > 0 ? rating : null,
    // El puntaje del profesional es el de la validación con IA; 0 o vacío = aún sin validar.
    trust: trustFromColumns(
      r.trust_score && r.trust_score > 0 ? r.trust_score : null,
      null,
      true,
      r.verified || r.rethus_verified,
    ),
    rethus: !!r.rethus_verified,
    verified: !!r.verified,
    city: r.home_city,
    lat: r.lat,
    lng: r.lng,
    status: status(r.status),
    live: !!r.live,
    lastSeen: r.last_seen,
    verification: verificationFrom(r.verification_status, !!(r.verified || r.rethus_verified)),
  };
}

// ─── Demanda abierta (familias e instituciones con ofertas u horas) ──────────

export interface MapDemandRow {
  poster_id: string;
  poster_kind: string;
  display_name: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  open_offers: number | null;
  open_hours: number | string | null;
  top_hourly: number | null;
  is_urgent: boolean | null;
  offer_id: string | null;
  trust_score: number | null;
  trust_level: string | null;
  trust_enough: boolean | null;
  distance_band: number | null;
  verification_status?: string | null;
}

export interface MapDemand {
  id: string;
  kind: "family" | "institution";
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  openOffers: number;
  openHours: number;
  topHourly: number | null;
  urgent: boolean;
  /** La oferta más reciente (para abrirla); nulo si solo hay horas sueltas. */
  offerId: string | null;
  trust: TrustSummary;
  distanceBand: number | null;
  verification: VerificationStatus;
}

export function fromDemandRow(r: MapDemandRow): MapDemand {
  const kind = r.poster_kind === "institution" ? "institution" : "family";
  return {
    id: r.poster_id,
    kind,
    name: r.display_name?.trim() || (kind === "institution" ? "Institución" : "Familia"),
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    openOffers: Number(r.open_offers ?? 0),
    openHours: num(r.open_hours) ?? 0,
    topHourly: r.top_hourly && r.top_hourly > 0 ? r.top_hourly : null,
    urgent: !!r.is_urgent,
    offerId: r.offer_id,
    trust: trustFromColumns(r.trust_score, r.trust_level, r.trust_enough),
    distanceBand: r.distance_band,
    // Sin la columna no se sabe: no se marca a nadie como pendiente por una migración sin aplicar.
    verification: verificationFrom(r.verification_status, true),
  };
}

/** «2 ofertas · 3 h sueltas · hasta $24.000/h»: lo que hay abierto, sin repetir lo que vale cero. */
export function demandHeadline(
  d: Pick<MapDemand, "openOffers" | "openHours" | "topHourly">,
): string {
  const parts: string[] = [];
  if (d.openOffers > 0) parts.push(`${d.openOffers} ${d.openOffers === 1 ? "oferta" : "ofertas"}`);
  if (d.openHours > 0) {
    const h = d.openHours % 1 === 0 ? String(d.openHours) : d.openHours.toFixed(1);
    parts.push(`${h} h sueltas`);
  }
  if (d.topHourly != null) parts.push(`hasta ${formatCOP(d.topHourly)}/h`);
  return parts.join(" · ") || "Sin ofertas abiertas";
}

// ─── Instituciones ───────────────────────────────────────────────────────────

export interface MapInstitutionRow {
  inst_id: string;
  name: string | null;
  institution_type: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean | null;
  status: string | null;
  live: boolean | null;
  open_offers: number | null;
  verification_status?: string | null;
}

export type InstitutionStatus = "available" | "busy" | "idle";

export interface MapInstitution {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  status: InstitutionStatus;
  live: boolean;
  openOffers: number;
  verification: VerificationStatus;
}

export function fromInstitutionRow(r: MapInstitutionRow): MapInstitution {
  return {
    id: r.inst_id,
    name: r.name?.trim() || "Institución",
    type: r.institution_type,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    verified: !!r.verified,
    status: r.status === "available" || r.status === "busy" ? r.status : "idle",
    live: !!r.live,
    openOffers: Number(r.open_offers ?? 0),
    verification: verificationFrom(r.verification_status, !!r.verified),
  };
}

// ─── Contadores ──────────────────────────────────────────────────────────────

export interface LiveCountsRow {
  pro_total: number | string;
  pro_available: number | string;
  pro_busy: number | string;
  pro_live: number | string;
  pro_rethus: number | string;
  fam_total: number | string;
  fam_available: number | string;
  fam_busy: number | string;
  fam_live: number | string;
  inst_total: number | string;
  inst_available: number | string;
  inst_busy: number | string;
  inst_live: number | string;
  completed_services: number | string;
}

export interface RoleCounts {
  /** Registrados. */
  total: number;
  /** Profesionales: disponibles ahora. Familias e instituciones: con ofertas u horas abiertas. */
  available: number;
  /** Profesionales: con servicio o reserva ahora. Familias e instituciones: con un servicio en curso. */
  busy: number;
  /** Con la aplicación abierta en este momento. */
  live: number;
}

export interface LiveCounts {
  professionals: RoleCounts;
  families: RoleCounts;
  institutions: RoleCounts;
  /** Profesionales publicados con RETHUS verificado. */
  professionalsRethus: number;
  completedServices: number;
}

const n = (v: number | string | null | undefined): number => Math.max(0, num(v) ?? 0);

export const EMPTY_COUNTS: LiveCounts = {
  professionals: { total: 0, available: 0, busy: 0, live: 0 },
  families: { total: 0, available: 0, busy: 0, live: 0 },
  institutions: { total: 0, available: 0, busy: 0, live: 0 },
  professionalsRethus: 0,
  completedServices: 0,
};

export function countsFromRow(r: LiveCountsRow | null | undefined): LiveCounts {
  if (!r) return EMPTY_COUNTS;
  return {
    professionals: {
      total: n(r.pro_total),
      available: n(r.pro_available),
      busy: n(r.pro_busy),
      live: n(r.pro_live),
    },
    families: {
      total: n(r.fam_total),
      available: n(r.fam_available),
      busy: n(r.fam_busy),
      live: n(r.fam_live),
    },
    institutions: {
      total: n(r.inst_total),
      available: n(r.inst_available),
      busy: n(r.inst_busy),
      live: n(r.inst_live),
    },
    professionalsRethus: n(r.pro_rethus),
    completedServices: n(r.completed_services),
  };
}

/** Fila de la función antigua `get_platform_counts` (si la nueva aún no existe): sin «ocupados» y sin detalle de «disponibles». */
export interface LegacyCountsRow {
  professionals_total: number | string;
  professionals_available: number | string;
  professionals_rethus: number | string;
  professionals_online: number | string;
  families_total: number | string;
  families_online: number | string;
  institutions_total: number | string;
  institutions_online: number | string;
  completed_services: number | string;
}

export function countsFromLegacy(r: LegacyCountsRow | null | undefined): LiveCounts {
  if (!r) return EMPTY_COUNTS;
  return {
    professionals: {
      total: n(r.professionals_total),
      available: n(r.professionals_available),
      busy: 0,
      live: n(r.professionals_online),
    },
    families: { total: n(r.families_total), available: 0, busy: 0, live: n(r.families_online) },
    institutions: {
      total: n(r.institutions_total),
      available: 0,
      busy: 0,
      live: n(r.institutions_online),
    },
    professionalsRethus: n(r.professionals_rethus),
    completedServices: n(r.completed_services),
  };
}

export type CounterViewer = "professional" | "family" | "institution" | "guest";
export type CounterKey = "professionals" | "families" | "institutions";

export interface CounterItem extends RoleCounts {
  key: CounterKey;
  label: string;
  /** Qué significa «disponible» para este grupo. */
  availableLabel: string;
  busyLabel: string;
}

const ITEM_TEXT: Record<CounterKey, { label: string; availableLabel: string; busyLabel: string }> =
  {
    professionals: { label: "Profesionales", availableLabel: "disponibles", busyLabel: "ocupados" },
    families: { label: "Familias", availableLabel: "buscando cuidado", busyLabel: "con servicio" },
    institutions: {
      label: "Instituciones",
      availableLabel: "con ofertas abiertas",
      busyLabel: "con servicio",
    },
  };

/** Qué grupos mira cada quien: el profesional, a quien lo contrata; las familias y las instituciones, a los profesionales. */
export const COUNTER_KEYS: Record<CounterViewer, CounterKey[]> = {
  professional: ["families", "institutions"],
  family: ["professionals", "institutions"],
  institution: ["professionals", "institutions"],
  guest: ["professionals", "families", "institutions"],
};

export function counterItems(viewer: CounterViewer, counts: LiveCounts): CounterItem[] {
  return COUNTER_KEYS[viewer].map((key) => ({ key, ...ITEM_TEXT[key], ...counts[key] }));
}

// ─── Orden y filtros ─────────────────────────────────────────────────────────

export interface Positioned {
  lat: number | null;
  lng: number | null;
}

export function hasPosition<T extends Positioned>(p: T): p is T & { lat: number; lng: number } {
  return p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Lo que se puede pintar como pin: solo con posición (nunca una inventada alrededor del centro de la ciudad). */
export function withPosition<T extends Positioned>(
  list: T[],
): Array<T & { lat: number; lng: number }> {
  return list.filter(hasPosition);
}

/** Separación de los pines que caen en la misma celda (~110 m): siguen dentro de su cuadrícula de ~1 km. */
export const COLOCATED_SPREAD_DEG = 0.001;

/**
 * Varias cuentas en la misma celda llegan con la misma posición exacta y un pin tapa al otro (pasó con dos profesionales de
 * Buesaco). Se reparten en un círculo pequeño alrededor de la celda, en orden estable por id, para que se vean todos. Una sola en
 * su celda queda donde está.
 */
export function spreadColocated<T extends { id: string; lat: number; lng: number }>(
  list: readonly T[],
  radiusDeg = COLOCATED_SPREAD_DEG,
): T[] {
  const groups = new Map<string, T[]>();
  for (const p of list) {
    const key = `${p.lat},${p.lng}`;
    const g = groups.get(key);
    if (g) g.push(p);
    else groups.set(key, [p]);
  }
  const moved = new Map<T, T>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / sorted.length;
      moved.set(p, {
        ...p,
        lat: p.lat + radiusDeg * Math.sin(angle),
        lng: p.lng + radiusDeg * Math.cos(angle),
      });
    });
  }
  return list.map((p) => moved.get(p) ?? p);
}

const STATUS_RANK: Record<PinStatus, number> = { available: 0, busy: 1, unavailable: 2 };

/** Más cercano primero (si hay punto de partida); sin posición, al final. Disponible antes que ocupado a igual distancia. */
export function sortProfessionals<T extends MapProfessional>(
  list: readonly T[],
  origin: LatLng | null,
): T[] {
  const km = (p: MapProfessional) =>
    origin && hasPosition(p) ? distanceKm(origin, p) : Number.POSITIVE_INFINITY;
  return [...list].sort(
    (a, b) =>
      Number(b.live) - Number(a.live) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      km(a) - km(b) ||
      (b.rating ?? 0) - (a.rating ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function kmTo(origin: LatLng | null, p: Positioned): number | null {
  return origin && hasPosition(p) ? distanceKm(origin, p) : null;
}

export interface StatusSummary {
  total: number;
  available: number;
  busy: number;
  unavailable: number;
  live: number;
  withoutPosition: number;
}

export function summarizeProfessionals(list: MapProfessional[]): StatusSummary {
  const s: StatusSummary = {
    total: list.length,
    available: 0,
    busy: 0,
    unavailable: 0,
    live: 0,
    withoutPosition: 0,
  };
  for (const p of list) {
    s[p.status] += 1;
    if (p.live) s.live += 1;
    if (!hasPosition(p)) s.withoutPosition += 1;
  }
  return s;
}
