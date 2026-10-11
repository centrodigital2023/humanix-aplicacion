// Landing premium para EPS / IPS
// CTA directo a registro de institución → onboarding wizard completo
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseMedical,
  Building2,
  ChevronRight,
  ClipboardList,
  FileCheck,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/humanix/Logo";

export const Route = createFileRoute("/eps-ips")({
  head: () => ({
    meta: [
      { title: "Humanix para EPS e IPS · Gestión de personal de salud" },
      {
        name: "description",
        content:
          "Conecta tu EPS o IPS con el mejor talento en salud. Publica turnos, verifica documentos y gestiona tu equipo en un solo lugar.",
      },
    ],
  }),
  component: EpsIpsLanding,
});

const BENEFITS = [
  {
    icon: <Search className="h-5 w-5" />,
    title: "Encuentra talento verificado",
    desc: "Profesionales con RETHUS, antecedentes y documentos al día.",
  },
  {
    icon: <ClipboardList className="h-5 w-5" />,
    title: "Publica turnos en segundos",
    desc: "Crea ofertas masivas para enfermería, medicina o auxiliares.",
  },
  {
    icon: <FileCheck className="h-5 w-5" />,
    title: "Cumplimiento FUID automático",
    desc: "Alertas de vencimiento de documentos según la norma.",
  },
  {
    icon: <Zap className="h-5 w-5" />,
    title: "Panel en tiempo real",
    desc: "Agenda, KPIs, mensajes y pagos en un solo dashboard.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Habeas data integrado",
    desc: "Cumplimiento Ley 1581/2012 sin papeleo extra.",
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: "Múltiples usuarios",
    desc: "Tu equipo de RRHH puede colaborar desde sus cuentas.",
  },
];

const STEPS = [
  { n: "01", label: "Crea tu cuenta", desc: "Nombre de institución, correo y contraseña." },
  { n: "02", label: "Configura tu perfil", desc: "NIT, cámara de comercio y representante legal." },
  { n: "03", label: "Publica tu primera oferta", desc: "Turnos, guardias o contratos fijos." },
  { n: "04", label: "Recibe candidatos hoy", desc: "Profesionales listos para empezar." },
];

const INSTITUTION_TYPES = [
  { emoji: "🏥", label: "IPS" },
  { emoji: "🛡️", label: "EPS" },
  { emoji: "🩺", label: "Clínica" },
  { emoji: "❤️", label: "Fundación" },
  { emoji: "🏢", label: "Centro médico" },
];

function EpsIpsLanding() {
  const navigate = useNavigate();

  const goRegister = () =>
    navigate({ to: "/auth", search: { role: "institution", mode: "signup" } as never });

  const goLogin = () =>
    navigate({ to: "/auth", search: { role: "institution", mode: "signin" } as never });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Navbar ── */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-3 border-b border-border/60 bg-background/80 backdrop-blur">
        <Logo />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goLogin}
            className="text-sm text-muted-foreground hover:text-foreground transition"
          >
            Iniciar sesión
          </button>
          <Button size="sm" variant="hero" onClick={goRegister} className="gap-1.5">
            Crear cuenta <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-5 pt-20 pb-16 text-center">
        {/* glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-20 flex justify-center"
        >
          <div className="h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-2xl space-y-6">
          {/* chips */}
          <div className="flex flex-wrap justify-center gap-2">
            {INSTITUTION_TYPES.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium"
              >
                {t.emoji} {t.label}
              </span>
            ))}
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-tight">
            El personal de salud <br className="hidden sm:block" />
            que necesitas, <span className="text-primary">hoy</span>.
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Humanix conecta tu EPS o IPS con profesionales verificados. Publica turnos, gestiona
            documentos y cumple la normativa desde un solo panel.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              size="lg"
              variant="hero"
              onClick={goRegister}
              className="gap-2 w-full sm:w-auto"
            >
              <Building2 className="h-5 w-5" />
              Crear cuenta gratis
            </Button>
            <Button size="lg" variant="outline" onClick={goLogin} className="w-full sm:w-auto">
              Ya tengo cuenta
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            <BadgeCheck className="inline h-3.5 w-3.5 mr-1 text-emerald-500" />
            Sin tarjeta de crédito · Configuración en menos de 5 min
          </p>
        </div>
      </section>

      {/* ── Beneficios ── */}
      <section className="px-5 py-16 bg-muted/30">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-2xl font-bold text-center mb-10">
            Todo lo que necesita tu institución
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="flex gap-4 rounded-2xl border border-border bg-card p-5"
              >
                <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  {b.icon}
                </div>
                <div>
                  <p className="font-semibold text-sm">{b.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cómo funciona ── */}
      <section className="px-5 py-16">
        <div className="mx-auto max-w-2xl">
          <h2 className="font-display text-2xl font-bold text-center mb-10">Empieza en 4 pasos</h2>
          <div className="space-y-4">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className="flex items-center gap-5 rounded-2xl border border-border bg-card px-5 py-4"
              >
                <span className="font-display text-3xl font-bold text-primary/40 shrink-0">
                  {s.n}
                </span>
                <div className="flex-1">
                  <p className="font-semibold">{s.label}</p>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="h-5 w-5 text-muted-foreground/40 shrink-0" />
                )}
                {i === STEPS.length - 1 && <Sparkles className="h-5 w-5 text-primary shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="px-5 py-16 bg-primary text-primary-foreground">
        <div className="mx-auto max-w-xl text-center space-y-5">
          <BriefcaseMedical className="h-12 w-12 mx-auto opacity-80" />
          <h2 className="font-display text-3xl font-bold">
            Tu institución merece el mejor talento
          </h2>
          <p className="opacity-80">
            Únete a las instituciones que ya confían en Humanix para gestionar su personal de salud.
          </p>
          <Button size="lg" variant="secondary" onClick={goRegister} className="gap-2 font-bold">
            Empezar ahora <ArrowRight className="h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* ── Footer mínimo ── */}
      <footer className="px-5 py-6 border-t border-border/60 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Humanix · Colombia ·{" "}
        <a href="/politica-privacidad" className="underline hover:text-foreground">
          Privacidad
        </a>
      </footer>
    </div>
  );
}
