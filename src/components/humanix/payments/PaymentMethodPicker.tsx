// «¿Cómo quieres pagar?» — dos tarjetas grandes y claras al pedir un turno. Bre-B va primero (es lo más fácil: el
// celular abre el banco y listo); efectivo sigue disponible. La familia nunca paga comisión: el total es el total.
import { cn } from "@/lib/utils";
import { COP, MIN_BOOKING_COP } from "@/lib/commissionMatrix";

export type PaymentMethod = "DIGITAL_BREB" | "CASH";

const OPTIONS: Array<{
  value: PaymentMethod;
  emoji: string;
  title: string;
  line: string;
  badge?: string;
}> = [
  {
    value: "DIGITAL_BREB",
    emoji: "⚡",
    title: "Bre-B",
    line: "Desde la app de tu banco, Nequi o Daviplata. Pagas cuando el profesional acepte.",
    badge: "Más fácil",
  },
  {
    value: "CASH",
    emoji: "💵",
    title: "Efectivo",
    line: "Le pagas en mano al profesional al terminar.",
  },
];

export function PaymentMethodPicker({
  value,
  onChange,
  proFirstName,
  size = "md",
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
  proFirstName?: string;
  size?: "md" | "lg";
}) {
  return (
    <fieldset>
      <legend className={cn("font-semibold", size === "lg" ? "mb-3 text-lg" : "mb-2 text-sm")}>
        ¿Cómo quieres pagar?
      </legend>
      <div role="radiogroup" className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition active:scale-[0.98]",
                on
                  ? "border-biosensor bg-biosensor/10 shadow-sm"
                  : "border-border bg-background hover:border-biosensor/40",
                size === "lg" && "p-4",
              )}
            >
              {o.badge && (
                <span className="absolute -top-2.5 right-2 rounded-full bg-biosensor px-2 py-0.5 text-[10px] font-bold text-biosensor-foreground">
                  {o.badge}
                </span>
              )}
              <span className={cn("font-bold", size === "lg" ? "text-lg" : "text-base")}>
                <span aria-hidden="true">{o.emoji}</span> {o.title}
              </span>
              <span
                className={cn(
                  "leading-snug text-muted-foreground",
                  size === "lg" ? "text-sm" : "text-xs",
                )}
              >
                {o.value === "CASH" && proFirstName
                  ? `Le pagas en mano a ${proFirstName} al terminar.`
                  : o.line}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Aviso amable si el turno no llega al mínimo (la base también lo exige: `hx_booking_commission`). */
export function minBookingMessage(total: number): string | null {
  return total > 0 && total < MIN_BOOKING_COP
    ? `El turno mínimo es de ${COP(MIN_BOOKING_COP)}. Suma una hora más para continuar.`
    : null;
}
