import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/humanix/LegalPage";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/cumplimiento")({
  head: () =>
    buildSeo({
      title: "Cumplimiento Normativo · Colombia",
      path: "/cumplimiento",
      description:
        "Marco normativo de Humanix.lat como portal de contacto en Colombia: Ley 1480, Ley 527, Ley 1341, Ley 1636, Decreto 1072, Ley 1258 y más.",
    }),
  component: CumplimientoPage,
});

function CumplimientoPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Cumplimiento Normativo", path: "/cumplimiento" },
        ]}
      />
      <LegalPage
        badge="Compliance"
        title={
          <>
            Cumplimiento <span className="text-gradient-bio">Normativo</span>
          </>
        }
        updatedAt="18 de mayo de 2026"
        intro="Humanix.lat fundamenta su operación en un estricto marco de legalidad corporativa y digital dentro de la República de Colombia. Nuestro modelo de negocio se alinea transversalmente con las siguientes normas vigentes."
      >
        <LegalSection title="Estatuto del Consumidor (Ley 1480 de 2011)">
          <p>
            Cumplimos con el régimen de protección al consumidor electrónico, transparencia
            informativa, mitigación de la asimetría informativa y la definición y exenciones
            operativas de los <strong>portales de contacto (Art. 53)</strong>.
          </p>
        </LegalSection>

        <LegalSection title="Comercio Electrónico y Mensajes de Datos (Ley 527 de 1999)">
          <p>
            Reconocemos la validez jurídica, fuerza vinculante y eficacia probatoria de los mensajes
            de datos, contratos electrónicos, firmas electrónicas o digitales y las transacciones
            desmaterializadas efectuadas en la Plataforma.
          </p>
        </LegalSection>

        <LegalSection title="Marco TIC (Ley 1341 de 2009)">
          <p>
            Operamos bajo los principios de libre competencia, masificación de las TIC, protección
            al usuario del sector tecnológico y promoción del acceso a la sociedad de la información.
          </p>
        </LegalSection>

        <LegalSection title="Servicio Público de Empleo (Ley 1636 de 2013 y Decreto 1072 de 2015)">
          <p>
            El modelo de Humanix se enfoca en el contacto civil/comercial autónomo de servicios
            prestados por profesionales independientes. Si alguna funcionalidad fuese calificada
            técnicamente como intermediación o colocación laboral, Humanix gestionará o se adaptará
            ante la <strong>UAESPE</strong>, adscrita al Ministerio del Trabajo, para operar en
            estricta legalidad.
          </p>
        </LegalSection>

        <LegalSection title="Régimen Corporativo (Ley 1258 de 2008)">
          <p>
            Humanix está constituida legalmente como <strong>Sociedad por Acciones Simplificada
            (S.A.S.)</strong>, con formalidad comercial e institucional ante la Cámara de Comercio
            correspondiente, limitando la responsabilidad de sus accionistas al monto de sus
            aportes.
          </p>
        </LegalSection>

        <LegalSection title="Protección de Datos Personales (Ley 1581 de 2012 y Decreto 1074 de 2015)">
          <p>
            Cumplimos íntegramente con el régimen general de protección de datos personales y la
            Circular 002 de 2015 de la SIC. Consulta la{" "}
            <a href="/privacidad" className="text-foreground underline underline-offset-4">
              Política de Privacidad
            </a>{" "}
            y la{" "}
            <a href="/habeas-data" className="text-foreground underline underline-offset-4">
              Política de Habeas Data
            </a>.
          </p>
        </LegalSection>

        <LegalSection title="Delitos Informáticos y Propiedad Intelectual (Ley 1273 de 2009 · Ley 23 de 1982)">
          <p>
            El uso no autorizado del software, marcas, bases de datos o algoritmos de la Plataforma,
            así como prácticas de web scraping, ingeniería inversa o suplantación, se denuncia ante
            la Fiscalía General de la Nación bajo el régimen de delitos informáticos y derechos de
            autor.
          </p>
        </LegalSection>

        <LegalSection title="Verificación de Oferentes en Salud (cuando aplica)">
          <p>
            Cuando la naturaleza del servicio autónomo lo exija, verificamos la inscripción del
            profesional en el <strong>REPS</strong> conforme a la <strong>Resolución 3100 de 2019</strong>{" "}
            y la <strong>Resolución 226 de 2015</strong>, así como su tarjeta profesional vigente
            ante la autoridad competente. Humanix.lat no presta servicios de salud directamente.
          </p>
        </LegalSection>

        <LegalSection title="Contacto Compliance">
          <p>
            Notificaciones legales y soporte normativo:{" "}
            <a href="mailto:soporte@humanix.lat" className="text-foreground underline underline-offset-4">soporte@humanix.lat</a>{" "}
            ·{" "}
            <a href="mailto:hola@humanix.lat" className="text-foreground underline underline-offset-4">hola@humanix.lat</a>{" "}
            · respaldo:{" "}
            <a href="mailto:centrodigital2023@gmail.com" className="text-foreground underline underline-offset-4">centrodigital2023@gmail.com</a>{" "}
            · teléfono <strong>+57 314 744 4715</strong> · domicilio: <strong>Pasto, Nariño,
            Colombia</strong>.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
