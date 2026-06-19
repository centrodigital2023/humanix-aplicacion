import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-medellin")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Medellín",
      path: "/enfermeria-medellin",
      description:
        "Cuidadores y enfermeras verificadas a domicilio en Medellín y el Valle de Aburrá. RETHUS validado, GPS y soporte 24/7.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Medellín · Antioquia"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Medellín</span>
        </>
      }
      intro="Atendemos El Poblado, Laureles, Belén, Envigado, Sabaneta, Itagüí, Bello, La Estrella y todo el Valle de Aburrá con cuidadores y enfermeras certificadas."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Medellín", path: "/enfermeria-medellin" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Medellín",
        description: "Enfermería domiciliaria 24/7 en Medellín y Valle de Aburrá con RETHUS verificado.",
        path: "/enfermeria-medellin",
        areaName: "Medellín",
      })}
      bullets={[
        "Cobertura completa en Valle de Aburrá.",
        "Enfermeras con experiencia en hospitales locales reconocidos.",
        "Atención por turnos, jornadas o 24/7.",
        "Pagos protegidos y soporte en español 24/7.",
      ]}
      faqs={[
        {
          q: "¿Atienden en Envigado, Sabaneta e Itagüí?",
          a: "Sí. Cubrimos todo el Valle de Aburrá con tiempos de respuesta similares a Medellín capital.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Bogotá", to: "/enfermeria-bogota" },
        { label: "Enfermería en Cali", to: "/enfermeria-cali" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
      ]}
    />
  );
}