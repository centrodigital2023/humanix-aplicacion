import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { ArrowRight, BookOpen } from "lucide-react";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/recursos")({
  head: () =>
    buildSeo({
      title: "Recursos · Guías de Cuidado en Casa",
      path: "/recursos",
      description:
        "Guías prácticas sobre cuidado en casa, cuánto cuesta una enfermera a domicilio, cómo verificar RETHUS, postoperatorio, signos de alarma y más.",
    }),
  component: ResourcesLayout,
});

const articles = [
  {
    slug: "cuanto-cuesta-enfermera-domicilio",
    title: "¿Cuánto cuesta una enfermera a domicilio en Colombia?",
    excerpt:
      "Tarifas reales 2025 por hora, turno y 24/7 para enfermeras y auxiliares en Bogotá, Medellín, Cali y Barranquilla.",
  },
  {
    slug: "como-verificar-rethus",
    title: "Cómo verificar el RETHUS de un profesional de la salud",
    excerpt:
      "Paso a paso para confirmar la tarjeta profesional en el Registro Único Nacional del Talento Humano en Salud.",
  },
  {
    slug: "cuidado-adulto-mayor-guia",
    title: "Guía completa para cuidar a un adulto mayor en casa",
    excerpt:
      "Higiene, alimentación, prevención de caídas, manejo de medicamentos y señales de alerta que no debes ignorar.",
  },
  {
    slug: "postoperatorio-en-casa",
    title: "Postoperatorio en casa: qué necesitas y cómo prepararte",
    excerpt:
      "Lista práctica para una recuperación segura: cuarto, insumos, enfermería, alimentación y signos de complicaciones.",
  },
  {
    slug: "signos-alarma-paciente-cronico",
    title: "10 signos de alarma en pacientes crónicos en casa",
    excerpt:
      "Cuándo llamar al médico, cuándo acudir a urgencias y cuándo activar la línea 123. Guía rápida para cuidadores.",
  },
  {
    slug: "contratar-cuidador-confianza",
    title: "Cómo contratar un cuidador de confianza sin estafas",
    excerpt:
      "Verificación de antecedentes, referencias laborales, contratos y cláusulas que protegen a tu familia.",
  },
];

function ResourcesLayout() {
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId.startsWith("/recursos/"));

  if (isChild) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Recursos", path: "/recursos" },
        ]}
      />
      <Navbar />

      <main className="pt-24 pb-20">
        <section className="relative overflow-hidden py-12 sm:py-16">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <BookOpen className="h-3.5 w-3.5" />
              Recursos · Cuidado en casa
            </span>
            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              Guías prácticas para familias y cuidadores
            </h1>
            <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
              Información clara, verificada por profesionales de la salud, para tomar mejores decisiones cuando alguien que amas necesita cuidado en casa.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-10">
          <div className="grid gap-4 sm:grid-cols-2">
            {articles.map((a) => (
              <Link
                key={a.slug}
                to={"/recursos/$slug" as never}
                params={{ slug: a.slug } as never}
                className="group block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-foreground/30"
              >
                <h2 className="font-display text-lg sm:text-xl font-bold text-foreground group-hover:text-biosensor transition-colors">
                  {a.title}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{a.excerpt}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-biosensor">
                  Leer guía
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}