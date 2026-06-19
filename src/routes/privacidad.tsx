import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/humanix/LegalPage";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/privacidad")({
  head: () =>
    buildSeo({
      title: "Política de Privacidad · Colombia",
      path: "/privacidad",
      description:
        "Cómo Humanix.lat recolecta, usa y protege datos personales según la Ley 1581 de 2012. Declaración expresa de no tratamiento de historias clínicas.",
    }),
  component: PrivacidadPage,
});

function PrivacidadPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Política de Privacidad", path: "/privacidad" },
        ]}
      />
      <LegalPage
        badge="Privacidad"
        title={
          <>
            Política de <span className="text-gradient-bio">Privacidad</span>
          </>
        }
        updatedAt="18 de mayo de 2026"
        intro="Humanix S.A.S., con domicilio en Pasto, Nariño, trata tus datos conforme a la Ley 1581 de 2012, el Decreto 1074 de 2015 y la Circular 002 de 2015 de la SIC."
      >
        <LegalSection title="1. Información objeto de recolección">
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Identificación y contacto:</strong> nombre completo, documento (C.C., C.E.,
              Pasaporte), dirección, correo electrónico y teléfono móvil.
            </li>
            <li>
              <strong>Perfil profesional (solo profesionales):</strong> hojas de vida, certificaciones
              académicas, antecedentes judiciales consultados en fuentes públicas, registros del REPS,
              tarjeta profesional y fotografía de perfil.
            </li>
            <li>
              <strong>Datos técnicos de navegación:</strong> dirección IP, geolocalización aproximada,
              tipo de dispositivo, sistema operativo, cookies y metadatos de uso de la Plataforma.
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="2. Finalidades del tratamiento">
          <ul className="list-disc pl-6 space-y-2">
            <li>Validar la identidad y mitigar riesgos de suplantación, fraude o conductas delictivas.</li>
            <li>Permitir la indexación y búsqueda de perfiles profesionales por clientes potenciales.</li>
            <li>Facilitar canales de comunicación internos (chats, alertas de asignación).</li>
            <li>Procesar pagos, facturación y cobro de tarifas de intermediación tecnológica, si aplica.</li>
            <li>Enviar alertas de seguridad, actualizaciones técnicas y soporte al cliente.</li>
            <li>Remitir comunicaciones comerciales o encuestas, previa autorización del usuario.</li>
          </ul>
        </LegalSection>

        <LegalSection title="3. No tratamiento de datos sensibles de salud (historias clínicas)">
          <p>
            Humanix S.A.S. declara expresamente que <strong>NO recolecta, NO almacena, NO custodia y
            NO realiza tratamiento alguno</strong> sobre datos de salud sensibles tales como
            historias clínicas, diagnósticos, prescripciones, exámenes de laboratorio o reportes
            psicológicos, conforme a las restricciones de la Ley 1581 de 2012.
          </p>
          <p>
            La Plataforma funciona únicamente para la coordinación logística del contacto. Toda
            información clínica compartida durante el cuidado ocurre dentro de la reserva profesional
            médico-paciente (<strong>Ley 23 de 1981</strong>) y se maneja directamente entre el
            profesional y el cliente, sin que Humanix posea acceso, copia o archivo.
          </p>
        </LegalSection>

        <LegalSection title="4. Transferencia y transmisión de datos">
          <p>
            Humanix S.A.S. <strong>no vende, alquila ni comercializa</strong> bases de datos
            personales. Los datos podrán compartirse con:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Encargados del Tratamiento:</strong> proveedores de servicios tecnológicos
              (cloud, pasarelas de pago, analítica) bajo contratos de transmisión que garanticen el
              cumplimiento de la normativa colombiana.
            </li>
            <li>
              <strong>Autoridades competentes:</strong> cuando exista requerimiento judicial o
              administrativo debidamente fundamentado.
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="5. Medidas de seguridad de la información">
          <p>
            Adoptamos medidas técnicas (cifrado en tránsito HTTPS/SSL, controles de acceso lógico),
            administrativas (políticas internas de confidencialidad) y físicas para mitigar riesgos
            de pérdida, alteración, acceso no autorizado o destrucción de la información.
          </p>
        </LegalSection>

        <LegalSection title="6. Uso de cookies y píxeles">
          <p>
            Utilizamos cookies propias y de terceros para optimizar la navegación, recordar sesiones
            y analizar el tráfico. El Usuario puede configurar su navegador para bloquearlas; esto
            podría limitar ciertas funciones operativas de la Plataforma.
          </p>
        </LegalSection>

        <LegalSection title="7. Conservación">
          <p>
            Conservamos los datos mientras subsistan las finalidades del tratamiento o el término
            legal de retención exigido por normas comerciales, contables o fiscales.
          </p>
        </LegalSection>

        <LegalSection title="8. Contacto">
          <p>
            Para ejercer derechos o resolver dudas sobre el tratamiento de datos:{" "}
            <a href="mailto:soporte@humanix.lat" className="text-foreground underline underline-offset-4">soporte@humanix.lat</a>{" "}
            · respaldo:{" "}
            <a href="mailto:centrodigital2023@gmail.com" className="text-foreground underline underline-offset-4">centrodigital2023@gmail.com</a>{" "}
            · teléfono <strong>+57 314 744 4715</strong>.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
