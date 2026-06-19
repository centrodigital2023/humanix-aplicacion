import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-barranquilla")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Barranquilla",
      path: "/enfermeria-barranquilla",
      description:
        "Cuidado en casa con enfermeras verificadas en Barranquilla y el Atlántico. RETHUS validado, GPS y atención 24/7.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Barranquilla · Atlántico"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Barranquilla</span>
        </>
      }
      intro="Atendemos Riomar, Norte-Centro Histórico, Suroriente, Suroccidente, Soledad, Puerto Colombia, Galapa y todo el área metropolitana del Atlántico."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Barranquilla", path: "/enfermeria-barranquilla" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Barranquilla",
        description: "Cuidado domiciliario verificado en Barranquilla y municipios del Atlántico.",
        path: "/enfermeria-barranquilla",
        areaName: "Barranquilla",
      })}
      bullets={[
        "Cobertura en Barranquilla y Soledad.",
        "Cuidadores costeños con calidez y experiencia.",
        "Atención por turnos diurnos y nocturnos.",
        "Pagos protegidos por Humanix.",
      ]}
      faqs={[
        {
          q: "¿Cubren Soledad y Puerto Colombia?",
          a: "Sí. Estos municipios entran dentro de nuestra cobertura del área metropolitana de Barranquilla.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Cartagena", to: "/enfermeria-cartagena" },
        { label: "Enfermería en Bogotá", to: "/enfermeria-bogota" },
      ]}
    />
  );
}