import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { BreadcrumbJsonLd } from "./BreadcrumbJsonLd";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, ArrowLeft } from "lucide-react";
import * as seo from "@/lib/seo";

export interface ArticleProps {
  title: string;
  subtitle?: string;
  publishedDate: string; // ISO yyyy-mm-dd
  readingMinutes: number;
  jsonLd: object;
  related?: { label: string; to: string }[];
  children: ReactNode;
}

/** Reusable layout for /recursos/* blog articles with semantic HTML and JSON-LD. */
export function Article({
  title,
  subtitle,
  publishedDate,
  readingMinutes,
  jsonLd,
  related = [],
  children,
}: ArticleProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Recursos", path: "/recursos" },
          { name: title, path: `/recursos` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: seo.jsonLdString(jsonLd) }}
      />
      <Navbar />

      <main className="pt-24 pb-20">
        <article className="mx-auto max-w-3xl px-4 sm:px-6">
          <Link
            to={"/recursos" as never}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a Recursos
          </Link>

          <h1 className="font-display text-3xl sm:text-5xl font-bold leading-tight">{title}</h1>
          {subtitle ? (
            <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(publishedDate).toLocaleDateString("es-CO", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {readingMinutes} min de lectura
            </span>
          </div>

          <div className="mt-8 prose prose-invert prose-sm sm:prose-base max-w-none [&_h2]:font-display [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:mt-6 [&_p]:leading-relaxed">
            {children}
          </div>

          <div className="mt-12 rounded-2xl border border-border bg-card p-6 text-center">
            <h2 className="font-display text-xl font-bold">¿Necesitas cuidado en casa hoy?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Recibe propuestas de profesionales verificados en menos de 2 minutos.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to="/buscar">Buscar profesional</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/planes">Ver planes</Link>
              </Button>
            </div>
          </div>

          {related.length > 0 ? (
            <section className="mt-10">
              <h2 className="font-display text-xl font-bold mb-3">Sigue leyendo</h2>
              <ul className="space-y-2">
                {related.map((r) => (
                  <li key={r.to}>
                    <Link
                      to={r.to as never}
                      className="text-sm text-foreground/80 hover:text-foreground underline-offset-4 hover:underline"
                    >
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </article>
      </main>

      <Footer />
    </div>
  );
}