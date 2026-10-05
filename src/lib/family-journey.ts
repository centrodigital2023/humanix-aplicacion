// Recorrido de la familia, de punta a punta:
//   home (elige) → registro (si hace falta) → pedido → seguimiento en el mapa → valoración.
// Lógica pura y testeable: pedido pendiente guardado y pasos del servicio.

export type WhenKey = "now" | "afternoon" | "tomorrow";

/** Pedido que la familia armó antes de tener cuenta; se retoma tras registrarse. */
export type PendingBooking = {
  proId: string;
  proName: string;
  hourlyRate: number | null;
  avatarUrl?: string | null;
  when: WhenKey;
  hours: number;
  address: string;
  coords: { lat: number; lng: number } | null;
  savedAt: number;
};

export const PENDING_BOOKING_KEY = "humanix-pending-booking";
/** Un pedido guardado vale 24 horas; después se descarta. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export function savePendingBooking(p: Omit<PendingBooking, "savedAt">, now = Date.now()) {
  try {
    localStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify({ ...p, savedAt: now }));
  } catch {
    /* sin almacenamiento: el flujo sigue, solo no se retoma */
  }
}

export function parsePendingBooking(raw: string | null, now = Date.now()): PendingBooking | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingBooking>;
    if (!p.proId || !p.proName || typeof p.savedAt !== "number") return null;
    if (now - p.savedAt > PENDING_TTL_MS) return null;
    return {
      proId: p.proId,
      proName: p.proName,
      hourlyRate: typeof p.hourlyRate === "number" ? p.hourlyRate : null,
      avatarUrl: p.avatarUrl ?? null,
      when: p.when === "afternoon" || p.when === "tomorrow" ? p.when : "now",
      hours: typeof p.hours === "number" && p.hours > 0 ? p.hours : 4,
      address: typeof p.address === "string" ? p.address : "",
      coords: p.coords && typeof p.coords.lat === "number" ? p.coords : null,
      savedAt: p.savedAt,
    };
  } catch {
    return null;
  }
}

export function loadPendingBooking(now = Date.now()): PendingBooking | null {
  try {
    return parsePendingBooking(localStorage.getItem(PENDING_BOOKING_KEY), now);
  } catch {
    return null;
  }
}

export function clearPendingBooking() {
  try {
    localStorage.removeItem(PENDING_BOOKING_KEY);
  } catch {
    /* ignore */
  }
}

/** Fecha del servicio según la opción elegida ("Ya", "Esta tarde", "Mañana"). */
export function whenToDate(w: WhenKey, from = new Date()): Date {
  const d = new Date(from);
  d.setSeconds(0, 0);
  if (w === "now") {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  } else if (w === "afternoon") {
    d.setMinutes(0);
    d.setHours(Math.max(d.getHours() + 2, 14));
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0);
  }
  return d;
}

// ── Pasos del servicio (mismo indicador en home, panel y seguimiento) ────────

export const JOURNEY_STEPS = [
  { status: "pending", emoji: "📝", label: "Pedido" },
  { status: "confirmed", emoji: "✅", label: "Aceptado" },
  { status: "in_route", emoji: "🚗", label: "En camino" },
  { status: "in_progress", emoji: "🏠", label: "Cuidando" },
  { status: "completed", emoji: "⭐", label: "Terminado" },
] as const;

/** Índice 0-4 del paso actual; -1 si el servicio fue cancelado. */
export function journeyIndex(status: string): number {
  if (status === "cancelled") return -1;
  const i = JOURNEY_STEPS.findIndex((s) => s.status === status);
  return i === -1 ? 0 : i;
}

/** Frase corta para la familia según el estado. */
export function journeySentence(status: string, proName: string): string {
  const name = proName.split(" ")[0] || "El profesional";
  switch (status) {
    case "pending":
      return `Esperando que ${name} acepte`;
    case "confirmed":
      return `${name} aceptó tu pedido`;
    case "in_route":
      return `${name} va en camino`;
    case "in_progress":
      return `${name} está cuidando a tu familiar`;
    case "completed":
      return "Servicio terminado. ¿Cómo te fue?";
    case "cancelled":
      return "Pedido cancelado";
    default:
      return "Pedido enviado";
  }
}

export const ACTIVE_STATUSES = ["pending", "confirmed", "in_route", "in_progress"] as const;
