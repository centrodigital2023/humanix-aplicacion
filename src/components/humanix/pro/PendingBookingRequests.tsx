// Solicitudes nuevas al profesional, arriba del todo y en vivo, como en inDrive: cuánto pagan, cuándo, hace cuánto
// llegó y un botón grande para aceptar sin salir del panel (o ver el detalle antes).
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BellRing, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acceptPendingBooking, usePendingBookings } from "@/hooks/use-pending-bookings";
import { useNow } from "@/hooks/use-now";
import { friendlyError } from "@/lib/friendlyError";
import { waitingLabel } from "@/lib/serviceFlow";

const when = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Bogota",
});
const money = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function PendingBookingRequests({ userId }: { userId: string }) {
  const query = usePendingBookings(userId);
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [accepting, setAccepting] = useState<string | null>(null);

  const accept = async (bookingId: string) => {
    setAccepting(bookingId);
    try {
      const ok = await acceptPendingBooking(bookingId);
      if (!ok) {
        toast.info("Esta solicitud ya no está disponible.");
        void query.refetch();
        return;
      }
      toast.success("¡Aceptaste el servicio! Ya puedes escribir y llamar.");
      void navigate({ to: "/servicio/$bookingId", params: { bookingId } });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setAccepting(null);
    }
  };

  if (query.isLoading) return null;
  if (query.error)
    return (
      <section className="space-y-2" aria-label="Solicitudes de servicio">
        <p className="text-sm text-destructive">No pudimos cargar tus solicitudes.</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </section>
    );
  if (!query.data?.length) return null;
  return (
    <section className="space-y-3" aria-label="Solicitudes de servicio" aria-live="polite">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <BellRing className="h-5 w-5 animate-pulse text-copper" aria-hidden />
        {query.data.length === 1
          ? "Tienes 1 solicitud nueva"
          : `Tienes ${query.data.length} solicitudes nuevas`}
      </h2>
      <ul className="space-y-3">
        {query.data.map((booking) => {
          const direct = !booking.payment_mode || booking.payment_mode === "direct_to_professional";
          return (
            <li
              key={booking.id}
              className="rounded-2xl border-2 border-copper/40 bg-card p-4 shadow-lg shadow-copper/10"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-2xl font-bold">
                    {money.format(booking.total_amount)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {booking.duration_hours} h · {when.format(new Date(booking.scheduled_at))}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {direct ? "Pago directo al terminar" : "Pago por la plataforma"} · llegó{" "}
                    {waitingLabel(booking.created_at, now)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  size="lg"
                  className="min-h-12 text-base font-bold"
                  disabled={accepting !== null}
                  onClick={() => void accept(booking.id)}
                >
                  {accepting === booking.id ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" aria-hidden />
                  )}
                  Aceptar
                </Button>
                <Button asChild size="lg" variant="outline" className="min-h-12 text-base">
                  <Link to="/servicio/$bookingId" params={{ bookingId: booking.id }}>
                    Ver detalle <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
