import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/humanix/ContentPage";
import { Briefcase } from "lucide-react";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/carreras")({
  head: () =>
    buildSeo({
      title: "Trabaja en Humanix · Oportunidades de Carrera",
      path: "/carreras",
      description:
        "Únete a nuestro equipo. Buscamos talento en medicina, tecnología y emprendimiento para transformar la salud en Colombia.",
    }),
  component: CarrerasPage,
});

function CarrerasPage() {
  return (
    <ContentPage
      icon={Briefcase}
      badge="Empleo"
      title={
        <>
          Trabaja en <span className="text-gradient-bio">Humanix</span>
        </>
      }
      description="Buscamos talento apasionado por transformar la salud. Si compartes nuestra misión, tenemos un lugar para ti."
    >
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">¿Por Qué Humanix?</h2>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="text-biosensor font-bold">→</span>
              <span className="text-muted-foreground">
                Impacto social real en millones de colombianos
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-biosensor font-bold">→</span>
              <span className="text-muted-foreground">Equipo diverso y colaborativo</span>
            </li>
            <li className="flex gap-3">
              <span className="text-biosensor font-bold">→</span>
              <span className="text-muted-foreground">
                Oportunidades de crecimiento profesional
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-biosensor font-bold">→</span>
              <span className="text-muted-foreground">Beneficios competitivos y flexibilidad</span>
            </li>
            <li className="flex gap-3">
              <span className="text-biosensor font-bold">→</span>
              <span className="text-muted-foreground">Tecnología de punta</span>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Áreas de Interés</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Ingeniería</h3>
              <p className="text-sm text-muted-foreground">
                Frontend, Backend, Mobile, DevOps, QA y especialistas en IA/ML
              </p>
            </div>
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Producto</h3>
              <p className="text-sm text-muted-foreground">
                Product Manager, UX/UI Designer, Product Analyst
              </p>
            </div>
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Salud</h3>
              <p className="text-sm text-muted-foreground">
                Médicos, Enfermeros, Especialistas clínicos, Health Data Scientist
              </p>
            </div>
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Comercial</h3>
              <p className="text-sm text-muted-foreground">
                Business Development, Ventas, Growth Marketing
              </p>
            </div>
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Operaciones</h3>
              <p className="text-sm text-muted-foreground">Supply Chain, Finance, HR, Legal</p>
            </div>
            <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-4">
              <h3 className="font-bold text-foreground mb-2">Sostenibilidad</h3>
              <p className="text-sm text-muted-foreground">Impact Specialist, Compliance Officer</p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Beneficios</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Salario competitivo</span>
            </div>
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Seguro médico para ti y tu familia</span>
            </div>
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Días de trabajo flexible</span>
            </div>
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Capacitación y desarrollo profesional</span>
            </div>
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Acceso a servicios de Humanix gratis</span>
            </div>
            <div className="flex gap-3">
              <span className="text-biosensor font-bold">✓</span>
              <span className="text-muted-foreground">Ambiente inclusivo y colaborativo</span>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-biosensor/10 to-cyber/10 border border-biosensor/20 rounded-2xl p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">Candidatos Ideales</h2>
          <ul className="space-y-2 text-muted-foreground">
            <li>• Pasión por impacto social y transformación de la salud</li>
            <li>• Mentalidad de startup: flexibilidad, proactividad, resiliencia</li>
            <li>• Excelentes habilidades de comunicación</li>
            <li>• Disposición para aprender continuamente</li>
            <li>• Capacidad de trabajo en equipo</li>
            <li>• Compromiso con la excelencia</li>
          </ul>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Proceso de Selección</h2>
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-biosensor/20 text-biosensor rounded-full flex items-center justify-center font-bold text-sm">
                1
              </div>
              <div>
                <h3 className="font-bold text-foreground">Revisión de candidatura</h3>
                <p className="text-sm text-muted-foreground">Evaluamos tu perfil y experiencia</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-biosensor/20 text-biosensor rounded-full flex items-center justify-center font-bold text-sm">
                2
              </div>
              <div>
                <h3 className="font-bold text-foreground">Entrevista inicial</h3>
                <p className="text-sm text-muted-foreground">
                  Conversamos sobre tu experiencia y motivación
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-biosensor/20 text-biosensor rounded-full flex items-center justify-center font-bold text-sm">
                3
              </div>
              <div>
                <h3 className="font-bold text-foreground">Prueba técnica/práctica</h3>
                <p className="text-sm text-muted-foreground">Demostramos nuestro trabajo juntos</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-biosensor/20 text-biosensor rounded-full flex items-center justify-center font-bold text-sm">
                4
              </div>
              <div>
                <h3 className="font-bold text-foreground">Entrevista con liderazgo</h3>
                <p className="text-sm text-muted-foreground">
                  Conoces al equipo y discutimos visión
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-biosensor/20 text-biosensor rounded-full flex items-center justify-center font-bold text-sm">
                5
              </div>
              <div>
                <h3 className="font-bold text-foreground">Oferta</h3>
                <p className="text-sm text-muted-foreground">¡Bienvenido al equipo!</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-border text-center">
          <p className="text-muted-foreground mb-4">
            ¿Viste una posición que te interesa? Envía tu CV a{" "}
            <a href="mailto:jobs@humanix.lat" className="text-biosensor font-medium hover:underline">
              jobs@humanix.lat
            </a>
          </p>
          <p className="text-sm text-muted-foreground">
            O{" "}
            <a href="/contacto" className="text-biosensor font-medium hover:underline">
              contactanos
            </a>{" "}
            si tienes preguntas.
          </p>
        </div>
      </div>
    </ContentPage>
  );
}
