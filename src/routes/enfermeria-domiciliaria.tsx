import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-domiciliaria")({
  head: () =>
    buildSeo({
      title: "Enfermería Domiciliaria 24/7 en Colombia",
      path: "/enfermeria-domiciliaria",
      description:
        "Enfermeras profesionales con tarjeta RETHUS para atención en casa: curaciones, medicamentos IV, control de signos vitales y acompañamiento 24/7.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Enfermería profesional"
      h1={
        <>
          Enfermería <span className="text-gradient-bio">domiciliaria</span> 24/7
        </>
      }
      intro="Conecta con enfermeras y enfermeros con tarjeta RETHUS verificada para atención profesional en tu hogar. Disponibilidad inmediata por turnos o cobertura completa."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería domiciliaria", path: "/enfermeria-domiciliaria" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería Domiciliaria 24/7",
        description:
          "Enfermería profesional a domicilio en Colombia con cobertura 24/7, RETHUS verificado y GPS en vivo.",
        path: "/enfermeria-domiciliaria",
      })}
      bullets={[
        "Tarjeta RETHUS validada en cada profesional.",
        "Tarifas claras por hora, turno o jornada.",
        "GPS en vivo, ETA en minutos y reportes digitales.",
        "Soporte 24/7 vía WhatsApp con copiloto IA.",
      ]}
      faqs={[
        {
          q: "¿Qué procedimientos pueden hacer en casa?",
          a: "Curaciones, manejo de heridas, administración de medicamentos IV/IM, terapias respiratorias, oxigenoterapia, control de signos vitales, manejo de sondas y catéteres.",
        },
        {
          q: "¿Cuánto cobran por hora?",
          a: "Las tarifas para enfermería profesional con RETHUS arrancan desde $35.000/hora. Auxiliares de enfermería desde $25.000/hora.",
        },
      ]}
      relatedLinks={[
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Auxiliar de enfermería", to: "/auxiliar-enfermeria" },
        { label: "Enfermera en Bogotá", to: "/enfermeria-bogota" },
      ]}
    />
  );
}