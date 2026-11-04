// El pago del turno, visto por cada lado y siempre en una frase. Pago retenido tipo InDrive (`src/lib/escrow.ts`):
//   Familia     · Bre-B sin pagar → un botón grande «Pagar $X con Bre-B» desde que pide el turno (hoja con QR y banco).
//               · Pagado → 🔒 protegido por Humanix. · Terminado → «¿Todo bien?»: liberar o reportar (24 h).
//               · Cancelado con pago → devolución completa a su llave Bre-B.  · Efectivo → cuánto entregar en mano.
//   Profesional · Sin pagar → que espere el 🔒 antes de salir. · Pagado → asegurado. · Terminado → por liberar / liberado.
//               · Efectivo → cuánto cobrar y la comisión apartada (al aceptar) o descontada (al terminar) de su billetera.
import { useState } from "react";
import { CheckCircle2, Hourglass, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COP } from "@/lib/commissionMatrix";
import { canClientDecide, canPayBooking, escrowStage, hoursToRelease } from "@/lib/escrow";
import { payBookingWithBreb } from "@/lib/firux.functions";
import { cn } from "@/lib/utils";
import { BrebPaySheet } from "./BrebPaySheet";
import { EscrowDecision, RefundPanel } from "./EscrowPanel";

export type PaymentBooking = {
  id: string;
  status: string;
  total_amount: number;
  payment_method?: string | null;
  paid_at?: string | null;
  platform_fee_amount?: number | null;
  professional_payout?: number | null;
  commission_exempt_cop?: number | null;
  client_id?: string;
  escrow_status?: string | null;
  release_due_at?: string | null;
  release_reason?: string | null;
  client_confirmed_at?: string | null;
};

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
  const stage = escrowStage(booking);
  const now = Date.now();
  // Cancelado: solo importa si hubo plata adentro (devolución).
  if (cancelled && stage !== "refunding" && stage !== "refunded") return null;

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
    if (stage === "refunding" || stage === "refunded") {
      return booking.client_id ? (
        <RefundPanel bookingId={booking.id} userId={booking.client_id} />
      ) : null;
    }
    if (stage === "awaiting_client" || stage === "disputed") {
      if (stage === "disputed" || canClientDecide(booking, now)) {
        return (
          <EscrowDecision
            bookingId={booking.id}
            peerFirstName={peerFirstName}
            amountCOP={Number(booking.total_amount)}
            hoursLeft={hoursToRelease(booking.release_due_at, now)}
            disputed={stage === "disputed"}
            onChanged={onPaid}
          />
        );
      }
    }
    if (stage === "released") {
      return (
        <div className={box}>
          <p className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-5 w-5 text-biosensor" aria-hidden="true" /> Pago liberado a{" "}
            {peerFirstName}
          </p>
          <p className="text-sm text-muted-foreground">
            {booking.release_reason === "auto"
              ? "Pasaron 24 h sin reportes y se lo entregamos. ¡Gracias por cuidar con Humanix!"
              : "Gracias por confirmar. ¡Que tengan un gran día!"}
          </p>
        </div>
      );
    }
    if (paid) {
      return (
        <div className={box}>
          <p className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="h-5 w-5 text-biosensor" aria-hidden="true" /> Pago protegido por
            Humanix
          </p>
          <p className="text-sm text-muted-foreground">
            Guardamos tus {COP(booking.total_amount)}. {peerFirstName} los recibe solo cuando
            confirmes que el turno terminó
            {booking.status === "pending" ? ". Si no acepta, te devolvemos todo." : "."}
          </p>
        </div>
      );
    }
    if (!canPayBooking(booking)) return null;
    return (
      <div className={box}>
        <p className="text-sm text-muted-foreground">
          {booking.status === "pending"
            ? `Paga ahora y asegura tu turno con ${peerFirstName} 🔒`
            : `${peerFirstName} aceptó tu turno 💚`}
        </p>
        <Button
          size="lg"
          className="mt-2 h-16 w-full rounded-2xl text-lg font-bold"
          onClick={() => setOpen(true)}
        >
          <Zap className="mr-2 h-6 w-6" aria-hidden="true" /> Pagar {COP(booking.total_amount)} con
          Bre-B
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Humanix guarda tu pago y solo se lo entrega a {peerFirstName} cuando confirmes que el
          turno terminó. Si se cancela, te devolvemos todo. Sin comisión para ti.
        </p>
        <BrebPaySheet
          open={open}
          onOpenChange={setOpen}
          title="Pagar turno"
          subtitle={`Turno con ${peerFirstName}`}
          start={() => payBookingWithBreb({ data: { bookingId: booking.id } })}
          paidMessage={`Tu pago quedó protegido. Le avisamos a ${peerFirstName}.`}
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
  const net = COP(Number(booking.professional_payout ?? booking.total_amount));
  const exemptNote =
    exempt > 0 ? ` (primer turno con esta familia: sin comisión hasta ${COP(exempt)})` : "";
  const PRO_COPY: Record<string, { icon: "ok" | "wait"; title: string; body: string }> = {
    unpaid: {
      icon: "wait",
      title: "La familia aún no ha pagado con Bre-B",
      body: "Espera a ver «Pago asegurado» antes de salir. Te avisamos al instante.",
    },
    protected: {
      icon: "ok",
      title: "Pago asegurado",
      body: `La familia ya pagó. Humanix guarda el dinero y te libera ${net} al terminar el turno${exemptNote}.`,
    },
    awaiting_client: {
      icon: "wait",
      title: "Pago por liberar",
      body: `La familia tiene ${Math.max(1, hoursToRelease(booking.release_due_at, now))} h para confirmar. Apenas lo haga (o al cumplirse el plazo) te enviamos ${net} a tu llave Bre-B.`,
    },
    disputed: {
      icon: "wait",
      title: "La familia reportó un problema",
      body: "Tu pago queda en pausa mientras el equipo de Humanix lo revisa. Te escribimos pronto.",
    },
    released: {
      icon: "ok",
      title: "Pago liberado",
      body: `Te enviamos ${net} a tu llave Bre-B${exemptNote}.`,
    },
    refunding: {
      icon: "wait",
      title: "El pago se devuelve a la familia",
      body: "El turno se canceló con el pago adentro, así que se lo devolvemos completo.",
    },
    refunded: {
      icon: "wait",
      title: "El pago se devolvió a la familia",
      body: "Si tienes dudas sobre este turno, escríbenos.",
    },
  };
  const copy = PRO_COPY[stage] ?? PRO_COPY.unpaid;
  return (
    <div className={box}>
      <p className="flex items-center gap-2 text-base font-semibold">
        {copy.icon === "ok" ? (
          <ShieldCheck className="h-5 w-5 text-biosensor" aria-hidden="true" />
        ) : (
          <Hourglass className="h-5 w-5 text-trust" aria-hidden="true" />
        )}
        {copy.title}
      </p>
      <p className="text-sm text-muted-foreground">{copy.body}</p>
    </div>
  );
}
