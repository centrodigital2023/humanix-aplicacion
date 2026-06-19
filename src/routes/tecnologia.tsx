import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Brain,
  Fingerprint,
  MapPinned,
  MessageSquare,
  BarChart3,
  Radio,
  Sparkles,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Button } from "@/components/ui/button";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { buildSeo, SITE_URL } from "@/lib/seo";

export const Route = createFileRoute("/tecnologia")({
  head: () =>
    buildSeo({
      title: "Tecnología IA · Colombia",
      path: "/tecnologia",
      description:
        "Matching semántico, geolocalización en vivo, validación anti-fraude IA y análisis de sentimiento por voz. La arquitectura que potencia el talento humano en salud de Colombia.",
      image: `${SITE_URL}/og/tecnologia.svg`,
      imageAlt: "Humanix Tecnología · IA en tiempo real para salud en Colombia",
    }),
  component: TecnologiaPage,
});

const features = [
  {
    icon: Brain,
    title: "Matching semántico bidireccional",
    desc: "Embeddings de perfiles y ofertas con pgvector. Match en menos de 150 ms con explicación IA.",
    color: "text-biosensor",
  },
  {
    icon: Fingerprint,
    title: "Verificación + anti-fraude IA",
    desc: "Validación de cédula colombiana, cruce con RETHUS y detector de inconsistencias en CV con Gemini.",
    color: "text-copper",
  },
  {
    icon: MapPinned,
    title: "Geolocalización en vivo",
    desc: "Tracking del cuidador vía WebSocket Realtime. ETA dinámico y botón de pánico conectado a 123.",
    color: "text-biosensor",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp Business inteligente",
    desc: "Publica ofertas en lenguaje natural. La IA parsea, distribuye y responde 24/7 con tono humano.",
    color: "text-fuchsia-neural",
  },
  {
    icon: BarChart3,
    title: "Análisis de voz post-servicio",
    desc: "Cada valoración por voz se transcribe y se clasifica por sentimiento. Alertas al superadmin.",
    color: "text-copper",
  },
  {
    icon: Radio,
    title: "Wearables y signos vitales",
    desc: "Integraciones con dispositivos para detección de caídas y ritmo cardíaco anormal en tiempo real.",
    color: "text-fuchsia-neural",
  },
];

const compliance = [
  {
    icon: ShieldCheck,
    title: "Habeas Data Ley 1581/2012",
    desc: "Consentimiento explícito y registro auditable de cada uso de datos.",
  },
  {
    icon: Cpu,
    title: "RETHUS verificado",
    desc: "Cruce automático con el Registro Único Nacional del Talento Humano en Salud.",
  },
  {
    icon: Sparkles,
    title: "IA con propósito",
    desc: "Modelos auditables, sin discriminación y con explicabilidad para superadmins.",
  },
];

function TecnologiaPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-16 sm:pb-20">
        <section className="relative overflow-hidden py-12 sm:py-16">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-70" />
          <div className="absolute inset-0 grid-pattern opacity-40" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Sparkles className="h-3.5 w-3.5" />
              Tecnología
            </span>
            <h1 className="mt-4 font-display text-[clamp(2rem,6vw,3.75rem)] font-bold leading-[1.05] text-cyber-foreground">
              IA en tiempo real, <span className="text-gradient-bio">arquitectura de élite</span>.
            </h1>
            <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/70 leading-relaxed" />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 sm:px-6 -mt-8">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] hover:-translate-y-1 transition-all duration-300"
              >
                <div
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/5 ${f.color}`}
                >
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 rounded-3xl border border-border bg-card p-6 sm:p-10">
            <h2 className="font-display text-2xl sm:text-3xl font-bold">Cumplimiento Colombia</h2>
            <p className="mt-2 text-muted-foreground">
              Diseñado desde el primer día para operar en el marco regulatorio colombiano.
            </p>
            <div className="mt-6 grid sm:grid-cols-3 gap-4">
              {compliance.map((c) => (
                <div
                  key={c.title}
                  className="rounded-2xl border border-biosensor/20 bg-biosensor/5 p-5"
                >
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-biosensor/15 text-biosensor">
                    <c.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-3 font-semibold">{c.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{c.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-border bg-border">
            {[
              { v: "<150 ms", l: "Match en vivo" },
              { v: "87+", l: "Profesionales activos" },
              { v: "94.2%", l: "Trust Score promedio" },
              { v: "24/7", l: "Soporte IA" },
            ].map((k) => (
              <div key={k.l} className="bg-card p-6 text-center">
                <div className="font-display text-3xl font-bold text-biosensor">{k.v}</div>
                <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                  {k.l}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Button variant="hero" size="xl" asChild>
              <Link to="/planes">Ver planes y precios</Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
      <HabeasDataConsent />
    </div>
  );
}
