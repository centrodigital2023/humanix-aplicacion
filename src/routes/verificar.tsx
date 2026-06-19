import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Search,
  AlertCircle,
  Star,
  MapPin,
  Phone,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  HeartPulse,
  ExternalLink,
  BadgeCheck,
  Info,
} from "lucide-react";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { buildSeo, jsonLdString } from "@/lib/seo";

export const Route = createFileRoute("/verificar")({
  head: () =>
    buildSeo({
      title: "Verificar profesional de salud en Colombia — RETHUS y Humanix",
      path: "/verificar",
      description:
        "Consulta gratis si un enfermero, auxiliar o cuidador está verificado en RETHUS y habilitado en Humanix. Comprueba calificaciones, especialidad y estado en tiempo real. Sin registro.",
    }),
  component: VerificarPage,
});

type ProResult = {
  user_id: string;
  specialty: string | null;
  home_city: string | null;
  avg_rating: number | null;
  published: boolean;
  blocked: boolean;
  available: boolean;
  rethus_verified: boolean | null;
  verified: boolean | null;
  years_experience: number | null;
  hourly_rate: number | null;
  gender: string | null;
  profiles: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2; bg: string }> = {
  approved: {
    label: "Verificado ✓ RETHUS",
    color: "text-emerald-600",
    icon: CheckCircle2,
    bg: "bg-emerald-50 border-emerald-200",
  },
  pending: {
    label: "En revisión",
    color: "text-amber-600",
    icon: Clock,
    bg: "bg-amber-50 border-amber-200",
  },
  rejected: {
    label: "No verificado",
    color: "text-red-600",
    icon: XCircle,
    bg: "bg-red-50 border-red-200",
  },
  unverified: {
    label: "Sin verificar",
    color: "text-gray-500",
    icon: AlertCircle,
    bg: "bg-gray-50 border-gray-200",
  },
};

function ProCard({ pro }: { pro: ProResult }) {
  const name = pro.profiles?.full_name ?? "Profesional";
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const statusKey = pro.rethus_verified === true || pro.verified === true
    ? "approved"
    : pro.rethus_verified === false
    ? "rejected"
    : "unverified";
  const status = STATUS_CONFIG[statusKey] ?? STATUS_CONFIG.unverified;
  const StatusIcon = status.icon;
  const isActive = pro.published && !pro.blocked;
  const isAvailable = isActive && pro.available;

  return (
    <Card className={`p-5 border transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-elegant)] ${!isActive ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-4">
        {pro.profiles?.avatar_url ? (
          <img
            src={pro.profiles.avatar_url}
            alt={name}
            className="h-14 w-14 rounded-2xl object-cover border-2 border-biosensor/30 shrink-0"
          />
        ) : (
          <div className="h-14 w-14 rounded-2xl bg-biosensor/10 text-biosensor font-bold text-xl flex items-center justify-center shrink-0 border border-biosensor/20">
            {initials || "?"}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-semibold text-foreground leading-tight">{name}</h3>
              {pro.specialty && (
                <p className="text-sm text-muted-foreground mt-0.5">{pro.specialty}</p>
              )}
            </div>
            <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${status.bg} ${status.color}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {status.label}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {isAvailable ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-semibold border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Disponible ahora
              </span>
            ) : isActive ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                No disponible
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 text-red-600 font-medium border border-red-500/20">
                <XCircle className="h-3 w-3" />
                Perfil inactivo
              </span>
            )}
            {pro.home_city && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {pro.home_city}
              </span>
            )}
            {pro.avg_rating != null && Number(pro.avg_rating) > 0 && (
              <span className="inline-flex items-center gap-1 text-copper font-semibold">
                <Star className="h-3 w-3 fill-copper" />
                {Number(pro.avg_rating).toFixed(1)}
              </span>
            )}
            {pro.years_experience != null && (
              <span className="text-muted-foreground">{pro.years_experience} años exp.</span>
            )}
            {pro.hourly_rate != null && Number(pro.hourly_rate) > 0 && (
              <span className="text-muted-foreground font-medium">
                ${Number(pro.hourly_rate).toLocaleString("es-CO")}/h
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="hero" size="sm" className="flex-1 sm:flex-none" asChild>
          <Link to="/buscar">Contratar en Humanix <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
        </Button>
        {pro.profiles?.phone && (
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" asChild>
            <a href={`https://wa.me/${String(pro.profiles.phone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
              <Phone className="h-3.5 w-3.5 mr-1" />
              WhatsApp
            </a>
          </Button>
        )}
      </div>
    </Card>
  );
}

function VerificarPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const { data } = await supabase
        .from("professional_profiles")
        .select(
          "user_id, specialty, home_city, avg_rating, published, blocked, available, rethus_verified, verified, years_experience, hourly_rate, gender, profiles:user_id(full_name, avatar_url, phone)",
        )
        .ilike("profiles.full_name", `%${q.trim()}%`)
        .limit(10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setResults((data ?? []) as any);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.length >= 3) search(query);
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Verificar Profesional", path: "/verificar" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdString({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Verificador de Profesionales de Salud — Humanix",
            description:
              "Consulta gratuita del estado de verificación RETHUS y habilitación en la plataforma Humanix de cualquier profesional de la salud en Colombia.",
            url: "https://humanix.lat/verificar",
            mainEntity: {
              "@type": "SearchAction",
              target: "https://humanix.lat/verificar?q={search_term_string}",
              "query-input": "required name=search_term_string",
            },
          }),
        }}
      />
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-biosensor/25 bg-biosensor/10 px-4 py-1.5 text-xs font-semibold text-biosensor mb-5">
            <BadgeCheck className="h-4 w-4" />
            Servicio 100% gratuito · Sin registro
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight mb-4">
            Verifica un <span className="text-gradient-bio">profesional de salud</span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
            Busca por nombre y comprueba si está verificado con RETHUS, habilitado en Humanix y disponible ahora mismo. Completamente gratis.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej: María González, Carlos Pérez enfermero…"
            className="pl-12 h-14 text-base rounded-2xl border-border/60 shadow-[var(--shadow-card)] focus:shadow-[var(--shadow-glow-bio)] transition-shadow"
            onKeyDown={(e) => e.key === "Enter" && search(query)}
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground animate-spin" />
          )}
        </div>

        {/* Results */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-2xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <Card className="p-10 text-center border-dashed">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-foreground mb-1">Sin resultados</p>
            <p className="text-sm text-muted-foreground mb-5">
              No encontramos "{query}" en nuestra base de profesionales verificados.
            </p>
            <Button variant="hero" size="sm" asChild>
              <Link to="/buscar">Ver todos los profesionales disponibles</Link>
            </Button>
          </Card>
        )}

        {!loading && results.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground px-1">
              {results.length} resultado{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""}
            </p>
            {results.map((pro) => (
              <ProCard key={pro.user_id} pro={pro} />
            ))}
          </div>
        )}

        {/* Info cards */}
        {!searched && (
          <div className="grid sm:grid-cols-3 gap-4 mt-2">
            {[
              {
                icon: BadgeCheck,
                color: "text-biosensor",
                bg: "bg-biosensor/10",
                title: "Verificación RETHUS",
                desc: "Consultamos el Registro de Talento Humano en Salud del Ministerio de Salud de Colombia.",
              },
              {
                icon: Star,
                color: "text-copper",
                bg: "bg-copper/10",
                title: "Calificaciones reales",
                desc: "Puntuaciones verificadas de familias e instituciones que contrataron el profesional.",
              },
              {
                icon: HeartPulse,
                color: "text-fuchsia-neural",
                bg: "bg-fuchsia-neural/10",
                title: "Estado en tiempo real",
                desc: "Disponibilidad actualizada al instante. Disponible, ocupado o fuera de servicio.",
              },
            ].map(({ icon: Icon, color, bg, title, desc }) => (
              <Card key={title} className="p-4 text-center space-y-2">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <p className="font-semibold text-sm">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </Card>
            ))}
          </div>
        )}

        {/* RETHUS link */}
        <div className="mt-10 flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Para verificación oficial puedes también consultar directamente el{" "}
            <a
              href="https://rethus.minsalud.gov.co"
              target="_blank"
              rel="noreferrer noopener"
              className="underline text-biosensor hover:text-biosensor/80 inline-flex items-center gap-0.5"
            >
              Registro RETHUS del Ministerio de Salud{" "}
              <ExternalLink className="h-3 w-3" />
            </a>
            . Humanix complementa esta verificación con calificaciones de usuarios, disponibilidad en tiempo real y contacto directo.
          </p>
        </div>

        {/* CTA box */}
        <Card className="mt-8 p-6 sm:p-8 text-center bg-gradient-to-br from-biosensor/5 via-card to-fuchsia-neural/5 border-biosensor/20">
          <ShieldCheck className="h-10 w-10 text-biosensor mx-auto mb-3" />
          <h2 className="font-display text-xl font-bold mb-2">
            ¿Eres profesional de salud?
          </h2>
          <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
            Registra tu perfil gratis en Humanix, valida tu RETHUS y aparece en este verificador para que familias e instituciones confíen en ti.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button variant="hero" size="lg" asChild>
              <Link to="/auth">
                Crear mi perfil verificado <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/profesionales">Saber más</Link>
            </Button>
          </div>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
