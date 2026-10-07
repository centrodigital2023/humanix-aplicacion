import { createFileRoute } from "@tanstack/react-router";
import { buildSeo, SITE_NAME } from "@/lib/seo";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { ValidationSurvey } from "@/components/humanix/ValidationSurvey";

export const Route = createFileRoute("/validacion")({
  head: () =>
    buildSeo({
      title: `Valida tu idea en 5 minutos — ${SITE_NAME}`,
      path: "/validacion",
      description:
        "Usa el mismo worksheet que los inversionistas para validar tu propuesta de valor. Complétalo gratis y obtén 1 mes Premium.",
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
