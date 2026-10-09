import { createFileRoute } from "@tanstack/react-router";
import { buildSeo, SITE_NAME } from "@/lib/seo";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { ValidationSurvey } from "@/components/humanix/ValidationSurvey";

export const Route = createFileRoute("/validacion")({
  head: () =>
    buildSeo({
      title: `Registro de usuario y beneficio premium — ${SITE_NAME}`,
      path: "/validacion",
      description:
        "Cuéntanos qué necesitas o qué ofreces en salud en casa (4 minutos) y gana 1 mes del plan Esencial. Familias, IPS/EPS y profesionales.",
    }),
  component: ValidacionPage,
});

function ValidacionPage() {
  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <Navbar static />
      <main id="contenido" tabIndex={-1} className="outline-none">
        <ValidationSurvey />
      </main>
      <Footer />
    </div>
  );
}
