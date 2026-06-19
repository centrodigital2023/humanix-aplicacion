import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/humanix/LegalPage";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/confianza")({
  head: () =>
    buildSeo({
      title: "Centro de Confianza · Seguridad y Privacidad",
      path: "/confianza",
      description:
        "Cómo Humanix.lat protege la información de familias, profesionales e instituciones: controles de acceso, cifrado, retención y respuesta a incidentes.",
    }),
  component: ConfianzaPage,
});

function ConfianzaPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Centro de Confianza", path: "/confianza" },
        ]}
      />
      <LegalPage
        badge="Confianza"
        title={
          <>
            Centro de <span className="text-gradient-bio">Confianza</span>
          </>
        }
        updatedAt="18 de junio de 2026"
        intro="Esta página es mantenida por Humanix S.A.S. para responder preguntas frecuentes sobre seguridad y privacidad de la plataforma Humanix.lat. No constituye una certificación ni una verificación independiente."
      >
        <LegalSection title="Acceso y autenticación">
          <ul className="list-disc pl-6 space-y-2">
            <li>Inicio de sesión con correo y contraseña, y con Google.</li>
            <li>Las sesiones se gestionan mediante tokens firmados; las contraseñas nunca se almacenan en texto plano.</li>
            <li>Acceso por roles: profesional, familia, institución y personal interno con privilegios limitados.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Protección de datos">
          <ul className="list-disc pl-6 space-y-2">
            <li>Las tablas que contienen datos personales aplican reglas de acceso a nivel de fila para que cada usuario solo vea su propia información.</li>
            <li>Las funciones administrativas con privilegios elevados están limitadas a personal interno autenticado.</li>
            <li>Los canales en tiempo real están segmentados por usuario o conversación; los canales administrativos se restringen al personal interno.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Infraestructura y hosting">
          <p>
            Humanix.lat se ejecuta sobre proveedores de nube reconocidos (Lovable Cloud / Supabase y Cloudflare).
            La transmisión de datos entre el navegador y nuestros servidores se realiza sobre HTTPS/TLS.
          </p>
        </LegalSection>

        <LegalSection title="Subprocesadores e integraciones">
          <ul className="list-disc pl-6 space-y-2">
            <li>Supabase — base de datos, autenticación y almacenamiento.</li>
            <li>Cloudflare — entrega de contenido y red perimetral.</li>
            <li>Resend — envío de correos transaccionales.</li>
            <li>MercadoPago — procesamiento de pagos.</li>
            <li>WhatsApp Business — comunicación opcional con usuarios.</li>
          </ul>
        </LegalSection>

        <LegalSection title="Retención y eliminación">
          <p>
            Conservamos los datos mientras la cuenta esté activa o sea necesario para cumplir obligaciones legales.
            Puedes solicitar la eliminación de tu cuenta y datos asociados desde tu panel o escribiendo al correo de contacto.
          </p>
        </LegalSection>

        <LegalSection title="Privacidad y derechos del titular">
          <p>
            El tratamiento de datos personales se realiza conforme a la Ley 1581 de 2012 de Colombia.
            Consulta el detalle en nuestra{" "}
            <a href="/privacidad" className="underline">Política de Privacidad</a> y en{" "}
            <a href="/habeas-data" className="underline">Habeas Data</a>.
          </p>
        </LegalSection>

        <LegalSection title="Reporte de incidentes y vulnerabilidades">
          <p>
            Si detectas un problema de seguridad o una vulnerabilidad, escríbenos a{" "}
            <a href="mailto:soporte@humanix.lat" className="underline">soporte@humanix.lat</a>{" "}
            con los pasos para reproducirlo. Atendemos los reportes de buena fe y no tomamos acciones legales contra investigadores que actúen responsablemente.
          </p>
        </LegalSection>

        <LegalSection title="Cumplimiento">
          <p>
            Humanix.lat no opera como prestador de servicios de salud y no almacena historias clínicas.
            Esta página describe controles habilitados y prácticas operativas; no implica certificaciones externas
            (SOC 2, ISO 27001, HIPAA u otras) salvo que se indique expresamente.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}