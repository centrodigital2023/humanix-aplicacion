// Botón de pánico fucsia neural. Registra incidente + abre llamada al 123.
import { useState } from "react";
import { AlertOctagon, Loader2, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function EmergencyButton({
  bookingId,
  className = "",
}: {
  bookingId?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const trigger = async () => {
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        toast.error("Inicia sesión para reportar la emergencia.");
        return;
      }
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        await new Promise<void>((resolve) => {
          if (typeof navigator === "undefined" || !navigator.geolocation) return resolve();
          navigator.geolocation.getCurrentPosition(
            (p) => {
              lat = p.coords.latitude;
              lng = p.coords.longitude;
              resolve();
            },
            () => resolve(),
            { timeout: 3000 },
          );
        });
      } catch {
        // sin geo
      }
      const { error } = await supabase.from("emergency_incidents").insert({
        triggered_by: sess.session.user.id,
        booking_id: bookingId ?? null,
        incident_type: "panic",
        lat,
        lng,
      });
      if (error) throw error;
      toast.success("Emergencia reportada", {
        description: "Superadmin notificado. Llamando al 123…",
      });
      // Línea única de emergencias en Colombia
      window.location.href = "tel:123";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo reportar la emergencia");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-neural text-fuchsia-neural-foreground font-semibold px-4 py-2.5 text-sm shadow-[var(--shadow-glow-fuchsia)] hover:opacity-95 transition ${className}`}
      >
        <AlertOctagon className="h-4 w-4" />
        Emergencia
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="max-w-sm w-full rounded-2xl border border-fuchsia-neural/40 bg-card p-6 shadow-[var(--shadow-elegant)]">
            <div className="h-12 w-12 rounded-2xl bg-fuchsia-neural/15 text-fuchsia-neural inline-flex items-center justify-center">
              <AlertOctagon className="h-6 w-6" />
            </div>
            <h3 className="mt-3 font-display text-xl font-bold">Confirmar emergencia</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Reportaremos la incidencia al superadmin de Humanix con tu ubicación y te conectaremos
              con la
              <strong> línea única de emergencias 123</strong>.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl border border-border bg-background py-2.5 text-sm font-medium hover:bg-muted/40"
              >
                Cancelar
              </button>
              <button
                onClick={trigger}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-neural text-fuchsia-neural-foreground py-2.5 text-sm font-semibold disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Phone className="h-4 w-4" />
                )}
                Reportar y llamar 123
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
