import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/humanix/LegalPage";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/habeas-data")({
  head: () =>
    buildSeo({
      title: "Habeas Data · Colombia",
      path: "/habeas-data",
      description:
        "Política de Habeas Data de Humanix S.A.S. conforme a la Ley Estatutaria 1581 de 2012 y el Decreto 1074 de 2015. Derechos, canales y términos de respuesta.",
    }),
  component: HabeasDataPage,
});

function HabeasDataPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Habeas Data", path: "/habeas-data" },
        ]}
      />
      <LegalPage
        badge="Habeas Data"
        title={
          <>
            Política de <span className="text-gradient-bio">Habeas Data</span>
          </>
        }
        updatedAt="18 de mayo de 2026"
        intro="Humanix S.A.S., con domicilio en Pasto, Nariño, actúa como Responsable del Tratamiento de bases de datos personales conforme a la Ley Estatutaria 1581 de 2012, el Decreto 1074 de 2015 y la Circular 002 de 2015 de la SIC."
      >
        <LegalSection title="1. Derechos fundamentales de los titulares (Art. 8 Ley 1581 de 2012)">
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Acceso y consulta:</strong> conocer de manera gratuita los datos personales
              sometidos a tratamiento por Humanix.
            </li>
            <li>
              <strong>Actualización y rectificación:</strong> solicitar la corrección de datos
              parciales, inexactos, incompletos, fraccionados o que induzcan a error.
            </li>
            <li>
              <strong>Revocatoria y supresión:</strong> solicitar la eliminación de los datos o
              revocar la autorización, salvo deber legal o contractual de permanencia.
            </li>
            <li>
              <strong>Prueba de autorización:</strong> solicitar prueba de la autorización otorgada
              a Humanix, salvo en los casos de ley.
            </li>
          </ul>
        </LegalSection>

        <LegalSection title="2. Canales y procedimiento (PQR)">
          <p>
            Las consultas, quejas, reclamos o solicitudes de actualización, rectificación o
            supresión se radican en:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Correos:{" "}
              <a href="mailto:soporte@humanix.lat" className="text-foreground underline underline-offset-4">soporte@humanix.lat</a>{" "}
              con copia a{" "}
              <a href="mailto:centrodigital2023@gmail.com" className="text-foreground underline underline-offset-4">centrodigital2023@gmail.com</a>
            </li>
            <li>Línea telefónica: <strong>+57 314 744 4715</strong></li>
            <li>Asunto: <em>Solicitud Derechos Habeas Data – [Nombre del Usuario]</em></li>
          </ul>
          <p>La solicitud deberá contener obligatoriamente:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Nombre completo del titular y número de documento de identificación.</li>
            <li>Descripción clara de los hechos y el derecho que desea ejercer.</li>
            <li>Documentos soporte que desee hacer valer, si aplica.</li>
            <li>Dirección física o correo electrónico para notificaciones.</li>
          </ul>
        </LegalSection>

        <LegalSection title="3. Términos legales de respuesta">
          <p>
            <strong>Consultas:</strong> diez (10) días hábiles desde la recepción, prorrogables por
            cinco (5) días hábiles adicionales informando al interesado.
          </p>
          <p>
            <strong>Reclamos:</strong> quince (15) días hábiles desde el día siguiente a la
            recepción. Si el reclamo está incompleto, se requerirá al interesado dentro de los
            cinco (5) días siguientes para subsanar; pasados dos (2) meses sin respuesta se entiende
            desistido. El plazo podrá prorrogarse máximo ocho (8) días hábiles informando al usuario.
          </p>
        </LegalSection>

        <LegalSection title="4. Autorización expresa e informada">
          <p>
            Al registrarse en Humanix.lat y aceptar esta política, el Usuario otorga su
            consentimiento <strong>previo, expreso, libre e informado</strong> para que Humanix
            S.A.S. recolecte, almacene, use, circule y procese sus datos personales conforme a las
            finalidades descritas. La vigencia de las bases de datos será igual al tiempo en que
            subsistan las finalidades del tratamiento o el término legal de retención exigido por
            normas comerciales o fiscales.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
