import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/fisioterapia-domicilio")({
  head: () =>
    buildSeo({
      title: "Fisioterapia a Domicilio con Fisioterapeutas Verificados",
      path: "/fisioterapia-domicilio",
      description:
        "Fisioterapeutas con registro RETHUS verificado para rehabilitación en casa: postoperatorio, adulto mayor, movilidad y dolor. Bogotá, Medellín, Cali y más ciudades.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Fisioterapeutas verificados"
      h1={
        <>
          Fisioterapia a <span className="text-gradient-bio">domicilio</span> en Colombia
        </>
      }
      intro="Recibe tu rehabilitación sin salir de casa. Encuentra fisioterapeutas con registro RETHUS verificado para recuperación después de una cirugía, mejorar la movilidad del adulto mayor o tratar el dolor, en las principales ciudades de Colombia."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Fisioterapia a domicilio", path: "/fisioterapia-domicilio" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Fisioterapia a Domicilio",
        description:
          "Fisioterapeutas con registro RETHUS verificado para rehabilitación en casa en Colombia.",
        path: "/fisioterapia-domicilio",
      })}
      bullets={[
        "Registro profesional RETHUS verificado antes de atender.",
        "Rehabilitación postoperatoria, de movilidad y manejo del dolor.",
        "Sesiones en casa, sin traslados para el paciente.",
        "Seguimiento de cada visita desde tu panel de familia.",
      ]}
      faqs={[
        {
          q: "¿Qué tratamientos se pueden hacer en casa?",
          a: "Rehabilitación después de cirugías, ejercicios de movilidad y equilibrio para adultos mayores, terapia para el dolor y recuperación tras lesiones, según la valoración del fisioterapeuta.",
        },
        {
          q: "¿Cómo sé que el fisioterapeuta está habilitado?",
          a: "Humanix verifica el registro RETHUS de cada profesional de la salud antes de que pueda ofrecer servicios en la plataforma.",
        },
        {
          q: "¿En qué ciudades está disponible?",
          a: "En las principales ciudades de Colombia, como Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga y Pereira, según la disponibilidad de profesionales.",
        },
      ]}
      relatedLinks={[
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Enfermería domiciliaria", to: "/enfermeria-domiciliaria" },
        { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
      ]}
    />
  );
}
