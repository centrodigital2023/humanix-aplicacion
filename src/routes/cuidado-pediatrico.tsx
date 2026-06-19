import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/cuidado-pediatrico")({
  head: () =>
    buildSeo({
      title: "Enfermería Pediátrica a Domicilio en Colombia",
      path: "/cuidado-pediatrico",
      description:
        "Enfermería pediátrica certificada para bebés y niños en casa. Curaciones, terapias respiratorias, administración de medicamentos y acompañamiento empático.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Cuidado pediátrico"
      h1={
        <>
          Enfermería <span className="text-gradient-bio">pediátrica</span> a domicilio
        </>
      }
      intro="Enfermeras y auxiliares con experiencia pediátrica para bebés, niños y adolescentes. Atención cálida, segura y certificada en la comodidad de tu hogar."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Cuidado pediátrico", path: "/cuidado-pediatrico" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Enfermería Pediátrica a Domicilio",
        description:
          "Cuidado pediátrico en casa: curaciones, terapias respiratorias y administración de medicamentos para bebés y niños.",
        path: "/cuidado-pediatrico",
      })}
      bullets={[
        "Terapias respiratorias y manejo de oxígeno domiciliario.",
        "Administración de medicamentos pediátricos por peso y horario.",
        "Cuidado postoperatorio y manejo de catéter PICC o gastrostomía.",
        "Acompañamiento materno-infantil y educación a cuidadores.",
      ]}
      faqs={[
        {
          q: "¿Atienden recién nacidos?",
          a: "Sí. Tenemos enfermeras especializadas en neonatos, lactancia materna, prematuros y cuidado canguro a domicilio.",
        },
        {
          q: "¿Cubren niños con condiciones crónicas?",
          a: "Sí, atendemos pacientes con cáncer, parálisis cerebral, traqueostomía y otras condiciones complejas con personal capacitado y equipo especializado.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería 24/7", to: "/enfermeria-domiciliaria" },
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
        { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
      ]}
    />
  );
}