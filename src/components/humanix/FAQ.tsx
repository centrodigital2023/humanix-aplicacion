import { useState } from "react";
import { ChevronDown } from "lucide-react";

export const faqs = [
  {
    q: "¿Cómo verifica Humanix a los profesionales?",
    a: "Cruzamos datos en tiempo real con el RETHUS, validamos documentos mediante IA y aplicamos un Trust Score. Cada perfil es aprobado manualmente por nuestro equipo antes de ser publicado.",
  },
  {
    q: "¿Cuánto tarda en llegar un cuidador a mi casa?",
    a: "El sistema está diseñado para conectar familias y profesionales de forma inmediata. Dependiendo de la disponibilidad en tu zona, la asignación se confirma en minutos.",
  },
  {
    q: "¿Cómo se realizan los pagos a profesionales?",
    a: "El pago es directo y transparente entre la familia y el profesional al finalizar el turno, facilitado a través de Nequi, PSE o efectivo.",
  },
  {
    q: "¿Qué cobertura tienen los seguros incluidos?",
    a: "Plan Estándar: priorizamos la selección rigurosa de profesionales para brindar tranquilidad y bienestar en cada visita. Plan Enterprise: contamos con el respaldo de profesionales que poseen su propio seguro de responsabilidad civil, garantizando mayor protección para tu familia.",
  },
  {
    q: "¿Funciona en ciudades intermedias?",
    a: "Operamos al 100% en Bogotá, Medellín, Cali y Barranquilla. Bucaramanga y Pereira se encuentran actualmente en fase piloto.",
  },
  {
    q: "¿Cómo cumplen con la ley de Habeas Data?",
    a: "Datos cifrados en servidores AWS, consentimiento granular en el registro y herramientas 24/7 para que el usuario gestione, porte o elimine su información de manera autónoma.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="py-24 sm:py-32 border-t border-border">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs uppercase tracking-[0.2em] text-biosensor font-semibold">
            Preguntas frecuentes
          </span>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">
            Todo lo que necesitas saber <span className="text-gradient-bio">antes de empezar</span>.
          </h2>
        </div>

        <div className="mt-12 divide-y divide-border border border-border rounded-3xl bg-card overflow-hidden">
          {faqs.map((f, i) => {
            const expanded = open === i;
            return (
              <button
                key={f.q}
                onClick={() => setOpen(expanded ? -1 : i)}
                className="w-full text-left px-5 sm:px-6 py-5 hover:bg-foreground/[0.02] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="font-display font-semibold text-base sm:text-lg">{f.q}</p>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground shrink-0 transition-transform ${
                      expanded ? "rotate-180 text-biosensor" : ""
                    }`}
                  />
                </div>
                {expanded && (
                  <p className="mt-3 text-sm sm:text-[15px] text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                    {f.a}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
