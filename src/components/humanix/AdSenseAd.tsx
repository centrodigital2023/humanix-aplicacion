import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  ADSENSE_DEFAULT_SLOT,
  ADSENSE_PUBLISHER_ID,
  adsEnabled,
  ensureAdsenseScript,
} from "@/lib/adsense";

type AdsWindow = Window & { adsbygoogle?: unknown[] };

interface AdSenseAdProps {
  /** ID del bloque (data-ad-slot). Por defecto VITE_ADSENSE_SLOT. */
  slot?: string;
  format?: string;
  className?: string;
}

/**
 * Bloque de anuncio de AdSense para la SPA: pinta el <ins> y hace push({})
 * cada vez que se monta o cambia la ruta. Solo se usa en páginas públicas.
 */
export function AdSenseAd({
  slot = ADSENSE_DEFAULT_SLOT,
  format = "auto",
  className = "",
}: AdSenseAdProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [enabled, setEnabled] = useState(false);

  // Solo en el cliente: evita desajustes de hidratación y respeta app nativa / rutas privadas.
  useEffect(() => {
    setEnabled(Boolean(slot) && adsEnabled());
  }, [slot, pathname]);

  if (!enabled) return null;
  return <AdSenseIns key={pathname} slot={slot} format={format} className={className} />;
}

function AdSenseIns({
  slot,
  format,
  className,
}: {
  slot: string;
  format: string;
  className: string;
}) {
  const ref = useRef<HTMLModElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    // Un <ins> solo admite un push (StrictMode monta dos veces en desarrollo).
    if (!el || el.getAttribute("data-adsbygoogle-status")) return;
    ensureAdsenseScript();
    try {
      // La cola funciona aunque el script aún no haya cargado.
      const w = window as AdsWindow;
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch (e) {
      console.error("AdSense:", e);
    }
  }, []);

  return (
    <aside aria-label="Publicidad" className={`my-10 ${className}`}>
      <p className="mb-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        Publicidad
      </p>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: "block", minHeight: 90 }}
        data-ad-client={ADSENSE_PUBLISHER_ID}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
