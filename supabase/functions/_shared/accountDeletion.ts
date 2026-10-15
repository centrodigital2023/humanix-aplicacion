// Eliminar la propia cuenta — reglas puras (sin APIs de Deno) que comparten la Edge Function `delete-account` y la
// interfaz (vía `src/lib/accountDeletion.ts`), probadas con Vitest.
//
// Lo que se protege: que nadie quede a mitad de un cuidado. Mientras haya un servicio en curso o programado, la
// cuenta no se elimina (ni en la interfaz ni en el servidor): primero se termina o se cancela con el flujo normal, que
// ya avisa a la otra parte. La eliminación en sí es discreta: no se envía ningún aviso a otras personas.

/** Estados de un servicio que aún no termina (ver la máquina de estados de `service_bookings`). */
export const OPEN_BOOKING_STATUSES = ["pending", "confirmed", "in_route", "in_progress"] as const;

/** Un servicio pendiente o confirmado de hace más de esto ya no se considera «programado» (quedó olvidado). */
export const STALE_AFTER_MS = 12 * 3_600_000;

export interface DeletionBooking {
  status: string;
  scheduled_at: string | null;
}

export interface DeletionBlockers {
  /** En camino o en curso ahora. */
  inProgress: number;
  /** Pendientes o confirmados para hoy o más adelante. */
  upcoming: number;
  blocked: boolean;
}

export function deletionBlockers(
  bookings: readonly DeletionBooking[],
  now: number,
): DeletionBlockers {
  let inProgress = 0;
  let upcoming = 0;
  for (const b of bookings) {
    if (b.status === "in_route" || b.status === "in_progress") {
      inProgress++;
    } else if (b.status === "pending" || b.status === "confirmed") {
      const t = b.scheduled_at ? Date.parse(b.scheduled_at) : NaN;
      // Sin fecha legible se trata como programado: es mejor preguntar que dejar a alguien sin servicio.
      if (!Number.isFinite(t) || t >= now - STALE_AFTER_MS) upcoming++;
    }
  }
  return { inProgress, upcoming, blocked: inProgress + upcoming > 0 };
}

/** «eliminar», sin importar mayúsculas, tildes ni espacios alrededor. */
export function isDeleteConfirmation(text: string): boolean {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "eliminar";
}

/** Frase serena con lo que impide eliminar la cuenta, o `null` si nada lo impide. */
export function blockersLine(b: DeletionBlockers): string | null {
  if (!b.blocked) return null;
  const parts: string[] = [];
  if (b.inProgress > 0) {
    parts.push(b.inProgress === 1 ? "un servicio en curso" : `${b.inProgress} servicios en curso`);
  }
  if (b.upcoming > 0) {
    parts.push(b.upcoming === 1 ? "un servicio programado" : `${b.upcoming} servicios programados`);
  }
  const what =
    b.inProgress + b.upcoming === 1 ? "Termínalo o cancélalo" : "Termínalos o cancélalos";
  return `Tienes ${parts.join(" y ")}. ${what} desde tu agenda y luego vuelve aquí: así nadie se queda esperando.`;
}
