// Centro de crecimiento del profesional: ingresos reales y descanso (plan Pro), «Mi semana» y reputación en detalle
// (plan Pro). El resumen del día vive en el héroe de Inicio (`ProHero`) y es para todos.
//
// Aquí solo se piden los datos (hooks de `use-pro-intel` y del hub de oportunidades), se pasan a las funciones puras de
// `src/lib` y se reparte el resultado en tarjetas. El plan se lee de `mp_subscriptions` (solo escribe el webhook de
// pagos); la puerta es de interfaz: son cuentas sobre datos que la persona ya puede leer. Sin el plan, cada herramienta
// muestra qué es y un dato real de la cuenta, y el botón lleva a /planes (los pagos solo se hacen en la página web).
import { useMemo, type ReactNode } from "react";
import { Award, CalendarRange, HeartHandshake, Lock, Sparkles, Wallet } from "lucide-react";
import { PlanBadge } from "@/components/humanix/PlanGate";
import { PremiumPreview } from "@/components/humanix/premium/PremiumPreview";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNow } from "@/hooks/use-now";
import { useMarketStats, useOpportunityFeed } from "@/hooks/use-opportunity-feed";
import { usePlan } from "@/hooks/use-plan";
import { useProBookings, useProRatings } from "@/hooks/use-pro-intel";
import { plural } from "@/lib/intelShared";
import { formatCOP } from "@/lib/pricing";
import { PLAN_CATALOG, type PlanFeature, type PlanKey } from "@/lib/plans";
import { buildEarningsReport } from "@/lib/proEarnings";
import { buildReputationReport } from "@/lib/proReputation";
import { buildWeekPlan } from "@/lib/proWeekPlan";
import { buildWorkloadReport } from "@/lib/proWorkload";
import { EarningsCard } from "./EarningsCard";
import { ReputationCard } from "./ReputationCard";
import { WeekPlanCard } from "./WeekPlanCard";
import { WorkloadCard } from "./WorkloadCard";

export type GrowKey = "ingresos" | "semana" | "descanso" | "reputacion";

const TABS: Array<{
  key: GrowKey;
  label: string;
  feature: PlanFeature;
  min: PlanKey;
  Icon: typeof Wallet;
}> = [
  {
    key: "ingresos",
    label: "Ingresos",
    feature: "pro_income_pulse",
    min: "pro_monthly",
    Icon: Wallet,
  },
  {
    key: "semana",
    label: "Mi semana",
    feature: "pro_week_planner",
    min: "pro_monthly",
    Icon: CalendarRange,
  },
  {
    key: "descanso",
    label: "Descanso",
    feature: "pro_rest_guard",
    min: "pro_monthly",
    Icon: HeartHandshake,
  },
  {
    key: "reputacion",
    label: "Reputación",
    feature: "pro_reputation_lab",
    min: "pro_premium_monthly",
    Icon: Award,
  },
];

export interface ProSmartCenterProps {
  userId: string;
  /** Ciudad base, para el rango de tarifas del mercado. */
  city: string | null;
  profile: {
    hourlyRate: number | null;
    verified: boolean | null;
    rethusVerified: boolean | null;
    completionPct: number;
    avgRating: number | null;
    totalJobs: number | null;
  };
  section: GrowKey;
  onSectionChange: (key: GrowKey) => void;
  /** Lleva a la pestaña de ofertas, donde se postula y se negocia. */
  onOpenOpportunities: () => void;
}

export function ProSmartCenter({
  userId,
  city,
  profile,
  section,
  onSectionChange,
  onOpenOpportunities,
}: ProSmartCenterProps) {
  const now = useNow();
  const plan = usePlan(userId);
  const canIncome = plan.can("pro_income_pulse");
  const canWeek = plan.can("pro_week_planner");
  const canRest = plan.can("pro_rest_guard");
  const canRep = plan.can("pro_reputation_lab");

  const bookingsQ = useProBookings(userId);
  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);
  const marketQ = useMarketStats(city, canIncome);
  const feed = useOpportunityFeed(userId);
  const ratingsQ = useProRatings(userId, canRep);

  const earnings = useMemo(
    () =>
      buildEarningsReport({
        bookings,
        publishedRate: profile.hourlyRate,
        market: canIncome ? (marketQ.data ?? null) : null,
        now,
      }),
    [bookings, profile.hourlyRate, canIncome, marketQ.data, now],
  );
  const workload = useMemo(() => buildWorkloadReport({ bookings, now }), [bookings, now]);
  const weekPlan = useMemo(
    () =>
      canWeek && feed.model
        ? buildWeekPlan({
            ranked: feed.model.ranked,
            busy: feed.model.bundle.pro.busy,
            options: { now },
          })
        : null,
    [canWeek, feed.model, now],
  );
  const reputation = useMemo(
    () =>
      canRep
        ? buildReputationReport({
            stars: ratingsQ.data?.stars ?? [],
            dimensions: ratingsQ.data?.dimensions ?? [],
            profile: {
              verified: profile.verified,
              rethusVerified: profile.rethusVerified,
              profileCompletion: profile.completionPct,
            },
          })
        : null,
    [canRep, ratingsQ.data, profile.verified, profile.rethusVerified, profile.completionPct],
  );

  // Mientras se lee el plan no se muestra ni la herramienta ni la invitación: quien ya paga no debe ver un candado.
  const gate = (allowed: boolean, unlocked: ReactNode, locked: ReactNode): ReactNode =>
    plan.loading ? <Skeleton className="h-40 w-full" /> : allowed ? unlocked : locked;

  const allowed: Record<GrowKey, boolean> = {
    ingresos: canIncome,
    semana: canWeek,
    descanso: canRest,
    reputacion: canRep,
  };

  const proNote = `${PLAN_CATALOG.pro_monthly.priceLabel}${PLAN_CATALOG.pro_monthly.priceNote}, sin permanencia y sin comisión.`;
  const premiumNote = `${PLAN_CATALOG.pro_premium_monthly.priceLabel}${PLAN_CATALOG.pro_premium_monthly.priceNote}, sin permanencia. Incluye todo lo del plan Pro.`;
  const monthEarned = earnings.flow.current.settledToDate;
  const fits = feed.model?.summary.shifts ?? 0;

  return (
    <section aria-label="Tu centro profesional" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Sparkles className="h-5 w-5 text-copper" aria-hidden="true" /> Tu centro profesional
        </h2>
        {!plan.loading && <PlanBadge plan={plan.plan} />}
      </div>

      <Tabs value={section} onValueChange={(v) => onSectionChange(v as GrowKey)}>
        <TabsList
          aria-label="Herramientas para crecer"
          className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4"
        >
          {TABS.map(({ key, label, Icon }) => (
            <TabsTrigger key={key} value={key} className="gap-1.5 py-2">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              {!allowed[key] && !plan.loading && (
                <Lock
                  className="h-3 w-3 text-copper"
                  aria-label={`Con el plan ${PLAN_CATALOG[TABS.find((t) => t.key === key)!.min].label}`}
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ingresos">
          {gate(
            canIncome,
            <EarningsCard
              report={earnings}
              loading={bookingsQ.isLoading}
              error={bookingsQ.isError}
            />,
            <PremiumPreview
              min="pro_monthly"
              ctaNote={proNote}
              icon={<Wallet className="h-4 w-4 text-ok" aria-hidden="true" />}
              title="Tus ingresos reales"
              description="Cuánto te queda por mes, cuánto tienes acordado y cuánto proyectamos, con tu día más fuerte y tu tarifa frente al mercado."
              bullets={[
                "Ingresos netos por mes y proyección del mes en curso",
                "Cuánta comisión pagaste y si el plan Pro se paga solo con tu volumen",
                "Tu día más fuerte, las familias que vuelven y tu tarifa frente a tu ciudad",
              ]}
              teaser={
                monthEarned > 0
                  ? `Este mes llevas ${formatCOP(monthEarned)} netos${earnings.commission.paidMonth > 0 ? ` y ya pagaste ${formatCOP(earnings.commission.paidMonth)} de comisión` : ""}.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="semana">
          {gate(
            canWeek,
            <WeekPlanCard
              plan={weekPlan}
              loading={feed.isLoading}
              error={!!feed.error}
              onOpenOpportunities={onOpenOpportunities}
            />,
            <PremiumPreview
              min="pro_monthly"
              ctaNote={proNote}
              icon={<CalendarRange className="h-4 w-4 text-trust" aria-hidden="true" />}
              title="Mi semana"
              description="Una combinación de turnos compatibles que encaja en tu agenda de los próximos 7 días."
              bullets={[
                "Turnos sin cruces con lo que ya tienes confirmado y con margen para llegar",
                "Topes de horas por día y por semana, y un día libre protegido",
                "Cada turno dice por qué entró y cada descarte, por qué quedó fuera",
              ]}
              teaser={
                fits > 0
                  ? `Ahora mismo hay ${plural(fits, "turno compatible", "turnos compatibles")} con tu agenda.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="descanso">
          {gate(
            canRest,
            <WorkloadCard
              report={workload}
              loading={bookingsQ.isLoading}
              error={bookingsQ.isError}
            />,
            <PremiumPreview
              min="pro_monthly"
              ctaNote={proNote}
              icon={<HeartHandshake className="h-4 w-4 text-copper" aria-hidden="true" />}
              title="Cuida a quien cuida"
              description="Tu carga de trabajo, tus días seguidos y tus descansos, con un día libre sugerido. Solo tú lo ves."
              bullets={[
                "Horas por semana y comparación con una jornada de referencia",
                "Días seguidos, turnos de noche y descansos de menos de 8 h entre turnos",
                "Tu próximo día libre y cruces en tu agenda",
              ]}
              teaser={
                workload.hasData
                  ? `En los últimos 7 días trabajaste ${workload.last7Hours} h.`
                  : null
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="reputacion">
          {gate(
            canRep,
            <ReputationCard
              report={reputation}
              loading={ratingsQ.isLoading}
              error={ratingsQ.isError}
            />,
            <PremiumPreview
              min="pro_premium_monthly"
              ctaNote={premiumNote}
              icon={<Award className="h-4 w-4 text-copper" aria-hidden="true" />}
              title="Tu reputación en detalle"
              description="Qué opinan de ti en cada aspecto, tu fortaleza, un empujón para crecer y lo que dicen de ti."
              bullets={[
                "Promedio, distribución de estrellas y tendencia",
                "Puntualidad, trato, cumplimiento y comunicación por separado",
                "Consejos amables y cuántos servicios de 5 estrellas faltan para tu próxima meta",
              ]}
              teaser={
                profile.avgRating && profile.totalJobs
                  ? `Tu promedio es ${profile.avgRating.toFixed(1).replace(".", ",")} en ${plural(profile.totalJobs, "servicio", "servicios")}: con el plan Pro ves en qué eres más fuerte.`
                  : null
              }
            />,
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}
