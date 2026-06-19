import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/enfermeria-cali")({
  head: () =>
    buildSeo({
      title: "Enfermería y Cuidadores a Domicilio en Cali",
      path: "/enfermeria-cali",
      description:
        "Enfermería domiciliaria verificada en Cali y Valle del Cauca. Tarifas desde $25.000/hora, RETHUS validado y GPS en vivo.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Cali · Valle del Cauca"
      h1={
        <>
          Enfermería a domicilio en <span className="text-gradient-bio">Cali</span>
        </>
      }
      intro="Cobertura en Granada, San Fernando, El Peñón, Ciudad Jardín, Pance, Tequendama, Norte y municipios como Yumbo, Jamundí y Palmira."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Enfermería en Cali", path: "/enfermeria-cali" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería a Domicilio en Cali",
        description: "Servicio de enfermería domiciliaria en Cali con cuidadores y auxiliares verificados.",
        path: "/enfermeria-cali",
        areaName: "Cali",
      })}
      bullets={[
        "Atención en Cali, Yumbo, Palmira y Jamundí.",
        "Personal con tarjeta RETHUS verificada.",
        "Disponibilidad de turnos diurnos, nocturnos y 24/7.",
        "Soporte WhatsApp 24/7.",
      ]}
      faqs={[
        {
          q: "¿Tienen cobertura en Jamundí y Palmira?",
          a: "Sí. Tenemos profesionales activos en municipios cercanos a Cali con tiempos de respuesta de 2-3 horas.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería en Bogotá", to: "/enfermeria-bogota" },
        { label: "Enfermería en Medellín", to: "/enfermeria-medellin" },
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
      ]}
    />
  );
}