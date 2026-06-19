// Perfil público de profesional: experiencia, documentación verificada,
// rating, ubicación y CTA contratar (con auth-gate vía BookNowButton).
import { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import {
  Loader2,
  MapPin,
  Star,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Briefcase,
  Award,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookNowButton } from "@/components/humanix/BookNowButton";
import { AgendaViewer } from "@/components/humanix/AgendaViewer";
import { useAppUser } from "@/hooks/use-app-user";
import { buildSeo, jsonLdString, SITE_URL, SOCIAL_IMAGE_URL } from "@/lib/seo";

export const Route = createFileRoute("/profesional/$proId")({
  loader: async ({ params }) => {
    try {
      const [profRes, proRes] = await Promise.all([
        supabase
          .from("public_profiles_safe")
          .select("full_name, avatar_url, city, bio")
          .eq("user_id", params.proId)
          .maybeSingle(),
        supabase
          .from("public_professionals_safe")
          .select("specialty, ai_summary, service_cities, rethus_verified, avg_rating, total_jobs")
          .eq("user_id", params.proId)
          .maybeSingle(),
      ]);
      return {
        seo: {
          name: profRes.data?.full_name ?? null,
          avatar: profRes.data?.avatar_url ?? null,
          city: profRes.data?.city ?? proRes.data?.service_cities?.[0] ?? "Colombia",
          bio: profRes.data?.bio ?? null,
          specialty: proRes.data?.specialty ?? "profesional de salud",
          summary: proRes.data?.ai_summary ?? null,
          rethus: !!proRes.data?.rethus_verified,
          rating: Number(proRes.data?.avg_rating ?? 0),
          jobs: Number(proRes.data?.total_jobs ?? 0),
        },
      };
    } catch {
      return { seo: null };
    }
  },
  head: ({ params, loaderData }) => {
    const s = loaderData?.seo;
    const name = s?.name ?? "Profesional verificado";
    const specialty = s?.specialty ?? "profesional de salud";
    const city = s?.city ?? "Colombia";
    const title = `${name} · ${specialty} en ${city}`;
    const description =
      s?.summary ??
      s?.bio ??
      `${name}, ${specialty} con verificación${s?.rethus ? " RETHUS" : ""} en ${city}. Agenda en línea y contratación segura en Humanix.`;
    const built = buildSeo({
      title,
      path: `/profesional/${params.proId}`,
      description: description.slice(0, 160),
      image: s?.avatar ?? SOCIAL_IMAGE_URL,
      imageAlt: `${name} — ${specialty}`,
      type: "profile",
    });
    const personLd = {
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      mainEntity: {
        "@type": "Person",
        name,
        jobTitle: specialty,
        description,
        image: s?.avatar ?? undefined,
        url: `${SITE_URL}/profesional/${params.proId}`,
        address: { "@type": "PostalAddress", addressLocality: city, addressCountry: "CO" },
        ...(s && s.rating > 0
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: s.rating.toFixed(1),
                reviewCount: Math.max(s.jobs, 1),
              },
            }
          : {}),
      },
    };
    return {
      ...built,
      scripts: [
        { type: "application/ld+json", children: jsonLdString(personLd) },
      ],
    };
  },
  component: ProfessionalPublicPage,
});

type Pro = {
  user_id: string;
  specialty: string | null;
  sub_specialties: string[] | null;
  bio: string | null;
  ai_summary: string | null;
  ai_strengths: string[] | null;
  years_experience: number | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  monthly_rate: number | null;
  home_city: string | null;
  service_cities: string[] | null;
  trust_score: number | null;
  avg_rating: number | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  rethus_number: string | null;
  total_jobs: number | null;
  available: boolean | null;
  reserved_until: string | null;
  lat: number | null;
  lng: number | null;
  certifications: unknown;
  work_experience: unknown;
  // From the SQL JOIN in the view
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
};

type Doc = {
  id: string;
  doc_type: "cv" | "rethus" | "diploma" | "id_document" | "other";
  status: "pending" | "approved" | "rejected";
  file_name: string | null;
  created_at: string;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const DOC_LABEL: Record<Doc["doc_type"], string> = {
  cv: "Hoja de vida",
  rethus: "RETHUS",
  diploma: "Diploma / Título",
  id_document: "Documento de identidad",
  other: "Otro documento",
};

function ProfessionalPublicPage() {
  const { proId } = useParams({ from: "/profesional/$proId" });
  const { user } = useAppUser();
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState<Pro | null>(null);
  const [profile, setProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    city: string | null;
    bio: string | null;
  } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Usar vistas públicas (security_invoker=false) para bypasar RLS —
        // professional_profiles tiene RLS que bloquea lecturas de otras familias.
        const [proRes, docsRes] = await Promise.all([
          supabase
            .from("public_professionals_safe")
            .select(
              "user_id, specialty, sub_specialties, bio, ai_summary, ai_strengths, years_experience, hourly_rate, shift_rate, monthly_rate, service_cities, trust_score, avg_rating, verified, rethus_verified, rethus_number, total_jobs, available, reserved_until, lat, lng, certifications, work_experience, full_name, avatar_url, phone",
            )
            .eq("user_id", proId)
            .maybeSingle(),
          supabase
            .from("professional_documents")
            .select("id, doc_type, status, file_name, created_at")
            .eq("user_id", proId)
            .eq("status", "approved")
            .order("created_at", { ascending: false }),
        ]);
        if (!active) return;
        const proData = proRes.data as Pro | null;
        setPro(proData);
        if (proData) {
          setProfile({
            full_name: proData.full_name ?? null,
            avatar_url: proData.avatar_url ?? null,
            city: proData.home_city ?? proData.service_cities?.[0] ?? null,
            bio: proData.bio ?? null,
          });
        }
        setDocs((docsRes.data ?? []) as Doc[]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [proId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando perfil…
      </div>
    );
  }

  if (!pro) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-32 pb-20 mx-auto max-w-3xl px-4 text-center">
          <h1 className="font-display text-3xl font-bold">Perfil no disponible</h1>
          <p className="mt-2 text-muted-foreground">
            Este profesional no existe o no está activo en Humanix.
          </p>
          <Button variant="hero" asChild className="mt-6">
            <Link to="/buscar" search={{ tab: "profesionales" }}>
              Volver a buscar
            </Link>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  const name = profile?.full_name ?? "Profesional Humanix";
  const city = profile?.city ?? pro.service_cities?.[0] ?? "Colombia";
  const rating = Number(pro.avg_rating ?? 0);
  const reserved = pro.reserved_until && new Date(pro.reserved_until) > new Date();

  const work = Array.isArray(pro.work_experience)
    ? (pro.work_experience as Array<Record<string, unknown>>)
    : [];
  const certs = Array.isArray(pro.certifications)
    ? (pro.certifications as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="pt-28 pb-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Link
            to="/buscar"
            search={{ tab: "profesionales" }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al buscador
          </Link>

          {/* Header */}
          <header className="mt-4 grid lg:grid-cols-[auto_1fr_auto] gap-6 items-start rounded-3xl border border-border bg-card p-6 sm:p-8">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={name}
                className="h-24 w-24 sm:h-28 sm:w-28 rounded-2xl object-cover border border-border"
              />
            ) : (
              <div className="h-24 w-24 sm:h-28 sm:w-28 rounded-2xl bg-biosensor/10 text-biosensor flex items-center justify-center font-display text-3xl font-bold">
                {name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-bold truncate">{name}</h1>
                {pro.verified && <CheckCircle2 className="h-5 w-5 text-biosensor" />}
                {reserved && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-fuchsia-neural/15 text-fuchsia-neural border border-fuchsia-neural/30">
                    Reservado
                  </span>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">
                {pro.specialty ?? "Profesional de salud"}
              </p>
              <div className="mt-3 flex items-center gap-4 flex-wrap text-sm">
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> {city}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-copper text-copper" />
                  <strong>{rating > 0 ? rating.toFixed(1) : "Nuevo"}</strong>
                  <span className="text-muted-foreground">· {pro.total_jobs ?? 0} servicios</span>
                </span>
                {(pro.years_experience ?? 0) > 0 && (
                  <span className="text-muted-foreground">{pro.years_experience} años exp.</span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {pro.rethus_verified && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-biosensor/15 text-biosensor border border-biosensor/30 inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> RETHUS
                    {pro.rethus_number ? ` · ${pro.rethus_number}` : ""}
                  </span>
                )}
                {(pro.trust_score ?? 0) > 0 && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-copper/15 text-copper border border-copper/30">
                    Trust Score {pro.trust_score}
                  </span>
                )}
                {(pro.sub_specialties ?? []).slice(0, 4).map((s) => (
                  <span
                    key={s}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="lg:text-right">
              {pro.hourly_rate ? (
                <>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Tarifa
                  </p>
                  <p className="font-display text-3xl font-bold text-biosensor">
                    {COP(pro.hourly_rate)}
                  </p>
                  <p className="text-xs text-muted-foreground">por hora</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Tarifa a convenir</p>
              )}
              <div className="mt-4">
                {pro.hourly_rate && !reserved ? (
                  <BookNowButton
                    professionalId={pro.user_id}
                    hourlyRate={pro.hourly_rate}
                    defaultLat={pro.lat ?? null}
                    defaultLng={pro.lng ?? null}
                    variant="copper"
                    size="lg"
                    fullWidth
                  />
                ) : (
                  <Button variant="hero" size="lg" disabled className="w-full">
                    {reserved ? "Reservado" : "Contactar"}
                  </Button>
                )}
              </div>
              <a
                href="#agenda"
                className="mt-2 block text-center text-[11px] text-muted-foreground hover:text-biosensor underline-offset-2 hover:underline"
              >
                Ver agenda y elegir horario ↓
              </a>
            </div>
          </header>

          {/* Agenda pública: familia puede contratar slots verdes */}
          <section id="agenda" className="mt-6 scroll-mt-24">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Agenda y disponibilidad</h2>
              <span className="text-[11px] text-muted-foreground">
                Horarios en tiempo real
              </span>
            </div>
            <AgendaViewer
              targetUserId={pro.user_id}
              targetRole="professional"
              currentUserId={user?.id ?? null}
              currentRole={
                user?.roles?.includes("family")
                  ? "family"
                  : user?.roles?.includes("professional")
                    ? "professional"
                    : null
              }
              targetHourlyRate={pro.hourly_rate ?? null}
            />
          </section>

          {/* Body */}
          <div className="mt-6 grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* AI summary / Bio */}
              {(pro.ai_summary || profile?.bio || pro.bio) && (
                <Card className="p-6">
                  <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-fuchsia-neural" /> Acerca de
                  </h2>
                  {pro.ai_summary && (
                    <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                      {pro.ai_summary}
                    </p>
                  )}
                  {(profile?.bio || pro.bio) && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {profile?.bio || pro.bio}
                    </p>
                  )}
                  {(pro.ai_strengths ?? []).length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {(pro.ai_strengths ?? []).map((s) => (
                        <span
                          key={s}
                          className="text-[11px] px-2 py-1 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/30"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {/* Experiencia */}
              <Card className="p-6">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-biosensor" /> Experiencia laboral
                </h2>
                {work.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    El profesional aún no ha publicado experiencia detallada.
                    {(pro.years_experience ?? 0) > 0 && (
                      <> Cuenta con {pro.years_experience} años en el sector salud.</>
                    )}
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3">
                    {work.map((w, i) => (
                      <li key={i} className="rounded-xl border border-border p-4">
                        <p className="font-semibold">
                          {(w.role as string) ?? (w.title as string) ?? "Cargo"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(w.company as string) ?? "Institución"}
                          {w.years
                            ? ` · ${w.years} años`
                            : w.period
                              ? ` · ${w.period as string}`
                              : ""}
                        </p>
                        {w.description ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            {w.description as string}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {/* Certificaciones */}
              {certs.length > 0 && (
                <Card className="p-6">
                  <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                    <Award className="h-4 w-4 text-copper" /> Certificaciones
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {certs.map((c, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-biosensor mt-0.5 shrink-0" />
                        <span>
                          <strong>{(c.name as string) ?? "Certificación"}</strong>
                          {c.issuer ? (
                            <span className="text-muted-foreground"> · {c.issuer as string}</span>
                          ) : null}
                          {c.year ? (
                            <span className="text-muted-foreground"> · {c.year as string}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>

            <aside className="space-y-6">
              {/* Documentos verificados */}
              <Card className="p-6">
                <h2 className="font-display text-lg font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-biosensor" /> Documentos verificados
                </h2>
                {docs.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    No hay documentos públicos aprobados todavía. La verificación RETHUS es una
                    validación automática del Ministerio de Salud de Colombia.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {docs.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center gap-2 text-sm rounded-lg border border-biosensor/20 bg-biosensor/5 p-2.5"
                      >
                        <CheckCircle2 className="h-4 w-4 text-biosensor shrink-0" />
                        <span className="font-medium">{DOC_LABEL[d.doc_type]}</span>
                        <span className="ml-auto text-[10px] uppercase tracking-wider text-biosensor">
                          Aprobado
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                  Por privacidad y seguridad, los archivos no son descargables públicamente. Humanix
                  los audita y certifica.
                </p>
              </Card>

              {/* Comisión transparente */}
              <Card className="p-6 border-copper/30 bg-copper/5">
                <h2 className="font-display text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-copper" /> Comisión transparente
                </h2>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Humanix cobra solo el <strong className="text-copper">3%</strong> sobre cada
                  contratación. El profesional recibe el <strong>97%</strong>. Sin tarifas ocultas,
                  sin permanencia.
                </p>
              </Card>
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
