// «Tu día» del profesional en Inicio: saludo, calma y lo que hay que atender ahora, para todos los profesionales.
//
// Aquí solo se piden los datos (hooks ya existentes del panel y de `use-pro-intel`), se pasan a las funciones puras de
// `src/lib` y se reparte el resultado en el héroe compartido. Nada de esto se envía a terceros. Los avisos de descanso son
// gratis para todos; el detalle (ingresos, carga, semana, reputación) vive en el centro profesional, con su plan.
import { useMemo } from "react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveServices } from "@/hooks/use-care-loop";
import { useReceivedKudos } from "@/hooks/use-care-loop";
import { useMyOfferApplications } from "@/hooks/use-institution-hub";
import { useNow } from "@/hooks/use-now";
import { useOpportunityFeed } from "@/hooks/use-opportunity-feed";
import { usePlan } from "@/hooks/use-plan";
import { useRatedBookingIds } from "@/hooks/use-family-intel";
import { useProBookings, useProProposals } from "@/hooks/use-pro-intel";
import { DAY_MS, msOf } from "@/lib/intelShared";
import { isShiftApplied } from "@/lib/opportunities";
import {
  buildProBrief,
  proHeroStats,
  PRO_RATING_WINDOW_DAYS,
  type ProBriefTarget,
  type ProSnapshot,
} from "@/lib/proBrief";
import { buildEarningsReport } from "@/lib/proEarnings";
import { buildWorkloadReport } from "@/lib/proWorkload";
import { ProBriefCard } from "./ProBriefCard";

export interface ProHeroProps {
  userId: string;
  name?: string | null;
  profile: {
    completionPct: number;
    verified: boolean | null;
    hasRate: boolean;
    totalJobs: number | null;
  };
  onNavigate: (target: ProBriefTarget) => void;
}

/** Puntaje desde el que un turno se llama «excelente» (el mismo corte que el hub de oportunidades). */
const EXCELLENT_SCORE = 80;

export function ProHero({ userId, name, profile, onNavigate }: ProHeroProps) {
  const now = useNow();
  const plan = usePlan(userId);
  const premium = plan.can("pro_income_pulse");

  const activeQ = useActiveServices(userId);
  const bookingsQ = useProBookings(userId);
  const proposalsQ = useProProposals(userId);
  const countersQ = useMyOfferApplications(userId);
  const kudosQ = useReceivedKudos(userId, 30);
  const feed = useOpportunityFeed(userId);

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);

  // Servicios hechos en las últimas 2 semanas que aún no calificó.
  const recentDoneIds = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.status === "completed" &&
            now - msOf(b.completed_at ?? b.scheduled_at) <= PRO_RATING_WINDOW_DAYS * DAY_MS,
        )
        .slice(0, 20)
        .map((b) => b.id),
    [bookings, now],
  );
  const ratedQ = useRatedBookingIds(userId, recentDoneIds);

  const workload = useMemo(() => buildWorkloadReport({ bookings, now }), [bookings, now]);
  const commissionMonth = useMemo(
    () => buildEarningsReport({ bookings, now }).commission.paidMonth,
    [bookings, now],
  );

  const snapshot = useMemo<ProSnapshot>(() => {
    const rated = new Set(ratedQ.data ?? []);
    const ranked = feed.model?.ranked ?? [];
    const open = feed.model
      ? ranked.filter(
          (r) => !isShiftApplied(r.shift, feed.model!.appliedNeedIds) && !r.match.conflict,
        )
      : [];
    const kudosWeek = (kudosQ.data ?? []).filter(
      (k) => now - msOf(k.created_at) <= 7 * DAY_MS,
    ).length;
    return {
      now,
      services: (activeQ.data ?? [])
        .filter((s) => s.side === "professional")
        .map((s) => ({
          bookingId: s.booking_id,
          status: s.status,
          scheduledAt: s.scheduled_at,
          counterpartName: s.counterpart_name || null,
          alerts: s.alerts,
        })),
      proposals: (proposalsQ.data ?? []).map((p) => ({
        id: p.id,
        status: p.status,
        proposedBy: p.proposed_by,
        expiresAt: p.expires_at,
        peerName: p.peer_name,
      })),
      counters: (countersQ.data ?? [])
        .filter((a) => a.status === "pending" && a.awaiting === "professional")
        .map((a) => ({
          id: a.id,
          expiresAt: a.expiresAt,
          institutionName: a.institutionName || null,
        })),
      unrated: bookings
        .filter((b) => recentDoneIds.includes(b.id) && !rated.has(b.id))
        .map((b) => ({ bookingId: b.id, peerName: null, completedAt: b.completed_at ?? null })),
      workload: {
        level: workload.level,
        runLength: workload.run.length,
        nextRestLabel: workload.nextRestDay?.label ?? null,
        nextRestIsToday: workload.nextRestDay?.isToday ?? false,
        overlapsAhead: workload.overlapsAhead,
      },
      profile: {
        completionPct: profile.completionPct,
        verified: profile.verified,
        hasRate: profile.hasRate,
      },
      opportunities: feed.model
        ? {
            fits: open.length,
            excellent: open.filter((r) => r.match.score >= EXCELLENT_SCORE).length,
          }
        : null,
      kudosThisWeek: kudosWeek,
      completedServices:
        profile.totalJobs ?? bookings.filter((b) => b.status === "completed").length,
      premium,
      commissionMonth,
    };
  }, [
    now,
    activeQ.data,
    proposalsQ.data,
    countersQ.data,
    bookings,
    recentDoneIds,
    ratedQ.data,
    workload,
    profile.completionPct,
    profile.verified,
    profile.hasRate,
    profile.totalJobs,
    feed.model,
    kudosQ.data,
    premium,
    commissionMonth,
  ]);

  const items = useMemo(() => buildProBrief(snapshot), [snapshot]);
  const stats = useMemo(() => proHeroStats(snapshot), [snapshot]);

  const ready =
    !plan.loading && !bookingsQ.isLoading && !activeQ.isLoading && !proposalsQ.isLoading;

  if (!ready) {
    return (
      <Skeleton
        className="h-64 w-full rounded-3xl"
        aria-busy="true"
        aria-label="Revisando tu día"
      />
    );
  }
  return (
    <ProBriefCard
      items={items}
      onAction={onNavigate}
      now={now}
      name={name}
      stats={stats}
      aside={<PlanBadge plan={plan.plan} />}
    />
  );
}
