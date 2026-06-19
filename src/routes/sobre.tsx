import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/humanix/ContentPage";
import { Building2, Users, MapPin, Star, Shield, Zap, Heart } from "lucide-react";
import { buildSeo, jsonLdString, breadcrumbLd, SITE_URL, SITE_NAME } from "@/lib/seo";
import { SocialIcons } from "@/components/humanix/SocialIcons";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";

const aboutPageLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: `Sobre ${SITE_NAME}`,
  url: `${SITE_URL}/sobre`,
  description:
    "Humanix es la plataforma premium de salud que conecta profesionales verificados con familias y clínicas en Colombia usando IA en tiempo real.",
  mainEntity: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    foundingDate: "2023",
    foundingLocation: {
      "@type": "Place",
      name: "Bogotá, Colombia",
    },
    numberOfEmployees: { "@type": "QuantitativeValue", value: "15" },
    areaServed: { "@type": "Country", name: "Colombia" },
    slogan: "Talento humano en salud, verificado con IA",
    knowsAbout: [
      "Enfermería domiciliaria",
      "Cuidado de adulto mayor",
      "Verificación RETHUS",
      "Inteligencia artificial en salud",
      "Marketplace de talento en salud",
    ],
  },
};

const STATS = [
  { icon: Users, label: "Profesionales activos", value: "+100" },
  { icon: MapPin, label: "Ciudades en Colombia", value: "7+" },
  { icon: Star, label: "Calificación promedio", value: "4.9/5" },
  { icon: Shield, label: "Verificación RETHUS", value: "100%" },
];

const VALUES = [
  {
    icon: Shield,
    title: "Confianza",
    desc: "Verificamos cédula, RETHUS y antecedentes de cada profesional. Tu seguridad no es negociable.",
    color: "text-biosensor",
    bg: "bg-biosensor/5 border-biosensor/20",
  },
  {
    icon: Heart,
    title: "Accesibilidad",
    desc: "Salud de calidad para todas las familias colombianas, desde cualquier ciudad, a cualquier hora.",
    color: "text-fuchsia-neural",
    bg: "bg-fuchsia-neural/5 border-fuchsia-neural/20",
  },
  {
    icon: Zap,
    title: "Innovación",
    desc: "IA de matching en <150 ms, GPS en vivo, Trust Score y anti-fraude. Tecnología al servicio de la vida.",
    color: "text-copper",
    bg: "bg-copper/5 border-copper/20",
  },
  {
    icon: Users,
    title: "Impacto Social",
    desc: "Generamos empleo digno para profesionales de salud y mejor bienestar para familias colombianas.",
    color: "text-cyber",
    bg: "bg-cyber/5 border-cyber/20",
  },
];

export const Route = createFileRoute("/sobre")({
  head: () =>
    buildSeo({
      title: "Sobre Humanix · Plataforma de Salud con IA en Colombia",
      path: "/sobre",
      description:
        "Humanix conecta +100 profesionales de salud verificados con familias y clínicas en Colombia. Verificación RETHUS, IA en tiempo real y cobertura en 7+ ciudades.",
    }),
  component: SobrePage,
});

function SobrePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(aboutPageLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString(
            breadcrumbLd([
              { name: "Inicio", path: "/" },
              { name: "Sobre Humanix", path: "/sobre" },
            ]),
          ),
        }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Sobre Humanix", path: "/sobre" },
        ]}
      />
      <ContentPage
        icon={Building2}
        badge="Nosotros"
        title={
          <>
            Sobre <span className="text-gradient-bio">Humanix</span>
          </>
        }
        description="La plataforma premium que conecta profesionales de salud verificados con familias y clínicas en Colombia — potenciada con IA en tiempo real."
      >
        <div className="space-y-10">

          {/* MÉTRICAS ---------------------------------------------------- */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 not-prose">
            {STATS.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-border bg-card p-4 text-center"
              >
                <s.icon className="mx-auto h-5 w-5 text-biosensor mb-2" />
                <div className="font-display text-2xl font-bold text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* MISIÓN ------------------------------------------------------ */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Nuestra Misión</h2>
            <p className="text-muted-foreground leading-relaxed">
              Democratizar el acceso a profesionales de salud verificados en Colombia. Que cualquier
              familia pueda encontrar una enfermera, auxiliar o cuidador de confianza — en menos de
              2 minutos, desde cualquier ciudad, a cualquier hora — sin pagar comisiones ni
              arriesgarse con perfiles sin verificar.
            </p>
          </div>

          {/* VISIÓN ------------------------------------------------------ */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Nuestra Visión</h2>
            <p className="text-muted-foreground leading-relaxed">
              Ser la red de talento humano en salud más confiable de Latinoamérica: donde los
              profesionales dedican su tiempo a cuidar, no a buscar trabajo; y donde las familias e
              instituciones acceden a cuidado integral con total tranquilidad.
            </p>
          </div>

          {/* VALORES ---------------------------------------------------- */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">Nuestros Valores</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 not-prose">
              {VALUES.map((v) => (
                <div
                  key={v.title}
                  className={`rounded-2xl border p-5 ${v.bg}`}
                >
                  <v.icon className={`h-6 w-6 mb-3 ${v.color}`} />
                  <h3 className={`font-display text-lg font-semibold ${v.color} mb-1`}>
                    {v.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{v.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* POR QUÉ HUMANIX ------------------------------------------- */}
          <div className="rounded-2xl border border-biosensor/20 bg-biosensor/5 p-6 not-prose">
            <h2 className="text-2xl font-bold text-foreground mb-4">¿Por qué Humanix?</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {[
                "Verificación RETHUS en tiempo real — no más perfiles falsos",
                "GPS en vivo durante cada servicio domiciliario",
                "Trust Score IA para cada profesional — transparencia total",
                "Sin comisiones — el profesional cobra directo al cliente",
                "Matching IA en menos de 150 ms — rapidez cuando más importa",
                "Disponibilidad 24/7 para emergencias y turno de guardia",
                "Protección de datos bajo estándares internacionales (HABEAS DATA)",
                "Anti-fraude IA activo — alertas automáticas ante actividad sospechosa",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-foreground/80">
                  <span className="text-biosensor font-bold shrink-0 mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* EQUIPO ----------------------------------------------------- */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Nuestro Equipo</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              Humanix nació en Colombia con un equipo multidisciplinario: médicos, enfermeros,
              ingenieros de software y especialistas en IA con la misión compartida de transformar
              el acceso a la salud.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Trabajamos con mentores de universidades líderes, el respaldo de inversionistas que
              creen en el impacto social, y la confianza de más de 100 profesionales y cientos de
              familias colombianas que ya usan la plataforma.
            </p>
          </div>

          {/* CIUDADES --------------------------------------------------- */}
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Cobertura en Colombia</h2>
            <div className="flex flex-wrap gap-2 not-prose">
              {[
                "Bogotá", "Medellín", "Cali", "Barranquilla",
                "Cartagena", "Bucaramanga", "Pereira",
              ].map((city) => (
                <span
                  key={city}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground/80"
                >
                  <MapPin className="h-3 w-3 text-biosensor" />
                  {city}
                </span>
              ))}
              <span className="inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground">
                + municipios cercanos
              </span>
            </div>
          </div>

          {/* CTA -------------------------------------------------------- */}
          <div className="pt-6 border-t border-border not-prose">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <p className="text-muted-foreground text-sm">
                ¿Quieres ser parte de nuestra misión?{" "}
                <a href="/carreras" className="text-biosensor font-medium hover:underline">
                  Únete al equipo
                </a>{" "}
                o{" "}
                <a href="/contacto" className="text-biosensor font-medium hover:underline">
                  contáctanos
                </a>
                .
              </p>
              <div className="flex flex-col items-end gap-2">
                <p className="text-muted-foreground text-sm font-medium">Síguenos en redes</p>
                <SocialIcons size="md" />
              </div>
            </div>
          </div>
        </div>
      </ContentPage>
    </>
  );
}
