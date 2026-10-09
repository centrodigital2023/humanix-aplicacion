// Cancelar un servicio: motivos guiados en lugar de un cuadro de texto del navegador.
//
// El motivo queda en `service_bookings.cancel_reason` y lo lee la otra parte. Se valida igual que cualquier mensaje
// que viaja por la plataforma (sin teléfonos, enlaces ni datos de pago). Quién puede cancelar y las transiciones de
// estado las impone la base de datos (`guard_booking_integrity`).

import { z } from "zod";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "./opportunities";

export type CancelParty = "client" | "professional";

export interface CancelReason {
  id: string;
  label: string;
}

export const CANCEL_REASONS: Record<CancelParty, readonly CancelReason[]> = {
  client: [
    { id: "no_longer_needed", label: "Ya no necesito el servicio" },
    { id: "schedule_change", label: "Cambió el horario" },
    { id: "other_option", label: "Encontré otra opción" },
    { id: "patient_hospitalized", label: "El paciente está hospitalizado" },
    { id: "other", label: "Otro motivo" },
  ],
  professional: [
    { id: "health_issue", label: "Tengo un problema de salud" },
    { id: "schedule_conflict", label: "Se me cruzó el horario" },
    { id: "transport", label: "No puedo llegar (transporte)" },
    { id: "family_emergency", label: "Emergencia familiar" },
    { id: "other", label: "Otro motivo" },
  ],
};

export const CANCEL_DETAIL_MAX = 300;

export function cancelReasonLabel(party: CancelParty, id: string): string {
  return CANCEL_REASONS[party].find((r) => r.id === id)?.label ?? id;
}

export function cancelFormSchema(party: CancelParty) {
  const ids = CANCEL_REASONS[party].map((r) => r.id);
  return z
    .object({
      reason: z.string().min(1, "Elige un motivo."),
      detail: z
        .string()
        .max(CANCEL_DETAIL_MAX + 100, `Máximo ${CANCEL_DETAIL_MAX} caracteres.`)
        .optional(),
    })
    .superRefine((v, ctx) => {
      if (!ids.includes(v.reason)) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: "Elige un motivo de la lista." });
        return;
      }
      const detail = (v.detail ?? "").trim();
      if (v.reason === "other" && !detail) {
        ctx.addIssue({
          code: "custom",
          path: ["detail"],
          message: "Cuéntale brevemente a la otra parte qué pasó.",
        });
        return;
      }
      const check = checkOutgoingMessage(detail, { maxChars: CANCEL_DETAIL_MAX });
      if (!check.ok)
        ctx.addIssue({
          code: "custom",
          path: ["detail"],
          message: MESSAGE_ERROR_COPY[check.reason],
        });
    });
}

export type CancelFormValues = z.output<ReturnType<typeof cancelFormSchema>>;

/** Texto que se guarda en `cancel_reason`: «Motivo: detalle» o solo el motivo. */
export function buildCancelReason(party: CancelParty, values: CancelFormValues): string {
  const label = cancelReasonLabel(party, values.reason);
  const detail = (values.detail ?? "").trim();
  if (values.reason === "other") return detail;
  return detail ? `${label}: ${detail}` : label;
}

/** Cambios de la reserva al cancelar (la hora de cancelación la fija el cliente web; el estado lo valida el servidor). */
export function buildCancelPatch(
  party: CancelParty,
  values: CancelFormValues,
  now: Date = new Date(),
) {
  return {
    status: "cancelled" as const,
    cancelled_at: now.toISOString(),
    cancel_reason: buildCancelReason(party, values),
  };
}

/**
 * Qué le pasa a la otra parte, en palabras claras, para mostrar antes de confirmar.
 * `offer`: el servicio nació de una oferta/turno publicado (hay plan B automático); `direct`: reserva directa.
 */
export function cancelConsequence(party: CancelParty, mode: "direct" | "offer" = "direct"): string {
  if (party === "professional") {
    return mode === "offer"
      ? "Se avisa de inmediato a quien te contrató, el turno se reabre y activamos su plan B: se invita a su equipo de confianza a cubrirlo."
      : "Se avisa de inmediato a la familia y le decimos cuántos de su equipo de confianza están libres para cubrir el horario.";
  }
  return "Se avisa de inmediato al profesional y se libera su horario.";
}
