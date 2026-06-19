import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-bucaramanga")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Bucaramanga",
      path: "/enfermeria-bucaramanga",
      description:
        "Cuidadores y enfermeras verificadas en Bucaramanga y el área metropolitana de Santander. RETHUS validado y GPS en vivo.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Bucaramanga · Santander"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Bucaramanga</span>
        </>
      }
      intro="Cobertura en Cabecera, Sotomayor, Cañaveral, Real de Minas, Floridablanca, Girón y Piedecuesta."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Bucaramanga", path: "/enfermeria-bucaramanga" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Bucaramanga",
        description: "Servicio de enfermería domiciliaria en Bucaramanga y área metropolitana de Santander.",
        path: "/enfermeria-bucaramanga",
        areaName: "Bucaramanga",
      })}
      bullets={[
        "Cobertura en área metropolitana santandereana.",
        "Profesionales con experiencia en clínicas de la región.",
        "Tarifas claras desde $25.000/hora.",
      ]}
      faqs={[
        {
          q: "¿Atienden en Floridablanca y Piedecuesta?",
          a: "Sí. Estos municipios entran dentro de nuestra cobertura metropolitana de Bucaramanga.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Bogotá", to: "/enfermeria-bogota" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
      ]}
    />
  );
}