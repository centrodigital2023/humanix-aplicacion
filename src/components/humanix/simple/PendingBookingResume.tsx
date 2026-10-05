// Retoma el pedido que la familia armó antes de registrarse.
//  - Vuelve del registro (?pedir=1) con sesión → abre la reserva ya llena.
//  - Si no, muestra "Tienes un pedido guardado con Ana · Continuar".
import { useEffect, useMemo, useState } from "react";
import type { AppUser } from "@/hooks/use-app-user";
import { clearPendingBooking, loadPendingBooking, type PendingBooking } from "@/lib/family-journey";
import { QuickBooking } from "./QuickBooking";
import { useVoice } from "./voice";

export function PendingBookingResume({
  user,
  autoOpen,
  onConsumed,
}: {
  user: AppUser | null;
  autoOpen: boolean;
  onConsumed: () => void;
}) {
  const { say } = useVoice();
  const [pending, setPending] = useState<PendingBooking | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPending(loadPendingBooking());
  }, []);

  useEffect(() => {
    if (autoOpen && user && pending) {
      setOpen(true);
      say(`Bienvenido. Confirma tu pedido con ${pending.proName}.`);
      onConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, user, pending]);

  // Objeto estable: QuickBooking reinicia sus campos cuando cambia `pro`.
  const pro = useMemo(
    () =>
      open && pending
        ? {
            id: pending.proId,
            name: pending.proName,
            hourlyRate: pending.hourlyRate,
            avatarUrl: pending.avatarUrl,
          }
        : null,
    [open, pending],
  );

  if (!pending) return null;

  return (
    <>
      {!open && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-[2rem] border-2 border-trust/30 bg-card p-5 shadow-lg shadow-trust/10 animate-in fade-in sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-3 text-lg font-bold">
            <span aria-hidden="true" className="text-3xl">
              🧡
            </span>
            Tienes un pedido guardado con {pending.proName}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="min-h-14 rounded-2xl bg-trust px-6 text-base font-bold text-trust-foreground shadow-md active:scale-95"
            >
              Continuar
            </button>
            <button
              type="button"
              onClick={() => {
                clearPendingBooking();
                setPending(null);
              }}
              className="min-h-14 rounded-2xl border-2 border-border px-4 text-base font-bold active:scale-95"
            >
              Borrar
            </button>
          </div>
        </div>
      )}
      <QuickBooking
        pro={pro}
        onClose={() => setOpen(false)}
        initialWhen={pending.when}
        initialHours={pending.hours}
        defaultAddress={pending.address}
        defaultCoords={pending.coords}
      />
    </>
  );
}
