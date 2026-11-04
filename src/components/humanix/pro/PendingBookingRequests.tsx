// Solicitudes nuevas al profesional, arriba del todo y en vivo, como en inDrive: cuánto pagan, cuándo, hace cuánto
// llegó y un botón grande para aceptar sin salir del panel (o ver el detalle antes).
// Si es en efectivo y la billetera no alcanza para la comisión (o está bloqueada), el botón pasa a «Recargar $X y aceptar»:
// abre la recarga por Bre-B y, apenas entra la plata, acepta el turno solo.
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, ChevronRight, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BrebPaySheet } from "@/components/humanix/payments/BrebPaySheet";
import { useWallet, walletQuery } from "@/components/humanix/payments/WalletCard";
import { acceptPendingBooking, usePendingBookings } from "@/hooks/use-pending-bookings";
import { COP, cashAcceptCheck, suggestedTopupCOP } from "@/lib/commissionMatrix";
import { topupWalletWithBreb } from "@/lib/firux.functions";
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
  const wallet = useWallet(userId);
  const qc = useQueryClient();
  // Recarga en curso para poder aceptar: el turno y el valor.
  const [topup, setTopup] = useState<{ bookingId: string; amount: number } | null>(null);

  /** Lo que le falta para aceptar este turno (0 si alcanza o si aún no se sabe: la base decide al aceptar). */
  const missingFor = (b: { payment_method: string | null; platform_fee_amount: number | null }) => {
    const w = wallet.data;
    if (!w) return 0;
    const fee = b.payment_method === "CASH" ? Number(b.platform_fee_amount ?? 0) : 0;
    const check = cashAcceptCheck(w.balance, fee, w.limit, w.reserved);
    return check.ok ? 0 : check.missingCOP;
  };

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
      const hint = String((e as { hint?: unknown })?.hint ?? "");
      if (hint.startsWith("wallet_")) {
        // La base no deja aceptar sin cupo (`hx_booking_wallet_gate`): se explica y se ofrece recargar a un toque.
        toast.error(
          (e as { message?: string }).message ?? "Recarga tu billetera para aceptar este turno.",
          {
            duration: 10_000,
            action: {
              label: "Recargar",
              onClick: () =>
                document
                  .getElementById("billetera")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" }),
            },
          },
        );
      } else {
        toast.error(friendlyError(e));
      }
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
          const cash = booking.payment_method === "CASH";
          const missing = missingFor(booking);
          const topupFor = suggestedTopupCOP(missing);
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
                    {cash
                      ? `💵 En efectivo · comisión ${money.format(booking.platform_fee_amount ?? 0)} de tu billetera`
                      : "⚡ Paga la familia por Bre-B · te llega a tu llave"}{" "}
                    · llegó {waitingLabel(booking.created_at, now)}
                  </p>
                </div>
              </div>
              {missing > 0 && (
                <p className="mt-3 rounded-xl bg-copper/10 px-3 py-2 text-sm" role="status">
                  {wallet.data?.blocked
                    ? `Tu billetera pasó el cupo. Recarga ${COP(topupFor)} para volver a recibir turnos.`
                    : `Te faltan ${COP(missing)} en tu billetera para aceptarlo en efectivo.`}
                </p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {missing > 0 ? (
                  <Button
                    size="lg"
                    className="min-h-12 text-base font-bold"
                    disabled={accepting !== null}
                    onClick={() => setTopup({ bookingId: booking.id, amount: topupFor })}
                  >
                    <Zap className="h-5 w-5" aria-hidden />
                    Recargar {COP(topupFor)} y aceptar
                  </Button>
                ) : (
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
                )}
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
      <BrebPaySheet
        open={topup !== null}
        onOpenChange={(o) => !o && setTopup(null)}
        title="Recargar y aceptar"
        subtitle="Apenas pagues, aceptamos el turno por ti."
        start={() => topupWalletWithBreb({ data: { amountCop: topup?.amount ?? 0 } })}
        paidMessage="Recarga lista. Estamos aceptando el turno…"
        onPaid={() => {
          const id = topup?.bookingId;
          setTopup(null);
          void qc.invalidateQueries({ queryKey: walletQuery(userId) });
          if (id) void accept(id);
        }}
      />
    </section>
  );
}
