import { Link } from "@tanstack/react-router";
import { BellRing, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingBookings } from "@/hooks/use-pending-bookings";

const when = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota",
});
const money = new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
});

export function PendingBookingRequests({ userId }: { userId: string }) {
  const query = usePendingBookings(userId);
  if (query.isLoading) return null;
  if (query.error) return (
    <section className="space-y-2" aria-label="Solicitudes de servicio">
      <p className="text-sm text-destructive">No pudimos cargar tus solicitudes.</p>
      <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Reintentar</Button>
    </section>
  );
  if (!query.data?.length) return null;
  return (
    <section className="space-y-3" aria-label="Solicitudes de servicio" aria-live="polite">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold">
        <BellRing className="h-4 w-4 text-copper" aria-hidden />
        Solicitudes de servicio ({query.data.length})
      </h2>
      <ul className="space-y-2">
        {query.data.map((booking) => (
          <li key={booking.id} className="rounded-lg border border-copper/30 bg-card p-4">
            <p className="text-sm font-semibold">Una familia solicita tu servicio</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {when.format(new Date(booking.scheduled_at))} · {booking.duration_hours} h · {money.format(booking.total_amount)}
            </p>
            <Button asChild className="mt-3" size="sm">
              <Link to="/servicio/$bookingId" params={{ bookingId: booking.id }}>
                Revisar solicitud <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}