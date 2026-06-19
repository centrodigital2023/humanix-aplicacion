import { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { LucideIcon } from "lucide-react";

interface ContentPageProps {
  icon: LucideIcon;
  badge: string;
  title: ReactNode;
  subtitle?: string;
  description?: string;
  children: ReactNode;
}

export function ContentPage({
  icon: Icon,
  badge,
  title,
  subtitle,
  description,
  children,
}: ContentPageProps) {
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
              <Icon className="h-3.5 w-3.5" />
              {badge}
            </span>
            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-cyber-foreground/60">
                {subtitle}
              </p>
            )}
            {description && (
              <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 sm:px-6 mt-10">
          <article className="rounded-3xl border border-border bg-card p-6 sm:p-10 shadow-[var(--shadow-card)]">
            {children}
          </article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
