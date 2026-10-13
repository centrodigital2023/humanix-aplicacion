// SOS: lógica pura del botón de emergencia y de la lista de alertas SOS (sin red ni DOM).
//
// Espejo de `public.clinical_alerts_sos_guard` / `public.hx_can_trigger_sos` (migración 20261012160000_sos_familiar.sql):
// los avisos de error llevan una pista (`hint`) `sos_recent` o `sos_limit`; si cambias esas pistas, cambia esta clasificación.
//
// Lo que NO hace: no promete WhatsApp. El aviso automático por WhatsApp depende de pg_net, de un secreto de Vault y de los
// secretos de la función `clinical-alert-notify`; mientras no existan, el botón enseña a la persona el WhatsApp manual (que
// siempre funciona) y dice con la verdad a cuántas personas se avisó dentro de la app.

/** Línea única de emergencias de Colombia. */
export const EMERGENCY_NUMBER = "123";
export const EMERGENCY_TEL = `tel:${EMERGENCY_NUMBER}`;

/** SOS por paciente: mismas cifras que la guarda de la base (2 minutos entre uno y otro, 5 por hora). */
export const SOS_MIN_GAP_MINUTES = 2;
export const SOS_MAX_PER_HOUR = 5;

export type SosErrorKind = "recent" | "limit" | "denied" | "unavailable" | "unknown";

/** Forma mínima de un error de PostgREST / PostgreSQL. */
export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
}

/** Traduce el error del INSERT del SOS a algo que la pantalla sepa explicar. */
export function classifySosError(err: PgLikeError | null | undefined): SosErrorKind {
  if (!err) return "unknown";
  const hint = (err.hint ?? "").toLowerCase();
  if (hint === "sos_recent") return "recent";
  if (hint === "sos_limit") return "limit";
  const text = `${err.message ?? ""} ${err.details ?? ""}`.toLowerCase();
  if (text.includes("ya se envió un sos")) return "recent";
  if (text.includes("demasiados sos")) return "limit";
  const code = err.code ?? "";
  // 42703 = columna inexistente; PGRST204/PGRST205 = la API no conoce la columna o la tabla (base sin migrar).
  if (
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /column .* does not exist|schema cache|could not find the/.test(text)
  ) {
    return "unavailable";
  }
  if (
    code === "42501" ||
    text.includes("row-level security") ||
    text.includes("permission denied")
  ) {
    return "denied";
  }
  return "unknown";
}

// ── Contacto y WhatsApp manual ────────────────────────────────────────────────────────────────────

/**
 * Celular colombiano listo para `wa.me`: «573001234567». Acepta «300 123 4567», «+57 300 123 4567», «(57) 3001234567»,
 * «0057 300…». Devuelve null si no es un celular (los fijos no usan WhatsApp) o si el número es imposible.
 */
export function normalizeCoPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith("57")) digits = digits.slice(2);
  if (digits.length !== 10 || !digits.startsWith("3")) return null;
  return `57${digits}`;
}

export function isCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Enlace de Google Maps con la ubicación, o null si no hay coordenadas válidas. */
export function mapsLink(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | null {
  if (lat == null || lng == null || !isCoord(lat, lng)) return null;
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Mensaje que la persona envía por WhatsApp a su contacto de emergencia. */
export function sosWhatsappText(input: {
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  const who = (input.name ?? "").trim() || "Una persona de Humanix";
  const link = mapsLink(input.lat, input.lng);
  const where = link
    ? `Mi ubicación: ${link}.`
    : "No pude compartir mi ubicación: por favor llámame ya.";
  return `🆘 ${who} necesita ayuda urgente. ${where} Si no respondo, llama al ${EMERGENCY_NUMBER}.`;
}

/**
 * Enlace de WhatsApp con el texto ya escrito. Con teléfono válido abre ese chat; sin él abre el selector de contactos de
 * WhatsApp (https://wa.me/?text=…), para que la persona elija a quién avisar.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const normalized = normalizeCoPhone(phone);
  const q = `text=${encodeURIComponent(text)}`;
  return normalized ? `https://wa.me/${normalized}?${q}` : `https://wa.me/?${q}`;
}

// ── Lo que se le dice a la persona tras pulsar ────────────────────────────────────────────────────

export type SosStatus = "sent" | SosErrorKind;

export interface SosOutcome {
  tone: "ok" | "warn";
  headline: string;
  lines: string[];
  /** Cuando nadie fue avisado dentro de la app: la pantalla pone «Llamar al 123» y el WhatsApp por delante. */
  callFirst: boolean;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function sosOutcome(input: {
  status: SosStatus;
  /** A cuántas personas se avisó dentro de la app (lo cuenta la base). */
  inappNotified?: number;
  /** Si la función de WhatsApp ya confirmó su envío. */
  whatsappAuto?: boolean;
  hasLocation?: boolean;
  hasEmergencyContact?: boolean;
}): SosOutcome {
  const { status, inappNotified = 0, whatsappAuto = false, hasLocation = false } = input;
  switch (status) {
    case "sent": {
      const lines: string[] = [];
      if (inappNotified > 0) {
        lines.push(
          `Avisamos dentro de Humanix a ${plural(inappNotified, "persona", "personas")} de tu círculo y tu equipo de cuidado.`,
        );
      } else {
        lines.push(
          "Aún no tienes círculo de cuidado ni profesional con servicio vigente a quien avisar dentro de Humanix.",
        );
      }
      lines.push(
        whatsappAuto
          ? "También se envió un WhatsApp automático."
          : input.hasEmergencyContact
            ? "Avisa ya por WhatsApp a tu contacto de emergencia con el botón de abajo."
            : "Avisa por WhatsApp a quien pueda ayudarte con el botón de abajo.",
      );
      lines.push(
        hasLocation
          ? "Tu ubicación quedó registrada y va en el aviso."
          : "No pudimos obtener tu ubicación: dila por teléfono.",
      );
      return {
        tone: inappNotified > 0 ? "ok" : "warn",
        headline: "SOS enviado",
        lines,
        callFirst: inappNotified === 0,
      };
    }
    case "recent":
      return {
        tone: "warn",
        headline: "Ya enviaste un SOS hace un momento",
        lines: [
          "Tu equipo ya recibió el aviso. Si sigues en peligro, llama al 123 y avisa por WhatsApp.",
        ],
        callFirst: true,
      };
    case "limit":
      return {
        tone: "warn",
        headline: "Llegaste al límite de SOS por hora",
        lines: ["Llama directamente al 123 o a tu contacto de emergencia."],
        callFirst: true,
      };
    case "denied":
      return {
        tone: "warn",
        headline: "No pudimos enviar este SOS desde tu cuenta",
        lines: ["Llama al 123 y avisa por WhatsApp a quien pueda ayudarte."],
        callFirst: true,
      };
    case "unavailable":
      return {
        tone: "warn",
        headline: "El aviso dentro de Humanix aún no está habilitado en este entorno",
        lines: ["Llama al 123 y avisa por WhatsApp a tu contacto de emergencia."],
        callFirst: true,
      };
    default:
      return {
        tone: "warn",
        headline: "No pudimos enviar el SOS",
        lines: [
          "Revisa tu conexión. Mientras tanto, llama al 123 y avisa por WhatsApp a quien pueda ayudarte.",
        ],
        callFirst: true,
      };
  }
}

// ── Lista de alertas SOS (lo que ven el círculo, el profesional y la institución) ────────────────────

export type SosAlertStatus = "active" | "acknowledged" | "resolved" | "false_positive";

/** Fila de `public.my_sos_alerts()`. */
export interface SosAlertRow {
  id: string;
  patient_id: string;
  patient_name: string | null;
  triggered_by_name: string | null;
  status: SosAlertStatus;
  lat: number | null;
  lng: number | null;
  created_at: string;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  notified_whatsapp: boolean;
  inapp_notified: number;
  mine: boolean;
}

export type SosAction = "acknowledge" | "resolve" | "false_positive";

export const SOS_STATUS_LABEL: Record<SosAlertStatus, string> = {
  active: "Activa",
  acknowledged: "Atendida",
  resolved: "Resuelta",
  false_positive: "Falsa alarma",
};

export const SOS_ACTION_STATUS: Record<SosAction, Exclude<SosAlertStatus, "active">> = {
  acknowledge: "acknowledged",
  resolve: "resolved",
  false_positive: "false_positive",
};

export const SOS_ACTION_LABEL: Record<SosAction, string> = {
  acknowledge: "Ya voy",
  resolve: "Resuelta",
  false_positive: "Falsa alarma",
};

/** Qué puede hacer quien mira una alerta (la base impide reabrir una cerrada y vuelve a poner quién y cuándo). */
export function sosActionsFor(status: SosAlertStatus): SosAction[] {
  if (status === "active") return ["acknowledge", "resolve", "false_positive"];
  if (status === "acknowledged") return ["resolve", "false_positive"];
  return [];
}

export function isSosOpen(status: SosAlertStatus): boolean {
  return status === "active" || status === "acknowledged";
}

/** Activas primero, luego atendidas, luego cerradas; dentro de cada grupo, la más reciente arriba. */
export function sortSosAlerts<T extends Pick<SosAlertRow, "status" | "created_at">>(
  rows: T[],
): T[] {
  const rank = (s: SosAlertStatus) => (s === "active" ? 0 : s === "acknowledged" ? 1 : 2);
  return [...rows].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function activeSosCount(rows: Pick<SosAlertRow, "status">[]): number {
  return rows.filter((r) => r.status === "active").length;
}

/** «hace 3 min», «hace 2 h», «hace 4 d». */
export function sosAgeLabel(createdAt: string, now: number = Date.now()): string {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** Línea de quién y cuándo atendió la alerta («Atendida por Luis G. hace 2 min»). */
export function sosHandledLine(row: SosAlertRow, now: number = Date.now()): string | null {
  if (row.status === "active") return null;
  const who = row.acknowledged_by_name?.trim();
  const at = row.resolved_at ?? row.acknowledged_at;
  const when = at ? ` ${sosAgeLabel(at, now)}` : "";
  const label =
    row.status === "false_positive" ? "Marcada como falsa alarma" : SOS_STATUS_LABEL[row.status];
  return `${label}${who ? ` por ${who}` : ""}${when}`;
}
