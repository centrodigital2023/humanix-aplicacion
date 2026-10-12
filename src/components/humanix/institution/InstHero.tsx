// «Tu día» de la institución en Inicio: saludo, calma y lo que hay que atender ahora, para todas las instituciones.
//
// Aquí solo se piden los datos (hooks ya existentes del panel y de `use-inst-intel`), se pasan a las funciones puras de
// `src/lib` y se reparte el resultado en el héroe compartido. Nada de esto se envía a terceros. Lo que protege al paciente
// y mueve la cobertura es gratis para todos; el detalle (costos, calidad, equipo, pronóstico e informe) vive en el centro
// de gestión, con su plan.
import { useMemo } from "react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveServices } from "@/hooks/use-care-loop";
import { useRatedBookingIds } from "@/hooks/use-family-intel";
import {
  useCoverageOffers,
  useInstitutionInbox,
  useMySmartContracts,
} from "@/hooks/use-institution-hub";
import { useInstBookings, useInstQuality } from "@/hooks/use-inst-intel";
import { useNow } from "@/hooks/use-now";
import { usePlan } from "@/hooks/use-plan";
import {
  INST_RATING_WINDOW_DAYS,
  buildInstBrief,
  instHeroStats,
  type InstBriefTarget,
  type InstSnapshot,
} from "@/lib/instBrief";
import { assessShifts, buildCoverageInputs, summarizeCoverage } from "@/lib/institutionCoverage";
import { DAY_MS, msOf, resolvePeriod } from "@/lib/intelShared";
import { InstBriefCard } from "./InstBriefCard";

export interface InstHeroProps {
  userId: string;
  name?: string | null;
  profile: { complete: boolean; verified: boolean | null };
  onNavigate: (target: InstBriefTarget) => void;
}

export function InstHero({ userId, name, profile, onNavigate }: InstHeroProps) {
  const now = useNow();
  const plan = usePlan(userId);
  const premium = plan.can("inst_quality_compliance");

  const activeQ = useActiveServices(userId);
  const offersQ = useCoverageOffers(userId);
  const inboxQ = useInstitutionInbox(userId);
  const contractsQ = useMySmartContracts(userId);
  const bookingsQ = useInstBookings(userId);
  const period = useMemo(() => resolvePeriod("30d", now), [now]);
  const quality = useInstQuality(userId, period, premium);

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);

  // Servicios terminados en las últimas 2 semanas que la institución aún no calificó.
  const recentDoneIds = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.status === "completed" &&
            now - msOf(b.completed_at ?? b.scheduled_at) <= INST_RATING_WINDOW_DAYS * DAY_MS,
        )
        .slice(0, 20)
        .map((b) => b.id),
    [bookings, now],
  );
  const ratedQ = useRatedBookingIds(userId, recentDoneIds);

  const applicants = useMemo(() => inboxQ.data ?? [], [inboxQ.data]);
  const shifts = useMemo(
    () => assessShifts(buildCoverageInputs(offersQ.data ?? [], applicants), now),
    [offersQ.data, applicants, now],
  );
  const coverage = useMemo(() => summarizeCoverage(shifts), [shifts]);

  const snapshot = useMemo<InstSnapshot>(() => {
    const rated = new Set(ratedQ.data ?? []);
    const worst = quality.report?.metrics
      .filter((m) => m.status === "alert" && m.value !== null)
      .sort((a, b) => (a.value as number) - (b.value as number))[0];
    return {
      now,
      services: (activeQ.data ?? [])
        .filter((s) => s.side === "client")
        .map((s) => ({
          bookingId: s.booking_id,
          status: s.status,
          scheduledAt: s.scheduled_at,
          counterpartName: s.counterpart_name || null,
          alerts: s.alerts,
        })),
      shifts: shifts.map((s) => ({
        shiftId: s.shiftId,
        offerTitle: s.title,
        risk: s.risk,
        open: s.open,
        hoursToStart: s.hoursToStart,
        startsAt: s.startsAt,
      })),
      waiting: applicants
        .filter((a) => a.status === "pending" && a.awaiting === "institution")
        .map((a) => ({ id: a.id, createdAt: a.createdAt })),
      unsigned: (contractsQ.data ?? [])
        .filter(
          (c) =>
            (c.status === "pending_signature" || c.status === "partially_signed") && !c.i_signed,
        )
        .map((c) => ({ id: c.contract_id, firstShiftAt: c.first_shift })),
      unrated: bookings
        .filter((b) => recentDoneIds.includes(b.id) && !rated.has(b.id))
        .map((b) => ({ bookingId: b.id, completedAt: b.completed_at ?? null })),
      profile,
      coveragePct: coverage.coveragePct,
      hasShifts: (offersQ.data?.length ?? 0) > 0,
      completedServices: bookings.filter((b) => b.status === "completed").length,
      premium,
      quality:
        premium && quality.report
          ? {
              alerts: quality.report.counts.alert,
              worst: worst ? { label: worst.label, value: worst.value as number } : null,
            }
          : null,
    };
  }, [
    now,
    activeQ.data,
    shifts,
    applicants,
    contractsQ.data,
    bookings,
    recentDoneIds,
    ratedQ.data,
    profile,
    coverage.coveragePct,
    offersQ.data,
    premium,
    quality.report,
  ]);

  const items = useMemo(() => buildInstBrief(snapshot), [snapshot]);
  const stats = useMemo(() => instHeroStats(snapshot), [snapshot]);

  const ready =
    !plan.loading &&
    !offersQ.isLoading &&
    !inboxQ.isLoading &&
    !activeQ.isLoading &&
    !bookingsQ.isLoading;

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
    <InstBriefCard
      items={items}
      onAction={onNavigate}
      now={now}
      name={name}
      stats={stats}
      coveragePct={coverage.coveragePct}
      aside={<PlanBadge plan={plan.plan} />}
    />
  );
}
