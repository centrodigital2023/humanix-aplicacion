import { useEffect, useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { RoleGate } from "./RoleGate";
import { useActiveUsersCount } from "@/hooks/use-active-users-count";

export function StickyCTA() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const { professionals, professionalsAvailable } = useActiveUsersCount();

  useEffect(() => {
    try {
      if (sessionStorage.getItem("hx_sticky_dismissed") === "1") setDismissed(true);
    } catch {
      // ignore
    }
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("hx_sticky_dismissed", "1");
    } catch {
      // ignore
    }
  };

  if (dismissed || !visible) return null;

  return (
    <>
      <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:right-6 sm:left-auto z-40 sm:max-w-md animate-in slide-in-from-bottom-6 fade-in duration-500">
        <div className="relative flex items-center gap-3 rounded-2xl border border-biosensor/30 bg-card/95 backdrop-blur-xl p-3 pr-10 shadow-[var(--shadow-elegant)]">
          <div className="h-10 w-10 rounded-xl bg-biosensor/15 flex items-center justify-center text-biosensor shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Encuentra cuidador hoy</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              <span className="text-emerald-500 font-bold">{professionalsAvailable}</span> disponibles · {professionals} registrados · desde $9.000/mes
            </p>
          </div>
          <button
            onClick={() => setGateOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold rounded-xl bg-foreground text-background px-3 py-2 hover:opacity-90 transition shrink-0"
          >
            Empezar <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={dismiss}
            aria-label="Cerrar"
            className="absolute top-1.5 right-1.5 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <RoleGate open={gateOpen} onOpenChange={setGateOpen} redirectTo="/buscar" />
    </>
  );
}
