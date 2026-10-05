// Home "Humanix simple": una pantalla que cambia según quién eres
// (Familias / IPS-EPS / Profesionales). Imágenes grandes + pocas palabras,
// guía por voz para quien no lee, sin publicidad ni urgencias falsas.
import { useCallback, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { Logo } from "@/components/humanix/Logo";
import { Footer } from "@/components/humanix/Footer";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { AudienceSwitcher } from "@/components/humanix/simple/AudienceSwitcher";
import { EasyReadToggle, VoiceToggle } from "@/components/humanix/simple/AccessibilityTools";
import { FamilyFlow } from "@/components/humanix/simple/FamilyFlow";
import { InstitutionFlow } from "@/components/humanix/simple/InstitutionFlow";
import { ProfessionalFlow } from "@/components/humanix/simple/ProfessionalFlow";
import { TINTS, type Tint } from "@/components/humanix/simple/ui";
import { LiveNearby } from "@/components/humanix/simple/LiveNearby";
import { FeatureHub } from "@/components/humanix/simple/FeatureHub";
import { PlanStrip } from "@/components/humanix/simple/PlanStrip";
import { VoiceProvider } from "@/components/humanix/simple/voice";
import { useAppUser, pathForRole } from "@/hooks/use-app-user";
import {
  AUDIENCE_COPY,
  AUDIENCE_STORAGE_KEY,
  parseAudience,
  whatsappLink,
  type Audience,
} from "@/lib/audience";
import { CONTACT } from "@/lib/social";
import { buildSeo, SITE_NAME } from "@/lib/seo";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { para?: Audience } => {
    const para = parseAudience(search.para);
    return para ? { para } : {};
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
  const { para } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { user } = useAppUser({ requireAuth: false });
  const audience: Audience = para ?? "familias";
  const copy = AUDIENCE_COPY[audience];

  const setAudience = useCallback(
    (next: Audience) => {
      try {
        localStorage.setItem(AUDIENCE_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      navigate({ search: { para: next }, replace: true, resetScroll: false });
    },
    [navigate],
  );

  // Sin ?para= en la URL: recuerda el último perfil elegido.
  useEffect(() => {
    if (para) return;
    try {
      const stored = parseAudience(localStorage.getItem(AUDIENCE_STORAGE_KEY));
      if (stored && stored !== "familias") setAudience(stored);
    } catch {
      /* ignore */
    }
  }, [para, setAudience]);

  return (
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

      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link to="/" search={{ para: audience }} aria-label="Humanix, inicio">
            <Logo />
          </Link>
          <nav aria-label="Cuenta" className="flex items-center gap-2">
            <a
              href={whatsappLink(CONTACT.whatsappNumber, "Hola Humanix, necesito ayuda.")}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Ayuda por WhatsApp"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-sm transition hover:shadow-md active:scale-95"
            >
              <MessageCircle className="h-6 w-6 text-ok" aria-hidden="true" />
            </a>
            {user ? (
              <Link
                to={pathForRole(user.primaryRole)}
                className="inline-flex min-h-12 items-center rounded-full bg-trust px-5 text-base font-bold text-trust-foreground shadow-md active:scale-95"
              >
                Mi panel
              </Link>
            ) : (
              <Link
                to="/auth"
                search={{ role: copy.authRole, mode: "signin" } as never}
                className="inline-flex min-h-12 items-center rounded-full bg-card px-5 text-base font-bold shadow-sm transition hover:shadow-md active:scale-95"
              >
                Entrar
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Selector persistente: siempre visible al hacer scroll */}
      <div className="sticky top-0 z-40 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
          <AudienceSwitcher value={audience} onChange={setAudience} panelId="contenido" />
        </div>
      </div>

      <main
        id="contenido"
        role="tabpanel"
        aria-labelledby={`audience-tab-${audience}`}
        tabIndex={-1}
        className="relative z-10 outline-none"
      >
        <section className="mx-auto max-w-6xl px-4 pb-4 pt-6 sm:px-6 sm:pt-10">
          <div
            key={audience}
            className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
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

        <section className="mx-auto max-w-6xl px-4 pb-10 sm:px-6" aria-label={copy.cta}>
          {audience === "familias" && <FamilyFlow />}
          {audience === "instituciones" && <InstitutionFlow user={user} />}
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

      <Footer />
      <HabeasDataConsent />
    </div>
  );
}
