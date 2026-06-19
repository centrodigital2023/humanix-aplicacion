import { useState } from "react";
import { X, ChevronRight, Sparkles, FileText, ShieldCheck, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    icon: <Sparkles className="h-5 w-5 text-fuchsia-neural" />,
    title: "Llena tu perfil con IA",
    body: "Cuéntanos en una frase quién eres o sube tu hoja de vida en PDF. La IA extrae todos los datos por ti.",
  },
  {
    icon: <FileText className="h-5 w-5 text-biosensor" />,
    title: "Sube tus documentos",
    body: "RETHUS, diplomas, cédula y certificaciones. Quedan visibles para que familias e IPS te elijan con confianza.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5 text-copper" />,
    title: "Trust Score automático",
    body: "La IA evalúa tu perfil y te da un puntaje 0-100. Si superas 70, quedas pre-aprobado y nuestro equipo confirma.",
  },
  {
    icon: <Briefcase className="h-5 w-5 text-biosensor" />,
    title: "Recibe ofertas que encajan",
    body: "Te recomendamos turnos según tu especialidad, ciudad y tarifa. Aplica en un clic.",
  },
];

export function OnboardingTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const cur = STEPS[step];

  return (
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)] p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          aria-label="Cerrar tour"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 mb-5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition ${
                i <= step ? "bg-biosensor" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
            {cur.icon}
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Paso {step + 1} de {STEPS.length}
            </p>
            <h2 className="font-display text-xl font-bold">{cur.title}</h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{cur.body}</p>
        <div className="mt-6 flex items-center justify-between">
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Saltar tour
          </button>
          <Button variant="hero" onClick={() => (last ? onClose() : setStep((s) => s + 1))}>
            {last ? "Empezar" : "Siguiente"}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
