import { useEffect, useState } from "react";

/** Reloj que se actualiza cada minuto: refresca cuentas regresivas y «hoy/mañana» sin pedir datos otra vez. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
