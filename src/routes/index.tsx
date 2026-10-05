// Home "Humanix simple": una sola pantalla que cambia según quién eres
// (Familias / IPS-EPS / Profesionales), sin publicidad, sin contadores de
// urgencia y con accesibilidad cognitiva (audio + letra grande).
import { useCallback, useEffect, useRef } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, BadgeCheck, EyeOff, MessageCircle, Receipt, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/humanix/Logo";
import { Footer } from "@/components/humanix/Footer";
import { HabeasDataConsent } from "@/components/humanix/HabeasDataConsent";
import { AudienceSwitcher } from "@/components/humanix/simple/AudienceSwitcher";
import { EasyReadToggle, ListenButton } from "@/components/humanix/simple/AccessibilityTools";
import { FamilyFlow } from "@/components/humanix/simple/FamilyFlow";
import { InstitutionFlow } from "@/components/humanix/simple/InstitutionFlow";
import { ProfessionalFlow } from "@/components/humanix/simple/ProfessionalFlow";
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
      title: `${SITE_NAME} · Cuidado en casa y talento en salud verificado en Colombia`,
      path: "/",
      appendSiteName: false,
      description:
        "Encuentra enfermeras y cuidadores con documentos revisados, cubre turnos de tu IPS o EPS y recibe ofertas como profesional de la salud. Precio claro, sin publicidad.",
    }),
  component: Index,
});

const HOW: Record<Audience, Array<{ title: string; text: string }>> = {
  familias: [
    {
      title: "Cuéntanos qué necesitas",
      text: "Tres preguntas sencillas. No tienes que registrarte para buscar.",
    },
    {
      title: "Elige entre 3 personas",
      text: "Con foto, documentos revisados, experiencia y precio claro.",
    },
    {
      title: "Mira cuándo va llegando",
      text: "Sigue el servicio desde tu celular y califica al terminar.",
    },
  ],
  instituciones: [
    { title: "Publica el turno", text: "Usa una plantilla por rol y horario. Toma un minuto." },
    {
      title: "Recibe candidatos validados",
      text: "Ordenados por cercanía, especialidad y documentos.",
    },
    {
      title: "Controla tu operación",
      text: "Turnos abiertos, cubiertos y credenciales por vencer en un panel.",
    },
  ],
  profesionales: [
    { title: "Activa tu disponibilidad", text: "Un solo botón. Lo apagas cuando quieras." },
    { title: "Recibe ofertas cerca", text: "Ves el pago y la zona antes de aceptar." },
    { title: "Trabaja con respaldo", text: "Pagos claros y un historial que habla por ti." },
  ],
};

const PROMISES = [
  {
    icon: BadgeCheck,
    title: "Documentos revisados",
    text: "Revisamos identidad, títulos y RETHUS de cada profesional.",
  },
  {
    icon: Receipt,
    title: "Precio total antes de confirmar",
    text: "Sin costos ocultos ni renovaciones automáticas sin avisar.",
  },
  {
    icon: EyeOff,
    title: "Sin publicidad en tu proceso",
    text: "Nada de anuncios mientras buscas o das cuidado.",
  },
  {
    icon: ShieldCheck,
    title: "Tus datos protegidos",
    text: "Cumplimos la Ley 1581 de 2012 (Habeas Data).",
  },
];

function Index() {
  const { para } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { user } = useAppUser({ requireAuth: false });
  const audience: Audience = para ?? "familias";
  const copy = AUDIENCE_COPY[audience];
  const flowHeadingRef = useRef<HTMLDivElement>(null);

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

  const goToFlow = () => {
    flowHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    flowHeadingRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="min-h-screen bg-canvas text-foreground">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-trust focus:px-4 focus:py-3 focus:text-trust-foreground"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/" search={{ para: audience }} aria-label="Humanix, inicio">
            <Logo />
          </Link>
          <nav aria-label="Cuenta" className="flex items-center gap-2">
            <a
              href={whatsappLink(CONTACT.whatsappNumber, "Hola Humanix, necesito ayuda.")}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold hover:bg-muted sm:inline-flex"
            >
              <MessageCircle className="h-4 w-4 text-ok" aria-hidden="true" />
              Ayuda
            </a>
            {user ? (
              <Link
                to={pathForRole(user.primaryRole)}
                className="inline-flex min-h-11 items-center rounded-full bg-trust px-4 text-sm font-bold text-trust-foreground hover:bg-trust/90"
              >
                Mi panel
              </Link>
            ) : (
              <Link
                to="/auth"
                search={{ role: copy.authRole, mode: "signin" } as never}
                className="inline-flex min-h-11 items-center rounded-full border-2 border-border px-4 text-sm font-bold hover:border-trust"
              >
                Ingresar
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Selector persistente: siempre visible al hacer scroll */}
      <div
        className="sticky top-0 z-40 border-b border-border bg-canvas/95 backdrop-blur"
        data-no-read
      >
        <div className="mx-auto max-w-6xl px-4 py-2.5 sm:px-6">
          <AudienceSwitcher value={audience} onChange={setAudience} panelId="contenido" />
        </div>
      </div>

      <main
        id="contenido"
        role="tabpanel"
        aria-labelledby={`audience-tab-${audience}`}
        tabIndex={-1}
      >
        <section className="mx-auto max-w-6xl px-4 pb-6 pt-8 sm:px-6 sm:pt-14">
          <div className="flex flex-wrap gap-2" data-no-read>
            <ListenButton targetId="contenido" />
            <EasyReadToggle />
          </div>
          <h1 className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.1] tracking-tight text-trust sm:text-5xl lg:text-6xl">
            {copy.title}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl">{copy.subtitle}</p>
          <button
            type="button"
            onClick={goToFlow}
            className="mt-7 inline-flex min-h-16 items-center gap-3 rounded-2xl bg-trust px-7 text-lg font-bold text-trust-foreground shadow-md transition hover:bg-trust/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2"
          >
            {copy.cta}
            <ArrowDown className="h-5 w-5" aria-hidden="true" />
          </button>
        </section>

        <section className="mx-auto max-w-6xl scroll-mt-24 px-4 py-6 sm:px-6" aria-label={copy.cta}>
          <div ref={flowHeadingRef} tabIndex={-1} className="scroll-mt-28 outline-none" />
          {audience === "familias" && <FamilyFlow />}
          {audience === "instituciones" && <InstitutionFlow user={user} />}
          {audience === "profesionales" && <ProfessionalFlow user={user} />}
        </section>

        <section aria-labelledby="how-title" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <h2 id="how-title" className="font-display text-2xl font-bold sm:text-3xl">
            Así de fácil
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {HOW[audience].map((s, i) => (
              <li key={s.title} className="rounded-3xl border border-border bg-card p-6">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-trust text-xl font-bold text-trust-foreground"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <h3 className="mt-4 text-xl font-bold">
                  <span className="sr-only">Paso {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-base text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="trust-title" className="bg-card py-12">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="trust-title" className="font-display text-2xl font-bold sm:text-3xl">
              Nuestro compromiso contigo
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PROMISES.map((p) => (
                <li key={p.title} className="rounded-3xl border border-border bg-background p-6">
                  <p.icon className="h-8 w-8 text-ok" aria-hidden="true" />
                  <h3 className="mt-3 text-lg font-bold">{p.title}</h3>
                  <p className="mt-1 text-base text-muted-foreground">{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-trust p-6 text-trust-foreground sm:flex-row sm:items-center sm:p-8">
            <div>
              <h2 className="font-display text-2xl font-bold">
                ¿Prefieres hablar con una persona?
              </h2>
              <p className="mt-1 text-base opacity-90">Te ayudamos por WhatsApp, paso a paso.</p>
            </div>
            <a
              href={whatsappLink(
                CONTACT.whatsappNumber,
                `Hola Humanix, vengo de la sección "${copy.tab}" y necesito ayuda.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-white px-6 text-base font-bold text-[#0f4c81] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-trust"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
              Escribir por WhatsApp
            </a>
          </div>
        </section>
      </main>

      <Footer />
      <HabeasDataConsent />
    </div>
  );
}
