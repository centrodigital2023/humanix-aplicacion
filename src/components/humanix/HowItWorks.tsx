import { useState, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  UserPlus,
  Search,
  MessageSquare,
  MapPin,
  Star,
  Shield,
  Building2,
  Users,
  ClipboardList,
  BrainCircuit,
  CheckCircle2,
  CreditCard,
} from "lucide-react";

type Role = "family" | "professional" | "institution";

const STEPS: Record<Role, { icon: React.ElementType; title: string; body: string }[]> = {
  family: [
    {
      icon: UserPlus,
      title: "Crea tu perfil familiar",
      body: "Cuéntanos sobre el paciente y las necesidades de cuidado. Solo toma 3 minutos.",
    },
    {
      icon: Search,
      title: "El match IA encuentra tu candidato",
      body: "Nuestra IA compara horarios, especialidad, cercanía y Trust Score en menos de 150 ms.",
    },
    {
      icon: Shield,
      title: "Verifica con RETHUS anti-fraude",
      body: "Cada profesional pasa por validación de tarjeta profesional y antecedentes en tiempo real.",
    },
    {
      icon: MessageSquare,
      title: "Coordina por WhatsApp o chat",
      body: "Contáctate directamente sin intermediarios. Sin comisión oculta para el profesional.",
    },
    {
      icon: MapPin,
      title: "Sigue la llegada en vivo",
      body: "Rastrea la ubicación del profesional y recibe ETA actualizada antes de que llegue.",
    },
    {
      icon: Star,
      title: "Califica y deja tu opinión",
      body: "Tu reseña ayuda a más familias y premia la excelencia del profesional.",
    },
  ],
  professional: [
    {
      icon: UserPlus,
      title: "Registra tu perfil profesional",
      body: "Sube tu tarjeta RETHUS, documentos y especialidades. Nosotros hacemos la verificación.",
    },
    {
      icon: BrainCircuit,
      title: "El algoritmo amplifica tu visibilidad",
      body: "Cuanto más alto tu Trust Score, más arriba apareces en búsquedas de familias e instituciones.",
    },
    {
      icon: MessageSquare,
      title: "Recibe propuestas en tu bandeja",
      body: "Acepta las ofertas que más te convengan. Tú controlas tu agenda y tus tarifas.",
    },
    {
      icon: MapPin,
      title: "Comparte tu ubicación en tiempo real",
      body: "El cliente ve tu ETA y te rastrea con privacidad. Solo mientras estás en servicio.",
    },
    {
      icon: CreditCard,
      title: "Cobra directo: Nequi, PSE o efectivo",
      body: "Sin intermediarios en el pago. El dinero llega a tu cuenta el mismo día.",
    },
    {
      icon: Star,
      title: "Construye tu reputación",
      body: "Responde a calificaciones, acumula reseñas y sube de nivel en el ecosistema Humanix.",
    },
  ],
  institution: [
    {
      icon: Building2,
      title: "Crea tu cuenta institucional",
      body: "Registra tu IPS, clínica o agencia. Onboarding asistido en menos de 24 horas.",
    },
    {
      icon: Users,
      title: "Define roles y sucursales",
      body: "Agrega a tu equipo HR, evaluadores y administradores con permisos separados.",
    },
    {
      icon: ClipboardList,
      title: "Publica ofertas y gestiona pipeline",
      body: "Abre convocatorias y el scoring IA ordena candidatos por idoneidad automáticamente.",
    },
    {
      icon: Shield,
      title: "RETHUS y detección de inconsistencias",
      body: "Validamos CVs vs. tarjeta profesional y alertamos sobre antecedentes en tiempo real.",
    },
    {
      icon: BrainCircuit,
      title: "IA de evaluación y entrevistas",
      body: "Usa nuestra IA para generar preguntas de entrevista, analizar respuestas y puntuar.",
    },
    {
      icon: CheckCircle2,
      title: "Contrata y haz seguimiento",
      body: "Firma digital de contratos, evaluaciones de desempeño y feedback bidireccional.",
    },
  ],
};

const ROLE_LABELS: Record<Role, string> = {
  family: "Familia",
  professional: "Profesional",
  institution: "Institución",
};

const ROLE_COLORS: Record<Role, string> = {
  family: "text-copper border-copper/40 bg-copper/10",
  professional: "text-biosensor border-biosensor/40 bg-biosensor/10",
  institution: "text-fuchsia-neural border-fuchsia-neural/40 bg-fuchsia-neural/10",
};

const ROLE_ACTIVE: Record<Role, string> = {
  family: "bg-copper text-white shadow-[0_0_12px_oklch(var(--copper)/0.4)]",
  professional: "bg-biosensor text-biosensor-foreground shadow-[var(--shadow-glow-bio)]",
  institution: "bg-fuchsia-neural text-white shadow-[0_0_12px_oklch(var(--fuchsia-neural)/0.4)]",
};

const ICON_BG: Record<Role, string> = {
  family: "bg-copper/10 text-copper",
  professional: "bg-biosensor/10 text-biosensor",
  institution: "bg-fuchsia-neural/10 text-fuchsia-neural",
};

function useCountUp(target: number, duration = 1200, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return count;
}

const STATS = [
  { value: 100, suffix: "+", label: "Profesionales verificados" },
  { value: 7, suffix: "+", label: "Ciudades activas" },
  { value: 4.9, suffix: "/5", label: "Calificación promedio", decimal: true },
  { value: 100, suffix: "%", label: "Certificación RETHUS" },
];

function StatItem({ value, suffix, label, decimal, visible }: {
  value: number; suffix: string; label: string; decimal?: boolean; visible: boolean;
}) {
  const count = useCountUp(decimal ? value * 10 : value, 1400, visible);
  const display = decimal ? (count / 10).toFixed(1) : count.toLocaleString("es-CO");
  return (
    <div className="text-center px-4">
      <p className="font-display text-3xl sm:text-4xl font-bold text-gradient-bio tabular-nums">
        {display}{suffix}
      </p>
      <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-[120px] mx-auto">{label}</p>
    </div>
  );
}

export function HowItWorks() {
  const [role, setRole] = useState<Role>("family");
  const steps = STEPS[role];
  const statsRef = useRef<HTMLDivElement>(null);
  const [statsVisible, setStatsVisible] = useState(false);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStatsVisible(true); obs.disconnect(); } },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="py-16 sm:py-24 bg-gradient-to-b from-background via-card/30 to-background overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-biosensor/25 bg-biosensor/10 px-3 py-1 text-[11px] font-semibold uppercase text-biosensor">
            Simple, seguro y en minutos
          </div>
          <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold text-gradient-cyber">
            ¿Cómo funciona Humanix?
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground mt-2 max-w-xl mx-auto">
            Selecciona tu perfil y descubre el camino optimizado para ti.
          </p>
        </div>

        {/* Role tabs */}
        <div className="flex justify-center gap-2 sm:gap-3 mb-10 flex-wrap">
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-full border px-4 sm:px-6 py-2 text-sm font-semibold transition-all duration-200 ${
                role === r ? ROLE_ACTIVE[r] : ROLE_COLORS[r]
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={`${role}-${i}`}
                className="group relative rounded-2xl border border-border/60 bg-card p-5 sm:p-6 transition-all duration-300 hover:border-biosensor/30 hover:shadow-[0_4px_24px_oklch(var(--biosensor)/0.08)] hover:-translate-y-0.5"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${ICON_BG[role]}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                        Paso {i + 1}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground text-sm sm:text-base leading-snug">
                      {step.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                      {step.body}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="text-center mt-10">
          <Link
            to="/auth"
            className="inline-flex h-11 items-center justify-center rounded-full bg-biosensor px-8 text-sm font-bold text-biosensor-foreground shadow-[var(--shadow-glow-bio)] transition hover:-translate-y-0.5"
          >
            Empieza gratis como {ROLE_LABELS[role]} →
          </Link>
        </div>

        {/* Stats counter removed */}
      </div>
    </section>
  );
}
