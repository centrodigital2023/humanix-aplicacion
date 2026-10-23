import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  X,
  Stethoscope,
  Building2,
  Crown,
  Loader2,
  Heart,
  Sparkles,
  ShieldCheck,
  Zap,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo, jsonLdString, faqLd, breadcrumbLd, SITE_URL } from "@/lib/seo";
import { toast } from "sonner";
import {
  COP,
  FREE_COMMISSION_PCT,
  INSTITUTION_BILLING,
  PLAN_CATALOG,
  PLANS_FOR_SEGMENT,
  calculateInstitutionBilling,
  canUseFeature,
  planValidity,
  type BillingCycle,
  type PlanFeature,
  type PlanKey,
  type PlanSegment,
} from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { PromoCodeRedeemCard } from "@/components/humanix/PromoCodeRedeemCard";
import { useAppUser } from "@/hooks/use-app-user";
import { useAudience } from "@/hooks/use-audience";
import type { Audience } from "@/lib/audience";
import { computeCta } from "@/lib/planCta";
import { LATER_MESSAGE, payPageHref } from "@/lib/checkout";

const PLAN_FAQS = [
  {
    q: "¿Puedo cancelar en cualquier momento?",
    a: "Sí. No hay permanencia mínima. Cancelas la renovación automática desde tu panel y el plan sigue activo hasta el final del periodo pagado.",
  },
  {
    q: "¿Cómo funciona la comisión del plan Free?",
    a: `Con el plan Free buscas, solicitas y contratas sin pagar nada. Humanix cobra una comisión del ${FREE_COMMISSION_PCT} % al profesional por cada servicio. Si la familia tiene el plan Familiar o Premium Familiar, o el profesional tiene Pro o Premium, ese servicio no paga comisión.`,
  },
  {
    q: "¿Cuál es la diferencia entre Familiar y Premium Familiar?",
    a: "Familiar quita la comisión e incluye acuerdos digitales, bitácora, alertas y soporte prioritario. Premium Familiar suma seguimiento avanzado, círculo familiar de hasta 10 personas, reportes para el médico, alertas prioritarias, botón SOS con aviso a tu círculo y soporte dedicado.",
  },
  {
    q: "¿Cuál es la diferencia entre Pro y Premium?",
    a: "Pro te deja cobrar el 100 % de cada servicio (0 % de comisión), con mejor visibilidad y acceso a ofertas. Premium suma prioridad alta en las búsquedas, badge verificado destacado, más créditos de IA y herramientas de reputación.",
  },
  {
    q: "¿Cómo funciona el plan Institucional?",
    a: `Desde ${COP(INSTITUTION_BILLING.basePriceCOP)} al mes con la sede principal incluida, y ${COP(INSTITUTION_BILLING.extraBranchCOP)} al mes por cada sede adicional. Incluye multiusuario con roles, vacantes, agenda, seguimiento y soporte. Con el contrato anual pagas ${INSTITUTION_BILLING.annualPaidMonths} meses y recibes ${INSTITUTION_BILLING.annualMonths}.`,
  },
  {
    q: "¿Los pagos son seguros?",
    a: "Sí. Pagas aquí mismo, en Humanix, con los formularios seguros de Mercado Pago (estándar PCI DSS nivel 1), en pesos colombianos: un mes con tarjeta, PSE (Bancolombia, Nequi y demás bancos) o Efecty, o cobro automático con tarjeta. Los datos de tu tarjeta los guarda Mercado Pago, nunca Humanix.",
  },
  {
    q: "¿Qué es la verificación RETHUS?",
    a: "RETHUS es el Registro Único Nacional del Talento Humano en Salud de Colombia. Verificamos que el número de tarjeta del profesional esté activo y sin sanciones antes de que pueda contactarte.",
  },
  {
    q: "¿Puedo cambiar de plan en cualquier momento?",
    a: "Puedes subir de plan cuando quieras: los días que te quedaban se convierten al plan nuevo y la suscripción anterior se cancela sola. Para bajar de plan, cancela la renovación automática y elige el nuevo cuando termine tu plan actual.",
  },
];

const productLd = (position: number, key: PlanKey, description: string) => ({
  "@type": "ListItem",
  position,
  item: {
    "@type": "Product",
    name: `Humanix ${PLAN_CATALOG[key].label}`,
    description,
    url: `${SITE_URL}/planes`,
    offers: {
      "@type": "Offer",
      price: String(PLAN_CATALOG[key].amountCOP),
      priceCurrency: "COP",
      availability: "https://schema.org/InStock",
      priceValidUntil: "2026-12-31",
    },
  },
});

const pricingProductLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Planes Humanix",
  url: `${SITE_URL}/planes`,
  itemListElement: [
    productLd(
      1,
      "free",
      "Plan gratuito: busca, solicita y contrata. Comisión del 10 % al profesional.",
    ),
    productLd(
      2,
      "essential_monthly",
      "Para familias: sin comisión, acuerdos digitales, bitácora y alertas.",
    ),
    productLd(
      3,
      "family_premium_monthly",
      "Para familias: seguimiento avanzado, círculo familiar y SOS.",
    ),
    productLd(
      4,
      "pro_monthly",
      "Para profesionales: 0 % de comisión, mejor visibilidad y ofertas.",
    ),
    productLd(
      5,
      "pro_premium_monthly",
      "Para profesionales: prioridad alta, badge destacado y más IA.",
    ),
    productLd(
      6,
      "institution_monthly",
      "Para IPS y clínicas: multiusuario, vacantes, agenda y sedes.",
    ),
  ],
};

export const Route = createFileRoute("/planes")({
  head: () =>
    buildSeo({
      title: "Planes y precios · Humanix",
      path: "/planes",
      description:
        "Planes Humanix desde COP 0. Familias: Familiar $9.900 y Premium $24.900. Profesionales: Pro $19.900 y Premium $39.900. Instituciones desde $299.000/mes. Sin permanencia.",
    }),
  component: PlansPage,
});

type DisplayPlan = {
  key: PlanKey;
  icon: typeof Stethoscope;
  tone: "bio" | "fuchsia" | "copper" | "muted";
};

const DISPLAY: DisplayPlan[] = [
  { key: "free", icon: Heart, tone: "muted" },
  { key: "essential_monthly", icon: Heart, tone: "copper" },
  { key: "family_premium_monthly", icon: Sparkles, tone: "copper" },
  { key: "pro_monthly", icon: Stethoscope, tone: "bio" },
  { key: "pro_premium_monthly", icon: Crown, tone: "bio" },
  { key: "institution_monthly", icon: Building2, tone: "fuchsia" },
];

const TONE: Record<string, string> = {
  bio: "border-biosensor/30 bg-biosensor/5 text-biosensor",
  fuchsia: "border-fuchsia-neural/40 bg-fuchsia-neural/5 text-fuchsia-neural",
  copper: "border-copper/30 bg-copper/5 text-copper",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

/** Una fila por función: cada columna se marca según `canUseFeature` (la misma regla que abre la función en la app). */
type CompareRow = {
  label: string;
  feature: PlanFeature;
  /** Perfiles para los que la fila tiene sentido (sin valor: todos). */
  only?: PlanSegment[];
};

const COMPARE_ROWS: CompareRow[] = [
  { label: "Perfil, búsqueda y solicitudes", feature: "apply_offers" },
  { label: "Asistente IA básico", feature: "ai_basic" },
  { label: "Mensajería 1:1 (aplicaciones aceptadas)", feature: "inbox_accepted" },
  { label: "Sin comisión en los servicios", feature: "no_commission" },
  { label: "Contacto directo por WhatsApp y dirección", feature: "whatsapp_contact" },
  { label: "Geolocalización en vivo + ETA", feature: "live_geo_eta" },
  { label: "Verificación RETHUS + anti-fraude IA", feature: "rethus_antifraud" },
  { label: "Acuerdos digitales", feature: "digital_agreements", only: ["family", "institution"] },
  {
    label: "Bitácora del cuidado e historia exportable",
    feature: "care_log",
    only: ["family", "institution"],
  },
  { label: "Alertas del cuidado", feature: "care_alerts", only: ["family", "institution"] },
  {
    label: "Panel de familia inteligente (comparador, presupuesto, cobertura)",
    feature: "smart_applicant_ranking",
    only: ["family"],
  },
  { label: "Soporte prioritario", feature: "priority_support" },
  { label: "Seguimiento avanzado", feature: "advanced_tracking", only: ["family"] },
  { label: "Círculo familiar (hasta 10 personas)", feature: "family_circle", only: ["family"] },
  { label: "Reportes para el médico", feature: "doctor_reports", only: ["family"] },
  {
    label: "Alertas prioritarias y botón SOS al círculo",
    feature: "priority_alerts",
    only: ["family"],
  },
  { label: "Soporte dedicado", feature: "dedicated_support", only: ["family"] },
  { label: "Mejor visibilidad en búsquedas", feature: "visibility_boost", only: ["professional"] },
  { label: "Acceso a ofertas y «Mi semana»", feature: "offers_access", only: ["professional"] },
  { label: "Negociar el valor", feature: "negotiate_rate", only: ["professional"] },
  {
    label: "Panel inteligente (ingresos reales, tarifa y descanso)",
    feature: "pro_income_pulse",
    only: ["professional"],
  },
  { label: "Prioridad alta en búsquedas", feature: "priority_listing", only: ["professional"] },
  {
    label: "Badge verificado destacado",
    feature: "verified_badge_featured",
    only: ["professional"],
  },
  { label: "Más créditos de IA", feature: "ai_credits_plus", only: ["professional"] },
  {
    label: "Herramientas de reputación y pasaporte con QR",
    feature: "pro_reputation_lab",
    only: ["professional"],
  },
  { label: "Coach de carrera y sugerencias IA", feature: "career_coach", only: ["professional"] },
  { label: "Multiusuario con roles", feature: "multi_user_roles", only: ["institution"] },
  {
    label: "Vacantes y pipeline con scoring IA",
    feature: "pipeline_scoring",
    only: ["institution"],
  },
  { label: "Agenda inteligente", feature: "inst_agenda_insights", only: ["institution"] },
  {
    label: "Seguimiento de pacientes y monitoreo clínico",
    feature: "inst_care_scale",
    only: ["institution"],
  },
  { label: "Cobro por sedes y contrato anual", feature: "branch_billing", only: ["institution"] },
];

function CellIcon({ value }: { value: boolean | string }) {
  if (value === false)
    return <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="No incluido" />;
  if (value === true)
    return <Check className="mx-auto h-4 w-4 text-biosensor" aria-label="Incluido" />;
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

const SEGMENT_OF: Record<Audience, PlanSegment> = {
  familias: "family",
  profesionales: "professional",
  instituciones: "institution",
};

const SEGMENT_TITLE: Record<PlanSegment, string> = {
  family: "Para familias",
  professional: "Para profesionales",
  institution: "Para instituciones",
};

// Cómo se ve el plan Free para cada perfil (la columna «cómo genera ingreso» de la tabla de precios).
const FREE_LINE: Record<PlanSegment, { audience: string; features: string[] }> = {
  family: {
    audience: "Busca, solicita y contrata sin pagar nada.",
    features: [
      "Buscar profesionales verificados",
      "Solicitar y contratar servicios",
      "Asistente IA básico",
      `Humanix cobra ${FREE_COMMISSION_PCT} % al profesional por cada servicio`,
    ],
  },
  professional: {
    audience: "Recibe servicios sin pagar mensualidad.",
    features: [
      "Perfil profesional verificado",
      "Postularte a solicitudes y ofertas abiertas",
      "Asistente IA básico",
      `Humanix cobra ${FREE_COMMISSION_PCT} % por cada servicio`,
    ],
  },
  institution: {
    audience: "Para conocer Humanix antes de contratar.",
    features: [
      "Perfil de la institución",
      "Publicar ofertas y recibir postulaciones",
      "Asistente IA básico",
    ],
  },
};

// Preguntas que solo tienen sentido para ciertos perfiles.
const FAQ_ONLY: Record<string, Audience[]> = {
  "¿Cuál es la diferencia entre Familiar y Premium Familiar?": ["familias"],
  "¿Cuál es la diferencia entre Pro y Premium?": ["profesionales"],
  "¿Cómo funciona el plan Institucional?": ["instituciones"],
};

function PlansPage() {
  const { user, loading: userLoading } = useAppUser({ requireAuth: false });
  const {
    plan: currentPlan,
    cancelAtPeriodEnd,
    autoRenew,
    currentPeriodEnd,
    loading: planLoading,
    error: planError,
    refresh: refreshPlan,
  } = usePlan(user?.id ?? null);
  const navigate = useNavigate();
  const loading = userLoading || planLoading;
  // Cada perfil ve solo sus planes.
  const { audience } = useAudience();
  const segments: PlanSegment[] = audience
    ? [SEGMENT_OF[audience]]
    : ["family", "professional", "institution"];
  const [instCycle, setInstCycle] = useState<BillingCycle>("monthly");
  const [acting, setActing] = useState<PlanKey | null>(null);
  const autoTriggered = useRef(false);

  const renewSoon = planValidity(
    { plan: currentPlan, currentPeriodEnd, autoRenew },
    Date.now(),
  ).renewSoon;
  const ctx = { userId: user?.id ?? null, currentPlan, cancelAtPeriodEnd, renewSoon };

  const choose = async (key: PlanKey) => {
    const cta = computeCta(key, ctx);
    if (cta.action.kind === "free") {
      window.location.href = user ? "/dashboard" : "/auth";
      return;
    }
    if (cta.action.kind === "login") {
      toast("Inicia sesión para activar tu plan", { description: "Te llevamos al login." });
      window.location.href = `/auth?redirect=${encodeURIComponent(cta.action.redirectTo)}`;
      return;
    }
    if (cta.action.kind === "current") {
      toast.info("Ya tienes este plan activo.");
      return;
    }
    if (cta.action.kind === "later") {
      toast.info(LATER_MESSAGE);
      return;
    }
    if (planError) {
      // Sin saber el plan real no se abre un pago: podría ser un cobro repetido.
      toast("No pudimos confirmar tu plan ahora.", {
        description: "Revisa tu conexión e inténtalo de nuevo.",
      });
      void refreshPlan();
      return;
    }
    setActing(key);
    void navigate({
      href: payPageHref(key, key === "institution_monthly" ? { cycle: instCycle } : {}),
    });
  };

  useEffect(() => {
    if (autoTriggered.current || loading || !user) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("plan") as PlanKey | null;
    if (!requested || !(requested in PLAN_CATALOG)) return;
    if (requested === "free") return;
    if (currentPlan === requested && !cancelAtPeriodEnd) return;
    autoTriggered.current = true;
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());
    void choose(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, currentPlan, cancelAtPeriodEnd]);

  return (
    <div className="min-h-screen bg-background">
      {/* JSON-LD estructurado para rich results de precios */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(pricingProductLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(faqLd(PLAN_FAQS)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbLd([
              { name: "Inicio", path: "/" },
              { name: "Planes y precios", path: "/planes" },
            ]),
          ),
        }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Planes y precios", path: "/planes" },
        ]}
      />

      <Navbar />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-24 pb-12 sm:pt-28 sm:pb-20">
        {/* HERO --------------------------------------------------------- */}
        <header className="text-center max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural border border-fuchsia-neural/30 font-medium">
            <Crown className="h-3 w-3" /> Planes Humanix
          </span>
          <h1 className="mt-4 font-display text-[clamp(1.875rem,5vw,3rem)] font-bold leading-tight">
            Un plan para cada <span className="text-gradient-bio">historia humana</span>.
          </h1>
          <p className="mt-3 text-muted-foreground text-base sm:text-lg">
            Pagos en pesos colombianos.{" "}
            <span className="font-semibold text-foreground">Sin permanencia.</span> Cancela cuando
            quieras.
          </p>
          {/* Trust badges */}
          <div className="mt-5 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-biosensor" /> RETHUS verificado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-copper" /> Activación inmediata
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-fuchsia-neural" /> +100 profesionales activos
            </span>
          </div>
        </header>

        {/* CANJE DEL BENEFICIO (formulario /validacion) ----------------- */}
        <div className="mx-auto mt-8 max-w-2xl">
          <PromoCodeRedeemCard signedIn={Boolean(user)} onRedeemed={() => void refreshPlan()} />
        </div>

        {segments.map((segment) => {
          const plans = DISPLAY.filter((d) => PLANS_FOR_SEGMENT[segment].includes(d.key));
          const rows = COMPARE_ROWS.filter((r) => !r.only || r.only.includes(segment));
          return (
            <div key={segment}>
              {segments.length > 1 && (
                <h2 className="mt-16 text-center font-display text-2xl font-bold">
                  {SEGMENT_TITLE[segment]}
                </h2>
              )}
              {/* PRICING CARDS ------------------------------------------- */}
              <section
                aria-label={`Planes de suscripción · ${SEGMENT_TITLE[segment]}`}
                className={`mt-8 grid gap-6 md:grid-cols-2 ${
                  plans.length === 3 ? "lg:grid-cols-3" : "lg:mx-auto lg:max-w-4xl"
                }`}
              >
                {plans.map((d) => {
                  const def = PLAN_CATALOG[d.key];
                  const Icon = d.icon;
                  const cta = computeCta(d.key, ctx);
                  const free = d.key === "free" ? FREE_LINE[segment] : null;
                  return (
                    <Card
                      key={d.key}
                      className={`p-6 flex flex-col relative transition-shadow hover:shadow-lg ${
                        def.highlight
                          ? "border-copper/50 shadow-[var(--shadow-elegant)] ring-1 ring-copper/20"
                          : ""
                      }`}
                    >
                      {def.highlight && (
                        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-3 py-1 rounded-full bg-copper text-white border border-copper/30 font-bold whitespace-nowrap shadow-sm">
                          ✦ Más elegido
                        </span>
                      )}
                      <div
                        className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${TONE[d.tone]}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-3 font-display text-xl font-semibold">{def.label}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                        {free?.audience ?? def.audience}
                      </p>
                      <div className="mt-4 pb-4 border-b border-border">
                        <span className="text-3xl sm:text-4xl font-bold font-display">
                          {def.priceLabel}
                        </span>
                        {def.priceNote && (
                          <span className="text-sm text-muted-foreground ml-1">
                            {def.priceNote}
                          </span>
                        )}
                      </div>
                      <ul className="mt-5 space-y-2.5 text-sm flex-1">
                        {(free?.features ?? def.featuresLabel).map((f) => (
                          <li key={f} className="flex gap-2.5">
                            <Check className="h-4 w-4 text-biosensor mt-0.5 shrink-0" />
                            <span className="leading-snug">{f}</span>
                          </li>
                        ))}
                      </ul>
                      {d.key === "institution_monthly" && (
                        <InstitutionCalculator cycle={instCycle} onCycle={setInstCycle} />
                      )}
                      <Button
                        className="mt-6 w-full"
                        variant={
                          def.highlight
                            ? "copper"
                            : d.tone === "fuchsia"
                              ? "hero"
                              : d.tone === "bio"
                                ? "default"
                                : "outline"
                        }
                        disabled={loading || acting === d.key || cta.disabled}
                        onClick={() => choose(d.key)}
                      >
                        {acting === d.key && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        {cta.label}
                      </Button>
                    </Card>
                  );
                })}
              </section>

              {/* FEATURE COMPARISON TABLE -------------------------------- */}
              <section
                aria-label={`Tabla de comparación · ${SEGMENT_TITLE[segment]}`}
                className="mt-12"
              >
                {segments.length === 1 && (
                  <>
                    <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-2">
                      ¿Qué incluye cada plan?
                    </h2>
                    <p className="text-center text-muted-foreground text-sm mb-8">
                      Compara todas las funciones y elige el plan que se adapta a ti.
                    </p>
                  </>
                )}
                <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-4 pl-6 pr-4 text-left font-semibold text-foreground w-2/5">
                          Funcionalidad
                        </th>
                        {plans.map((d) => {
                          const def = PLAN_CATALOG[d.key];
                          return (
                            <th
                              key={d.key}
                              className={`py-4 px-3 text-center font-semibold ${
                                def.highlight ? "text-copper" : "text-foreground"
                              }`}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span>{def.label}</span>
                                <span
                                  className={`text-xs font-normal ${
                                    def.highlight ? "text-copper" : "text-muted-foreground"
                                  }`}
                                >
                                  {def.priceLabel}
                                  {def.priceNote ? def.priceNote : ""}
                                </span>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={row.label}
                          className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                            i % 2 === 0 ? "" : "bg-muted/10"
                          }`}
                        >
                          <td className="py-3 pl-6 pr-4 text-foreground/90 leading-snug">
                            {row.label}
                          </td>
                          {plans.map((d) => (
                            <td
                              key={d.key}
                              className={`py-3 px-3 text-center ${PLAN_CATALOG[d.key].highlight ? "bg-copper/5" : ""}`}
                            >
                              <CellIcon value={canUseFeature(d.key, row.feature)} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          );
        })}

        {/* FAQ --------------------------------------------------------- */}
        <section aria-label="Preguntas frecuentes sobre planes" className="mt-20 max-w-3xl mx-auto">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-8">
            Preguntas frecuentes
          </h2>
          <div className="space-y-3">
            {PLAN_FAQS.filter(
              (f) => !audience || !FAQ_ONLY[f.q] || FAQ_ONLY[f.q].includes(audience),
            ).map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-border bg-card p-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-foreground">
                  {f.q}
                  <span className="text-muted-foreground transition-transform group-open:rotate-180 shrink-0">
                    ⌄
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA FINAL --------------------------------------------------- */}
        <section className="mt-16 rounded-2xl border border-border bg-gradient-to-br from-biosensor/5 via-card to-fuchsia-neural/5 p-8 text-center">
          <h2 className="font-display text-xl sm:text-2xl font-bold">
            ¿Necesitas un plan a medida para tu IPS o clínica?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto">
            Armamos un plan personalizado con integraciones, usuarios ilimitados y acuerdos
            especiales para instituciones de salud.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href="mailto:hola@humanix.lat?subject=Plan IPS Humanix"
              className="inline-flex h-10 items-center justify-center rounded-md bg-biosensor px-5 text-sm font-semibold text-biosensor-foreground hover:bg-biosensor/90 transition-colors"
            >
              hola@humanix.lat
            </a>
            <a
              href="https://wa.me/573147444715?text=Hola%20Humanix%2C%20quiero%20informaci%C3%B3n%20del%20Plan%20Instituci%C3%B3n."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-card px-5 text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              WhatsApp +57 314 744 4715
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            El WhatsApp es solo para resolver dudas. Los pagos se realizan únicamente en esta
            página.
          </p>
          <Link
            to="/"
            className="mt-4 text-xs text-muted-foreground hover:text-foreground inline-block transition-colors"
          >
            ← Volver al inicio
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}

/** Calculadora del plan Institucional: sedes activas y ciclo (mensual o anual, 12 meses por 10). */
function InstitutionCalculator({
  cycle,
  onCycle,
}: {
  cycle: BillingCycle;
  onCycle: (c: BillingCycle) => void;
}) {
  const [branches, setBranches] = useState(1);
  const b = calculateInstitutionBilling({ branches, cycle });
  const max = 50;
  return (
    <div className="mt-5 space-y-3 rounded-xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Sedes</span>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            aria-label="Quitar una sede"
            className="h-7 w-7 rounded-full border border-border bg-card disabled:opacity-40"
            disabled={branches <= 1}
            onClick={() => setBranches((n) => Math.max(1, n - 1))}
          >
            −
          </button>
          <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
            {branches}
          </span>
          <button
            type="button"
            aria-label="Agregar una sede"
            className="h-7 w-7 rounded-full border border-border bg-card disabled:opacity-40"
            disabled={branches >= max}
            onClick={() => setBranches((n) => Math.min(max, n + 1))}
          >
            +
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-full border border-border bg-card p-0.5">
        {(["monthly", "annual"] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cycle === c}
            onClick={() => onCycle(c)}
            className={`rounded-full px-2 py-1 transition ${
              cycle === c ? "bg-fuchsia-neural text-white" : "text-muted-foreground"
            }`}
          >
            {c === "monthly"
              ? "Mensual"
              : `Anual (${INSTITUTION_BILLING.annualMonths} por ${INSTITUTION_BILLING.annualPaidMonths})`}
          </button>
        ))}
      </div>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">
          {cycle === "annual" ? `Total ${b.months} meses` : "Total al mes"}
        </span>
        <span className="text-base font-bold tabular-nums text-fuchsia-neural">
          {COP(b.totalCOP)}
        </span>
      </p>
      {cycle === "annual" && (
        <p className="text-emerald-700 dark:text-emerald-400">
          Ahorras {COP(b.annualDiscountCOP)}: {COP(Math.round(b.totalCOP / b.months))} al mes.
        </p>
      )}
      <p className="text-muted-foreground">Al pagar se cobran las sedes activas de tu cuenta.</p>
    </div>
  );
}
