// Del panel a la lista comparable: junta propuestas y postulaciones pendientes con lo que se sabe de cada profesional
// y de la historia de la familia con él, en el formato que entiende `rankApplicants`. Puro: no consulta nada.

import type { Applicant } from "./applicantRanking";
import { distanceKm } from "./geo";
import { msOf, numOrNull } from "./intelShared";

export interface ProposalSource {
  id: string;
  professional_id: string;
  status: string;
  /** «family» o «professional»: solo importan las que llegan de un profesional. */
  proposed_by: string;
  hourly_rate: number | string | null;
  posted_rate: number | string | null;
  created_at: string | null;
  expires_at: string | null;
  peer_name?: string | null;
}

export interface ApplicationSource {
  id: string;
  professional_id: string;
  status: string;
  created_at: string | null;
  proposed_amount: number | string | null;
  job_offer_id: string;
}

export interface OfferSource {
  id: string;
  amount: number | string | null;
  /** hour · shift · month · package */
  modality: string | null;
}

/** Lo que muestra el perfil público (directorio seguro: `public.public_professionals`). */
export interface ProFacts {
  user_id: string;
  avg_rating: number | string | null;
  total_jobs: number | string | null;
  trust_score: number | string | null;
  rethus_verified: boolean | null;
  verified: boolean | null;
  years_experience: number | string | null;
  available: boolean | null;
  lat: number | string | null;
  lng: number | string | null;
}

/** Primer nombre, para hablarle a la familia sin exponer el nombre completo de nadie. */
export function firstName(full: string | null | undefined): string | null {
  const t = (full ?? "").trim().split(/\s+/)[0];
  return t ? t : null;
}

export function buildApplicants(args: {
  proposals: ProposalSource[];
  applications: ApplicationSource[];
  offers: OfferSource[];
  facts: Record<string, ProFacts | undefined>;
  names: Record<string, string | null | undefined>;
  teamIds: Iterable<string>;
  /** Servicios terminados de la familia con cada profesional. */
  completedWith: Record<string, number | undefined>;
  origin: { lat: number | null; lng: number | null };
  now: number;
}): Applicant[] {
  const team = new Set(args.teamIds);
  const offers = new Map(args.offers.map((o) => [o.id, o]));
  const out: Applicant[] = [];

  const common = (professionalId: string, fallbackName: string | null) => {
    const f = args.facts[professionalId];
    const lat = numOrNull(f?.lat);
    const lng = numOrNull(f?.lng);
    const km =
      args.origin.lat !== null && args.origin.lng !== null && lat !== null && lng !== null
        ? distanceKm({ lat: args.origin.lat, lng: args.origin.lng }, { lat, lng })
        : null;
    return {
      professionalId,
      name: firstName(args.names[professionalId]) ?? firstName(fallbackName),
      avgRating: numOrNull(f?.avg_rating),
      totalJobs: numOrNull(f?.total_jobs),
      trustScore: numOrNull(f?.trust_score),
      rethusVerified: f?.rethus_verified ?? null,
      verified: f?.verified ?? null,
      yearsExperience: numOrNull(f?.years_experience),
      available: f?.available ?? null,
      km,
      inTeam: team.has(professionalId),
      servicesTogether: Math.max(0, Math.floor(args.completedWith[professionalId] ?? 0)),
    };
  };

  const positive = (v: number | string | null): number | null => {
    const n = numOrNull(v);
    return n !== null && n > 0 ? n : null;
  };

  for (const p of args.proposals) {
    if (p.status !== "pending" || p.proposed_by === "family") continue;
    if (p.expires_at !== null && !(msOf(p.expires_at) > args.now)) continue;
    out.push({
      id: p.id,
      source: "proposal",
      offeredRate: positive(p.hourly_rate),
      postedRate: positive(p.posted_rate),
      hourly: true,
      createdAt: p.created_at,
      ...common(p.professional_id, p.peer_name ?? null),
    });
  }

  for (const a of args.applications) {
    if (a.status !== "pending") continue;
    const offer = offers.get(a.job_offer_id);
    const posted = positive(offer?.amount ?? null);
    out.push({
      id: a.id,
      source: "application",
      // Si no propuso otro monto, acepta el publicado.
      offeredRate: positive(a.proposed_amount) ?? posted,
      postedRate: posted,
      hourly: offer?.modality === "hour",
      createdAt: a.created_at,
      ...common(a.professional_id, null),
    });
  }
  return out;
}
