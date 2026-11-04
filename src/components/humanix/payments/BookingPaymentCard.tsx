// El pago del turno, visto por cada lado y siempre en una frase:
//   Familia     · Bre-B sin pagar y ya aceptado → un botón grande «Pagar $X con Bre-B» (abre la hoja con QR y banco).
//               · Bre-B antes de que acepten → «Pagarás cuando {nombre} acepte».  · Pagado → ✅.  · Efectivo → cuánto entregar en mano.
//   Profesional · Bre-B pagado → cuánto le llega a su llave.  · Sin pagar → que espere.  · Efectivo → cuánto cobrar y la
//               comisión apartada (al aceptar) o descontada (al terminar) de su billetera.
import { useState } from "react";
import { CheckCircle2, Hourglass, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COP } from "@/lib/commissionMatrix";
import { payBookingWithBreb } from "@/lib/firux.functions";
import { cn } from "@/lib/utils";
import { BrebPaySheet } from "./BrebPaySheet";

export type PaymentBooking = {
  id: string;
  status: string;
  total_amount: number;
  payment_method?: string | null;
  paid_at?: string | null;
  platform_fee_amount?: number | null;
  professional_payout?: number | null;
  commission_exempt_cop?: number | null;
};

const PAYABLE = new Set(["confirmed", "accepted", "in_progress", "completed"]);

export function BookingPaymentCard({
  booking,
  side,
  peerFirstName,
  onPaid,
}: {
  booking: PaymentBooking;
  side: "client" | "professional";
  peerFirstName: string;
  onPaid?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cash = booking.payment_method === "CASH";
  const paid = Boolean(booking.paid_at);
  const cancelled = booking.status === "cancelled";
  if (cancelled) return null;

  const tone = paid ? "ok" : cash ? "neutral" : "action";
  const box = cn(
    "rounded-3xl border p-4",
    tone === "ok" && "border-biosensor/30 bg-biosensor/10",
    tone === "neutral" && "border-border bg-muted/40",
    tone === "action" && "border-trust/30 bg-trust/5",
  );

  if (side === "client") {
    if (cash) {
      const done = booking.status === "completed";
      return (
        <div className={box}>
          <p className="text-base font-semibold">
            {done
              ? `💵 Turno en efectivo: ${COP(booking.total_amount)} a ${peerFirstName}.`
              : `💵 Al terminar, le pagas ${COP(booking.total_amount)} en mano a ${peerFirstName}.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {done
              ? "Si aún no se lo entregaste, hazlo ahora. Sin comisión para ti."
              : "Sin comisión para ti: solo el valor del turno. Ten el efectivo listo."}
          </p>
        </div>
      );
    }
    if (paid) {
      return (
        <div className={box}>
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-5 w-5 text-biosensor" aria-hidden="true" /> Turno pagado con
            Bre-B
          </p>
          <p className="text-sm text-muted-foreground">
            Gracias. {peerFirstName} recibe su pago al terminar el turno.
          </p>
        </div>
      );
    }
    if (!PAYABLE.has(booking.status)) {
      return (
        <div className={box}>
          <p className="flex items-center gap-2 text-base font-semibold">
            <Zap className="h-5 w-5 text-trust" aria-hidden="true" /> Pagarás con Bre-B cuando{" "}
            {peerFirstName} acepte
          </p>
          <p className="text-sm text-muted-foreground">
            Te avisamos al instante. Es un toque desde la app de tu banco.
          </p>
        </div>
      );
    }
    return (
      <div className={box}>
        <p className="text-sm text-muted-foreground">{peerFirstName} aceptó tu turno 💚</p>
        <Button
          size="lg"
          className="mt-2 h-16 w-full rounded-2xl text-lg font-bold"
          onClick={() => setOpen(true)}
        >
          <Zap className="mr-2 h-6 w-6" aria-hidden="true" /> Pagar {COP(booking.total_amount)} con
          Bre-B
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Desde tu banco, Nequi o Daviplata · sin comisión para ti
        </p>
        <BrebPaySheet
          open={open}
          onOpenChange={setOpen}
          title="Pagar turno"
          subtitle={`Turno con ${peerFirstName}`}
          start={() => payBookingWithBreb({ data: { bookingId: booking.id } })}
          paidMessage={`Le avisamos a ${peerFirstName} que el turno está pago.`}
          onPaid={onPaid}
        />
      </div>
    );
  }

  // Profesional
  const fee = Number(booking.platform_fee_amount ?? 0);
  const exempt = Number(booking.commission_exempt_cop ?? 0);
  if (cash) {
    const done = booking.status === "completed";
    const accepted = booking.status !== "pending";
    return (
      <div className={box}>
        <p className="text-base font-semibold">
          {done
            ? `💵 Cobraste ${COP(booking.total_amount)} en efectivo.`
            : `💵 Al terminar te pagan ${COP(booking.total_amount)} en efectivo.`}
        </p>
        <p className="text-sm text-muted-foreground">
          {fee > 0
            ? done
              ? `Descontamos ${COP(fee)} de comisión de tu billetera Humanix.`
              : accepted
                ? `Tienes ${COP(fee)} de comisión apartados en tu billetera; se descuentan al terminar.`
                : `Al aceptar apartamos ${COP(fee)} de comisión de tu billetera; se descuentan al terminar.`
            : "Este turno no paga comisión 🎉"}
          {exempt > 0 && ` (primer turno con esta familia: te ahorraste ${COP(exempt)})`}
        </p>
      </div>
    );
  }
  return (
    <div className={box}>
      <p className="flex items-center gap-2 text-base font-semibold">
        {paid ? (
          <CheckCircle2 className="h-5 w-5 text-biosensor" aria-hidden="true" />
        ) : (
          <Hourglass className="h-5 w-5 text-trust" aria-hidden="true" />
        )}
        {paid ? "La familia ya pagó con Bre-B" : "La familia pagará con Bre-B"}
      </p>
      <p className="text-sm text-muted-foreground">
        Al terminar te enviamos {COP(Number(booking.professional_payout ?? booking.total_amount))} a
        tu llave Bre-B
        {exempt > 0 ? ` (primer turno con esta familia: sin comisión hasta ${COP(exempt)})` : ""}.
      </p>
    </div>
  );
}
