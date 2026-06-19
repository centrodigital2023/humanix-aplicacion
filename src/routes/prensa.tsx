import { createFileRoute } from "@tanstack/react-router";
import { ContentPage } from "@/components/humanix/ContentPage";
import { Newspaper } from "lucide-react";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/prensa")({
  head: () =>
    buildSeo({
      title: "Prensa · Colombia",
      path: "/prensa",
      description:
        "Novedades, comunicados de prensa y cobertura mediática sobre Humanix y la transformación de la salud en Colombia.",
    }),
  component: PrensaPage,
});

function PrensaPage() {
  return (
    <ContentPage
      icon={Newspaper}
      badge="Prensa"
      title={
        <>
          Centro de <span className="text-gradient-bio">Prensa</span>
        </>
      }
      description="Encuentra comunicados, artículos y cobertura mediática sobre Humanix y el futuro de la salud digital en Colombia."
    >
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Últimas Noticias</h2>
          <div className="space-y-4">
            <div className="border-l-4 border-biosensor pl-4 py-2">
              <p className="text-xs text-biosensor font-medium uppercase tracking-wider mb-2">
                21 de Abril de 2026
              </p>
              <h3 className="font-bold text-foreground mb-2">
                Humanix alcanza 10,000 profesionales verificados en Colombia
              </h3>
              <p className="text-muted-foreground text-sm mb-2">
                La plataforma continúa su expansión con médicos, enfermeros y especialistas en toda
                el país, mejorando el acceso a salud de calidad.
              </p>
              <a href="#" className="text-biosensor text-sm font-medium hover:underline">
                Leer más →
              </a>
            </div>

            <div className="border-l-4 border-biosensor pl-4 py-2">
              <p className="text-xs text-biosensor font-medium uppercase tracking-wider mb-2">
                15 de Marzo de 2026
              </p>
              <h3 className="font-bold text-foreground mb-2">
                Humanix incorpora IA para mejorar el matching entre profesionales y pacientes
              </h3>
              <p className="text-muted-foreground text-sm mb-2">
                Una nueva generación de algoritmos permite encontrar el especialista perfecto en
                minutos.
              </p>
              <a href="#" className="text-biosensor text-sm font-medium hover:underline">
                Leer más →
              </a>
            </div>

            <div className="border-l-4 border-biosensor pl-4 py-2">
              <p className="text-xs text-biosensor font-medium uppercase tracking-wider mb-2">
                1 de Febrero de 2026
              </p>
              <h3 className="font-bold text-foreground mb-2">
                Humanix recibe certificación ISO 27001 de seguridad de información
              </h3>
              <p className="text-muted-foreground text-sm mb-2">
                Reforzamos nuestro compromiso con la protección de datos de usuarios.
              </p>
              <a href="#" className="text-biosensor text-sm font-medium hover:underline">
                Leer más →
              </a>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Sobre Humanix</h2>
          <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-6 space-y-4">
            <div>
              <h3 className="font-bold text-foreground mb-2">¿Qué es Humanix?</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Humanix es una plataforma tecnológica B2B2C que conecta profesionales de salud
                verificados con familias y clínicas en Colombia. Transformamos el acceso a atención
                médica de calidad a través de verificación rigurosa, disponibilidad 24/7 y
                protección de datos de clase mundial.
              </p>
            </div>
            <div>
              <h3 className="font-bold text-foreground mb-2">Datos Clave</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  • <strong>Usuarios:</strong> Más de 50,000 familias confiando en Humanix
                </li>
                <li>
                  • <strong>Profesionales:</strong> 10,000+ médicos y especialistas verificados
                </li>
                <li>
                  • <strong>Cobertura:</strong> 32 departamentos en Colombia
                </li>
                <li>
                  • <strong>Disponibilidad:</strong> 24/7 incluyendo servicios de emergencia
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Logros y Reconocimiento</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-biosensor/10 to-transparent border border-biosensor/20 rounded-xl p-4">
              <p className="text-2xl font-bold text-biosensor mb-2">🏆</p>
              <h3 className="font-bold text-foreground mb-1">Mejor HealthTech 2025</h3>
              <p className="text-xs text-muted-foreground">
                Reconocido como mejor startup de salud digital
              </p>
            </div>
            <div className="bg-gradient-to-br from-biosensor/10 to-transparent border border-biosensor/20 rounded-xl p-4">
              <p className="text-2xl font-bold text-biosensor mb-2">📱</p>
              <h3 className="font-bold text-foreground mb-1">Top 10 Apps Salud</h3>
              <p className="text-xs text-muted-foreground">
                Posicionada entre las 10 apps de salud más descargadas
              </p>
            </div>
            <div className="bg-gradient-to-br from-biosensor/10 to-transparent border border-biosensor/20 rounded-xl p-4">
              <p className="text-2xl font-bold text-biosensor mb-2">🌟</p>
              <h3 className="font-bold text-foreground mb-1">Impacto Social</h3>
              <p className="text-xs text-muted-foreground">
                Reconocimiento por contribución a acceso equitativo a salud
              </p>
            </div>
            <div className="bg-gradient-to-br from-biosensor/10 to-transparent border border-biosensor/20 rounded-xl p-4">
              <p className="text-2xl font-bold text-biosensor mb-2">🔒</p>
              <h3 className="font-bold text-foreground mb-1">ISO 27001</h3>
              <p className="text-xs text-muted-foreground">
                Certificado en seguridad de información
              </p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Contacto de Prensa</h2>
          <div className="bg-biosensor/5 border border-biosensor/20 rounded-xl p-6">
            <p className="text-muted-foreground mb-4">
              Para consultas de prensa, entrevistas, comunicados o cualquier solicitud de
              información, contáctanos:
            </p>
            <div className="space-y-2">
              <p className="text-foreground">
                <strong>Email:</strong>{" "}
                <a href="mailto:press@humanix.lat" className="text-biosensor hover:underline">
                  press@humanix.lat
                </a>
              </p>
              <p className="text-foreground">
                <strong>Teléfono:</strong> +57 (1) XXX XXXX
              </p>
              <p className="text-foreground">
                <strong>Twitter/X:</strong>{" "}
                <a href="#" className="text-biosensor hover:underline">
                  @HumanixColombia
                </a>
              </p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-foreground mb-4">Kit de Prensa</h2>
          <p className="text-muted-foreground mb-4">
            Descarga nuestro kit completo con logos, fotos, biografías y materiales de marca:
          </p>
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-biosensor text-white rounded-lg font-medium hover:bg-biosensor/90 transition-colors">
            📦 Descargar Kit (ZIP)
          </button>
        </div>

        <div className="mt-8 pt-8 border-t border-border text-center">
          <p className="text-muted-foreground">
            ¿Tienes una pregunta o sugerencia?{" "}
            <a href="/contacto" className="text-biosensor font-medium hover:underline">
              Contáctanos
            </a>
          </p>
        </div>
      </div>
    </ContentPage>
  );
}
