import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Stethoscope,
  Wallet,
  Award,
  Bot,
  Calendar,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Button } from "@/components/ui/button";
import { HumanixAssistant } from "@/components/humanix/HumanixAssistant";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import * as seo from "@/lib/seo";
const { buildSeo, SITE_URL, SITE_NAME } = seo;

const profesionalesServiceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Humanix · Marketplace laboral para talento humano en salud",
  serviceType: "Marketplace de empleos para enfermeros, auxiliares y cuidadores",
  provider: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  },
  areaServed: {
    "@type": "Country",
    name: "Colombia",
  },
  audience: {
    "@type": "Audience",
    audienceType: "Enfermeros, auxiliares de enfermería, cuidadores y médicos generales",
  },
  url: `${SITE_URL}/profesionales`,
} as const;

export const Route = createFileRoute("/profesionales")({
  head: () =>
    buildSeo({
      title: "Profesionales de salud · Colombia",
      path: "/profesionales",
      description:
        "Enfermeros, auxiliares y cuidadores: encuentra turnos por hora, jornada o paquetes en toda Colombia. Verificación RETHUS, Trust Score y pagos en Nequi al instante.",
      image: `${SITE_URL}/og/profesionales.svg`,
      imageAlt: "Humanix para profesionales · turnos, pagos en Nequi y Trust Score",
    }),
  component: ProfesionalesPage,
});

const benefits = [
  {
    icon: Calendar,
    title: "Turnos a tu medida",
    desc: "Acepta turnos por hora, jornada o paquetes prepago desde la app o WhatsApp.",
  },
  {
    icon: Wallet,
    title: "Pago inmediato en COP",
    desc: "Cobra en Nequi, PSE o RappiPay al terminar el turno. Sin intermediarios ni demoras.",
  },
  {
    icon: Award,
    title: "Reputación verificable",
    desc: "Insignias, Social Trust Score y verificación oficial RETHUS visibles para familias e IPS.",
  },
  {
    icon: Bot,
    title: "Coach IA 24/7",
    desc: "Humanix Assistant prepara tus entrevistas, resume historiales y sube tu Trust Score.",
  },
  {
    icon: TrendingUp,
    title: "Más visibilidad con Pro",
    desc: "Boost en búsquedas, matching semántico bidireccional y validación anti-fraude prioritaria.",
  },
  {
    icon: ShieldCheck,
    title: "Cumplimiento Ley 1581",
    desc: "Tus datos están protegidos por Habeas Data. Tú decides qué compartir y con quién.",
  },
];

const steps = [
  "Crea tu perfil con cédula colombiana, RETHUS y experiencia.",
  "La IA valida tus credenciales y calcula tu Social Trust Score inicial.",
  "Recibes ofertas que matchean tu especialidad, tarifa y zona.",
  "Confirmas, llegas, te pagan al instante. Sin papeleo.",
];

function ProfesionalesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Profesionales", path: "/profesionales" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: seo.jsonLdString(profesionalesServiceLd) }}
      />
      <Navbar />
      <main className="pt-24 sm:pt-28 pb-16 sm:pb-20">
        <section className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Stethoscope className="h-3.5 w-3.5" />
              Para profesionales de salud
            </span>
            <h1 className="mt-4 font-display text-[clamp(1.875rem,5.5vw,3rem)] font-bold leading-[1.05]">
              Tu carrera en salud, <span className="text-gradient-bio">sin fricción</span>.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
              Humanix conecta enfermeros, auxiliares y cuidadores con familias, clínicas y agencias
              de toda Colombia. Trabaja cuando quieras, cobra al instante y construye reputación
              verificable.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Button variant="hero" size="xl" className="w-full sm:w-auto" asChild>
                <Link to="/auth" search={{ role: "professional" }}>
                  Crear perfil gratis <ArrowRight className="ml-1 h-5 w-5" />
                </Link>
              </Button>
              <Button variant="glass" size="xl" className="w-full sm:w-auto" asChild>
                <Link to="/buscar" search={{ tab: "ofertas" }}>
                  Ver ofertas abiertas
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] hover:-translate-y-1 transition-all duration-300"
              >
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-biosensor/20 bg-biosensor/10 text-biosensor">
                  <b.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold">{b.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-3xl border border-border bg-card p-6 sm:p-10">
            <h2 className="font-display text-2xl sm:text-3xl font-bold">Cómo funciona</h2>
            <ol className="mt-6 space-y-4">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-3">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-biosensor/15 text-biosensor inline-flex items-center justify-center text-sm font-bold">
                    {i + 1}
                  </span>
                  <p className="text-sm sm:text-base leading-relaxed">{s}</p>
                </li>
              ))}
            </ol>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to="/auth" search={{ role: "professional" }}>
                  Empezar ahora
                </Link>
              </Button>
              <Button variant="ghost" size="lg" asChild>
                <Link to="/planes">
                  Ver plan Pro <CheckCircle2 className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <HumanixAssistant
        persona="professional"
        greeting="¡Hola! Soy tu coach Humanix. ¿Quieres preparar una entrevista o subir tu Trust Score?"
      />
      <HabeasDataConsent />
    </div>
  );
}
