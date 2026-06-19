// SOS Familiar: botón de pánico que crea una clinical_alert crítica con
// ubicación en tiempo real. Reusa la tubería de monitoreo clínico
// (clinical_alerts → Database Webhook → clinical-alert-notify) para avisar
// de inmediato por WhatsApp al paciente, su familia y su profesional.
import { useState } from "react";
import { Siren, Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

function getLocation(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, lng: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 4000, enableHighAccuracy: true },
    );
  });
}

export function SosFamiliarButton({
  patientId,
  className = "",
}: {
  patientId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const trigger = async () => {
    setBusy(true);
    try {
      const { lat, lng } = await getLocation();

      const { error } = await sb.from("clinical_alerts").insert({
        patient_id: patientId,
        alert_type: "sos_manual",
        severity: "critical",
        status: "active",
        actual_value: 0,
        unit: null,
        lat,
        lng,
      });
      if (error) throw error;

      setSent(true);
      toast.success("SOS enviado", {
        description:
          lat != null
            ? "Tu ubicación fue compartida. Tu familia y tu profesional fueron notificados por WhatsApp."
            : "Tu familia y tu profesional fueron notificados por WhatsApp.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar el SOS");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSent(false);
          setOpen(true);
        }}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 text-white font-semibold px-4 py-2.5 text-sm shadow-[0_0_24px_-6px_rgba(220,38,38,0.6)] hover:bg-red-700 transition animate-pulse ${className}`}
      >
        <Siren className="h-4 w-4" />
        SOS Familiar
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="max-w-sm w-full rounded-2xl border border-red-600/40 bg-card p-6 shadow-[var(--shadow-elegant)]">
            <div className="h-12 w-12 rounded-2xl bg-red-600/15 text-red-600 inline-flex items-center justify-center">
              <Siren className="h-6 w-6" />
            </div>
            <h3 className="mt-3 font-display text-xl font-bold">
              {sent ? "SOS enviado" : "¿Activar SOS familiar?"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {sent ? (
                "Tu ubicación y una alerta crítica fueron enviadas por WhatsApp a tu familia y tu profesional asignado. Mantén la calma, te están contactando."
              ) : (
                <>
                  Enviaremos tu <strong>ubicación en tiempo real</strong> y una alerta crítica por
                  WhatsApp a tu familia y tu profesional. Úsalo solo si necesitas ayuda urgente.
                </>
              )}
            </p>
            {!sent && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Compartiremos tu ubicación GPS si tu dispositivo lo permite.
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted/40"
              >
                {sent ? "Cerrar" : "Cancelar"}
              </button>
              {!sent && (
                <button
                  onClick={trigger}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 text-white py-2.5 text-sm font-semibold disabled:opacity-60 hover:bg-red-700"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Siren className="h-4 w-4" />
                  )}
                  Enviar SOS ahora
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
