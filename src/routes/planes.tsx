// Planes y precios (nov 2026): familias y profesionales gratis; instituciones, plan anual por tamaño de sede. Todos los
// pagos por Bre-B (Firux), dentro de Humanix. Las cifras salen de `commissionMatrix.ts` y `plans.ts`, nunca a mano.
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2,
  Check,
  Heart,
  Landmark,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  TrendingDown,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { BrebPaySheet } from "@/components/humanix/payments/BrebPaySheet";
import { buildSeo, jsonLdString, faqLd, breadcrumbLd } from "@/lib/seo";
import { pricingProductLd } from "@/lib/planSeo";
import {
  PLAN_CATALOG,
  planValidity,
  segmentOfRoles,
  type PlanKey,
  type PlanSegment,
} from "@/lib/plans";
import {
  COP,
  FIRST_SHIFT_EXEMPT_CAP_COP,
  INSTITUTION_PLANS,
  MIN_BOOKING_COP,
  PRO_TIERS,
  WALLET_CREDIT_LIMIT_COP,
  type InstitutionSize,
} from "@/lib/commissionMatrix";
import { payInstitutionPlanWithBreb } from "@/lib/firux.functions";
import { usePlan } from "@/hooks/use-plan";
import { useAppUser } from "@/hooks/use-app-user";
import { useAudience } from "@/hooks/use-audience";
import type { Audience } from "@/lib/audience";
import { computeCta } from "@/lib/planCta";
import { cn } from "@/lib/utils";

const TIERS_ASC = [...PRO_TIERS].reverse(); // 15 → 12 → 10

const PLAN_FAQS = [
  {
    q: "¿Cuánto cuesta Humanix para una familia?",
    a: "Nada. La cuenta de familia es gratis, con todas sus funciones, y nunca te cobramos comisión: pagas solo el valor del turno que acuerdas con el profesional.",
  },
  {
    q: "¿Cómo pago un turno?",
    a: "Al pedir el turno eliges Bre-B o efectivo. Con Bre-B, cuando el profesional acepta te aparece el botón «Pagar con Bre-B»: tocas «Abrir mi banco», confirmas y listo. Funciona con cualquier banco, Nequi o Daviplata. Si prefieres efectivo, le pagas en mano al terminar.",
  },
  {
    q: "¿Cuánto cobra Humanix al profesional?",
    a: `No hay mensualidad. Humanix cobra una comisión por turno que baja mientras más trabajas: ${TIERS_ASC.map((t) => `${t.pct} %`).join(", ")} según los turnos que completaste en los últimos 30 días (0 a 19, 20 a 59, 60 o más). Tu primer turno con cada familia o institución nueva no paga comisión, hasta ${COP(FIRST_SHIFT_EXEMPT_CAP_COP)}.`,
  },
  {
    q: "¿Cómo recibo mi pago como profesional?",
    a: "Guarda tu llave Bre-B (tu celular, cédula, correo o código @) en tu panel. Cuando una familia paga por Bre-B, al terminar el turno te enviamos tu parte a esa llave. Si te pagan en efectivo, la comisión se descuenta de tu billetera Humanix.",
  },
  {
    q: "¿Para qué es la billetera del profesional?",
    a: `Solo para los turnos en efectivo: al terminarlos, la comisión se descuenta de tu billetera. Tienes un cupo de ${COP(-WALLET_CREDIT_LIMIT_COP)}: puedes quedar en negativo hasta ahí, y recargas en segundos con Bre-B.`,
  },
  {
    q: "¿Cómo funciona el plan Institucional?",
    a: `Es un plan anual por tamaño de sede: ${COP(INSTITUTION_PLANS.small.monthlyCOP)} al mes para sedes de 1 a 9 profesionales (${COP(INSTITUTION_PLANS.small.annualCOP)} al año, comisión ${INSTITUTION_PLANS.small.pct} %) o ${COP(INSTITUTION_PLANS.large.monthlyCOP)} al mes para 10 o más (${COP(INSTITUTION_PLANS.large.annualCOP)} al año, comisión ${INSTITUTION_PLANS.large.pct} %). Se paga en un solo pago al año por Bre-B, sin cobros automáticos.`,
  },
  {
    q: "¿Hay un valor mínimo por turno?",
    a: `Sí, el turno mínimo es de ${COP(MIN_BOOKING_COP)}.`,
  },
  {
    q: "¿Los pagos son seguros?",
    a: "Sí. Bre-B es el sistema de pagos inmediatos del Banco de la República: pagas desde la app de tu propio banco, sin compartir tarjetas ni claves con Humanix. El pago se confirma con un aviso firmado del proveedor y nunca por WhatsApp.",
  },
];

export const Route = createFileRoute("/planes")({
  head: () =>
    buildSeo({
      title: "Planes y precios · Humanix",
      path: "/planes",
      description: `Familias: gratis y sin comisión. Profesionales: sin mensualidad, comisión de ${TIERS_ASC[0].pct} % que baja hasta ${TIERS_ASC[2].pct} %. Instituciones desde ${COP(INSTITUTION_PLANS.small.monthlyCOP)}/mes, pago anual. Pagos con Bre-B.`,
    }),
  component: PlansPage,
});

const SEGMENT_OF: Record<Audience, PlanSegment> = {
  familias: "family",
  profesionales: "professional",
  instituciones: "institution",
};

const FAQ_ONLY: Record<string, Audience[]> = {
  "¿Cuánto cobra Humanix al profesional?": ["profesionales", "instituciones"],
  "¿Cómo recibo mi pago como profesional?": ["profesionales"],
  "¿Para qué es la billetera del profesional?": ["profesionales"],
  "¿Cómo funciona el plan Institucional?": ["instituciones"],
  "¿Cuánto cuesta Humanix para una familia?": ["familias"],
};

function PlansPage() {
  const { user, loading: userLoading } = useAppUser({ requireAuth: false });
  const plan = usePlan(user?.id ?? null);
  const loading = userLoading || plan.loading;
  const { audience } = useAudience();
  const segments: PlanSegment[] = audience
    ? [SEGMENT_OF[audience]]
    : ["family", "professional", "institution"];
  const segment = segmentOfRoles(user?.roles);
  const renewSoon = planValidity(plan, Date.now()).renewSoon;
  const ctx = { userId: user?.id ?? null, currentPlan: plan.plan, segment, renewSoon };
  const [paySize, setPaySize] = useState<InstitutionSize | null>(null);
  const autoTriggered = useRef(false);

  const choose = (key: PlanKey, size: InstitutionSize = "small") => {
    const { action } = computeCta(key, ctx);
    if (action.kind === "free") {
      window.location.href = user ? "/dashboard" : "/auth";
      return;
    }
    if (action.kind === "login") {
      window.location.href = `/auth?redirect=${encodeURIComponent(action.redirectTo)}`;
      return;
    }
    if (action.kind === "current" || action.kind === "other_profile") return;
    if (plan.error) {
      // Sin saber el plan real no se abre un pago: podría ser un cobro repetido.
      toast("No pudimos confirmar tu plan ahora.", {
        description: "Revisa tu conexión e inténtalo de nuevo.",
      });
      void plan.refresh();
      return;
    }
    setPaySize(size);
  };

  // Vuelta del login con ?plan=institution_monthly: se abre el pago directamente.
  useEffect(() => {
    if (autoTriggered.current || loading || !user || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("plan");
    if (requested !== "institution_monthly") return;
    autoTriggered.current = true;
    url.searchParams.delete("plan");
    window.history.replaceState({}, "", url.toString());
    choose("institution_monthly");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(pricingProductLd()) }}
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
      <main className="mx-auto max-w-6xl px-4 pb-12 pt-24 sm:px-6 sm:pb-20 sm:pt-28">
        <header className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-biosensor/30 bg-biosensor/10 px-3 py-1.5 text-xs font-medium text-biosensor">
            <Zap className="h-3 w-3" aria-hidden="true" /> Pagos con Bre-B
          </span>
          <h1 className="mt-4 font-display text-[clamp(1.875rem,5vw,3rem)] font-bold leading-tight">
            Gratis para cuidar. <span className="text-gradient-bio">Simple para pagar.</span>
          </h1>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Familias y profesionales usan Humanix{" "}
            <span className="font-semibold text-foreground">sin mensualidad</span>. Pagas desde la
            app de tu banco, en segundos.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-biosensor" aria-hidden="true" /> RETHUS
              verificado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5 text-trust" aria-hidden="true" /> Bre-B del Banco de
              la República
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 text-copper" aria-hidden="true" /> Cualquier banco,
              Nequi o Daviplata
            </span>
          </div>
        </header>

        <div className={cn("mt-12 grid gap-6", segments.length > 1 && "lg:grid-cols-3")}>
          {segments.includes("family") && (
            <FreeCard
              planKey="family_premium_monthly"
              icon={<Heart className="h-5 w-5" aria-hidden="true" />}
              tone="copper"
              cta={computeCta("family_premium_monthly", ctx)}
              onChoose={() => choose("family_premium_monthly")}
              loading={loading}
              footer={<p className="text-sm font-semibold text-copper">💚 Nunca pagas comisión</p>}
            />
          )}
          {segments.includes("professional") && (
            <FreeCard
              planKey="pro_monthly"
              icon={<Stethoscope className="h-5 w-5" aria-hidden="true" />}
              tone="bio"
              cta={computeCta("pro_monthly", ctx)}
              onChoose={() => choose("pro_monthly")}
              loading={loading}
              footer={<CommissionLadder />}
            />
          )}
          {segments.includes("institution") && (
            <InstitutionOffer
              ctaLabel={computeCta("institution_monthly", ctx).label}
              disabled={loading || computeCta("institution_monthly", ctx).disabled}
              onChoose={(size) => choose("institution_monthly", size)}
            />
          )}
        </div>

        <HowToPay />

        <section aria-label="Preguntas frecuentes sobre planes" className="mx-auto mt-20 max-w-3xl">
          <h2 className="mb-8 text-center font-display text-2xl font-bold sm:text-3xl">
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
                  <span className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                    ⌄
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-border bg-gradient-to-br from-biosensor/5 via-card to-fuchsia-neural/5 p-8 text-center">
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            ¿Dudas sobre el plan para tu IPS o clínica?
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Te contamos cómo funciona y te ayudamos a activarlo.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href="mailto:hola@humanix.lat?subject=Plan Institucional Humanix"
              className="inline-flex h-10 items-center justify-center rounded-md bg-biosensor px-5 text-sm font-semibold text-biosensor-foreground transition-colors hover:bg-biosensor/90"
            >
              hola@humanix.lat
            </a>
            <a
              href="https://wa.me/573147444715?text=Hola%20Humanix%2C%20quiero%20informaci%C3%B3n%20del%20Plan%20Institucional."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-card px-5 text-sm font-medium transition-colors hover:bg-muted/40"
            >
              WhatsApp +57 314 744 4715
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            El WhatsApp es solo para resolver dudas. Los pagos se hacen únicamente aquí, en Humanix.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Volver al inicio
          </Link>
        </section>
      </main>
      <Footer />

      <BrebPaySheet
        open={paySize !== null}
        onOpenChange={(o) => !o && setPaySize(null)}
        title="Plan Institucional"
        subtitle={paySize ? `${INSTITUTION_PLANS[paySize].label} · 12 meses` : undefined}
        start={() => payInstitutionPlanWithBreb({ data: { size: paySize ?? "small" } })}
        paidMessage="Tu plan queda activo por un año. ¡Bienvenidos!"
        onPaid={() => void plan.refresh()}
      />
    </div>
  );
}

const TONE = {
  bio: "border-biosensor/30 bg-biosensor/5 text-biosensor",
  copper: "border-copper/30 bg-copper/5 text-copper",
} as const;

function FreeCard({
  planKey,
  icon,
  tone,
  cta,
  onChoose,
  loading,
  footer,
}: {
  planKey: PlanKey;
  icon: React.ReactNode;
  tone: keyof typeof TONE;
  cta: { label: string; disabled: boolean };
  onChoose: () => void;
  loading: boolean;
  footer: React.ReactNode;
}) {
  const def = PLAN_CATALOG[planKey];
  return (
    <article className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-xl border",
          TONE[tone],
        )}
      >
        {icon}
      </div>
      <h2 className="mt-3 font-display text-2xl font-bold">{def.label}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{def.audience}</p>
      <p className="mt-4 border-b border-border pb-4">
        <span className="font-display text-4xl font-bold">{def.priceLabel}</span>
        <span className="ml-1 text-sm text-muted-foreground">{def.priceNote}</span>
      </p>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
        {def.featuresLabel.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-biosensor" aria-hidden="true" />
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">{footer}</div>
      <Button
        className="mt-5 w-full"
        size="lg"
        variant={tone === "copper" ? "copper" : "default"}
        disabled={loading || cta.disabled}
        onClick={onChoose}
      >
        {cta.label}
      </Button>
    </article>
  );
}

/** La comisión del profesional, como una escalera que baja. */
function CommissionLadder() {
  const ranges = ["0–19 turnos", "20–59 turnos", "60 o más"];
  return (
    <div className="rounded-2xl bg-biosensor/5 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <TrendingDown className="h-4 w-4 text-biosensor" aria-hidden="true" /> Tu comisión baja
        contigo
      </p>
      <ol
        className="mt-3 flex items-end gap-2"
        aria-label="Comisión según turnos en los últimos 30 días"
      >
        {TIERS_ASC.map((t, i) => (
          <li key={t.pct} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-sm font-bold">{t.pct} %</span>
            <span
              className="w-full rounded-t-lg bg-biosensor/70"
              style={{ height: `${t.pct * 3}px` }}
              aria-hidden="true"
            />
            <span className="text-center text-[11px] leading-tight text-muted-foreground">
              {ranges[i]}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        En los últimos 30 días. Primer turno con cada familia nueva: sin comisión (hasta{" "}
        {COP(FIRST_SHIFT_EXEMPT_CAP_COP)}).
      </p>
    </div>
  );
}

function InstitutionOffer({
  ctaLabel,
  disabled,
  onChoose,
}: {
  ctaLabel: string;
  disabled: boolean;
  onChoose: (size: InstitutionSize) => void;
}) {
  const [size, setSize] = useState<InstitutionSize>("small");
  const def = PLAN_CATALOG.institution_monthly;
  const chosen = INSTITUTION_PLANS[size];
  return (
    <article className="flex flex-col rounded-3xl border border-fuchsia-neural/30 bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-fuchsia-neural/40 bg-fuchsia-neural/5 text-fuchsia-neural">
        <Building2 className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-3 font-display text-2xl font-bold">{def.label}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{def.audience}</p>
      <div role="radiogroup" aria-label="Tamaño de la sede" className="mt-4 grid gap-2">
        {(["small", "large"] as const).map((s) => {
          const p = INSTITUTION_PLANS[s];
          const on = s === size;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setSize(s)}
              className={cn(
                "rounded-2xl border-2 p-3 text-left transition",
                on
                  ? "border-fuchsia-neural bg-fuchsia-neural/5"
                  : "border-border hover:border-fuchsia-neural/40",
              )}
            >
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="font-display text-2xl font-bold">{COP(p.monthlyCOP)}</span>
              <span className="text-sm text-muted-foreground">/mes</span>
              <span className="block text-xs text-muted-foreground">
                {COP(p.annualCOP)} al año · comisión {p.pct} % al profesional
              </span>
            </button>
          );
        })}
      </div>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
        {def.featuresLabel.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-biosensor" aria-hidden="true" />
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>
      <Button
        className="mt-6 w-full"
        size="lg"
        variant="hero"
        disabled={disabled}
        onClick={() => onChoose(size)}
      >
        {ctaLabel === "Activar con Bre-B" ? `Activar · ${COP(chosen.annualCOP)} al año` : ctaLabel}
      </Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Un solo pago al año por Bre-B. Sin cobros automáticos.
      </p>
    </article>
  );
}

function HowToPay() {
  const steps = [
    {
      emoji: "📝",
      title: "Pides el turno",
      text: "Eliges Bre-B o efectivo. El turno mínimo es de " + COP(MIN_BOOKING_COP) + ".",
    },
    {
      emoji: "✅",
      title: "El profesional acepta",
      text: "Te avisamos al instante y aparece el botón «Pagar con Bre-B».",
    },
    {
      emoji: "🏦",
      title: "Abres tu banco",
      text: "Confirmas el pago en la app de tu banco, Nequi o Daviplata. ¡Listo!",
    },
  ];
  return (
    <section aria-label="Cómo se paga" className="mt-16 rounded-3xl bg-trust/5 p-6 sm:p-10">
      <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
        Pagar un turno toma 3 toques
      </h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-3xl bg-card p-5 text-center shadow-sm">
            <p aria-hidden="true" className="text-4xl">
              {s.emoji}
            </p>
            <p className="mt-2 font-display text-lg font-bold">
              {i + 1}. {s.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Y si eres profesional, tu parte llega a tu llave Bre-B apenas terminas el turno. 💸
      </p>
    </section>
  );
}
