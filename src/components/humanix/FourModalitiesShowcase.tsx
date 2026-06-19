import { Clock, Briefcase, Calendar, TrendingUp } from "lucide-react";

export function FourModalitiesShowcase() {
  const modalities = [
    {
      icon: Clock,
      title: "Por Hora",
      description: "Cuidado flexible y corto plazo",
      examples: [
        { role: "Profesional", value: "$65.000/h" },
        { role: "Familia", value: "Negociable" },
        { role: "IPS", value: "Presupuesto" },
      ],
      use: "Consultas, procedimientos, ayuda puntual",
    },
    {
      icon: Calendar,
      title: "Jornada 8 Horas",
      description: "Turno completo de día",
      examples: [
        { role: "Profesional", value: "$340.000" },
        { role: "Familia", value: "Negociable" },
        { role: "IPS", value: "Presupuesto" },
      ],
      use: "Cuidado diurno, procedimientos complejos",
    },
    {
      icon: Briefcase,
      title: "Jornada 12 Horas",
      description: "Cobertura turno noche o full day",
      examples: [
        { role: "Profesional", value: "$480.000" },
        { role: "Familia", value: "Negociable" },
        { role: "IPS", value: "Presupuesto" },
      ],
      use: "Urgencias, cuidados intensivos, turnos nocturnos",
    },
    {
      icon: TrendingUp,
      title: "Mensual",
      description: "Contrato a largo plazo",
      examples: [
        { role: "Profesional", value: "$6.800.000" },
        { role: "Familia", value: "Negociable" },
        { role: "IPS", value: "Presupuesto" },
      ],
      use: "Cobertura fija, relación laboral estructurada",
    },
  ];

  return (
    <section className="py-20 sm:py-28 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <h2 className="font-display text-3xl sm:text-4xl font-bold mb-4">
            Las 4 modalidades de{" "}
            <span className="text-gradient-bio">pago y tarifas</span>
          </h2>
          <p className="text-muted-foreground">
            Flexibilidad total. Profesionales establecen sus tarifas. Familias negocian presupuestos. IPS define presupuestos institucionales.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {modalities.map((mod) => {
            const Icon = mod.icon;
            return (
              <div
                key={mod.title}
                className="relative group rounded-2xl border border-slate-800 bg-slate-950/50 p-6 hover:border-slate-700 transition-all duration-300 hover:-translate-y-1"
              >
                {/* Icon */}
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-biosensor/20 to-purple-500/20 border border-biosensor/30 mb-4">
                  <Icon className="h-6 w-6 text-biosensor" />
                </div>

                {/* Title */}
                <h3 className="font-display text-xl font-bold mb-1">{mod.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">{mod.description}</p>

                {/* Divider */}
                <div className="border-t border-slate-800 my-4" />

                {/* Examples by role */}
                <div className="space-y-2.5 mb-4">
                  {mod.examples.map((ex) => (
                    <div key={ex.role} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{ex.role}</span>
                      <span className="font-semibold text-white">{ex.value}</span>
                    </div>
                  ))}
                </div>

                {/* Use case */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800/50">
                  <p className="text-xs text-slate-300 italic">{mod.use}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer text */}
        <div className="mt-12 p-6 bg-slate-950 rounded-2xl border border-slate-800 text-center">
          <p className="text-sm text-slate-300">
            <strong>Profesionales:</strong> Define tus tarifas estándar. Familias y IPS ven tus precios y pueden proponer alternativas.{" "}
            <strong>Familias:</strong> Siempre puedes negociar presupuestos custom. <strong>IPS/EPS:</strong> Presupuestos institucionales estructurados por jornada.
          </p>
        </div>
      </div>
    </section>
  );
}
