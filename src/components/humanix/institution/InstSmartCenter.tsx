// Centro de gestión de la institución: costos, calidad y cumplimiento, equipo, pronóstico de cobertura e informe para la
// gerencia (plan IPS Mejorado). El resumen del día vive en el héroe de Inicio (`InstHero`) y es para todas las
// instituciones.
//
// Aquí solo se piden los datos (hooks de `use-inst-intel` y del hub de la institución), se pasan a las funciones puras de
// `src/lib` y se reparte el resultado en tarjetas. El plan se lee de `mp_subscriptions` (solo escribe el webhook de
// pagos); la puerta es de interfaz: son cuentas sobre datos que la institución ya puede leer. Sin el plan, cada
// herramienta muestra qué es y un dato real de la cuenta, y el botón lleva a /planes (los pagos solo se hacen en la
// página web). Nada se envía a terceros.
import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, FileText, Lock, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { PremiumPreview } from "@/components/humanix/premium/PremiumPreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrustedTeam } from "@/hooks/use-care-loop";
import {
  useCoverageOffers,
  useInstitutionInbox,
  useInstitutionReputation,
} from "@/hooks/use-institution-hub";
import {
  INST_BOOKINGS_LIMIT,
  INST_BOOKINGS_LOOKBACK_DAYS,
  useInstBookings,
  useInstOffers,
  useInstQuality,
} from "@/hooks/use-inst-intel";
import { useNow } from "@/hooks/use-now";
import { useMarketStats } from "@/hooks/use-opportunity-feed";
import { usePlan } from "@/hooks/use-plan";
import { buildCostReport } from "@/lib/instCost";
import { lastCompletedByPro, proNames } from "@/lib/instData";
import { buildEmployerReport } from "@/lib/instEmployer";
import { buildForecast } from "@/lib/instForecast";
import { buildExecutiveReport, csvContext, servicesCsv } from "@/lib/instReport";
import { buildTeamReport } from "@/lib/instTeam";
import { buildCoverageInputs } from "@/lib/institutionCoverage";
import { DAY_MS, msOf, plural, resolvePeriod, type PeriodKey } from "@/lib/intelShared";
import { PLAN_CATALOG, type PlanFeature } from "@/lib/plans";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { CostCard } from "./CostCard";
import { ForecastCard } from "./ForecastCard";
import { QualityCard } from "./QualityCard";
import { ReportCard } from "./ReportCard";
import { TeamCard } from "./TeamCard";

export type InstSection = "costos" | "calidad" | "equipo" | "pronostico" | "informe";

const TABS: Array<{
  key: InstSection;
  label: string;
  feature: PlanFeature;
  Icon: typeof Wallet;
}> = [
  { key: "costos", label: "Costos", feature: "inst_cost_intel", Icon: Wallet },
  { key: "calidad", label: "Calidad", feature: "inst_quality_compliance", Icon: ShieldCheck },
  { key: "equipo", label: "Equipo", feature: "inst_team_reliability", Icon: Users },
  {
    key: "pronostico",
    label: "Pronóstico",
    feature: "inst_coverage_forecast",
    Icon: CalendarRange,
  },
  { key: "informe", label: "Informe", feature: "inst_executive_report", Icon: FileText },
];

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
  { key: "last_month", label: "Mes pasado" },
];

export interface InstSmartCenterProps {
  userId: string;
  /** Nombre de la institución, para el título del informe. */
  institutionName: string;
  /** Ciudad base, para el rango de tarifas del mercado. */
  city: string | null;
  section: InstSection;
  onSectionChange: (key: InstSection) => void;
  /** Lleva al centro de cobertura de Inicio, donde se invita al equipo, se sube el valor o se marca urgente. */
  onOpenCoverage: () => void;
}

export function InstSmartCenter({
  userId,
  institutionName,
  city,
  section,
  onSectionChange,
  onOpenCoverage,
}: InstSmartCenterProps) {
  const now = useNow();
  const plan = usePlan(userId);
  const allowed: Record<InstSection, boolean> = {
    costos: plan.can("inst_cost_intel"),
    calidad: plan.can("inst_quality_compliance"),
    equipo: plan.can("inst_team_reliability"),
    pronostico: plan.can("inst_coverage_forecast"),
    informe: plan.can("inst_executive_report"),
  };
  const anyPremium = Object.values(allowed).some(Boolean);

  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const period = useMemo(() => resolvePeriod(periodKey, now), [periodKey, now]);

  const bookingsQ = useInstBookings(userId);
  const quality = useInstQuality(userId, period, anyPremium);
  const offersQ = useInstOffers(userId, anyPremium);
  const marketQ = useMarketStats(city, allowed.costos || allowed.informe);
  const teamQ = useTrustedTeam(userId);
  const coverageQ = useCoverageOffers(userId);
  const inboxQ = useInstitutionInbox(userId);
  const reputationQ = useInstitutionReputation(userId, allowed.equipo);

  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);
  const offers = useMemo(() => offersQ.data ?? {}, [offersQ.data]);
  const { pros } = quality.data;
  const names = useMemo(() => proNames(pros), [pros]);

  // ── Cuentas (puras: las mismas con o sin plan; el plan solo decide qué se muestra) ──
  const cost = useMemo(
    () =>
      buildCostReport({
        bookings,
        offers,
        market: allowed.costos || allowed.informe ? (marketQ.data ?? null) : null,
        period,
        now,
      }),
    [bookings, offers, allowed.costos, allowed.informe, marketQ.data, period, now],
  );
  const team = useMemo(
    () =>
      buildTeamReport({
        bookings,
        pros,
        teamIds: (teamQ.data ?? []).map((m) => m.professional_id),
        period,
        now,
      }),
    [bookings, pros, teamQ.data, period, now],
  );
  const employer = useMemo(
    () => (allowed.equipo && reputationQ.data ? buildEmployerReport(reputationQ.data) : null),
    [allowed.equipo, reputationQ.data],
  );
  const forecast = useMemo(
    () =>
      buildForecast({
        inputs: buildCoverageInputs(coverageQ.data ?? [], inboxQ.data ?? []),
        now,
      }),
    [coverageQ.data, inboxQ.data, now],
  );
  const serviceIds = useMemo(() => lastCompletedByPro(bookings), [bookings]);

  const executive = useMemo(
    () =>
      allowed.informe && quality.report
        ? buildExecutiveReport({
            institutionName,
            period,
            cost,
            quality: quality.report,
            team,
            forecast: coverageQ.data ? forecast : null,
            now,
          })
        : null,
    [
      allowed.informe,
      quality.report,
      institutionName,
      period,
      cost,
      team,
      forecast,
      coverageQ.data,
      now,
    ],
  );
  const getCsv = () =>
    servicesCsv({
      bookings,
      period,
      now,
      offers,
      ...csvContext(quality.data),
    });

  // ── Datos reales de la cuenta para las vistas previas (sin revelar el análisis) ──
  const since30 = now - 30 * DAY_MS;
  const done30 = bookings.filter(
    (b) => b.status === "completed" && msOf(b.scheduled_at) >= since30,
  );
  const pros30 = new Set(done30.map((b) => b.professional_id)).size;

  // Mientras se lee el plan no se muestra ni la herramienta ni la invitación: quien ya paga no debe ver un candado.
  const gate = (key: InstSection, unlocked: ReactNode, locked: ReactNode): ReactNode =>
    plan.loading ? <Skeleton className="h-40 w-full" /> : allowed[key] ? unlocked : locked;

  const instNote = `${PLAN_CATALOG.institution_monthly.priceLabel}${PLAN_CATALOG.institution_monthly.priceNote}, sin permanencia.`;
  const periodMatters = section !== "pronostico";

  return (
    <section id="centro-gestion" aria-label="Centro de gestión" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Sparkles className="h-5 w-5 text-copper" aria-hidden="true" /> Centro de gestión
        </h2>
        {!plan.loading && <PlanBadge plan={plan.plan} />}
      </div>

      {anyPremium && bookings.length >= INST_BOOKINGS_LIMIT && (
        <p role="note" className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs">
          Tu institución tiene muchos servicios: se leen los {INST_BOOKINGS_LIMIT} más recientes de
          los últimos {INST_BOOKINGS_LOOKBACK_DAYS} días, así que las cifras de los meses más
          antiguos pueden estar incompletas.
        </p>
      )}

      <Tabs value={section} onValueChange={(v) => onSectionChange(v as InstSection)}>
        <TabsList
          aria-label="Herramientas de gestión"
          className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5"
        >
          {TABS.map(({ key, label, Icon }) => (
            <TabsTrigger key={key} value={key} className="gap-1.5 py-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              {!allowed[key] && !plan.loading && (
                <Lock
                  className="h-3 w-3 text-copper"
                  aria-label={`Con el plan ${PLAN_CATALOG.institution_monthly.label}`}
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div
          role="group"
          aria-label="Periodo del análisis"
          className={cn("mt-3 flex flex-wrap items-center gap-1.5", !periodMatters && "hidden")}
        >
          <span className="mr-1 text-xs text-muted-foreground">Periodo</span>
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={p.key === periodKey ? "default" : "outline"}
              aria-pressed={p.key === periodKey}
              onClick={() => setPeriodKey(p.key)}
            >
              {p.label}
            </Button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">{period.label}</span>
        </div>

        <TabsContent value="costos">
          {gate(
            "costos",
            <CostCard
              report={cost}
              loading={bookingsQ.isLoading || offersQ.isLoading}
              error={bookingsQ.isError}
            />,
            <PremiumPreview
              min="institution_monthly"
              ctaNote={instNote}
              icon={<Wallet className="h-4 w-4 text-trust" aria-hidden="true" />}
              title="Costos y proyección"
              description="Cuánto llevas, cuánto tienes acordado y cuánto proyectamos para el mes, con tu costo por hora frente al mercado."
              bullets={[
                "Gasto de los últimos 6 meses y proyección del mes en curso como un rango",
                "Tu costo por hora frente a la mediana de tu ciudad y cuánto podrías ahorrar",
                "En qué ofertas y especialidades se va el dinero, y lo ya acordado para 30 días",
              ]}
              teaser={
                cost.current.settledToDate > 0
                  ? `Este mes llevas ${formatCOP(cost.current.settledToDate)} en servicios terminados.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="calidad">
          {gate(
            "calidad",
            <QualityCard
              report={quality.report}
              names={names}
              loading={quality.loading}
              error={quality.error}
            />,
            <PremiumPreview
              min="institution_monthly"
              ctaNote={instNote}
              icon={<ShieldCheck className="h-4 w-4 text-ok" aria-hidden="true" />}
              title="Calidad y cumplimiento"
              description="Seis indicadores de lo que ya ocurrió en tus servicios, cada uno con su meta y de dónde sale el número."
              bullets={[
                "Turnos cumplidos, llegadas puntuales y horas registradas frente a las contratadas",
                "Servicios con parte del turno y con contrato firmado",
                "Horas atendidas por personal con RETHUS verificado, y la lista de servicios por revisar",
              ]}
              teaser={
                done30.length > 0
                  ? `Tus ${plural(done30.length, "servicio terminado", "servicios terminados")} de los últimos 30 días ya se pueden medir con estos indicadores.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="equipo">
          {gate(
            "equipo",
            <TeamCard
              report={team}
              employer={employer}
              serviceIds={serviceIds}
              loading={bookingsQ.isLoading || quality.loading || teamQ.isLoading}
              error={bookingsQ.isError}
            />,
            <PremiumPreview
              min="institution_monthly"
              ctaNote={instNote}
              icon={<Users className="h-4 w-4 text-trust" aria-hidden="true" />}
              title="Tu equipo"
              description="Quién cumple, de quién dependes y a quién sumar, y cómo te ven los profesionales."
              bullets={[
                "Una ficha por profesional: servicios, horas, puntualidad y cancelaciones",
                "Cuánto del cuidado depende de una sola persona",
                "Quién de tu equipo de confianza lleva tiempo sin trabajar contigo y a quién sumar",
              ]}
              teaser={
                pros30 > 0
                  ? `En los últimos 30 días trabajaste con ${plural(pros30, "profesional", "profesionales")}.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="pronostico">
          {gate(
            "pronostico",
            <ForecastCard
              report={forecast}
              loading={coverageQ.isLoading || inboxQ.isLoading}
              error={coverageQ.isError}
              onOpenCoverage={onOpenCoverage}
            />,
            <PremiumPreview
              min="institution_monthly"
              ctaNote={instNote}
              icon={<CalendarRange className="h-4 w-4 text-trust" aria-hidden="true" />}
              title="Pronóstico de cobertura"
              description="Qué días de las próximas dos semanas van cubiertos y dónde está el riesgo, antes de que sea urgente."
              bullets={[
                "Los próximos 14 días día por día, con cupos cubiertos y horas por cubrir",
                "Cobertura por semana y lo que empieza en menos de 48 horas",
                "Los horarios que suelen quedar sin cubrir, para publicarlos con tiempo",
              ]}
              teaser={
                forecast.totals.shifts > 0
                  ? `Tienes ${plural(forecast.totals.shifts, "turno publicado", "turnos publicados")} para los próximos 14 días.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="informe">
          {gate(
            "informe",
            <ReportCard
              report={executive}
              loading={
                bookingsQ.isLoading ||
                quality.loading ||
                teamQ.isLoading ||
                offersQ.isLoading ||
                coverageQ.isLoading
              }
              error={bookingsQ.isError || quality.error}
              now={now}
              getCsv={getCsv}
            />,
            <PremiumPreview
              min="institution_monthly"
              ctaNote={instNote}
              icon={<FileText className="h-4 w-4 text-copper" aria-hidden="true" />}
              title="Informe de gestión"
              description="Un resumen listo para la gerencia o la auditoría: lo que se hizo, lo que costó, cómo se cumplió y qué atender."
              bullets={[
                "Frase de apertura, cifras clave y una sección por tema",
                "Para copiar, descargar en texto, imprimir o guardar en PDF",
                "Los servicios del periodo en un CSV para auditorías, con parte, contrato y RETHUS",
              ]}
              teaser={
                done30.length > 0
                  ? `El informe incluiría tus ${plural(done30.length, "servicio", "servicios")} de los últimos 30 días.`
                  : null
              }
            />,
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
