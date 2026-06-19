import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/humanix/Navbar";
import { Hero } from "@/components/humanix/Hero";
import { LiveSocialProof } from "@/components/humanix/LiveSocialProof";
import { TrustBar } from "@/components/humanix/TrustBar";
import { AudienceSection } from "@/components/humanix/AudienceSection";
import { Footer } from "@/components/humanix/Footer";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { QuickCareWizard } from "@/components/humanix/QuickCareWizard";
import { LaunchBar } from "@/components/humanix/LaunchBar";
import { LiveMapSection } from "@/components/humanix/LiveMapSection";

import { faqs } from "@/components/humanix/FAQ";
import * as seo from "@/lib/seo";
const { buildSeo, faqLd, SITE_NAME } = seo;
import heroImage from "@/assets/hero-humanix.webp";

// Below-the-fold: lazy to mejorar FCP/LCP
const HowItWorks = lazy(() =>
  import("@/components/humanix/HowItWorks").then((m) => ({ default: m.HowItWorks })),
);
const TechSection = lazy(() =>
  import("@/components/humanix/TechSection").then((m) => ({ default: m.TechSection })),
);
const Testimonials = lazy(() =>
  import("@/components/humanix/Testimonials").then((m) => ({ default: m.Testimonials })),
);
const Pricing = lazy(() =>
  import("@/components/humanix/Pricing").then((m) => ({ default: m.Pricing })),
);
const FAQ = lazy(() => import("@/components/humanix/FAQ").then((m) => ({ default: m.FAQ })));
const CTA = lazy(() => import("@/components/humanix/CTA").then((m) => ({ default: m.CTA })));

const HumanixAssistant = lazy(() =>
  import("@/components/humanix/HumanixAssistant").then((module) => ({
    default: module.HumanixAssistant,
  })),
);
const StickyCTA = lazy(() =>
  import("@/components/humanix/StickyCTA").then((module) => ({ default: module.StickyCTA })),
);

export const Route = createFileRoute("/")({
  head: () =>
    buildSeo({
      title: `${SITE_NAME} · Talento humano en salud para Colombia`,
      path: "/",
      appendSiteName: false,
      description:
        "Humanix conecta enfermeros, auxiliares y cuidadores con familias y clínicas de Colombia. Uber de salud con IA en tiempo real, verificación RETHUS y pagos inmediatos en Nequi y PSE.",
      extraLinks: [
        { rel: "preload", href: heroImage, as: "image", type: "image/webp", fetchPriority: "high" },
      ],
    }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: seo.jsonLdString(faqLd(faqs)) }}
      />
      <LaunchBar />
      <Navbar />
      <main>
        <Hero />
        <section className="mx-auto max-w-7xl px-4 sm:px-6 -mt-10 sm:-mt-16 relative z-10">
          <QuickCareWizard />
        </section>
        <LiveSocialProof />
        <TrustBar />
        <AudienceSection />
        <section className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <LiveMapSection role="guest" height={460} />
        </section>
        <Suspense fallback={<div className="min-h-[200px]" />}>
          <HowItWorks />
          <TechSection />
          <Testimonials />
          <Pricing />
          <FAQ />
          <CTA />
        </Suspense>
      </main>
      <Footer />
      <Suspense fallback={null}>
        <HumanixAssistant persona="default" />
      </Suspense>
      <Suspense fallback={null}>
        <StickyCTA />
      </Suspense>
      <HabeasDataConsent />
    </div>
  );
}
