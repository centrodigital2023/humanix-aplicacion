import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-pereira")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Pereira",
      path: "/enfermeria-pereira",
      description:
        "Cuidadores y enfermeras verificadas a domicilio en Pereira, Dosquebradas y el Eje Cafetero. RETHUS validado.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Pereira · Eje Cafetero"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Pereira</span>
        </>
      }
      intro="Atendemos Pinares, Álamos, Cerritos, Centro, Dosquebradas, La Virginia y otros municipios del Eje Cafetero."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Pereira", path: "/enfermeria-pereira" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Pereira",
        description: "Cuidado en casa con enfermeras y cuidadores verificados en Pereira y Eje Cafetero.",
        path: "/enfermeria-pereira",
        areaName: "Pereira",
      })}
      bullets={[
        "Cobertura en Pereira, Dosquebradas y La Virginia.",
        "Cuidado para adultos mayores y postoperatorios.",
        "Soporte 24/7.",
      ]}
      faqs={[
        {
          q: "¿Cubren Manizales y Armenia?",
          a: "Por ahora la cobertura del Eje Cafetero se concentra en Pereira y municipios cercanos. Estamos expandiendo a Manizales y Armenia en las próximas semanas.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Medellín", to: "/enfermeria-medellin" },
        { label: "Enfermería en Cali", to: "/enfermeria-cali" },
      ]}
    />
  );
}