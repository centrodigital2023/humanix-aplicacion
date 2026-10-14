// Centro de cuidado inteligente del panel de familia: «Tu día, resuelto» para todas las familias y, con el plan
// Esencial, informe de bienestar, comparador de postulaciones, presupuesto y radar de cobertura.
//
// Aquí solo se piden los datos (hooks de `use-family-intel`), se pasan a las funciones puras de `src/lib` y se
// reparte el resultado en tarjetas. El plan se lee de `mp_subscriptions` (solo escribe el webhook de pagos); la puerta
// es de interfaz: son cuentas sobre datos que la familia ya puede leer. Sin el plan, cada herramienta muestra qué es
// y un dato real de la cuenta, y el botón lleva a /planes (los pagos solo se hacen en la página web).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HeartPulse, Lock, Radar, Scale, Sparkles, Wallet } from "lucide-react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrustedTeam, useActiveServices } from "@/hooks/use-care-loop";
import {
  useApplicantFacts,
  useCircleMemberCount,
  useFamilyBookings,
  useFamilyCareLogs,
  useFamilyNeeds,
  useFamilyProposals,
  useNow,
  useProfessionalNames,
  useRatedBookingIds,
} from "@/hooks/use-family-intel";
import { useMarketStats } from "@/hooks/use-opportunity-feed";
import { usePlan } from "@/hooks/use-plan";
import { rankApplicants } from "@/lib/applicantRanking";
import { buildApplicants, type ApplicationSource, type OfferSource } from "@/lib/applicantSources";
import { buildBudgetReport } from "@/lib/careBudget";
import { careDaysReport } from "@/lib/careDays";
import {
  ROUTES,
  episodeDay as computeEpisodeDay,
  goalProgress,
  inferRoutes,
  isCareRoute,
  pickRoute,
  type CareRoute,
} from "@/lib/careJourney";
import { buildCoverageRadar } from "@/lib/coverageRadar";
import { buildFamilyBrief, heroStats, type BriefTarget } from "@/lib/familyBrief";
import { DAY_MS, plural } from "@/lib/intelShared";
import { buildSnapshot, completedByProfessional, premiumHints } from "@/lib/familySnapshot";
import { formatCOP } from "@/lib/pricing";
import { buildWellbeingReport, DEFAULT_WINDOW_DAYS } from "@/lib/wellbeing";
import { ApplicantsRankingCard } from "./ApplicantsRankingCard";
import { CareBudgetCard } from "./CareBudgetCard";
import { CareJourneyCard } from "./CareJourneyCard";
import { CoverageRadarCard, type RadarAnchor } from "./CoverageRadarCard";
import { FamilyBriefCard } from "./FamilyBriefCard";
import { PremiumPreview } from "@/components/humanix/premium/PremiumPreview";
import { WellbeingReportCard } from "./WellbeingReportCard";
import { scrollToId } from "@/components/humanix/premium/scroll";

type TabKey = "bienestar" | "comparador" | "gasto" | "cobertura";

export interface FamilySmartCenterProps {
  userId: string;
  /** Nombre de la persona para el saludo (si viene un correo, se omite). */
  name?: string | null;
  /** Ciudad de la familia, para el rango de tarifas. */
  city: string;
  profile: { complete: boolean; hasEmergencyContact: boolean };
  /** Postulaciones a las ofertas de la familia (ya cargadas por el panel). */
  applications: ApplicationSource[];
  offers: OfferSource[];
  coords: { lat: number | null; lng: number | null };
}

export function FamilySmartCenter({
  userId,
  name,
  city,
  profile,
  applications,
  offers,
  coords,
}: FamilySmartCenterProps) {
  const now = useNow();
  const plan = usePlan(userId);
  const premium = plan.can("family_wellbeing_report");

  const bookingsQ = useFamilyBookings(userId);
  const needsQ = useFamilyNeeds(userId);
  const proposalsQ = useFamilyProposals(userId);
  const teamQ = useTrustedTeam(userId);
  const activeQ = useActiveServices(userId);
  const circleQ = useCircleMemberCount(userId);
  const marketQ = useMarketStats(city, premium);

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);
  const proposals = useMemo(() => proposalsQ.data ?? [], [proposalsQ.data]);
  const team = useMemo(() => teamQ.data ?? [], [teamQ.data]);
  const market = premium ? (marketQ.data ?? null) : null;

  // Nombres: de quienes atendieron, propusieron o se postularon.
  const proIds = useMemo(
    () => [
      ...bookings.map((b) => b.professional_id),
      ...proposals.map((p) => p.professional_id),
      ...applications.map((a) => a.professional_id),
    ],
    [bookings, proposals, applications],
  );
  const namesQ = useProfessionalNames(proIds);
  const names = useMemo(() => namesQ.data ?? {}, [namesQ.data]);

  const completedIds = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "completed")
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
        .slice(0, 20)
        .map((b) => b.id),
    [bookings],
  );
  const ratedQ = useRatedBookingIds(userId, completedIds);

  // ── Radar de cobertura (también alimenta el resumen del día) ──────────────
  const radar = useMemo(
    () =>
      buildCoverageRadar({
        needs: needsQ.data ?? [],
        proposals: proposals.map((p) => ({
          id: p.id,
          family_need_id: p.family_need_id,
          status: p.status,
          proposed_by: p.proposed_by,
          expires_at: p.expires_at,
        })),
        team,
        market,
        now,
      }),
    [needsQ.data, proposals, team, market, now],
  );

  // ── Presupuesto ───────────────────────────────────────────────────────────
  const budget = useMemo(
    () => buildBudgetReport({ bookings, market, now }),
    [bookings, market, now],
  );

  // ── Informe de bienestar (solo con plan: pide los partes) ─────────────────
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const logsQ = useFamilyCareLogs(userId, bookingsQ.data, premium);
  const wbBookings = useMemo(
    () => bookings.map((b) => ({ ...b, professional_name: names[b.professional_id] ?? null })),
    [bookings, names],
  );
  const wbLogs = logsQ.data?.rows;
  const wbTruncated = logsQ.data?.truncated;
  const wellbeing = useMemo(
    () =>
      premium
        ? buildWellbeingReport({
            bookings: wbBookings,
            logs: wbLogs ?? [],
            now,
            windowDays,
            logsTruncated: wbTruncated,
          })
        : null,
    [premium, wbBookings, wbLogs, now, windowDays, wbTruncated],
  );
  // Los avisos del resumen del día miran siempre 30 días: cambiar el periodo del informe no debe mover el resumen.
  const wellbeingForBrief = useMemo(
    () =>
      !premium
        ? null
        : windowDays === DEFAULT_WINDOW_DAYS
          ? wellbeing
          : buildWellbeingReport({
              bookings: wbBookings,
              logs: wbLogs ?? [],
              now,
              windowDays: DEFAULT_WINDOW_DAYS,
              logsTruncated: wbTruncated,
            }),
    [premium, windowDays, wellbeing, wbBookings, wbLogs, now, wbTruncated],
  );

  // ── Comparador de postulaciones ───────────────────────────────────────────
  const pendingProIds = useMemo(
    () => [
      ...proposals.filter((p) => p.status === "pending").map((p) => p.professional_id),
      ...applications.filter((a) => a.status === "pending").map((a) => a.professional_id),
    ],
    [proposals, applications],
  );
  const factsQ = useApplicantFacts(pendingProIds, premium);
  const applicants = useMemo(
    () =>
      buildApplicants({
        proposals,
        applications,
        offers,
        facts: factsQ.data ?? {},
        names,
        teamIds: team.map((m) => m.professional_id),
        completedWith: completedByProfessional(bookings),
        origin: coords,
        now,
      }),
    [proposals, applications, offers, factsQ.data, names, team, bookings, coords, now],
  );
  const ranked = useMemo(() => rankApplicants(applicants, { market }), [applicants, market]);

  // ── Ruta de cuidado (reconoce la necesidad por la agenda; la familia puede elegir otra) ───────────
  // La elección se recuerda en este navegador (comodidad de quien la usa); no es un dato que la plataforma necesite.
  const routeKey = `humanix-care-route:${userId}`;
  const [chosenRoute, setChosenRoute] = useState<CareRoute | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(routeKey);
      setChosenRoute(isCareRoute(saved) ? saved : null);
    } catch {
      /* sin almacenamiento: la ruta se sugiere igual desde la agenda */
    }
  }, [routeKey]);
  const onRouteChange = (r: CareRoute) => {
    setChosenRoute(r);
    try {
      localStorage.setItem(routeKey, r);
    } catch {
      /* sin almacenamiento: vale para esta sesión */
    }
  };
  const inferredRoutes = useMemo(
    () => inferRoutes((needsQ.data ?? []).map((n) => n.care_type)),
    [needsQ.data],
  );
  const route = pickRoute(inferredRoutes, chosenRoute);
  const routeTone = route ? ROUTES[route].tone : "warm";
  const careLogs = useMemo(() => wbLogs ?? [], [wbLogs]);
  const episode = useMemo(() => computeEpisodeDay(bookings, now), [bookings, now]);
  const careDays = useMemo(
    () => careDaysReport({ bookings, logs: careLogs, now, tone: routeTone }),
    [bookings, careLogs, now, routeTone],
  );
  const goals = useMemo(
    () => (premium && route ? goalProgress(route, careLogs, now) : null),
    [premium, route, careLogs, now],
  );

  // ── Resumen del día ───────────────────────────────────────────────────────
  const snapshot = useMemo(
    () =>
      buildSnapshot({
        now,
        active: activeQ.data ?? [],
        bookings,
        ratedBookingIds: ratedQ.data ?? [],
        names,
        proposals,
        applications,
        gaps: radar.gaps,
        profile,
        teamSize: team.length,
        circleMembers: circleQ.data ?? 0,
        premium,
        hints: premium ? premiumHints(wellbeingForBrief, budget) : undefined,
      }),
    [
      now,
      activeQ.data,
      bookings,
      ratedQ.data,
      names,
      proposals,
      applications,
      radar.gaps,
      profile,
      team.length,
      circleQ.data,
      premium,
      wellbeingForBrief,
      budget,
    ],
  );
  const brief = useMemo(() => buildFamilyBrief(snapshot), [snapshot]);
  const stats = useMemo(() => heroStats(snapshot), [snapshot]);

  // ── Pestañas y navegación ─────────────────────────────────────────────────
  const [tab, setTab] = useState<TabKey | null>(null);
  const activeTab: TabKey = tab ?? (ranked.length > 0 ? "comparador" : "bienestar");

  const openTab = (t: TabKey) => {
    setTab(t);
    // Deja que la pestaña pinte antes de bajar a ella.
    setTimeout(() => scrollToId("centro-herramientas"), 0);
  };

  const onBriefAction = (target: BriefTarget) => {
    switch (target.kind) {
      case "agenda":
        return scrollToId("agenda");
      case "proposals":
        return scrollToId("propuestas");
      case "applications":
        return premium ? openTab("comparador") : scrollToId("postulaciones");
      case "ratings":
        return scrollToId("calificar");
      case "team":
        return scrollToId("equipo");
      case "circle":
        return scrollToId("circulo");
      case "profile":
        return scrollToId("mis-datos");
      case "wellbeing":
        return openTab("bienestar");
      case "budget":
        return openTab("gasto");
      default:
        return; // service, search y plans son enlaces con ruta propia: no pasan por aquí
    }
  };

  const onRadarAnchor = (a: RadarAnchor) =>
    scrollToId(a === "agenda" ? "agenda" : a === "proposals" ? "propuestas" : "equipo");

  const onOpenInbox = (source: "proposal" | "application") =>
    scrollToId(source === "proposal" ? "propuestas" : "postulaciones");

  // ── Datos reales de la cuenta para las vistas previas (sin revelar el análisis) ──
  const since30 = now - 30 * DAY_MS;
  const services30 = bookings.filter(
    (b) => b.status === "completed" && new Date(b.scheduled_at).getTime() >= since30,
  ).length;
  const openHours = Math.round(radar.gaps.reduce((n, g) => n + g.hours, 0));

  // Mientras se lee el plan no se muestra ni la herramienta ni la invitación: quien ya paga no debe ver un candado.
  const gate = (unlocked: ReactNode, locked: ReactNode): ReactNode =>
    plan.loading ? <Skeleton className="h-40 w-full" /> : premium ? unlocked : locked;

  const ready =
    !plan.loading &&
    !bookingsQ.isLoading &&
    !proposalsQ.isLoading &&
    !needsQ.isLoading &&
    !activeQ.isLoading;

  return (
    <section id="centro-inteligente" aria-label="Tu centro de cuidado" className="space-y-4">
      {ready ? (
        <FamilyBriefCard
          items={brief}
          onAction={onBriefAction}
          now={now}
          name={name}
          stats={stats}
        />
      ) : (
        <Skeleton
          className="h-64 w-full rounded-3xl"
          aria-busy="true"
          aria-label="Revisando tu día"
        />
      )}

      <div id="ruta-de-cuidado" className="scroll-mt-4">
        <CareJourneyCard
          route={route}
          inferred={inferredRoutes}
          onRouteChange={onRouteChange}
          episodeDay={episode}
          careDays={careDays}
          goals={goals}
          bookings={wbBookings}
          logs={careLogs}
          report={wellbeing}
          premium={premium}
          now={now}
          personName={name}
          loading={!ready || (premium && logsQ.isLoading)}
        />
      </div>

      <div id="centro-herramientas" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold">
            <Sparkles className="h-5 w-5 text-copper" aria-hidden="true" /> Herramientas
            inteligentes
          </h3>
          {!plan.loading && <PlanBadge plan={plan.plan} />}
        </div>
        <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList
            aria-label="Herramientas del plan Esencial"
            className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4"
          >
            {(
              [
                ["bienestar", "Bienestar", HeartPulse],
                ["comparador", "Comparador", Scale],
                ["gasto", "Gasto", Wallet],
                ["cobertura", "Cobertura", Radar],
              ] as const
            ).map(([key, label, Icon]) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 py-2">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                {!premium && !plan.loading && (
                  <Lock className="h-3 w-3 text-copper" aria-label="Con el plan Esencial" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="bienestar">
            {gate(
              <WellbeingReportCard
                report={wellbeing}
                windowDays={windowDays}
                onWindowChange={setWindowDays}
                loading={bookingsQ.isLoading || logsQ.isLoading}
                error={bookingsQ.isError || logsQ.isError}
              />,
              <PremiumPreview
                icon={<HeartPulse className="h-4 w-4 text-sos" aria-hidden="true" />}
                title="Informe de bienestar"
                description="Cómo ha estado el ánimo, los signos vitales y las alertas de cada turno, con un resumen listo para el médico."
                bullets={[
                  "Tendencia del ánimo, la presión arterial, el pulso, la temperatura y el oxígeno",
                  "Alertas, incidentes y medicamentos registrados por el profesional",
                  "Resumen para llevar a la consulta (copiar o descargar)",
                ]}
                teaser={
                  services30 > 0
                    ? `Tus ${plural(services30, "servicio", "servicios")} de los últimos 30 días ya ${services30 === 1 ? "tiene" : "tienen"} parte: con el plan Esencial los convertimos en un informe.`
                    : null
                }
              />,
            )}
          </TabsContent>

          <TabsContent value="comparador">
            {gate(
              <ApplicantsRankingCard
                ranked={ranked}
                loading={proposalsQ.isLoading || factsQ.isLoading}
                onOpenInbox={onOpenInbox}
              />,
              <PremiumPreview
                icon={<Scale className="h-4 w-4 text-trust" aria-hidden="true" />}
                title="Comparador inteligente"
                description="Ordena las propuestas y postulaciones con un puntaje de 0 a 100 que se puede desarmar."
                bullets={[
                  "Verificación, confianza, calificaciones y experiencia de cada profesional",
                  "Precio frente al rango de tu ciudad y contraoferta sugerida",
                  "Cercanía y si ya te atendió o está en tu equipo de confianza",
                ]}
                teaser={
                  applicants.length > 0
                    ? `Tienes ${plural(applicants.length, "opción", "opciones")} por comparar ahora mismo.`
                    : null
                }
              />,
            )}
          </TabsContent>

          <TabsContent value="gasto">
            {gate(
              <CareBudgetCard
                report={budget}
                loading={bookingsQ.isLoading}
                error={bookingsQ.isError}
              />,
              <PremiumPreview
                icon={<Wallet className="h-4 w-4 text-trust" aria-hidden="true" />}
                title="Presupuesto de cuidado"
                description="Cuánto llevas, cuánto tienes programado y cuánto proyectamos para el mes."
                bullets={[
                  "Gasto de los últimos 6 meses y proyección del mes en curso",
                  "Cómo va tu gasto frente al mes pasado a la misma fecha",
                  "Tu costo por hora frente al rango de tu ciudad y cuánto podrías ahorrar",
                ]}
                teaser={
                  budget.current.spentToDate > 0
                    ? `Este mes llevas ${formatCOP(budget.current.spentToDate)} en servicios terminados.`
                    : null
                }
              />,
            )}
          </TabsContent>

          <TabsContent value="cobertura">
            {gate(
              <CoverageRadarCard radar={radar} loading={needsQ.isLoading} onGoTo={onRadarAnchor} />,
              <PremiumPreview
                icon={<Radar className="h-4 w-4 text-trust" aria-hidden="true" />}
                title="Radar de cobertura"
                description="Qué horas de tu agenda siguen sin profesional y a quién avisar primero."
                bullets={[
                  "Horas sin cubrir de los próximos 14 días, con su urgencia",
                  "Si tu tarifa ayuda o estorba frente al rango de tu ciudad",
                  "A quién de tu equipo de confianza conviene avisar primero",
                ]}
                teaser={
                  openHours > 0
                    ? `Tienes ${plural(openHours, "hora", "horas")} sin cubrir en los próximos 14 días.`
                    : null
                }
              />,
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
