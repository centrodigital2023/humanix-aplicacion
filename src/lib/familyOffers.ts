// Ofertas publicadas por las familias, vistas por el profesional (`public.list_open_family_offers`, migración 20261013110000).
//
// Se adaptan al mismo modelo que las ofertas de instituciones (`InstitutionOffer`) para reutilizar la compatibilidad explicable,
// los filtros, el orden («más cerca de ti», «mejor pago por hora») y la postulación con valor propuesto. Lo único que cambia es
// quién publica (`party: "family"`) y lo que de verdad existe: una oferta de familia no trae turnos, así que su horario se
// coordina al aceptar.
//
// Seguridad: el servidor ya filtró lo privado — no viajan teléfono ni dirección (la descripción llega con los datos de contacto
// tachados y el nombre abreviado, «Ana G.»). La postulación, el valor propuesto (0,8×–2× del publicado, plan Esencial o superior),
// el contacto (`reveal_offer_contact`) y la reserva siguen siendo los mismos que para las instituciones: aquí solo se presenta.

import {
  PARTY_COPY,
  hourlyEquivalent,
  normalizeOfferRow,
  type InstitutionOffer,
  type InstitutionOfferRow,
  type RankedOffer,
} from "./institutionOffers";

/** Fila que devuelve `public.list_open_family_offers()` (v2). */
export interface FamilyOfferRow {
  offer_id: string;
  family_user_id: string;
  display_name: string | null;
  title: string;
  description: string | null;
  city: string | null;
  specialty_required: string | null;
  requirements: string[] | null;
  modality: string;
  amount: number;
  is_urgent: boolean | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  my_application_id: string | null;
  my_status: string | null;
  my_awaiting: string | null;
  my_amount: number | null;
  family_stars: number | string | null;
  family_ratings: number | null;
  family_completed: number | null;
  family_trust: number | null;
  family_trust_level: string | null;
  family_trust_enough: boolean | null;
  family_verified: boolean | null;
  distance_band_km: number | null;
}

/** La oferta de una familia en el modelo común. Sin turnos: el horario se acuerda al aceptar. */
export function normalizeFamilyOfferRow(r: FamilyOfferRow): InstitutionOffer {
  const asInstitutionRow: InstitutionOfferRow = {
    offer_id: r.offer_id,
    institution_user_id: r.family_user_id,
    institution_name: r.display_name,
    institution_type: null,
    institution_verified: r.family_verified,
    title: r.title,
    description: r.description,
    city: r.city,
    service_area: null,
    specialty_required: r.specialty_required,
    requirements: r.requirements,
    modality: r.modality,
    amount: r.amount,
    is_urgent: r.is_urgent,
    start_date: r.start_date,
    end_date: r.end_date,
    positions_total: 1,
    positions_filled: 0,
    shifts: [],
    created_at: r.created_at,
    lat: null,
    lng: null,
    my_application_id: r.my_application_id,
    my_status: r.my_status,
    my_awaiting: r.my_awaiting,
    my_amount: r.my_amount,
    rating_count: r.family_ratings,
    rating_avg: r.family_stars,
    completed_services: r.family_completed,
    institution_trust: r.family_trust,
    institution_trust_level: r.family_trust_level,
    institution_trust_enough: r.family_trust_enough,
    distance_band_km: r.distance_band_km,
  };
  const offer = normalizeOfferRow(asInstitutionRow);
  return {
    ...offer,
    party: "family",
    institutionName: (r.display_name ?? "").trim() || PARTY_COPY.family.name,
  };
}

export interface FamilyOfferSummary {
  /** Ofertas a las que aún puede postularse (sin cruces y sin postulación vigente). */
  open: number;
  urgent: number;
  /** Mejor valor por hora entre las que se pueden calcular (por hora, o por turno con agenda). */
  bestHourly: number | null;
  /** Rango de cercanía de la más cercana (2, 5, 10, 20, 50 o 100), si alguna trae ubicación. */
  nearestBand: number | null;
  /** Postulaciones vigentes de este profesional. */
  applied: number;
}

export function summarizeFamilyOffers(rows: RankedOffer[]): FamilyOfferSummary {
  const free = rows.filter((r) => !r.match.conflict && !r.offer.application);
  const hourly = free.map((r) => hourlyEquivalent(r.offer)).filter((h): h is number => h != null);
  const bands = free.map((r) => r.offer.distanceBand).filter((b): b is number => b != null);
  return {
    open: free.length,
    urgent: free.filter((r) => r.offer.urgent || r.urgency === "now" || r.urgency === "today")
      .length,
    bestHourly: hourly.length ? Math.max(...hourly) : null,
    nearestBand: bands.length ? Math.min(...bands) : null,
    applied: rows.filter((r) => r.offer.application).length,
  };
}
