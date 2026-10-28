// Flujo del servicio tipo InDrive, igual para familia, EPS/IPS y profesional:
//   📝 Pedido → ✅ Aceptado → 🚗 En camino → 🏠 Cuidando → ⭐ Terminado
// Estados de `service_bookings`: pending → confirmed → in_route → in_progress → completed (o cancelled).
// Las transiciones las impone la base (`guard_booking_integrity`); aquí solo vive lo que la pantalla decide.
// Lógica pura y testeable: qué frase ver, qué botón mostrar, cuándo se abre el chat y qué aviso merece alerta.
import { journeySentence } from "@/lib/family-journey";

export type FlowViewer = "client" | "professional" | "viewer";

/** El chat y la llamada se desbloquean en cuanto el profesional acepta. */
const CONTACT_STATUSES = new Set(["confirmed", "in_route", "in_progress", "completed"]);
export function isContactUnlocked(status: string): boolean {
  return CONTACT_STATUSES.has(status);
}

/** Frase grande del indicador de pasos, según quién mira. */
export function flowSentence(
  status: string,
  viewer: FlowViewer,
  peerName: string,
  clientOrigin?: "family" | "institution",
): string {
  if (viewer !== "professional") return journeySentence(status, peerName);
  switch (status) {
    case "pending":
      return clientOrigin === "institution"
        ? "La EPS/IPS te pidió este servicio. ¿Lo aceptas?"
        : clientOrigin === "family"
          ? "La familia te pidió este servicio. ¿Lo aceptas?"
          : "Te pidieron este servicio. ¿Lo aceptas?";
    case "confirmed":
      return "Aceptaste. Avisa cuando salgas";
    case "in_route":
      return "Vas en camino. Avisa al llegar";
    case "in_progress":
      return "Estás cuidando. Llena el parte del turno";
    case "completed":
      return "Turno terminado. ¡Gracias por cuidar!";
    case "cancelled":
      return "Servicio cancelado";
    default:
      return "Servicio";
  }
}

export type ProAction = {
  next: "confirmed" | "in_route" | "in_progress" | "completed";
  label: string;
  /** Marca de tiempo que acompaña el cambio. */
  stamp?: "started_at" | "arrived_at" | "completed_at";
  /** «Finalizar» abre el cierre del turno (ánimo + nota) en lugar de cambiar el estado directo. */
  needsDialog?: boolean;
};

/** Siguiente paso que puede dar el profesional desde cada estado (null si no hay ninguno). */
export function nextProfessionalAction(status: string): ProAction | null {
  switch (status) {
    case "pending":
      return { next: "confirmed", label: "Aceptar servicio" };
    case "confirmed":
      return { next: "in_route", label: "Voy en camino", stamp: "started_at" };
    case "in_route":
      return { next: "in_progress", label: "Llegué: empezar a cuidar", stamp: "arrived_at" };
    case "in_progress":
      return {
        next: "completed",
        label: "Terminar turno",
        stamp: "completed_at",
        needsDialog: true,
      };
    default:
      return null;
  }
}

// ── Alertas en vivo ──────────────────────────────────────────────────────────

export type LiveAlertTone = "request" | "good" | "info" | "alert";

export type LiveAlert = {
  /** Clave de deduplicación: la reserva si hay una (el aviso y el INSERT de la reserva son la misma alerta). */
  key: string;
  tone: LiveAlertTone;
  title: string;
  body: string;
  link: string | null;
  /** Solo en solicitudes al profesional: permite «Aceptar» desde la alerta. */
  bookingId?: string;
  /** Se queda en pantalla hasta que la persona actúe. */
  sticky: boolean;
  createdAt: string;
};

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  meta?: unknown;
  read_at?: string | null;
  created_at: string;
};

const ALERT_TYPES: Record<string, { tone: LiveAlertTone; sticky: boolean }> = {
  // Para el profesional
  booking_requested: { tone: "request", sticky: true },
  team_invite_urgent: { tone: "request", sticky: true },
  new_offer: { tone: "info", sticky: false },
  team_invite: { tone: "info", sticky: false },
  opportunity_alert: { tone: "info", sticky: false },
  application_accepted: { tone: "good", sticky: true },
  application_counter_offer: { tone: "info", sticky: false },
  slot_counter_offer: { tone: "info", sticky: false },
  slot_proposal_accepted: { tone: "good", sticky: true },
  slot_proposal_rejected: { tone: "info", sticky: false },
  application_rejected: { tone: "info", sticky: false },
  // Para familia y EPS/IPS (y su círculo): llegan propuestas, como en inDrive
  application_received: { tone: "good", sticky: false },
  slot_proposal_received: { tone: "good", sticky: false },
  application_withdrawn: { tone: "info", sticky: false },
  booking_confirmed: { tone: "good", sticky: false },
  plan_b_started: { tone: "info", sticky: true },
  booking_accepted: { tone: "good", sticky: true },
  professional_on_the_way: { tone: "info", sticky: false },
  care_started: { tone: "info", sticky: false },
  care_finished: { tone: "good", sticky: false },
  care_alert: { tone: "alert", sticky: true },
  shift_cancelled_by_professional: { tone: "alert", sticky: true },
  shift_cancelled_by_institution: { tone: "alert", sticky: true },
  booking_cancelled: { tone: "alert", sticky: true },
};

const BOOKING_LINK = /^\/servicio\/([0-9a-f-]{36})$/i;
/** Algunos avisos de la base apuntan al panel de un rol fijo (p. ej. «Nueva postulación» → /dashboard/institucion, también para familias). */
const ROLE_PANEL_LINK = /^\/dashboard\/(institucion|familia|profesional)\/?$/;

/** ¿Este tipo de aviso sale como alerta flotante? Los paneles lo usan para no repetirlo en un toast. */
export function isLiveAlertType(type: string): boolean {
  return type in ALERT_TYPES;
}

/** Enlace del aviso: el panel genérico decide por rol, así nadie cae en el panel de otro rol. */
export function alertLink(link: string | null): string | null {
  if (!link) return null;
  return ROLE_PANEL_LINK.test(link) ? "/dashboard" : link;
}

function bookingIdOf(n: NotificationRow): string | undefined {
  const meta = n.meta as { booking_id?: unknown } | null | undefined;
  if (meta && typeof meta.booking_id === "string") return meta.booking_id;
  const m = n.link ? BOOKING_LINK.exec(n.link) : null;
  return m?.[1];
}

/** Convierte un aviso de `notifications` en alerta flotante; null si ese tipo no merece interrumpir. */
export function liveAlertFromNotification(n: NotificationRow): LiveAlert | null {
  const kind = ALERT_TYPES[n.type];
  if (!kind) return null;
  const bookingId = bookingIdOf(n);
  return {
    key: n.type === "booking_requested" && bookingId ? `request:${bookingId}` : `n:${n.id}`,
    tone: kind.tone,
    title: n.title,
    body: n.body ?? "",
    link: alertLink(n.link),
    bookingId: n.type === "booking_requested" ? bookingId : undefined,
    sticky: kind.sticky,
    createdAt: n.created_at,
  };
}

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export type PendingBookingRow = {
  id: string;
  duration_hours: number;
  total_amount: number;
  payment_mode?: string | null;
  created_at: string;
};

/**
 * Alerta construida desde la reserva misma (INSERT en `service_bookings` o pendientes al reconectar).
 * Respaldo por si el aviso de `notifications` no llega: comparte la clave, así nunca se ve dos veces.
 */
export function liveAlertFromBooking(b: PendingBookingRow): LiveAlert {
  const pay =
    b.payment_mode === "direct_to_professional" || !b.payment_mode
      ? "pago directo al terminar"
      : "pago por la plataforma";
  return {
    key: `request:${b.id}`,
    tone: "request",
    title: "Nueva solicitud de servicio",
    body: `Turno de ${b.duration_hours} h por ${COP.format(b.total_amount)} (${pay}). Acéptalo para abrir el chat y la llamada.`,
    link: `/servicio/${b.id}`,
    bookingId: b.id,
    sticky: true,
    createdAt: b.created_at,
  };
}

/** Al reconectar solo se recuperan avisos recientes: lo viejo ya está en la campana. */
export const MISSED_ALERT_WINDOW_MS = 15 * 60 * 1000;
export function isRecent(
  createdAt: string,
  now: number,
  windowMs = MISSED_ALERT_WINDOW_MS,
): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t <= windowMs;
}

/**
 * Agrega una alerta a la pila sin duplicar (misma clave = misma alerta) y sin pasar del máximo visible.
 * Las más nuevas quedan arriba; las descartadas por la persona no vuelven.
 */
export function pushAlert(
  stack: LiveAlert[],
  alert: LiveAlert,
  dismissed: ReadonlySet<string>,
  max = 3,
): LiveAlert[] {
  if (dismissed.has(alert.key) || stack.some((a) => a.key === alert.key)) return stack;
  return [alert, ...stack].slice(0, max);
}

// ── Espera de respuesta (pedido sin aceptar) ─────────────────────────────────

/** Tras este tiempo sin respuesta se ofrece pedir a otro profesional, como en inDrive. */
export const NO_ANSWER_AFTER_MS = 10 * 60 * 1000;

/** «hace 3 min», «hace 1 h»: cuánto lleva esperando un pedido. */
export function waitingLabel(createdAt: string, now: number): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}

/** ¿El pedido lleva tanto sin respuesta que conviene ofrecer otra opción? */
export function isWaitingTooLong(status: string, createdAt: string, now: number): boolean {
  if (status !== "pending") return false;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now - t >= NO_ANSWER_AFTER_MS;
}

/** Nombre corto de cada estado, igual al indicador de pasos (Pedido, Aceptado, En camino, Cuidando, Terminado). */
export const STATUS_LABEL: Record<string, string> = {
  pending: "Pedido",
  confirmed: "Aceptado",
  in_route: "En camino",
  in_progress: "Cuidando",
  completed: "Terminado",
  cancelled: "Cancelado",
};
