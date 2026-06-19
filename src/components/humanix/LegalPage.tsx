import { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { HabeasDataConsent } from "./HabeasDataConsent";
import { Shield } from "lucide-react";

interface LegalPageProps {
  badge: string;
  title: ReactNode;
  updatedAt: string;
  intro?: string;
  children: ReactNode;
}

export function LegalPage({ badge, title, updatedAt, intro, children }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="pt-24 pb-20">
        <section className="relative overflow-hidden py-12 sm:py-16">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Shield className="h-3.5 w-3.5" />
              {badge}
            </span>
            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              {title}
            </h1>
            <p className="mt-4 text-xs uppercase tracking-[0.2em] text-cyber-foreground/60">
              Última actualización · {updatedAt}
            </p>
            {intro && (
              <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
                {intro}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 sm:px-6 mt-10">
          <article className="rounded-3xl border border-border bg-card p-6 sm:p-10 shadow-[var(--shadow-card)] prose-legal">
            {children}
          </article>
          <p className="mt-6 text-xs text-muted-foreground text-center">
            Para solicitudes formales de Habeas Data o PQRS, escribe a{" "}
            <a
              href="mailto:legal@humanix.lat"
              className="text-foreground underline underline-offset-4"
            >
              legal@humanix.lat
            </a>
            .
          </p>
        </section>
      </main>
      <Footer />
      <HabeasDataConsent />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="font-display text-xl sm:text-2xl font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm sm:text-[15px] text-muted-foreground leading-relaxed">
        {children}
      </div>
    </section>
  );
}
