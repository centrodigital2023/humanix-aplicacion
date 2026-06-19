import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { Button } from "@/components/ui/button";
import { BreadcrumbJsonLd, type BreadcrumbItem } from "./BreadcrumbJsonLd";
import { ShieldCheck, MapPin, Activity, Star, ArrowRight, CheckCircle2 } from "lucide-react";
import { CONTACT } from "@/lib/social";
import * as seo from "@/lib/seo";

export type FaqItem = { q: string; a: string };

export interface SeoLandingProps {
  badge: string;
  h1: ReactNode;
  intro: string;
  breadcrumbs: BreadcrumbItem[];
  serviceJsonLd?: object;
  bullets: string[];
  pricingNote?: string;
  faqs: FaqItem[];
  ctaPath?: "/buscar" | "/auth" | "/planes";
  ctaLabel?: string;
  relatedLinks?: { label: string; to: string }[];
  children?: ReactNode;
}

/**
 * Reusable landing layout for SEO-focused city / specialty / resource pages.
 * Renders semantic H1/H2/H3, JSON-LD (BreadcrumbList + optional Service/FAQ),
 * and an internal-link block that strengthens topical authority.
 */
export function SeoLanding({
  badge,
  h1,
  intro,
  breadcrumbs,
  serviceJsonLd,
  bullets,
  pricingNote,
  faqs,
  ctaPath = "/buscar",
  ctaLabel = "Buscar profesional ahora",
  relatedLinks = [],
  children,
}: SeoLandingProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd items={breadcrumbs} />
      {serviceJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: seo.jsonLdString(serviceJsonLd) }}
        />
      ) : null}
      {faqs.length > 0 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: seo.jsonLdString(seo.faqLd(faqs)) }}
        />
      ) : null}
      <Navbar />

      <main id="main" className="pt-24 pb-20">
        {/* HERO --------------------------------------------------------- */}
        <section className="relative overflow-hidden py-12 sm:py-16">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
            <nav aria-label="Migas de pan" className="text-xs text-cyber-foreground/60">
              <ol className="flex flex-wrap items-center gap-1">
                {breadcrumbs.map((b, i) => (
                  <li key={b.path} className="flex items-center gap-1">
                    {i > 0 ? <span aria-hidden>›</span> : null}
                    {i < breadcrumbs.length - 1 ? (
                      <Link
                        to={b.path as never}
                        className="hover:text-cyber-foreground transition-colors"
                      >
                        {b.name}
                      </Link>
                    ) : (
                      <span className="text-cyber-foreground">{b.name}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <span className="mt-3 inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <MapPin className="h-3.5 w-3.5" />
              {badge}
            </span>

            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              {h1}
            </h1>

            <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
              {intro}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to={ctaPath as never}>
                  {ctaLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <a
                href={CONTACT.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-md border border-cyber-foreground/20 bg-cyber-foreground/5 px-5 text-sm text-cyber-foreground hover:bg-cyber-foreground/10 transition-colors"
              >
                WhatsApp {CONTACT.phoneDisplay}
              </a>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-cyber-foreground/60">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-biosensor" /> RETHUS verificado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-biosensor" /> GPS en vivo
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-biosensor" /> 4.9/5 promedio
              </span>
            </div>
          </div>
        </section>

        {/* BULLETS ------------------------------------------------------ */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-10">
          <div className="grid gap-3 sm:grid-cols-2">
            {bullets.map((b) => (
              <div
                key={b}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-biosensor" />
                <p className="text-sm text-foreground/90 leading-relaxed">{b}</p>
              </div>
            ))}
          </div>
          {pricingNote ? (
            <p className="mt-4 text-xs text-muted-foreground">{pricingNote}</p>
          ) : null}
        </section>

        {/* CONTENT (children) ------------------------------------------ */}
        {children ? (
          <section className="mx-auto max-w-3xl px-4 sm:px-6 mt-12 prose prose-invert prose-sm sm:prose-base">
            {children}
          </section>
        ) : null}

        {/* FAQ ---------------------------------------------------------- */}
        {faqs.length > 0 ? (
          <section className="mx-auto max-w-3xl px-4 sm:px-6 mt-14">
            <h2 className="font-display text-2xl sm:text-3xl font-bold mb-6">
              Preguntas frecuentes
            </h2>
            <div className="space-y-3">
              {faqs.map((f) => (
                <details
                  key={f.q}
                  className="group rounded-xl border border-border bg-card p-4 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
                    {f.q}
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                      ⌄
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ) : null}

        {/* RELATED LINKS (internal linking SEO) ------------------------ */}
        {relatedLinks.length > 0 ? (
          <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-14">
            <h2 className="font-display text-xl sm:text-2xl font-bold mb-4">
              También te puede interesar
            </h2>
            <div className="flex flex-wrap gap-2">
              {relatedLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to as never}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground/80 hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* FINAL CTA --------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-16">
          <div className="rounded-3xl border border-border bg-gradient-to-br from-card to-card/40 p-8 text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-bold">
              ¿Listo para empezar?
            </h2>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground">
              Encuentra el profesional ideal en menos de 2 minutos.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to={ctaPath as never}>{ctaLabel}</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link to="/planes">Ver planes</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}