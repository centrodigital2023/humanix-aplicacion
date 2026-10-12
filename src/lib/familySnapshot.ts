// Arma la «foto» de la familia que lee `buildFamilyBrief` a partir de lo que ya consultó el panel. Puro: aquí no se
// consulta nada, solo se traducen filas de varias tablas a una sola forma y se deciden las cosas que dependen de
// cruzar datos (qué servicios terminados siguen sin calificar, qué avisos del plan de pago se pasan al resumen).

import type { BudgetReport } from "./careBudget";
import type { ActiveService } from "./careLoop";
import type { CoverageRadar } from "./coverageRadar";
import { firstName } from "./applicantSources";
import type {
  BriefApplication,
  BriefProposal,
  BriefService,
  BriefUnrated,
  FamilySnapshot,
  PremiumHints,
} from "./familyBrief";
import { msOf } from "./familyIntelShared";
import type { WellbeingReport } from "./wellbeing";

export interface SnapshotBooking {
  id: string;
  status: string;
  scheduled_at: string;
  completed_at?: string | null;
  professional_id: string;
}

/** Cuántos servicios terminados sin calificar se consideran (los más recientes). */
const UNRATED_LOOKBACK = 20;

export function buildSnapshot(i: {
  now: number;
  active: ActiveService[];
  bookings: SnapshotBooking[];
  ratedBookingIds: Iterable<string>;
  names: Record<string, string | null | undefined>;
  proposals: Array<{
    id: string;
    status: string;
    proposed_by: string;
    expires_at: string | null;
    peer_name?: string | null;
  }>;
  applications: Array<{ id: string; status: string; created_at: string | null }>;
  gaps: CoverageRadar["gaps"];
  profile: { complete: boolean; hasEmergencyContact: boolean };
  teamSize: number;
  circleMembers: number;
  premium: boolean;
  hints?: PremiumHints;
}): FamilySnapshot {
  const rated = new Set(i.ratedBookingIds);

  const services: BriefService[] = i.active
    .filter((a) => a.side === "client" || a.side === "circle")
    .filter((a) => ["confirmed", "in_route", "in_progress"].includes(a.status))
    .map((a) => ({
      bookingId: a.booking_id,
      side: a.side as "client" | "circle",
      status: a.status,
      scheduledAt: a.scheduled_at,
      counterpartName: firstName(a.counterpart_name),
      ownerName: firstName(a.owner_name),
      alerts: a.alerts,
    }));

  const completed = i.bookings
    .filter((b) => b.status === "completed")
    .sort(
      (a, b) => msOf(b.completed_at ?? b.scheduled_at) - msOf(a.completed_at ?? a.scheduled_at),
    );

  const unrated: BriefUnrated[] = completed
    .slice(0, UNRATED_LOOKBACK)
    .filter((b) => !rated.has(b.id))
    .map((b) => ({
      bookingId: b.id,
      proName: firstName(i.names[b.professional_id]),
      completedAt: b.completed_at ?? b.scheduled_at,
    }));

  const proposals: BriefProposal[] = i.proposals.map((p) => ({
    id: p.id,
    status: p.status,
    proposedBy: p.proposed_by,
    expiresAt: p.expires_at,
    peerName: firstName(p.peer_name),
  }));

  const applications: BriefApplication[] = i.applications.map((a) => ({
    id: a.id,
    status: a.status,
    createdAt: a.created_at ?? "",
  }));

  return {
    now: i.now,
    services,
    proposals,
    applications,
    gaps: i.gaps.map((g) => ({
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      hours: g.hours,
      level: g.level,
    })),
    unrated,
    profile: i.profile,
    completedServices: completed.length,
    teamSize: i.teamSize,
    circleMembers: i.circleMembers,
    premium: i.premium,
    hints: i.hints,
  };
}

/** Gasto mínimo del mes (COP) para que un cambio de ritmo valga la pena comentarlo. */
export const MIN_SPEND_FOR_PACE = 100_000;

/** Lo que el informe de bienestar y el presupuesto le dicen al resumen del día (solo con plan de pago). */
export function premiumHints(
  wellbeing: WellbeingReport | null,
  budget: BudgetReport | null,
): PremiumHints {
  return {
    alerts7d: wellbeing ? wellbeing.alerts.last7d : undefined,
    moodTrend: wellbeing ? wellbeing.moods.trend : undefined,
    budgetDeltaPct:
      budget && budget.vsLastMonth.spentToDate >= MIN_SPEND_FOR_PACE
        ? budget.vsLastMonth.deltaPct
        : null,
    aboveMarketPct: budget && budget.rate.position === "above" ? budget.rate.diffPct : null,
  };
}

/** Servicios terminados de la familia con cada profesional (alimenta «ya te conoce» del comparador). */
export function completedByProfessional(
  bookings: Array<{ status: string; professional_id: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bookings) {
    if (b.status !== "completed" || !b.professional_id) continue;
    out[b.professional_id] = (out[b.professional_id] ?? 0) + 1;
  }
  return out;
}
