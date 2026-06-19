import { Brain, MapPinned, Fingerprint, Radio, MessageSquare, BarChart3 } from "lucide-react";
import { useActiveUsersCount } from "@/hooks/use-active-users-count";

const features = [
  {
    icon: Brain,
    title: "Matchmaking predictivo",
     desc: "LightGBM + embeddings que aprenden de cada contratación exitosa. Match en menos de 1 km.",
    color: "text-biosensor",
  },
  {
    icon: Fingerprint,
    title: "\n",
    desc: "Cédula colombiana + reconocimiento facial + cruce con RETHUS y Registraduría.",
    color: "text-copper",
  },
  {
    icon: MapPinned,
    title: "Geolocalización viva",
    desc: "Tracking cada 30 s vía WebSocket, integrado con Waze y Google Maps en tiempo real.",
    color: "text-biosensor",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp inteligente",
    desc: "Publica ofertas en lenguaje natural. La IA parsea, distribuye y notifica al instante.",
    color: "text-fuchsia-neural",
  },
  {
    icon: BarChart3,
    title: "Predicción de demanda",
    desc: "Mapa de calor por barrio con previsión de picos por estacionalidad y redes sociales.",
    color: "text-copper",
  },
  {
    icon: Radio,
    title: "Wearables conectados",
    desc: "Detección de caídas, ritmo cardíaco anormal y alertas automáticas al superadmin.",
    color: "text-fuchsia-neural",
  },
];

export function TechSection() {
  const { professionals } = useActiveUsersCount();

  return (
    <section id="tecnologia" className="relative py-24 sm:py-32 overflow-hidden">
      <div className="absolute inset-0 bg-cyber" />
      <div className="absolute inset-0 bg-aurora opacity-70" />
      <div className="absolute inset-0 grid-pattern opacity-40" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <span className="text-xs uppercase tracking-[0.2em] text-biosensor font-semibold">
            Tecnología
          </span>
          <h2 className="mt-3 font-display text-3xl sm:text-5xl font-bold leading-tight text-cyber-foreground">
            IA en tiempo real, <span className="text-gradient-bio">arquitectura de élite</span>.
          </h2>
          <p className="mt-5 text-lg text-cyber-foreground/70 leading-relaxed">
            Construido sobre Kafka, Redis y SageMaker en AWS São Paulo — con smart contracts que
            liberan pagos al confirmar la geolocalización de llegada.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-2xl border border-cyber-foreground/10 bg-cyber-foreground/[0.03] backdrop-blur-md p-6 hover:bg-cyber-foreground/[0.06] hover:border-cyber-foreground/20 transition-all duration-300"
            >
              <div
                className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyber-foreground/5 ${f.color}`}
              >
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold text-cyber-foreground">
                {f.title}
              </h3>
              <p className="mt-2 text-sm text-cyber-foreground/65 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* KPI strip */}
        <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-2xl overflow-hidden border border-cyber-foreground/10 bg-cyber-foreground/10">
          {[
             { v: "<1 km", l: "Match en vivo" },
             { v: `${professionals}+`, l: "Profesionales" },
            { v: "99.2%", l: "Trust Score" },
            { v: "24/7", l: "Soporte IA" },
          ].map((k) => (
            <div key={k.l} className="bg-cyber p-6 text-center">
              <div className="font-display text-3xl font-bold text-biosensor">{k.v}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-cyber-foreground/60">
                {k.l}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
