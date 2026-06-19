import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo, jsonLdString, faqLd, breadcrumbLd, SITE_URL } from "@/lib/seo";
import { toast } from "sonner";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";
import { usePlan } from "@/hooks/use-plan";
import { useAppUser } from "@/hooks/use-app-user";
import { computeCta } from "@/lib/planCta";

const PLAN_FAQS = [
  {
    q: "¿Puedo cancelar en cualquier momento?",
    a: "Sí. No hay permanencia mínima. Cancelas desde tu perfil o escribiéndonos, y el plan sigue activo hasta el final del periodo pagado.",
  },
  {
    q: "¿Cuál es la diferencia entre Esencial y Pro?",
    a: "Esencial es ideal para familias y profesionales que quieren todo activo. Pro agrega boost de visibilidad en búsquedas, coach de carrera IA y sugerencias de mensajes — pensado para profesionales que quieren más servicios.",
  },
  {
    q: "¿Cómo funciona el plan Institución?",
    a: "El plan Institución está diseñado para IPS, clínicas y agencias. Incluye multi-usuario con roles (HR, evaluador, admin), pipeline con scoring IA, detección de inconsistencias en CVs y soporte prioritario con onboarding asistido. Contáctanos para adaptar el plan a tus necesidades.",
  },
  {
    q: "¿Los pagos son seguros?",
    a: "Sí. Procesamos pagos con MercadoPago (estándar PCI DSS nivel 1). No almacenamos datos de tarjetas. También aceptamos Nequi y PSE.",
  },
  {
    q: "¿Qué es la verificación RETHUS?",
    a: "RETHUS es el Registro Único Nacional del Talento Humano en Salud de Colombia. Verificamos que el número de tarjeta del profesional esté activo y sin sanciones antes de que pueda contactarte.",
  },
  {
    q: "¿Puedo cambiar de plan en cualquier momento?",
    a: "Sí. Puedes subir o bajar de plan en cualquier momento. El cambio aplica de inmediato y se prorratea en tu siguiente ciclo de facturación.",
  },
];

const pricingProductLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Planes Humanix",
  url: `${SITE_URL}/planes`,
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      item: {
        "@type": "Product",
        name: "Humanix Free",
        description: "Plan gratuito para conocer Humanix sin compromiso.",
        url: `${SITE_URL}/planes`,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "COP",
          availability: "https://schema.org/InStock",
          priceValidUntil: "2026-12-31",
        },
      },
    },
    {
      "@type": "ListItem",
      position: 2,
      item: {
        "@type": "Product",
        name: "Humanix Esencial",
        description: "Para familias y profesionales que quieren todo activo.",
        url: `${SITE_URL}/planes`,
        offers: {
          "@type": "Offer",
          price: "9000",
          priceCurrency: "COP",
          availability: "https://schema.org/InStock",
          priceValidUntil: "2026-12-31",
        },
      },
    },
    {
      "@type": "ListItem",
      position: 3,
      item: {
        "@type": "Product",
        name: "Humanix Pro Profesional",
        description: "Para profesionales que quieren visibilidad máxima y coach IA.",
        url: `${SITE_URL}/planes`,
        offers: {
          "@type": "Offer",
          price: "29000",
          priceCurrency: "COP",
          availability: "https://schema.org/InStock",
          priceValidUntil: "2026-12-31",
        },
      },
    },
    {
      "@type": "ListItem",
      position: 4,
      item: {
        "@type": "Product",
        name: "Humanix Institución (IPS)",
        description: "Para clínicas, hospitales y agencias de cuidado.",
        url: `${SITE_URL}/planes`,
        offers: {
          "@type": "Offer",
          price: "99000",
          priceCurrency: "COP",
          availability: "https://schema.org/InStock",
          priceValidUntil: "2026-12-31",
        },
      },
    },
  ],
};

export const Route = createFileRoute("/planes")({
  head: () =>
    buildSeo({
      title: "Planes y precios · Humanix",
      path: "/planes",
      description:
        "Planes Humanix desde COP 0. Free, Esencial $9.000, Pro $29.000 e Institución $99.000 COP/mes. Sin permanencia, cancela cuando quieras. Verificación RETHUS incluida.",
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
  { key: "essential_monthly", icon: Sparkles, tone: "copper" },
  { key: "pro_monthly", icon: Stethoscope, tone: "bio" },
  { key: "institution_monthly", icon: Building2, tone: "fuchsia" },
];

const TONE: Record<string, string> = {
  bio: "border-biosensor/30 bg-biosensor/5 text-biosensor",
  fuchsia: "border-fuchsia-neural/40 bg-fuchsia-neural/5 text-fuchsia-neural",
  copper: "border-copper/30 bg-copper/5 text-copper",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

type CompareRow = {
  label: string;
  free: boolean | string;
  essential: boolean | string;
  pro: boolean | string;
  institution: boolean | string;
};

const COMPARE_ROWS: CompareRow[] = [
  {
    label: "Perfil profesional o familiar",
    free: true,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Buscar y aplicar a ofertas",
    free: true,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Asistente IA básico",
    free: true,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Mensajería 1:1 (aplicaciones aceptadas)",
    free: true,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Match IA en < 150 ms",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Postulaciones ilimitadas",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Contacto directo WhatsApp",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Geolocalización en vivo + ETA",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Verificación RETHUS + anti-fraude IA",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Sin comisión (cobro directo)",
    free: false,
    essential: true,
    pro: true,
    institution: true,
  },
  {
    label: "Boost de visibilidad en búsquedas",
    free: false,
    essential: false,
    pro: true,
    institution: true,
  },
  {
    label: "Coach de carrera IA 24/7",
    free: false,
    essential: false,
    pro: true,
    institution: true,
  },
  {
    label: "Sugerencias IA en mensajes",
    free: false,
    essential: false,
    pro: true,
    institution: true,
  },
  {
    label: "Anti-fraude IA prioritario",
    free: false,
    essential: false,
    pro: true,
    institution: true,
  },
  {
    label: "Multi-usuario con roles (HR, admin)",
    free: false,
    essential: false,
    pro: false,
    institution: true,
  },
  {
    label: "Pipeline de candidatos + scoring IA",
    free: false,
    essential: false,
    pro: false,
    institution: true,
  },
  {
    label: "Detección inconsistencias CV + RETHUS",
    free: false,
    essential: false,
    pro: false,
    institution: true,
  },
  {
    label: "Créditos IA mensuales",
    free: false,
    essential: false,
    pro: false,
    institution: true,
  },
  {
    label: "Soporte prioritario + onboarding",
    free: false,
    essential: false,
    pro: false,
    institution: true,
  },
];

function CellIcon({ value }: { value: boolean | string }) {
  if (value === false)
    return <X className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="No incluido" />;
  if (value === true)
    return <Check className="mx-auto h-4 w-4 text-biosensor" aria-label="Incluido" />;
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

function PlansPage() {
  const { user, loading: userLoading } = useAppUser({ requireAuth: false });
  const {
    plan: currentPlan,
    cancelAtPeriodEnd,
    loading: planLoading,
  } = usePlan(user?.id ?? null);
  const loading = userLoading || planLoading;
  const [acting, setActing] = useState<PlanKey | null>(null);
  const autoTriggered = useRef(false);

  const ctx = { userId: user?.id ?? null, currentPlan, cancelAtPeriodEnd };

  const choose = async (key: PlanKey) => {
    const cta = computeCta(key, ctx);
    if (cta.action.kind === "free") {
      window.location.href = user ? "/dashboard" : "/auth";
      return;
    }
    if (cta.action.kind === "sales") {
      const msg = encodeURIComponent(
        "Hola Humanix 👋, quiero información del Plan Institución (IPS).",
      );
      window.open(`https://wa.me/573147444715?text=${msg}`, "_blank", "noopener,noreferrer");
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
    setActing(key);
    try {
      const def = PLAN_CATALOG[key];
      const { data, error } = await supabase.functions.invoke("mp-create-subscription", {
        body: { plan: key, amount: def.amountCOP, email: user?.email },
      });
      if (error) throw error;
      const url =
        (data as { init_point?: string; sandbox_init_point?: string })?.init_point ??
        (data as { sandbox_init_point?: string })?.sandbox_init_point;
      if (!url) throw new Error("No se pudo iniciar el checkout.");
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al iniciar el pago");
    } finally {
      setActing(null);
    }
  };

  useEffect(() => {
    if (autoTriggered.current || loading || !user) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("plan") as PlanKey | null;
    if (!requested || !(requested in PLAN_CATALOG)) return;
    if (requested === "free" || requested === "institution_monthly") return;
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
            <span className="font-semibold text-foreground">Sin permanencia.</span>{" "}
            Cancela cuando quieras.
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

        {/* PRICING CARDS ----------------------------------------------- */}
        <section
          aria-label="Planes de suscripción"
          className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {DISPLAY.map((d) => {
            const def = PLAN_CATALOG[d.key];
            const Icon = d.icon;
            const cta = computeCta(d.key, ctx);
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
                <h2 className="mt-3 font-display text-xl font-semibold">{def.label}</h2>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{def.audience}</p>
                <div className="mt-4 pb-4 border-b border-border">
                  <span className="text-3xl sm:text-4xl font-bold font-display">
                    {def.priceLabel}
                  </span>
                  {def.priceNote && (
                    <span className="text-sm text-muted-foreground ml-1">{def.priceNote}</span>
                  )}
                </div>
                <ul className="mt-5 space-y-2.5 text-sm flex-1">
                  {def.featuresLabel.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <Check className="h-4 w-4 text-biosensor mt-0.5 shrink-0" />
                      <span className="leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-6 w-full"
                  variant={
                    def.highlight ? "copper" : d.tone === "fuchsia" ? "hero" : d.tone === "bio" ? "default" : "outline"
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

        {/* FEATURE COMPARISON TABLE ------------------------------------ */}
        <section aria-label="Tabla de comparación de planes" className="mt-20">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-2">
            ¿Qué incluye cada plan?
          </h2>
          <p className="text-center text-muted-foreground text-sm mb-8">
            Compara todas las funciones y elige el plan que se adapta a ti.
          </p>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-4 pl-6 pr-4 text-left font-semibold text-foreground w-2/5">
                    Funcionalidad
                  </th>
                  {DISPLAY.map((d) => {
                    const def = PLAN_CATALOG[d.key];
                    return (
                      <th
                        key={d.key}
                        className={`py-4 px-3 text-center font-semibold w-[15%] ${
                          def.highlight ? "text-copper" : "text-foreground"
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span>{def.label}</span>
                          <span
                            className={`text-xs font-normal ${
                              def.highlight
                                ? "text-copper"
                                : "text-muted-foreground"
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
                {COMPARE_ROWS.map((row, i) => (
                  <tr
                    key={row.label}
                    className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${
                      i % 2 === 0 ? "" : "bg-muted/10"
                    }`}
                  >
                    <td className="py-3 pl-6 pr-4 text-foreground/90 leading-snug">{row.label}</td>
                    <td className="py-3 px-3 text-center">
                      <CellIcon value={row.free} />
                    </td>
                    <td className="py-3 px-3 text-center bg-copper/5">
                      <CellIcon value={row.essential} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <CellIcon value={row.pro} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <CellIcon value={row.institution} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ --------------------------------------------------------- */}
        <section aria-label="Preguntas frecuentes sobre planes" className="mt-20 max-w-3xl mx-auto">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-center mb-8">
            Preguntas frecuentes
          </h2>
          <div className="space-y-3">
            {PLAN_FAQS.map((f) => (
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
