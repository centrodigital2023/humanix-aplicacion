import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-bogota")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Bogotá",
      path: "/enfermeria-bogota",
      description:
        "Enfermeras, auxiliares y cuidadores verificados a domicilio en Bogotá. RETHUS validado, GPS en vivo y tarifas desde $25.000/hora. Atención en menos de 2 horas.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Bogotá D.C."
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Bogotá</span>
        </>
      }
      intro="Cobertura completa en Bogotá: Chapinero, Usaquén, Suba, Engativá, Fontibón, Teusaquillo, Kennedy, Bosa, Ciudad Bolívar y municipios cercanos como Chía, Cajicá, Soacha y La Calera."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Bogotá", path: "/enfermeria-bogota" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Bogotá",
        description: "Servicio de enfermería domiciliaria 24/7 en Bogotá con verificación RETHUS y GPS en vivo.",
        path: "/enfermeria-bogota",
        areaName: "Bogotá",
      })}
      bullets={[
        "Atención en zona norte, centro y sur de Bogotá.",
        "ETA promedio de 90 minutos en zonas urbanas.",
        "Enfermeras con experiencia en clínicas de primer nivel.",
        "Cobertura para Chía, Cajicá, Sopó, Soacha y La Calera.",
      ]}
      faqs={[
        {
          q: "¿Cuánto cuesta una enfermera a domicilio en Bogotá?",
          a: "En Bogotá las tarifas arrancan desde $25.000/hora para auxiliares y $35.000/hora para enfermería profesional con RETHUS. Hay descuentos en jornadas 12h o 24h.",
        },
        {
          q: "¿En cuánto tiempo llega una enfermera?",
          a: "En zonas urbanas de Bogotá el ETA promedio es de 90 minutos. Para zonas alejadas o municipios cercanos puede tomar entre 2 y 4 horas.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Medellín", to: "/enfermeria-medellin" },
        { label: "Enfermería en Cali", to: "/enfermeria-cali" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
      ]}
    />
  );
}