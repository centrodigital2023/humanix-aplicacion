import { useState, useEffect } from "react";
import { MessageCircle, X, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTACT } from "@/lib/social";

const WA_URL = CONTACT.whatsappUrl;

/**
 * Abre WhatsApp forzando una ventana top-level (evita ERR_BLOCKED_BY_RESPONSE
 * cuando la app corre dentro de un iframe — preview de Lovable, Webviews, etc.).
 */
function openWhatsApp() {
  try {
    const win = window.open(WA_URL, "_blank", "noopener,noreferrer");
    if (!win) {
      // Bloqueador de popups: intenta romper el iframe escribiendo en top.
      if (window.top && window.top !== window.self) {
        window.top.location.href = WA_URL;
      } else {
        window.location.href = WA_URL;
      }
    }
  } catch {
    window.location.href = WA_URL;
  }
}

/**
 * Botón flotante global de WhatsApp.
 * Único canal de contacto humano de la plataforma.
 */
export function FloatingWAChat() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <>
      {open && (
        <div
          style={{ left: "1rem", right: "auto", bottom: "6rem" }}
          className="fixed bottom-24 left-4 right-auto z-[100] w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-2"
          role="dialog"
          aria-label="Contacto WhatsApp"
        >
          <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-t-2xl">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold">Humanix · Soporte</p>
                <p className="text-[11px] text-muted-foreground">Respondemos en minutos</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-sm text-foreground/90">
              Hola 👋 Estamos disponibles por WhatsApp para resolver dudas, ayudarte a encontrar
              profesional o reportar cualquier incidente.
            </p>
            <Button
              variant="hero"
              className="w-full"
              size="lg"
              onClick={openWhatsApp}
              type="button"
            >
              <Phone className="h-4 w-4" />
              Abrir WhatsApp
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              {CONTACT.phoneDisplay} · Línea oficial Humanix
            </p>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        style={{ left: "1rem", right: "auto", bottom: "1rem" }}
        className="fixed bottom-4 left-4 right-auto z-[99] h-14 w-14 rounded-full bg-emerald-500 text-white shadow-[0_8px_24px_rgba(16,185,129,0.45)] hover:bg-emerald-600 hover:scale-110 transition-all flex items-center justify-center group"
        aria-label="Abrir chat de WhatsApp"
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <>
            <MessageCircle className="h-6 w-6" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-300 animate-ping" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400" />
          </>
        )}
      </button>
    </>
  );
}
