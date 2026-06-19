import { useEffect, useState } from "react";
import { Activity, HeartPulse, Users, Building2 } from "lucide-react";
import { useActiveUsersCount } from "@/hooks/use-active-users-count";

const events = [
  "Laura aceptó un turno en Engativá hace 2 min",
  "Andrés cobró $180.000 COP por Nequi hace 4 min",
  "Clínica Reina Sofía publicó 3 turnos UCI hace 5 min",
  "Marta fue contratada por una familia en Cali hace 7 min",
  "Nuevo profesional de salud se registró hace 9 min",
  "Carlos calificó 5★ a Camila en Medellín hace 12 min",
];

export function LiveSocialProof() {
  const [i, setI] = useState(0);
  const {
    professionals, professionalsAvailable,
    families, institutions,
    loading,
  } = useActiveUsersCount();

  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % events.length), 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative -mt-px border-y border-border bg-card/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-biosensor shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-0.5" />
          En vivo
        </span>
        {!loading && (
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <HeartPulse className="h-3 w-3 text-biosensor" />
              <span className="font-bold text-emerald-500">{professionalsAvailable}</span>
              <span>/ {professionals} prof.</span>
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3 text-copper" />
              <span className="font-bold">{families}</span>
              <span>familias</span>
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3 text-fuchsia-400" />
              <span className="font-bold">{institutions}</span>
              <span>instituciones</span>
            </span>
          </div>
        )}
        <span className="hidden sm:inline-block h-3 w-px bg-border" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-1">
          <Activity className="h-3.5 w-3.5 text-biosensor shrink-0" />
          <span key={i} className="truncate animate-in fade-in slide-in-from-bottom-1 duration-500">
            {events[i]}
          </span>
        </div>
      </div>
    </section>
  );
}
