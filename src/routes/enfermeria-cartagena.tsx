import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-cartagena")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Cartagena",
      path: "/enfermeria-cartagena",
      description:
        "Enfermería domiciliaria verificada en Cartagena de Indias y Bolívar. RETHUS validado, GPS y soporte 24/7.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Cartagena · Bolívar"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Cartagena</span>
        </>
      }
      intro="Servicio en Bocagrande, Castillogrande, Manga, Crespo, Pie de la Popa, Centro Histórico, Turbaco y zonas turísticas."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Cartagena", path: "/enfermeria-cartagena" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Cartagena",
        description: "Servicio de enfermería domiciliaria en Cartagena de Indias y municipios cercanos.",
        path: "/enfermeria-cartagena",
        areaName: "Cartagena",
      })}
      bullets={[
        "Atención a turistas y residentes en hoteles y apartamentos.",
        "Cuidadores con experiencia en pacientes adultos mayores.",
        "Servicio bilingüe disponible bajo solicitud.",
      ]}
      faqs={[
        {
          q: "¿Atienden en hoteles?",
          a: "Sí. Coordinamos atención de enfermería en hoteles, apartamentos turísticos y residencias en Cartagena.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Barranquilla", to: "/enfermeria-barranquilla" },
        { label: "Enfermería en Medellín", to: "/enfermeria-medellin" },
      ]}
    />
  );
}