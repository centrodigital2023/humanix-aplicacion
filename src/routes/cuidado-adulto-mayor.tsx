import { createFileRoute } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

export const Route = createFileRoute("/cuidado-adulto-mayor")({
  head: () =>
    buildSeo({
      title: "Cuidado de Adulto Mayor a Domicilio en Colombia",
      path: "/cuidado-adulto-mayor",
      description:
        "Cuidadores y enfermeros verificados para el adulto mayor en casa. Atención 24/7, RETHUS validado, GPS en vivo y planes desde $25.000/hora en Colombia.",
    }),
  component: Page,
});

function Page() {
  return (
    <SeoLanding
      badge="Cuidado especializado"
      h1={
        <>
          Cuidado de <span className="text-gradient-bio">adulto mayor</span> a domicilio
        </>
      }
      intro="Conecta con cuidadores y enfermeras profesionales especializadas en adultos mayores. Verificación RETHUS, seguimiento en vivo y soporte 24/7 en todas las ciudades principales de Colombia."
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: "Cuidado adulto mayor", path: "/cuidado-adulto-mayor" },
      ]}
      serviceJsonLd={serviceLd({
        name: "Cuidado de Adulto Mayor a Domicilio",
        description:
          "Servicio de cuidadores y enfermería para adultos mayores en casa. Verificación RETHUS, GPS en vivo y atención 24/7.",
        path: "/cuidado-adulto-mayor",
      })}
      bullets={[
        "Acompañamiento, higiene, alimentación y administración de medicamentos.",
        "Cuidadores con experiencia comprobable en demencia, Alzheimer y movilidad reducida.",
        "Reportes diarios al familiar y botón de emergencia conectado a línea 123.",
        "Cobertura por turnos, 24/7 o jornadas completas según necesidad.",
      ]}
      pricingNote="Planes desde $25.000/hora · Sin permanencia · Cancela cuando quieras."
      faqs={[
        {
          q: "¿Cuánto cuesta un cuidador de adulto mayor a domicilio?",
          a: "Las tarifas en Humanix arrancan desde $25.000/hora para acompañamiento básico y varían según experiencia, ciudad y nivel de complejidad. Puedes recibir cotización en menos de 2 minutos.",
        },
        {
          q: "¿Los cuidadores están verificados?",
          a: "Sí. Validamos cédula, antecedentes, RETHUS cuando aplica, referencias y formación. Además, nuestra IA monitorea cualquier comportamiento inusual durante el servicio.",
        },
        {
          q: "¿Atienden a personas con Alzheimer o movilidad reducida?",
          a: "Sí. Filtramos por especialidad y experiencia. Puedes elegir cuidador con experiencia certificada en demencias, Alzheimer, postrados o pacientes oncológicos.",
        },
        {
          q: "¿Cómo funciona el botón de emergencia?",
          a: "El cuidador y el familiar tienen un botón que envía alerta inmediata a Humanix y a tu contacto de emergencia, junto con la ubicación GPS exacta del paciente.",
        },
      ]}
      relatedLinks={[
        { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
        { label: "Cuidado paliativo", to: "/cuidado-paliativo" },
        { label: "Enfermería domiciliaria 24/7", to: "/enfermeria-domiciliaria" },
        { label: "Cuidador en Bogotá", to: "/enfermeria-bogota" },
        { label: "Cuidador en Medellín", to: "/enfermeria-medellin" },
      ]}
    >
      <h2>¿Qué incluye el servicio de cuidado para el adulto mayor?</h2>
      <p>
        En Humanix coordinamos cuidadores y auxiliares de enfermería que cubren tareas básicas y avanzadas: higiene personal, vestido, alimentación, control de signos vitales, administración de medicamentos por horario, acompañamiento en caminatas y citas médicas, y compañía emocional. Cuando el caso lo requiere, asignamos enfermería profesional con tarjeta RETHUS para procedimientos como curaciones, oxigenoterapia o sondas.
      </p>
      <h2>¿Cómo elegimos el mejor cuidador para tu familia?</h2>
      <p>
        Nuestra IA analiza la condición clínica del paciente, la zona, el horario y las preferencias familiares para presentarte 3-5 perfiles compatibles en menos de 2 minutos. Cada perfil incluye experiencia, calificación, distancia y especialidades. Tú agendas con un toque y recibes confirmación inmediata por WhatsApp.
      </p>
      <h2>Ciudades donde operamos</h2>
      <p>
        Bogotá, Medellín, Cali, Barranquilla, Cartagena, Bucaramanga, Pereira y municipios cercanos. Si vives fuera de estas ciudades, escríbenos y activamos cobertura bajo demanda.
      </p>
    </SeoLanding>
  );
}