import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/cuidador-domicilio")({
  head: () =>
    buildSeo({
      title: "Cuidador a Domicilio Verificado en Colombia",
      path: "/cuidador-domicilio",
      description:
        "Cuidadores con experiencia comprobable y antecedentes verificados. Acompañamiento, higiene, alimentación y compañía con tarifas desde $20.000/hora.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Cuidadores certificados"
      h1={
        <>
          Cuidador a <span className="text-gradient-bio">domicilio</span> verificado
        </>
      }
      intro="Encuentra cuidadores responsables, con referencias y antecedentes validados. Para acompañamiento diurno, nocturno o 24/7, en cualquier ciudad principal de Colombia."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Cuidador a domicilio", path: "/cuidador-domicilio" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Cuidador a Domicilio",
        description:
          "Cuidadores verificados para acompañamiento, higiene, alimentación y compañía a domicilio en Colombia.",
        path: "/cuidador-domicilio",
      })}
      bullets={[
        "Antecedentes judiciales y referencias laborales verificadas.",
        "Capacitación básica en primeros auxilios y movilización.",
        "Tarifas claras desde $20.000/hora sin sorpresas.",
        "Pólizas y respaldo Humanix en cada servicio.",
      ]}
      faqs={[
        {
          q: "¿Cuál es la diferencia entre cuidador y auxiliar de enfermería?",
          a: "El cuidador acompaña, ayuda con higiene, alimentación y movilización. El auxiliar de enfermería tiene formación técnica para administrar medicamentos, controlar signos vitales y hacer curaciones básicas.",
        },
        {
          q: "¿Pueden quedarse a dormir en la casa?",
          a: "Sí. Ofrecemos modalidades por horas, turnos de 8h, 12h, 24h o internos por días o semanas según tu necesidad.",
        },
      ]}
      relatedLinks={[
        { label: "Auxiliar de enfermería", to: "/auxiliar-enfermeria" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Cómo contratar cuidador de confianza", to: "/recursos/contratar-cuidador-confianza" },
      ]}
    />
  );
}