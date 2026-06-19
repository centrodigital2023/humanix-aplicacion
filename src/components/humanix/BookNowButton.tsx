// "Contratar ahora" — crea un service_booking y abre /servicio/$id.
// Usado en cards de profesionales y en cards de ofertas (precarga datos).
import { useState } from "react";
import { Loader2, Calendar, Clock, MapPin, ShieldCheck } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function BookNowButton({
  professionalId,
  hourlyRate,
  jobOfferId,
  defaultAddress,
  defaultLat,
  defaultLng,
  variant = "copper",
  size = "sm",
  className,
  fullWidth = false,
}: {
  professionalId: string;
  hourlyRate: number; // COP/h
  jobOfferId?: string;
  defaultAddress?: string | null;
  defaultLat?: number | null;
  defaultLng?: number | null;
  variant?: "copper" | "hero";
  size?: "sm" | "lg";
  className?: string;
  fullWidth?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return d.toISOString().slice(0, 16);
  });
  const [hours, setHours] = useState<number>(4);
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const total = Math.max(0, Math.round(hours * hourlyRate));
  const platformFee = Math.round(total * 0.03);
  const proPayout = total - platformFee;

  const submit = async () => {
    if (!hourlyRate) {
      toast.error("Este profesional no tiene tarifa por hora configurada");
      return;
    }
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        toast.error("Inicia sesión para contratar.");
        navigate({ to: "/auth" });
        return;
      }
      const scheduled_at = new Date(date).toISOString();
      const { data, error } = await supabase
        .from("service_bookings")
        .insert({
          client_id: sess.session.user.id,
          professional_id: professionalId,
          job_offer_id: jobOfferId ?? null,
          scheduled_at,
          duration_hours: hours,
          hourly_rate: hourlyRate,
          total_amount: total,
          service_address: address || null,
          service_lat: defaultLat ?? null,
          service_lng: defaultLng ?? null,
          emergency_phone: phone || null,
          notes: notes || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Servicio creado", {
        description: "Te llevamos al seguimiento en vivo.",
      });
      setOpen(false);
      navigate({ to: "/servicio/$bookingId", params: { bookingId: data.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear la reserva");
    } finally {
      setBusy(false);
    }
  };

  const btnClass =
    variant === "copper"
      ? "bg-copper text-copper-foreground hover:opacity-95 shadow-[var(--shadow-glow-copper)]"
      : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition ${
          size === "lg" ? "px-5 py-3 text-sm" : "px-3.5 py-2 text-xs"
        } ${fullWidth ? "w-full" : ""} ${variant === "copper" ? btnClass : ""} ${className ?? ""}`}
      >
        Contratar ahora
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)] overflow-hidden"
          >
            <header className="px-5 py-4 border-b border-border">
              <p className="text-[10px] uppercase tracking-widest text-copper font-semibold">
                Reserva de servicio
              </p>
              <h3 className="font-display text-xl font-bold">Confirmar contratación</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Quedará reservado por 15 días según las normas de Humanix.
              </p>
            </header>

            <div className="p-5 space-y-3">
              <Field
                icon={<Calendar className="h-4 w-4 text-biosensor" />}
                label="Fecha y hora del servicio"
              >
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
                />
              </Field>

              <Field icon={<Clock className="h-4 w-4 text-biosensor" />} label="Duración (horas)">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
                />
              </Field>

              <Field
                icon={<MapPin className="h-4 w-4 text-biosensor" />}
                label="Dirección del servicio"
              >
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Calle 100 #15-20, Bogotá"
                  className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
                />
              </Field>

              <Field
                icon={<ShieldCheck className="h-4 w-4 text-biosensor" />}
                label="Teléfono de emergencia"
              >
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+57 300 000 0000"
                  className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
                />
              </Field>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Notas para el profesional (medicación, condiciones, etc.)"
                className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm"
              />

              <div className="rounded-xl bg-biosensor/5 border border-biosensor/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Total a pagar
                    </p>
                    <p className="font-display text-2xl font-bold text-biosensor">{COP(total)}</p>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground leading-tight">
                    {hours} h × {COP(hourlyRate)}/h
                  </div>
                </div>
                <div className="border-t border-biosensor/20 pt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <p className="text-muted-foreground">Profesional recibe</p>
                    <p className="font-semibold text-foreground">{COP(proPayout)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Comisión Humanix (3%)</p>
                    <p className="font-semibold text-copper">{COP(platformFee)}</p>
                  </div>
                </div>
              </div>
            </div>

            <footer className="px-5 py-4 border-t border-border flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="flex-1"
              >
                Cancelar
              </Button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-copper text-copper-foreground font-semibold py-2.5 text-sm shadow-[var(--shadow-glow-copper)] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar y pagar"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {icon}
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
