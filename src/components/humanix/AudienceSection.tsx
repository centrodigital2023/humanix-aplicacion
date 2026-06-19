import {
  Calendar,
  Wallet,
  Award,
  Bot,
  Search,
  ShieldCheck,
  Heart,
  PhoneCall,
  Building2,
  FileText,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

const pro = [
  { icon: Calendar, title: "Turnos a tu medida", desc: "Por hora, jornada (8h/12h) o paquetes mensuales. Acepta desde WhatsApp en 10 segundos." },
  { icon: Wallet, title: "Pago inmediato", desc: "Cobra en Nequi, PSE o RappiPay al terminar cada turno. Sin intermediarios." },
  { icon: Award, title: "Reputación verificada", desc: "Insignias, Trust Score y verificación RETHUS visibles a familias e IPS." },
  { icon: Bot, title: "Humanix Assistant IA", desc: "Prepara entrevistas, resume historiales clínicos, sugiere turnos próximos." },
];

const fam = [
  { icon: Search, title: "Encuentra en minutos", desc: "Selecciona especialidad, fecha, hora y zona. Match automático en <10Km." },
  { icon: ShieldCheck, title: "100% verificados", desc: "Cédula, RETHUS y biometría facial validados con IA. Transparencia total." },
  { icon: Heart, title: "Monitoreo en vivo", desc: "Geolocalización GPS del profesional, signos vitales y botón de emergencia 24/7." },
  { icon: PhoneCall, title: "Soporte inmediato", desc: "WhatsApp directo al profesional. Respaldo de pólizas Sura y Colsanitas." },
];

const inst = [
  { icon: FileText, title: "Publica vacantes", desc: "Define especialidad, jornada y presupuesto. Recibe candidaturas de profesionales verificados." },
  { icon: BarChart3, title: "Dashboard inteligente", desc: "Predictiva de ausentismo, auditoria de turnos y compliance automático Min. Salud." },
  { icon: TrendingUp, title: "Gestión de costos", desc: "Presupuestos estructurados por jornada. Reportes de ROI de talento humano." },
  { icon: Award, title: "API y webhooks", desc: "Integra Humanix con tu sistema de nómina, PMS o ERP existente sin fricción." },
];

function Card({
  icon: Icon,
  title,
  desc,
  accent,
}: {
  icon: typeof Calendar;
  title: string;
  desc: string;
  accent: "bio" | "copper" | "purple";
}) {
  const colors =
    accent === "bio"
      ? "bg-biosensor/10 text-biosensor border-biosensor/20"
      : accent === "copper"
      ? "bg-copper/10 text-copper border-copper/20"
      : "bg-purple-500/10 text-purple-400 border-purple-500/20";
  return (
    <div className="group rounded-2xl border border-border bg-card p-6 hover:border-foreground/20 hover:-translate-y-1 transition-all duration-300 shadow-[var(--shadow-card)]">
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${colors}`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

export function AudienceSection() {
  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-24">
        {/* Profesionales */}
        <div id="profesionales" className="grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4">
            <span className="text-xs uppercase tracking-[0.2em] text-biosensor font-semibold">
              Para profesionales de salud
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">
              On/Off como en Uber,{" "}
              <span className="text-gradient-bio">sin fricción</span>.
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Activa disponibilidad, recibe alertas en tiempo real y cobra al instante a tu billetera. Construye reputación verificable con cada servicio.
            </p>
            <Button variant="hero" size="lg" className="mt-6">
              Crear perfil profesional
            </Button>
          </div>
          <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
            {pro.map((c) => (
              <Card key={c.title} {...c} accent="bio" />
            ))}
          </div>
        </div>

        {/* Familias */}
        <div id="familias" className="grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4 lg:order-2">
            <span className="text-xs uppercase tracking-[0.2em] text-copper font-semibold">
              Para familias y pacientes
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">
              Cuidado verificado,{" "}
              <span className="text-copper">al instante</span>.
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Contrata cuidadores certificados en minutos. Propón tu propio presupuesto o acepta tarifas estándar. Monitoreo en vivo con GPS y botón SOS. Respaldo de pólizas médicas.
            </p>
            <Button variant="copper" size="lg" className="mt-6" asChild>
              <Link to="/buscar">Buscar cuidador ahora</Link>
            </Button>
          </div>
          <div className="lg:col-span-8 lg:order-1 grid sm:grid-cols-2 gap-4">
            {fam.map((c) => (
              <Card key={c.title} {...c} accent="copper" />
            ))}
          </div>
        </div>

        {/* Instituciones */}
        <div id="instituciones" className="grid lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4">
            <span className="text-xs uppercase tracking-[0.2em] text-purple-400 font-semibold">
              Para IPS, EPS y clínicas
            </span>
            <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">
              Cubrir turnos sin dolor de cabeza,{" "}
              <span className="text-purple-400">con IA</span>.
            </h2>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Publica vacantes, recibe candidaturas verificadas en minutos. Dashboard predictivo para ausentismo. Cumple normatividad Min. Salud automáticamente. Integra con tu nómina existente.
            </p>
            <Button 
              variant="glass" 
              size="lg" 
              className="mt-6 border-purple-500/30 hover:border-purple-500/50 hover:text-purple-300"
              asChild
            >
              <Link to="/superadmin">Ver panel institucional</Link>
            </Button>
          </div>
          <div className="lg:col-span-8 grid sm:grid-cols-2 gap-4">
            {inst.map((c) => (
              <Card key={c.title} {...c} accent="purple" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
