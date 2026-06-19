import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection } from "@/components/humanix/LegalPage";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/terminos")({
  head: () =>
    buildSeo({
      title: "Términos y Condiciones · Colombia",
      path: "/terminos",
      description:
        "Términos y Condiciones de uso de Humanix.lat como portal de contacto (Art. 53 Ley 1480 de 2011) entre profesionales independientes de la salud y usuarios en Colombia.",
    }),
  component: TerminosPage,
});

function TerminosPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Términos y Condiciones", path: "/terminos" },
        ]}
      />
      <LegalPage
        badge="Legal"
        title={
          <>
            Términos y <span className="text-gradient-bio">Condiciones</span>
          </>
        }
        updatedAt="18 de mayo de 2026"
        intro="Humanix.lat es un Portal de Contacto en los términos del Artículo 53 de la Ley 1480 de 2011. No es IPS, EPS, empleador ni proveedor de servicios de salud: actuamos exclusivamente como facilitador tecnológico entre profesionales independientes y usuarios demandantes."
      >
        <LegalSection title="Naturaleza de la Plataforma">
          <p>
            Humanix.lat es un ecosistema tecnológico avanzado diseñado para la intermediación y el
            contacto. Se declara expresa e inequívocamente que Humanix.lat <strong>no es una IPS</strong>,
            <strong> no es una EPS</strong>, no constituye un centro de asistencia social, ni ostenta
            la calidad de empleador o contratante laboral de los profesionales inscritos. La plataforma
            no planifica, ejecuta, supervisa, audita ni interviene en actividades médicas,
            asistenciales, de enfermería, terapéuticas o de cuidado físico o psicológico.
          </p>
          <p>
            Nuestra función se circunscribe estrictamente a la de facilitador tecnológico, operando
            bajo la arquitectura jurídica de <strong>Portal de Contacto</strong>, según el{" "}
            <strong>Artículo 53 de la Ley 1480 de 2011</strong> (Estatuto del Consumidor) y la
            doctrina vinculante de la Superintendencia de Industria y Comercio (SIC).
          </p>
          <p className="italic border-l-2 border-border pl-4">
            "Los portales de contacto son aquellos sitios electrónicos en los que se ponen en contacto
            a oferentes y demandantes de productos o servicios. Quienes administren estos portales de
            contacto no serán considerados como proveedores de los bienes o servicios que se ofrecen
            a través de los mismos, siempre que cumplan con el deber de identificación del oferente y
            con las obligaciones de información que establezca el reglamento."
          </p>
          <p>Protocolos de cumplimiento que ejecuta Humanix:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Identificación del Oferente:</strong> registro validado y trazable de
              profesionales (nombre, documento, tarjeta profesional y, cuando aplique, verificación
              de inscripción en el REPS bajo la Resolución 3100 de 2019).
            </li>
            <li>
              <strong>Autonomía de la Voluntad Privada:</strong> Humanix no fija ni impone tarifas,
              honorarios, horarios, turnos, metodologías o protocolos. Toda condición es pactada
              directamente entre usuario y profesional (Art. 1602 Código Civil).
            </li>
            <li>
              <strong>Ausencia Absoluta de Subordinación:</strong> no concurren los elementos del
              contrato de trabajo (Art. 23 CST). No hay subordinación jurídica ni dependencia
              económica frente a la plataforma.
            </li>
          </ul>
          <p>
            Cualquier reclamación por oportunidad, calidad, idoneidad, presunta culpa médica,
            impericia, negligencia, accidentes o responsabilidad civil o penal durante la ejecución
            del cuidado corresponde exclusivamente al profesional contratado.
          </p>
        </LegalSection>

        <LegalSection title="1. Aceptación Vinculante de los Términos">
          <p>
            El acceso, navegación, registro y uso de la plataforma web y móvil Humanix.lat (la
            "Plataforma") se rige por estos Términos y Condiciones. Al crear una cuenta o usar
            cualquier herramienta, usted adquiere la condición de Usuario (Cliente/Demandante o
            Profesional/Oferente) y celebra un contrato de adhesión legalmente vinculante con{" "}
            <strong>Humanix S.A.S.</strong> Si no acepta estas cláusulas en su totalidad, deberá
            abstenerse de utilizar la Plataforma.
          </p>
        </LegalSection>

        <LegalSection title="2. Descripción del Servicio e Intermediación">
          <p>
            Humanix.lat provee un entorno virtual que opera como vitrina tecnológica e
            infraestructura de comunicación para que profesionales independientes ofrezcan sus
            servicios autónomos. Humanix <strong>no comercializa servicios de salud directos</strong>{" "}
            ni asume la posición de proveedor en los términos del artículo 5, numeral 11, de la Ley
            1480 de 2011.
          </p>
        </LegalSection>

        <LegalSection title="3. Perfeccionamiento de la Relación Contractual Externa">
          <p>
            Al contratar a un profesional a través de la Plataforma se genera un vínculo contractual
            directo, bilateral e independiente entre el Cliente y el Profesional. Humanix actúa como
            un tercero ajeno a dicha relación. Los efectos jurídicos y el cumplimiento de las
            obligaciones pactadas corresponden exclusivamente a las partes de ese contrato privado.
          </p>
        </LegalSection>

        <LegalSection title="4. Declaraciones y Garantías de los Profesionales">
          <p>Cada profesional declara bajo la gravedad del juramento que:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Cuenta con títulos académicos idóneos, homologados y convalidados ante el Ministerio de Educación, si aplica.</li>
            <li>Posee Tarjeta Profesional u orden de inscripción vigente expedida por la autoridad competente.</li>
            <li>Cumple, cuando aplica, con la habilitación ante la Secretaría de Salud y el registro en el REPS (Resolución 3100 de 2019 y Resolución 226 de 2015).</li>
            <li>No tiene inhabilidades, antecedentes penales pendientes ni sanciones disciplinarias o administrativas vigentes.</li>
          </ul>
        </LegalSection>

        <LegalSection title="5. Exclusión Estricta de Responsabilidad">
          <p>En la medida máxima permitida por la ley colombiana, Humanix S.A.S. no será responsable por:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>La idoneidad médica, diagnósticos, tratamientos, dosificación o evolución clínica del paciente.</li>
            <li>Daño emergente, lucro cesante, perjuicio moral, lesiones personales, pérdida de oportunidad o fallecimiento derivados de la actividad del profesional.</li>
            <li>Pérdidas, hurtos o daños a bienes en el lugar donde se ejecute el servicio.</li>
            <li>Fallas técnicas, caídas del servidor o indisponibilidad por fuerza mayor o problemas en redes ajenas a nuestro control.</li>
          </ul>
        </LegalSection>

        <LegalSection title="6. Obligaciones y Deberes del Usuario">
          <ul className="list-disc pl-6 space-y-2">
            <li>Suministrar información 100% veraz, exacta y verificable.</li>
            <li>Custodiar de forma confidencial sus credenciales y responder por toda actividad realizada desde su cuenta.</li>
            <li>Mantener trato respetuoso, digno y libre de discriminación, acoso o violencia.</li>
            <li>No usar la Plataforma para fines ilícitos ni desviar el contacto fuera del ecosistema para evadir las tarifas legítimas.</li>
          </ul>
        </LegalSection>

        <LegalSection title="7. Ley Aplicable y Solución de Controversias">
          <p>
            Estos Términos se rigen por las leyes de la República de Colombia. Las controversias se
            intentarán resolver por arreglo directo en un plazo de <strong>treinta (30) días
            calendario</strong>. De persistir, las partes acudirán ante los jueces de la República,
            fijando como domicilio contractual exclusivo la ciudad de <strong>Pasto, Nariño</strong>.
          </p>
        </LegalSection>

        <LegalSection title="8. Modificaciones Unilaterales">
          <p>
            Humanix S.A.S. se reserva el derecho de modificar estos Términos en cualquier momento.
            Los cambios sustanciales se notificarán en la Plataforma o por correo. El uso continuado
            constituirá aceptación expresa de las modificaciones.
          </p>
        </LegalSection>

        <LegalSection title="9. Protección Legal Adicional y Blindaje Corporativo">
          <p>
            <strong>Limitación punitiva:</strong> Humanix, sus accionistas, representantes, directores
            o empleados no serán responsables por daños incidentales, indirectos, especiales,
            consecuenciales o punitivos (incluida pérdida de ganancias, daño al goodwill,
            interrupción de actividades o afectaciones emocionales).
          </p>
          <p>
            <strong>Indemnidad absoluta:</strong> el Usuario acepta defender, indemnizar y mantener
            indemne a Humanix S.A.S. y filiales ante toda acción, reclamación, sanción o gasto
            (incluidos honorarios de abogados) derivados del uso indebido de la Plataforma,
            incumplimiento de estos Términos, violación de derechos de terceros o daños causados
            durante la prestación del servicio autónomo.
          </p>
          <p>
            <strong>Propiedad intelectual e industrial:</strong> el software, códigos, bases de
            datos, algoritmos, interfaces, diseños, marcas ("Humanix", "Humanix.lat"), textos,
            imágenes y herramientas son propiedad exclusiva de Humanix S.A.S. Se prohíbe el web
            scraping, ingeniería inversa, descompilación o reproducción no autorizada, sancionable
            bajo la Ley 1273 de 2009 y la Ley 23 de 1982.
          </p>
          <p>
            <strong>Suspensión, exclusión y terminación:</strong> Humanix podrá suspender o cancelar
            cuentas sin previo aviso ni indemnización ante violaciones a estos Términos, fraude,
            suplantación, calificaciones extremadamente bajas, reportes de mala praxis o riesgo
            reputacional u operativo.
          </p>
          <p>
            <strong>Fuerza mayor o caso fortuito:</strong> Humanix queda exonerada conforme al Art.
            64 del Código Civil (modificado por la Ley 95 de 1890) ante desastres naturales,
            huelgas, ataques cibernéticos a gran escala, caídas masivas de proveedores cloud, fallos
            de energía o internet, guerras, emergencias sanitarias o actos de autoridad.
          </p>
          <p>
            <strong>Divisibilidad:</strong> la nulidad de cualquier cláusula no afectará la vigencia
            de las restantes.{" "}
            <strong>No renuncia de derechos:</strong> la omisión o retraso en ejercer un derecho no
            implica renuncia.{" "}
            <strong>Integridad del acuerdo:</strong> estos Términos junto con las Políticas de
            Privacidad y Habeas Data constituyen el acuerdo total entre Humanix S.A.S. y el Usuario.
          </p>
        </LegalSection>

        <LegalSection title="10. Contacto Oficial">
          <p>
            Humanix S.A.S. · Domicilio contractual: <strong>Pasto, Nariño, Colombia</strong>.<br />
            Correos: <a href="mailto:soporte@humanix.lat" className="text-foreground underline underline-offset-4">soporte@humanix.lat</a>{" "}
            · <a href="mailto:hola@humanix.lat" className="text-foreground underline underline-offset-4">hola@humanix.lat</a>{" "}
            · Respaldo: <a href="mailto:centrodigital2023@gmail.com" className="text-foreground underline underline-offset-4">centrodigital2023@gmail.com</a>
            <br />
            Teléfono / mensajería: <strong>+57 314 744 4715</strong>.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
