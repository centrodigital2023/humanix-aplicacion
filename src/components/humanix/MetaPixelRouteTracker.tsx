// PageView del píxel de Meta en cada cambio de ruta de la SPA (la primera página la registra el <head>),
// y «Contact» cuando alguien abre WhatsApp desde cualquier botón. Reglas de privacidad en src/lib/metaPixel.ts.
import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { trackPixel, trackPixelPageView } from "@/lib/metaPixel";

export function MetaPixelRouteTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === null) {
      last.current = pathname; // primera carga: ya contada en el head
      return;
    }
    if (last.current === pathname) return;
    last.current = pathname;
    trackPixelPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(a.href))
        trackPixel("Contact", { content_name: "WhatsApp" });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
