// «Gracias»: reconocimiento cálido entre las partes de un servicio completado.
//
// No es una calificación (esa mide y compara); es lo que hace que el profesional quiera volver y que la familia
// o la institución quiera agradecer. Espejo de `public.kudos_allowed_kinds` / `public.send_kudos` (migración
// 20261010100000_care_loop.sql): si cambias una lista, cambia la otra y sus pruebas.

import { z } from "zod";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "./opportunities";

/** Quien da las gracias: el cliente (familia o institución) o el profesional. */
export type KudosRole = "client" | "professional";

export interface KudosKind {
  id: string;
  label: string;
  emoji: string;
  /** Frase en primera persona que se muestra bajo el reconocimiento. */
  blurb: string;
}

export const KUDOS_KINDS: Record<KudosRole, readonly KudosKind[]> = {
  client: [
    {
      id: "punctual",
      label: "Puntualidad",
      emoji: "⏰",
      blurb: "Llegó a tiempo y cumplió el horario.",
    },
    {
      id: "caring",
      label: "Trato cariñoso",
      emoji: "💛",
      blurb: "Trató a mi familiar con cariño y respeto.",
    },
    {
      id: "patient",
      label: "Paciencia",
      emoji: "🌿",
      blurb: "Tuvo paciencia cuando más hizo falta.",
    },
    {
      id: "peace_of_mind",
      label: "Me dio tranquilidad",
      emoji: "🕊️",
      blurb: "Pude descansar sabiendo que estaba en buenas manos.",
    },
    {
      id: "communicative",
      label: "Comunicación clara",
      emoji: "💬",
      blurb: "Me mantuvo informado/a en todo momento.",
    },
    {
      id: "professional",
      label: "Muy profesional",
      emoji: "🩺",
      blurb: "Conocimiento, orden y criterio.",
    },
  ],
  professional: [
    {
      id: "respectful",
      label: "Trato respetuoso",
      emoji: "🤝",
      blurb: "Nos trataron con respeto.",
    },
    {
      id: "clear_instructions",
      label: "Indicaciones claras",
      emoji: "📋",
      blurb: "Todo estaba claro desde el inicio.",
    },
    {
      id: "welcoming",
      label: "Ambiente acogedor",
      emoji: "🏡",
      blurb: "Un lugar cómodo para trabajar.",
    },
    {
      id: "well_prepared",
      label: "Todo listo para el turno",
      emoji: "✅",
      blurb: "Tenían todo preparado para el servicio.",
    },
  ],
};

export const MAX_KUDOS_KINDS = 3;
export const KUDOS_MESSAGE_MAX = 280;

const ALL_KINDS: ReadonlyMap<string, KudosKind> = new Map(
  [...KUDOS_KINDS.client, ...KUDOS_KINDS.professional].map((k) => [k.id, k]),
);

export function kudosKindsFor(role: KudosRole): readonly KudosKind[] {
  return KUDOS_KINDS[role];
}

export function isKudosKind(role: KudosRole, id: string): boolean {
  return KUDOS_KINDS[role].some((k) => k.id === id);
}

export function kudosLabel(id: string): string {
  return ALL_KINDS.get(id)?.label ?? id;
}

export function kudosEmoji(id: string): string {
  return ALL_KINDS.get(id)?.emoji ?? "💛";
}

/** Rol de quien mira un servicio respecto a las gracias: cliente, profesional o ninguno (círculo, personal). */
export function kudosRoleFor(
  booking: { client_id: string; professional_id: string },
  userId: string | null | undefined,
): KudosRole | null {
  if (!userId) return null;
  if (userId === booking.client_id) return "client";
  if (userId === booking.professional_id) return "professional";
  return null;
}

/** A quién va dirigido el agradecimiento de ese rol. */
export function kudosRecipient(
  booking: { client_id: string; professional_id: string },
  role: KudosRole,
): string {
  return role === "client" ? booking.professional_id : booking.client_id;
}

/** Formulario de «Gracias» para un rol (lo valida igual que el servidor: lista cerrada, 1 a 3, sin contacto ni pagos). */
export function kudosFormSchema(role: KudosRole) {
  const allowed = KUDOS_KINDS[role].map((k) => k.id);
  return z
    .object({
      kinds: z
        .array(z.string())
        .min(1, "Elige al menos un reconocimiento.")
        .max(MAX_KUDOS_KINDS, `Puedes elegir hasta ${MAX_KUDOS_KINDS}.`),
      message: z
        .string()
        .max(KUDOS_MESSAGE_MAX + 100, `Máximo ${KUDOS_MESSAGE_MAX} caracteres.`)
        .optional(),
    })
    .superRefine((v, ctx) => {
      if (v.kinds.some((k) => !allowed.includes(k))) {
        ctx.addIssue({
          code: "custom",
          path: ["kinds"],
          message: "Elige reconocimientos de la lista.",
        });
      }
      if (new Set(v.kinds).size !== v.kinds.length) {
        ctx.addIssue({ code: "custom", path: ["kinds"], message: "No repitas reconocimientos." });
      }
      const check = checkOutgoingMessage(v.message, { maxChars: KUDOS_MESSAGE_MAX });
      if (!check.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["message"],
          message: MESSAGE_ERROR_COPY[check.reason],
        });
      }
    });
}

export type KudosFormValues = z.output<ReturnType<typeof kudosFormSchema>>;

/** Argumentos del RPC `send_kudos`. */
export function buildKudosCall(bookingId: string, values: KudosFormValues) {
  const message = (values.message ?? "").trim();
  return {
    p_booking_id: bookingId,
    p_kinds: values.kinds,
    p_message: message === "" ? null : message,
  };
}

export interface KudosSummaryRow {
  kind: string;
  givers: number;
}

export interface KudosChip {
  id: string;
  label: string;
  emoji: string;
  count: number;
}

/** Reconocimientos públicos de un profesional, del más frecuente al menos (solo los de familias/instituciones). */
export function kudosChips(rows: KudosSummaryRow[] | null | undefined, limit = 6): KudosChip[] {
  return (rows ?? [])
    .filter((r) => r.givers > 0 && isKudosKind("client", r.kind))
    .sort((a, b) => b.givers - a.givers || a.kind.localeCompare(b.kind))
    .slice(0, limit)
    .map((r) => ({
      id: r.kind,
      label: kudosLabel(r.kind),
      emoji: kudosEmoji(r.kind),
      count: r.givers,
    }));
}

/** Del objeto `kudos_by_kind` de las estadísticas al mismo formato de filas. */
export function kudosRowsFromMap(
  map: Record<string, number> | null | undefined,
): KudosSummaryRow[] {
  return Object.entries(map ?? {}).map(([kind, givers]) => ({ kind, givers: Number(givers) || 0 }));
}

/** Texto para que el profesional comparta sus gracias (sin nombres de familias ni mensajes privados). */
export function kudosShareText(opts: { kinds: string[]; url: string }): string {
  const labels = opts.kinds.slice(0, 3).map((k) => `«${kudosLabel(k)}»`);
  const list = labels.length ? ` por ${labels.join(", ")}` : "";
  return `Las familias me dieron las gracias${list} en Humanix 💛 Mira mi perfil verificado: ${opts.url}`;
}

/** Enlace público al perfil de un profesional. */
export function publicProfileUrl(proId: string, origin?: string): string {
  const base = (
    origin ?? (typeof window !== "undefined" ? window.location.origin : "https://humanix.lat")
  ).replace(/\/$/, "");
  return `${base}/profesional/${proId}`;
}
