import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/auxiliar-enfermeria")({
  head: () =>
    buildSeo({
      title: "Auxiliar de Enfermería a Domicilio en Colombia",
      path: "/auxiliar-enfermeria",
      description:
        "Auxiliares de enfermería verificadas para cuidado en casa. Signos vitales, medicamentos, curaciones básicas y acompañamiento a un toque.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Auxiliares verificadas"
      h1={
        <>
          Auxiliar de <span className="text-gradient-bio">enfermería</span> a domicilio
        </>
      }
      intro="Auxiliares de enfermería con formación técnica certificada para apoyar el cuidado en casa: signos vitales, medicamentos, curaciones, alimentación y movilización."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Auxiliar de enfermería", path: "/auxiliar-enfermeria" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Auxiliar de Enfermería a Domicilio",
        description:
          "Auxiliares de enfermería certificadas con experiencia hospitalaria, disponibles para cuidado en casa.",
        path: "/auxiliar-enfermeria",
      })}
      bullets={[
        "Formación técnica certificada y experiencia hospitalaria.",
        "Apoyo en medicamentos por horario, signos vitales y curaciones.",
        "Movilización segura y prevención de caídas.",
        "Tarifas desde $25.000/hora por turno o jornada completa.",
      ]}
      faqs={[
        {
          q: "¿Qué pueden hacer y qué no?",
          a: "Pueden administrar medicamentos prescritos, controlar signos vitales y hacer curaciones simples. Para procedimientos avanzados (vías centrales, transfusiones) asignamos enfermería profesional con RETHUS.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería 24/7", to: "/enfermeria-domiciliaria" },
        { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
      ]}
    />
  );
}