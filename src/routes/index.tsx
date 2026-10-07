// Home "Humanix simple": una pantalla que cambia según quién eres
// (Familias / IPS-EPS / Profesionales). Imágenes grandes + pocas palabras,
// guía por voz para quien no lee, sin publicidad ni urgencias falsas.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { EasyReadToggle, VoiceToggle } from "@/components/humanix/simple/AccessibilityTools";
import { FamilyFlow } from "@/components/humanix/simple/FamilyFlow";
import { InstitutionFlow } from "@/components/humanix/simple/InstitutionFlow";
import { ProfessionalFlow } from "@/components/humanix/simple/ProfessionalFlow";
import { TINTS, type Tint } from "@/components/humanix/simple/ui";
import { LiveNearby } from "@/components/humanix/simple/LiveNearby";
import { FeatureHub } from "@/components/humanix/simple/FeatureHub";
import { PlanStrip } from "@/components/humanix/simple/PlanStrip";
import { MyBookings } from "@/components/humanix/simple/MyBookings";
import { PendingBookingResume } from "@/components/humanix/simple/PendingBookingResume";
import { VoiceProvider } from "@/components/humanix/simple/voice";
import { useAudience } from "@/hooks/use-audience";
import { ProfileChooser } from "@/components/humanix/simple/ProfileChooser";
import { AUDIENCE_COPY, parseAudience, whatsappLink, type Audience } from "@/lib/audience";
import { LeadCaptureWidget } from "@/components/humanix/LeadCaptureWidget";
import { CONTACT } from "@/lib/social";
import { buildSeo, SITE_NAME } from "@/lib/seo";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { para?: Audience; pedir?: "1" } => {
    const para = parseAudience(search.para);
    const out: { para?: Audience; pedir?: "1" } = {};
    if (para) out.para = para;
    // Vuelve del registro con un pedido guardado para confirmar.
    if (search.pedir === "1" || search.pedir === 1) out.pedir = "1";
    return out;
  },
  head: () =>
    buildSeo({
      title: `${SITE_NAME} · Cuidado en casa y talento en salud verificado`,
      path: "/",
      appendSiteName: false,
      description:
        "Enfermeras y cuidadores verificados cerca de ti. Turnos cubiertos para IPS y EPS. Ofertas para profesionales de la salud. Precio claro, sin publicidad.",
    }),
  component: Index,
});

// Phase 6 — North Star live stats strip
type LiveStats = { services_today: number; pros_available: number; families_month: number };

function NorthStarStrip() {
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [{ count: svc }, { count: pros }, { count: fam }] = await Promise.all([
          supabase
            .from("service_bookings")
            .select("id", { count: "exact", head: true })
            .gte("created_at", today),
          supabase
            .from("professional_profiles")
            .select("user_id", { count: "exact", head: true })
            .eq("available", true)
            .eq("active", true),
          supabase
            .from("service_bookings")
            .select("id", { count: "exact", head: true })
            .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
        ]);
        if (active)
          setStats({
            services_today: svc ?? 0,
            pros_available: pros ?? 0,
            families_month: fam ?? 0,
          });
      } catch {
        // non-fatal
      }
    })();
    return () => { active = false; };
  }, []);

  if (!stats) return null;

  const items = [
    { n: stats.services_today, label: "Servicios hoy", emoji: "🩺" },
    { n: stats.pros_available, label: "Profesionales disponibles ahora", emoji: "🟢" },
    { n: stats.families_month, label: "Familias atendidas este mes", emoji: "👨‍👩‍👧" },
  ];

  return (
    <div
      aria-label="Actividad en vivo"
      className="mx-auto max-w-6xl px-4 sm:px-6"
    >
      <ul className="flex flex-wrap justify-center gap-3">
        {items.map((item, i) => (
          <li
            key={item.label}
            style={{ animationDelay: `${i * 120}ms` }}
            className="stat-live inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-border"
          >
            <span aria-hidden="true">{item.emoji}</span>
            <span className="font-bold tabular-nums">{item.n.toLocaleString("es-CO")}</span>
            <span className="text-muted-foreground">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Pic = { emoji: string; label: string; tint: Tint };

const HOW: Record<Audience, Pic[]> = {
  familias: [
    { emoji: "👆", label: "Elige", tint: "sky" },
    { emoji: "🤝", label: "Conoce", tint: "rose" },
    { emoji: "🏡", label: "Cuidado en casa", tint: "emerald" },
  ],
  instituciones: [
    { emoji: "📝", label: "Publica", tint: "sky" },
    { emoji: "👩‍⚕️", label: "Elige candidato", tint: "violet" },
    { emoji: "✅", label: "Turno cubierto", tint: "emerald" },
  ],
  profesionales: [
    { emoji: "🟢", label: "Actívate", tint: "emerald" },
    { emoji: "📲", label: "Recibe ofertas", tint: "sky" },
    { emoji: "💵", label: "Cobra claro", tint: "amber" },
  ],
};

const PROMISES: Pic[] = [
  { emoji: "🛡️", label: "Verificados", tint: "emerald" },
  { emoji: "💲", label: "Precio claro", tint: "amber" },
  { emoji: "🚫", label: "Sin anuncios", tint: "rose" },
  { emoji: "🔒", label: "Datos seguros", tint: "sky" },
];

function PicRow({ items, numbered }: { items: Pic[]; numbered?: boolean }) {
  const Tag = numbered ? "ol" : "ul";
  return (
    <Tag
      className={`grid gap-3 ${items.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}
    >
      {items.map((p, i) => (
        <li
          key={p.label}
          className="flex flex-col items-center gap-3 rounded-3xl bg-card p-4 text-center shadow-sm"
        >
          <span
            aria-hidden="true"
            className={`relative flex h-16 w-16 items-center justify-center rounded-full text-3xl sm:h-20 sm:w-20 sm:text-4xl ${TINTS[p.tint]}`}
          >
            {p.emoji}
            {numbered && (
              <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-trust text-sm font-bold text-trust-foreground">
                {i + 1}
              </span>
            )}
          </span>
          <span className="text-base font-bold leading-tight sm:text-lg">{p.label}</span>
        </li>
      ))}
    </Tag>
  );
}

function Index() {
  return (
    <VoiceProvider>
      <Home />
    </VoiceProvider>
  );
}

function Home() {
  const { para, pedir } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { audience: current, locked, ready, user, choose, clear } = useAudience();

  // Enlaces con ?para= (registro, anuncios) fijan el perfil, salvo que la cuenta ya lo defina.
  useEffect(() => {
    if (para && !locked && para !== current) choose(para);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [para, locked]);

  const audience: Audience | undefined = locked ? current : (para ?? current);

  const shell = (children: React.ReactNode) => (
    <div className="relative min-h-screen overflow-x-clip bg-canvas text-foreground">
      {/* Fondo cálido y sereno */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[720px] bg-[radial-gradient(900px_420px_at_15%_0%,color-mix(in_oklab,var(--trust)_14%,transparent),transparent_70%),radial-gradient(700px_380px_at_95%_10%,color-mix(in_oklab,var(--ok)_14%,transparent),transparent_70%)]"
      />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-trust focus:px-4 focus:py-3 focus:text-trust-foreground"
      >
        Saltar al contenido
      </a>
      <Navbar static />
      {children}
      <Footer />
      <HabeasDataConsent />
      {/* Acceso admin — punto apenas visible, abajo a la derecha */}
      <button
        type="button"
        onClick={() => navigate({ to: "/superadmin" })}
        aria-label="Administración"
        className="fixed bottom-2 right-2 z-30 h-4 w-4 cursor-pointer rounded-full opacity-10 transition-opacity hover:opacity-50 focus-visible:opacity-80 focus-visible:outline-none"
      >
        <span className="block h-2 w-2 rounded-full bg-foreground/60 mx-auto mt-1" />
      </button>
    </div>
  );

  // Mientras sabemos quién es (sesión / elección guardada), un espacio sereno.
  if (!audience && !ready) {
    return shell(<main id="contenido" className="min-h-[60vh]" aria-busy="true" />);
  }

  // Sin perfil: solo la pregunta "¿Quién eres?".
  if (!audience) {
    return shell(
      <main id="contenido" tabIndex={-1} className="relative z-10 outline-none">
        <div className="mx-auto flex max-w-6xl justify-end gap-2 px-4 pt-4 sm:px-6">
          <VoiceToggle />
          <EasyReadToggle />
        </div>
        <ProfileChooser
          onChoose={(a) => {
            choose(a);
            navigate({ search: { para: a }, replace: true, resetScroll: false });
          }}
        />
      </main>,
    );
  }

  const copy = AUDIENCE_COPY[audience];

  return shell(
    <>
      <main id="contenido" tabIndex={-1} className="relative z-10 outline-none">
        <section className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-10">
          <div
            key={audience}
            className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-card px-4 text-base font-bold shadow-sm ring-1 ring-border">
                  <span aria-hidden="true">{copy.emoji}</span>
                  {copy.tab}
                </span>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => {
                      clear();
                      navigate({ search: {}, replace: true, resetScroll: false });
                    }}
                    className="min-h-10 rounded-full px-3 text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Cambiar
                  </button>
                )}
              </p>
              <h1 className="font-display text-[2.4rem] font-bold leading-[1.05] tracking-tight text-trust sm:text-6xl">
                {copy.title}
              </h1>
              <p className="mt-3 text-xl text-muted-foreground sm:text-2xl">{copy.subtitle}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <VoiceToggle />
              <EasyReadToggle />
            </div>
          </div>
        </section>

        <NorthStarStrip />

        <section className="mx-auto max-w-6xl px-4 pb-10 sm:px-6" aria-label={copy.cta}>
          {audience === "familias" && (
            <div className="space-y-5">
              <PendingBookingResume
                user={user}
                autoOpen={pedir === "1"}
                onConsumed={() =>
                  navigate({ search: { para: "familias" }, replace: true, resetScroll: false })
                }
              />
              {user && <MyBookings userId={user.id} />}
              <FamilyFlow />
            </div>
          )}
          {audience === "instituciones" && (
            <>
              <InstitutionFlow user={user} />
              <div className="mt-4 text-center">
                <a
                  href="/eps-ips"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition"
                >
                  Conoce todo lo que Humanix ofrece para EPS e IPS →
                </a>
              </div>
            </>
          )}
          {audience === "profesionales" && <ProfessionalFlow user={user} />}
        </section>

        <section aria-labelledby="map-title" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <h2 id="map-title" className="font-display text-2xl font-bold sm:text-3xl">
            📍 {audience === "profesionales" ? "Ofertas en el mapa" : "Cerca de ti, en vivo"}
          </h2>
          <div className="mt-5">
            <LiveNearby audience={audience} user={user} />
          </div>
        </section>

        <section aria-labelledby="hub-title" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <h2 id="hub-title" className="font-display text-2xl font-bold sm:text-3xl">
            Todo en Humanix
          </h2>
          <div className="mt-5">
            <FeatureHub audience={audience} />
          </div>
        </section>

        <section aria-labelledby="plans-title" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <h2 id="plans-title" className="font-display text-2xl font-bold sm:text-3xl">
            Planes
          </h2>
          <div className="mt-5">
            <PlanStrip audience={audience} user={user} />
          </div>
        </section>

        <section aria-labelledby="how-title" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <h2 id="how-title" className="font-display text-2xl font-bold sm:text-3xl">
            Así de fácil
          </h2>
          <div className="mt-5">
            <PicRow items={HOW[audience]} numbered />
          </div>
        </section>

        <section aria-labelledby="trust-title" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <h2 id="trust-title" className="font-display text-2xl font-bold sm:text-3xl">
            Te cuidamos
          </h2>
          <div className="mt-5">
            <PicRow items={PROMISES} />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-14 pt-6 sm:px-6">
          <a
            href={whatsappLink(
              CONTACT.whatsappNumber,
              `Hola Humanix, soy de "${copy.tab}" y necesito ayuda.`,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-4 rounded-[2rem] bg-ok p-6 text-ok-foreground shadow-xl shadow-ok/25 transition hover:-translate-y-0.5 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40 sm:p-8"
          >
            <span className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20 text-4xl"
              >
                💬
              </span>
              <span>
                <span className="block font-display text-2xl font-bold">¿Te ayudamos?</span>
                <span className="block text-lg opacity-90">Escríbenos por WhatsApp</span>
              </span>
            </span>
            <MessageCircle
              className="h-8 w-8 shrink-0 transition group-hover:scale-110"
              aria-hidden="true"
            />
          </a>
        </section>
      </main>
      <LeadCaptureWidget userId={user?.id} />
    </>,
  );
}
