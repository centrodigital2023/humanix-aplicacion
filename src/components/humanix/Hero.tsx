import { useState } from "react";
import { ArrowRight, Sparkles, MapPin, Activity, Zap, TrendingUp, Wifi, Users, Building2, HeartPulse, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useActiveUsersCount } from "@/hooks/use-active-users-count";
import { AnimatedCounter } from "./AnimatedCounter";
import heroImage from "@/assets/hero-humanix.webp";
import { RoleGate } from "./RoleGate";

export function Hero() {
  const [gateOpen, setGateOpen] = useState(false);
  const {
    professionals,
    professionalsAvailable,
    professionalsRethus,
    families,
    institutions,
    completedServices,
    loading,
  } = useActiveUsersCount();

  const familiesAndIPS = families + institutions;

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-36 sm:pb-24 lg:pt-40 lg:pb-28">
      <div className="absolute inset-0 bg-aurora pointer-events-none" />
      <div className="absolute inset-0 grid-pattern opacity-60 pointer-events-none" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-10 sm:gap-12 lg:gap-16 items-center">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Zap className="h-3.5 w-3.5 animate-pulse" />
              Uber-like marketplace de salud • IA en tiempo real
            </div>

            <h1 className="mt-6 font-display text-[clamp(2rem,6vw,3.75rem)] font-bold leading-[1.05] tracking-tight">
              <span className="text-gradient-bio">Talento en salud</span>,{" "}
              conectado al instante.
            </h1>

            <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
              Tres actores. Un sistema. Profesionales activan su disponibilidad como en Uber. Familias e IPS buscan y contratan en tiempo real. Matching automático en &lt;5km. Pagos directos.
            </p>

            {/* Key Stats — Uber-style, datos reales desde Supabase en tiempo real */}
            <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-6 pb-8">
              {/* Profesionales */}
              <div className="space-y-1">
                {loading ? (
                  <div className="h-9 w-20 animate-pulse rounded-md bg-white/10" />
                ) : (
                  <p className="text-2xl sm:text-3xl font-black text-white flex items-center gap-1.5">
                    <HeartPulse className="h-5 w-5 text-biosensor shrink-0" />
                    <AnimatedCounter value={professionals} suffix="+" immediate={false} />
                  </p>
                )}
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                  Profesionales registrados
                  {!loading && professionalsRethus > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-biosensor/15 px-1.5 py-0.5 text-[10px] font-semibold text-biosensor">
                      {professionalsRethus} RETHUS ✓
                    </span>
                  )}
                </p>
              </div>

              {/* Online ahora mismo */}
              <div className="space-y-1">
                {loading ? (
                  <div className="h-9 w-16 animate-pulse rounded-md bg-emerald-400/20" />
                ) : (
                  <p className="text-2xl sm:text-3xl font-black text-emerald-400 flex items-center gap-1.5">
                    <Wifi className="h-5 w-5 animate-pulse shrink-0" />
                    <AnimatedCounter value={professionalsAvailable} />
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Online ahora mismo</p>
              </div>

              {/* Familias e IPS activas */}
              <div className="space-y-1">
                {loading ? (
                  <div className="h-9 w-16 animate-pulse rounded-md bg-copper/20" />
                ) : (
                  <p className="text-2xl sm:text-3xl font-black text-copper flex items-center gap-1.5">
                    <Users className="h-5 w-5 shrink-0" />
                    <AnimatedCounter value={familiesAndIPS} />
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Familias e IPS activas
                  {!loading && institutions > 0 && (
                    <span className="ml-1 text-fuchsia-400/70">
                      · <Building2 className="inline h-3 w-3" /> {institutions} IPS
                    </span>
                  )}
                </p>
              </div>

              {/* Servicios completados */}
              <div className="space-y-1">
                {loading ? (
                  <div className="h-9 w-16 animate-pulse rounded-md bg-fuchsia-500/20" />
                ) : (
                  <p className="text-2xl sm:text-3xl font-black text-fuchsia-400 flex items-center gap-1.5">
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                    <AnimatedCounter value={completedServices} suffix="+" />
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Servicios completados</p>
              </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Button variant="hero" size="xl" className="w-full sm:w-auto" onClick={() => setGateOpen(true)}>
                Explorar plataforma <ArrowRight className="ml-1 h-5 w-5" />
              </Button>
              <Button variant="glass" size="xl" className="w-full sm:w-auto" asChild>
                <a href="/profesionales">Soy profesional de salud</a>
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 text-sm text-muted-foreground border-t border-border/40 pt-6">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-biosensor animate-pulse" />
                Geolocalización en vivo
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-biosensor" />
                Oferta y demanda
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-copper" />
                Pago inmediato
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="relative rounded-3xl overflow-hidden border border-border shadow-[var(--shadow-elegant)] animate-float">
              <img
                src={heroImage}
                alt="Profesional de la salud usando Humanix - Marketplace Uber-like"
                width={1536}
                height={1024}
                loading="eager"
                decoding="async"
                fetchPriority="high"
                className="w-full h-auto"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-cyber/40 via-transparent to-transparent" />
            </div>

            {/* Live Match Card */}
            <div className="hidden sm:flex absolute -left-4 bottom-10 items-center gap-3 rounded-2xl bg-card/95 backdrop-blur-xl border border-border p-3.5 pr-5 shadow-[var(--shadow-card)] animate-in slide-in-from-left">
              <div className="h-10 w-10 rounded-xl bg-biosensor/15 flex items-center justify-center">
                <Activity className="h-5 w-5 text-biosensor animate-pulse" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Match en vivo</p>
                <p className="text-sm font-semibold">Engativá • 2.4 km • 12 min</p>
              </div>
              <span className="ml-2 h-2.5 w-2.5 rounded-full bg-biosensor animate-pulse" />
            </div>

            {/* Trust Score Card */}
            <div className="hidden sm:flex absolute -right-2 top-8 items-center gap-3 rounded-2xl bg-card/95 backdrop-blur-xl border border-border p-3.5 pr-5 shadow-[var(--shadow-card)] animate-in slide-in-from-right">
              <div className="h-10 w-10 rounded-xl bg-copper/15 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-copper" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Social Trust Score</p>
                <p className="text-sm font-semibold">4.9 · RETHUS ✓</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <RoleGate open={gateOpen} onOpenChange={setGateOpen} redirectTo="/buscar" />
    </section>
  );
}
