import { Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "humanix.launchbar.dismissed.v1";

/**
 * Barra superior de urgencia/lanzamiento.
 * Se oculta tras dismiss y persiste 7 días.
 */
export function LaunchBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      setShow(true);
      return;
    }
    try {
      const ts = Number(raw);
      if (Date.now() - ts > 7 * 24 * 60 * 60 * 1000) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[60] bg-gradient-to-r from-copper via-biosensor to-copper text-foreground shadow-lg">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 flex items-center justify-center gap-3 text-xs sm:text-sm">
        <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
        <p className="font-semibold tracking-tight text-center">
          <span className="hidden sm:inline">🚀 Lanzamiento Humanix · </span>
          Primeros 100 usuarios:{" "}
          <span className="underline decoration-2 underline-offset-2">3 meses Pro gratis</span>
        </p>
        <Link
          to="/auth"
          search={{ role: "professional" }}
          className="hidden sm:inline-flex items-center gap-1 font-bold whitespace-nowrap hover:opacity-80 transition"
        >
          Reclamar <ArrowRight className="h-3 w-3" />
        </Link>
        <button
          onClick={() => {
            localStorage.setItem(KEY, String(Date.now()));
            setShow(false);
          }}
          aria-label="Cerrar"
          className="ml-1 sm:ml-3 opacity-70 hover:opacity-100 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
