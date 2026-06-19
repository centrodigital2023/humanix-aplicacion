import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/cuidado-postoperatorio")({
  head: () =>
    buildSeo({
      title: "Cuidado Postoperatorio en Casa · Enfermería a Domicilio",
      path: "/cuidado-postoperatorio",
      description:
        "Enfermeros profesionales para tu recuperación postoperatoria en casa. Curaciones, control de signos vitales, manejo del dolor y reportes diarios. Cobertura 24/7 en Colombia.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Recuperación segura"
      h1={
        <>
          Cuidado <span className="text-gradient-bio">postoperatorio</span> en casa
        </>
      }
      intro="Enfermería profesional para acompañar tu recuperación tras una cirugía. Curaciones, manejo del dolor, signos vitales y movilización segura, con reportes para ti y tu médico."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Cuidado postoperatorio", path: "/cuidado-postoperatorio" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Cuidado Postoperatorio a Domicilio",
        description:
          "Enfermería domiciliaria postquirúrgica con curaciones, control de dolor y signos vitales. Cobertura 24/7 en Colombia.",
        path: "/cuidado-postoperatorio",
      })}
      bullets={[
        "Curaciones de heridas y manejo de drenajes con técnica aséptica.",
        "Control de signos vitales, glicemia y oxigenación.",
        "Administración de medicamentos IV, IM y orales con horario.",
        "Movilización segura, prevención de úlceras por presión y trombosis.",
      ]}
      pricingNote="Tarifas desde $35.000/hora · Paquetes 8h, 12h o 24h con descuento."
      faqs={[
        {
          q: "¿Qué tipo de cirugías cubren?",
          a: "Ortopédicas, ginecológicas, bariátricas, cardíacas, oncológicas, oftalmológicas, plásticas, urológicas y más. Asignamos enfermería con experiencia en tu tipo de cirugía.",
        },
        {
          q: "¿Cuánto tiempo necesito enfermería en casa?",
          a: "Depende del procedimiento. Cirugías ambulatorias suelen requerir 24-72h, prótesis de cadera 1-3 semanas y pacientes complejos varios meses. Te ayudamos a dimensionarlo.",
        },
        {
          q: "¿Atienden urgencias el mismo día?",
          a: "Sí. En zonas urbanas tenemos disponibilidad en menos de 2 horas para curaciones y manejo de complicaciones leves. Si es una emergencia vital, contacta línea 123.",
        },
      ]}
      relatedLinks={[
        { label: "Enfermería 24/7", to: "/enfermeria-domiciliaria" },
        { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
        { label: "Cuidado pediátrico", to: "/cuidado-pediatrico" },
        { label: "Postoperatorio en casa (guía)", to: "/recursos/postoperatorio-en-casa" },
      ]}
    />
  );
}