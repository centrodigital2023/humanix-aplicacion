// Banner de consentimiento Habeas Data (Ley 1581 de 2012).
// Persistente en localStorage + registro en backend si hay sesión.
import { useEffect, useState } from "react";
import { Shield, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const KEY = "hx_habeas_v1";

export function HabeasDataConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  const accept = async () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // ignore
    }
    setShow(false);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session) {
        await supabase.from("user_consents").insert({
          user_id: sess.session.user.id,
          consent_type: "habeas_data_v1",
          granted: true,
          user_agent: navigator.userAgent,
        });
      }
    } catch {
      // silencioso
    }
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-3 inset-x-3 sm:bottom-5 sm:left-5 sm:right-auto sm:max-w-md z-[60] animate-in slide-in-from-bottom-6 fade-in duration-500">
      <div className="relative rounded-2xl border border-border bg-card/95 backdrop-blur-xl p-4 pr-10 shadow-[var(--shadow-elegant)]">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-biosensor/15 text-biosensor inline-flex items-center justify-center">
            <Shield className="h-4 w-4" />
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="text-foreground font-semibold text-sm">Tu privacidad importa</p>
            <p className="mt-1">
              Humanix trata tus datos según la <strong>Ley 1581 de 2012</strong> (Habeas Data) y el
              Decreto 1377 de 2013. Usamos cookies esenciales y, con tu permiso explícito,
              geolocalización durante servicios activos.
            </p>
            <Button onClick={accept} variant="hero" size="sm" className="mt-3">
              Aceptar y continuar
            </Button>
          </div>
        </div>
        <button
          onClick={() => setShow(false)}
          aria-label="Cerrar"
          className="absolute top-2 right-2 h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
