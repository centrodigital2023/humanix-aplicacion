// Página pública de una oferta de empleo con JobPosting JSON-LD (indexable).
// Renderiza detalles leídos desde Supabase (lectura anónima vía RLS) y CTA de
// contratación. Las ofertas cerradas / bloqueadas retornan 404 SEO-friendly.
import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  Loader2,
  MapPin,
  Clock,
  Briefcase,
  ArrowLeft,
  Building2,
  User,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import * as seo from "@/lib/seo";
const { SITE_NAME, SITE_URL } = seo;

type Offer = {
  id: string;
  title: string;
  description: string | null;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  city: string;
  address: string | null;
  specialty_required: string | null;
  requirements: string[] | null;
  poster_type: "family" | "institution";
  status: "open" | "filled" | "closed";
  reserved_until: string | null;
  start_date: string | null;
  end_date: string | null;
  shifts_count: number | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
  blocked: boolean;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const MODALITY_LABEL: Record<Offer["modality"], string> = {
  hour: "Por hora",
  shift: "Por turno",
  month: "Mensual",
  package: "Paquete",
};

// Schema.org employmentType mapping
const EMPLOYMENT_TYPE: Record<Offer["modality"], string> = {
  hour: "PART_TIME",
  shift: "TEMPORARY",
  month: "FULL_TIME",
  package: "CONTRACTOR",
};

export const Route = createFileRoute("/oferta/$offerId")({
  head: ({ params }) => {
    const url = `${SITE_URL}/oferta/${params.offerId}`;
    return {
      meta: [
        { title: `Oferta de empleo en salud · ${SITE_NAME}` },
        {
          name: "description",
          content:
            "Oferta verificada de trabajo en salud: cuidado, enfermería o medicina. Aplica desde Humanix con pagos en Nequi y respaldo de verificación RETHUS.",
        },
        {
          name: "robots",
          content: "index,follow,max-image-preview:large,max-snippet:-1",
        },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "og:title", content: `Oferta de empleo en salud · ${SITE_NAME}` },
        {
          property: "og:description",
          content: "Aplica a esta oferta de talento humano en salud verificada en Colombia.",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: OfferPublicPage,
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-muted-foreground">Oferta no encontrada.</p>
        <Link to="/buscar" search={{ tab: "ofertas" }} className="text-biosensor hover:underline">
          Volver al buscador
        </Link>
      </div>
    </div>
  ),
});

function jobPostingLd(offer: Offer): Record<string, unknown> {
  const datePosted = new Date(offer.created_at).toISOString();
  const validThrough = offer.end_date
    ? new Date(offer.end_date).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Convert "amount" to a monthly baseline so Google understands the salary context.
  const unitText: Record<Offer["modality"], string> = {
    hour: "HOUR",
    shift: "DAY",
    month: "MONTH",
    package: "MONTH",
  };

  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: offer.title,
    description: offer.description ?? offer.title,
    datePosted,
    validThrough,
    employmentType: EMPLOYMENT_TYPE[offer.modality],
    identifier: {
      "@type": "PropertyValue",
      name: SITE_NAME,
      value: offer.id,
    },
    hiringOrganization: {
      "@type": "Organization",
      name:
        offer.poster_type === "institution"
          ? "Institución de salud verificada"
          : "Familia verificada",
      sameAs: SITE_URL,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: offer.city,
        addressRegion: offer.city,
        addressCountry: "CO",
        streetAddress: offer.address ?? undefined,
      },
      ...(offer.lat != null && offer.lng != null
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: offer.lat,
              longitude: offer.lng,
            },
          }
        : {}),
    },
    applicantLocationRequirements: {
      "@type": "Country",
      name: "Colombia",
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "COP",
      value: {
        "@type": "QuantitativeValue",
        value: offer.amount,
        unitText: unitText[offer.modality],
      },
    },
    occupationalCategory: offer.specialty_required ?? "Talento humano en salud",
    qualifications: (offer.requirements ?? []).join("; ") || undefined,
    directApply: true,
    url: `${SITE_URL}/oferta/${offer.id}`,
  };
}

function OfferPublicPage() {
  const { offerId } = useParams({ from: "/oferta/$offerId" });
  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("job_offers")
        .select(
          "id, title, description, modality, amount, city, address, specialty_required, requirements, poster_type, status, reserved_until, start_date, end_date, shifts_count, lat, lng, created_at, updated_at, blocked",
        )
        .eq("id", offerId)
        .maybeSingle();
      if (!active) return;
      setOffer((data as Offer | null) ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [offerId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando oferta…
      </div>
    );
  }

  if (!offer || offer.blocked || offer.status !== "open") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-32 pb-20 mx-auto max-w-3xl px-4 text-center">
          <h1 className="font-display text-3xl font-bold">Oferta no disponible</h1>
          <p className="mt-2 text-muted-foreground">
            Esta oferta fue cerrada, cubierta o retirada por el publicador.
          </p>
          <Button variant="hero" asChild className="mt-6">
            <Link to="/buscar" search={{ tab: "ofertas" }}>
              Ver ofertas abiertas
            </Link>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Ofertas", path: "/buscar?tab=ofertas" },
          { name: offer.title, path: `/oferta/${offer.id}` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: seo.jsonLdString(jobPostingLd(offer)) }}
      />

      <Navbar />
      <main className="pt-28 pb-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <Link
            to="/buscar"
            search={{ tab: "ofertas" }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver a ofertas
          </Link>

          <header className="mt-4 rounded-3xl border border-border bg-card p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-biosensor/10 px-2.5 py-1 text-biosensor font-semibold">
                <Briefcase className="h-3 w-3" />
                {MODALITY_LABEL[offer.modality]}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 text-muted-foreground">
                <MapPin className="h-3 w-3" /> {offer.city}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 text-muted-foreground">
                {offer.poster_type === "institution" ? (
                  <Building2 className="h-3 w-3" />
                ) : (
                  <User className="h-3 w-3" />
                )}
                {offer.poster_type === "institution" ? "Institución" : "Familia"}
              </span>
            </div>
            <h1 className="mt-4 font-display text-2xl sm:text-4xl font-bold leading-tight">
              {offer.title}
            </h1>
            <p className="mt-3 text-2xl font-bold text-biosensor">
              {COP(offer.amount)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {MODALITY_LABEL[offer.modality].toLowerCase()}
              </span>
            </p>
            {offer.specialty_required && (
              <p className="mt-2 text-sm text-muted-foreground">
                Especialidad requerida: <strong>{offer.specialty_required}</strong>
              </p>
            )}
          </header>

          {offer.description && (
            <Card className="mt-6 p-6 sm:p-8">
              <h2 className="font-display text-lg font-semibold mb-3">Descripción</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {offer.description}
              </p>
            </Card>
          )}

          {offer.requirements && offer.requirements.length > 0 && (
            <Card className="mt-6 p-6 sm:p-8">
              <h2 className="font-display text-lg font-semibold mb-3">Requisitos</h2>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {offer.requirements.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <CheckCircle2 className="h-4 w-4 text-biosensor mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(offer.start_date || offer.end_date || offer.shifts_count) && (
            <Card className="mt-6 p-6 sm:p-8">
              <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-biosensor" /> Detalles del turno
              </h2>
              <dl className="grid sm:grid-cols-3 gap-4 text-sm">
                {offer.start_date && (
                  <div>
                    <dt className="text-muted-foreground">Inicio</dt>
                    <dd className="font-medium">
                      {new Date(offer.start_date).toLocaleDateString("es-CO")}
                    </dd>
                  </div>
                )}
                {offer.end_date && (
                  <div>
                    <dt className="text-muted-foreground">Fin</dt>
                    <dd className="font-medium">
                      {new Date(offer.end_date).toLocaleDateString("es-CO")}
                    </dd>
                  </div>
                )}
                {offer.shifts_count && (
                  <div>
                    <dt className="text-muted-foreground">Turnos</dt>
                    <dd className="font-medium">{offer.shifts_count}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="hero" size="lg" asChild>
              <Link to="/auth" search={{ role: "professional", redirect: `/oferta/${offer.id}` }}>
                Aplicar a esta oferta
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/buscar" search={{ tab: "ofertas" }}>
                Ver más ofertas
              </Link>
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
