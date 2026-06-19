import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/cuidado-paliativo")({
  head: () =>
    buildSeo({
      title: "Cuidados Paliativos a Domicilio en Colombia",
      path: "/cuidado-paliativo",
      description:
        "Cuidados paliativos en casa con enfoque humano. Manejo del dolor, acompañamiento espiritual y apoyo emocional para el paciente y la familia, con cobertura 24/7.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Acompañamiento humano"
      h1={
        <>
          Cuidados <span className="text-gradient-bio">paliativos</span> en casa
        </>
      }
      intro="Acompañamos al paciente y a su familia con dignidad: manejo del dolor, control de síntomas, apoyo emocional y respeto absoluto por las decisiones de cada persona."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Cuidados paliativos", path: "/cuidado-paliativo" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Cuidados Paliativos Domiciliarios",
        description:
          "Equipo de enfermería paliativa con manejo del dolor, control de síntomas y apoyo emocional al paciente y la familia.",
        path: "/cuidado-paliativo",
      })}
      bullets={[
        "Manejo del dolor con enfoque farmacológico y no farmacológico.",
        "Control de síntomas: disnea, náuseas, ansiedad, insomnio.",
        "Apoyo emocional, espiritual y comunicación con el equipo médico.",
        "Acompañamiento al duelo y soporte continuo a la familia.",
      ]}
      faqs={[
        {
          q: "¿Trabajan con seguros o EPS?",
          a: "Atendemos pacientes particulares y privados. Si tu EPS cubre el servicio, te ayudamos a coordinar el plan complementario en casa.",
        },
        {
          q: "¿Pueden venir de noche?",
          a: "Sí. Ofrecemos turnos nocturnos, 24/7 y acompañamiento continuo según la necesidad del paciente.",
        },
      ]}
      relatedLinks={[
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Enfermería 24/7", to: "/enfermeria-domiciliaria" },
      ]}
    />
  );
}