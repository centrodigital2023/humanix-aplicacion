// Atajo de un toque cuando la familia repite al mismo profesional el mismo día y hora (lógica en lib/careRoutine).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFamilyBookings, useProfessionalNames } from "@/hooks/use-family-intel";
import { useNow } from "@/hooks/use-now";
import { detectRoutine, routineLabel } from "@/lib/careRoutine";
import { firstName } from "@/lib/applicantSources";

export function CareRoutineCard({ userId }: { userId: string }) {
  const now = useNow();
  const bookingsQ = useFamilyBookings(userId);
  const routine = useMemo(() => detectRoutine(bookingsQ.data ?? [], now), [bookingsQ.data, now]);
  const namesQ = useProfessionalNames(routine ? [routine.professionalId] : []);
  const [hidden, setHidden] = useState(false);

  if (!routine || hidden) return null;
  const name = firstName(namesQ.data?.[routine.professionalId]) ?? "tu profesional";
  const next = new Date(routine.nextAt).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  });

  return (
    <section
      aria-label="Tu rutina de cuidado"
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-500"
    >
      <button
        type="button"
        onClick={() => setHidden(true)}
        aria-label="Ocultar sugerencia"
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          {routine.hasUpcoming ? <CalendarCheck className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {name} ya es parte de la rutina: {routine.times} veces {routineLabel(routine)}.
          </p>
          <p className="text-sm text-muted-foreground">
            {routine.hasUpcoming
              ? `El ${next} ya está reservado. Todo en orden.`
              : `¿Repetimos el ${next}${routine.durationHours ? ` por ${routine.durationHours} h` : ""}? Quien ya conoce a tu familiar da más tranquilidad.`}
          </p>
        </div>
      </div>
      {!routine.hasUpcoming && (
        <div className="mt-3 flex justify-end">
          <Button asChild size="sm" className="transition-transform active:scale-95">
            <Link to="/profesional/$proId" params={{ proId: routine.professionalId }}>
              Reservar con {name}
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}
