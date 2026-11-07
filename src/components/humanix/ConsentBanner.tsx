// Aviso de cookies y publicidad. Reglas y efectos en src/lib/consent.ts.
import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CONSENT_OPEN_EVENT,
  bannerAllowedOnPath,
  getConsent,
  needsConsentPrompt,
  setConsent,
  type ConsentChoice,
} from "@/lib/consent";
import { ensureMetaPixel, pageViewAllowedOnPath, trackPixelPageView } from "@/lib/metaPixel";

export function ConsentBanner() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(needsConsentPrompt());
    const reopen = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open || !bannerAllowedOnPath(pathname)) return null;

  const choose = (choice: ConsentChoice) => {
    const before = getConsent();
    setConsent(choice);
    if (choice === "granted" && before !== "granted") {
      // setConsent ya dio «grant» al píxel en espera; si no estaba (rechazo previo) se instala ahora.
      // La visita a esta página no se registró sin permiso: se cuenta ahora, una sola vez.
      if (ensureMetaPixel() && pageViewAllowedOnPath(pathname)) trackPixelPageView(pathname);
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Preferencias de cookies"
      className="fixed inset-x-0 bottom-0 z-[120] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur p-4 sm:p-5 shadow-2xl">
        <div className="flex gap-3">
          <Cookie className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Tu privacidad, tu decisión</p>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Usamos cookies necesarias para que Humanix funcione. Con tu permiso también usamos
              cookies de Google y Meta para medir visitas y mostrarte anuncios útiles. Nunca
              compartimos datos de salud ni de pacientes.{" "}
              <Link to="/privacidad" className="underline underline-offset-4 text-foreground">
                Política de privacidad
              </Link>
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => choose("denied")}>
            Solo necesarias
          </Button>
          <Button size="sm" onClick={() => choose("granted")}>
            Aceptar
          </Button>
        </div>
      </div>
    </div>
  );
}
