// Postulantes de la familia: la lista de tarjetas (horas + ofertas de trabajo), en vivo, y las acciones sobre cada una.
//
// Todo lo que decide la seguridad vive en la base (migración 20261012190000_offer_alerts_and_plans.sql): qué nombre se ve según el
// plan, quién puede negociar, el cupo diario de contactos, el teléfono. Estos hooks piden, presentan y ejecutan; los errores llegan
// tal cual (código, pista, texto) para que `applicantError` los explique. Las funciones nuevas aún no están en los tipos generados,
// por eso el cliente se tipa a mano.

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  fromOfferRow,
  fromSlotRow,
  sortApplicants,
  type ApplicantCard,
  type OfferApplicantRow,
  type ShiftInput,
  type SlotApplicantRow,
} from "@/lib/applicants";

const sb = supabase as unknown as SupabaseClient;

export const applicantKeys = {
  list: (uid: string) => ["applicants", "list", uid] as const,
};

/** `42883` (función inexistente) o `PGRST202`: la base aún no tiene esa lista; no es un fallo para la persona. */
function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    /could not find the function/i.test(err.message ?? "")
  );
}

async function loadApplicants(): Promise<ApplicantCard[]> {
  const [slots, offers] = await Promise.all([
    sb.rpc("family_applicants", { p_limit: 100 }),
    sb.rpc("family_offer_applicants", { p_limit: 100 }),
  ]);
  for (const r of [slots, offers]) {
    if (r.error && !isMissingFunction(r.error)) throw r.error;
  }
  const cards = [
    ...((slots.data ?? []) as SlotApplicantRow[]).map(fromSlotRow),
    ...((offers.data ?? []) as OfferApplicantRow[]).map(fromOfferRow),
  ];
  return sortApplicants(cards, "recent");
}

/**
 * Las postulaciones a lo que publicó la familia, en vivo: Realtime avisa cuando cambia una propuesta o una postulación (las políticas
 * de la base ya filtran las que puede ver) o llega un aviso nuevo a la campana.
 */
export function useFamilyApplicants(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: applicantKeys.list(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 15_000,
    queryFn: loadApplicants,
  });
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: applicantKeys.list(userId ?? "") });
  }, [qc, userId]);
  useRealtimeRefresh(
    "family-applicants",
    [
      { table: "slot_proposals", filter: `family_user_id=eq.${userId}` },
      { table: "applications" },
      { table: "notifications", event: "INSERT", filter: `user_id=eq.${userId}` },
    ],
    refresh,
    !!userId && enabled,
  );
  return query;
}

export interface RevealedContact {
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  revealsLeft: number;
}

interface RevealRow {
  full_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  reveals_left: number | null;
}

/**
 * Acciones sobre una tarjeta; cada una refresca la lista. Negociar el valor lo hacen los diálogos de contraoferta del hub
 * (`CounterOfferDialog` para horas, `OfferCounterDialog` para ofertas): ellos llaman a la base y avisan con `onDone`.
 */
export function useApplicantActions(userId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: applicantKeys.list(userId ?? "") });
  };

  const accept = useMutation({
    mutationFn: async (input: { card: ApplicantCard; shifts?: ShiftInput[] }) => {
      const { card, shifts } = input;
      if (card.source === "slots") {
        const { data, error } = await sb.rpc("accept_slot_proposal", { p_proposal_id: card.id });
        if (error) throw error;
        return { bookingId: (data as string | null) ?? null };
      }
      const { data, error } = await sb.rpc("accept_application", {
        p_application_id: card.id,
        p_shifts: shifts && shifts.length > 0 ? shifts : null,
      });
      if (error) throw error;
      const ids = (data as { booking_ids?: string[] } | null)?.booking_ids ?? [];
      return { bookingId: ids[0] ?? null };
    },
    onSettled: invalidate,
  });

  const reject = useMutation({
    mutationFn: async (input: { card: ApplicantCard; note?: string }) => {
      const { card, note } = input;
      if (card.source === "slots") {
        // La política y el disparador de la base dejan al destinatario pasar una propuesta de «pendiente» a «rechazada».
        const { data, error } = await sb
          .from("slot_proposals")
          .update({ status: "rejected" })
          .eq("id", card.id)
          .select("id");
        if (error) throw error;
        if (!data || data.length === 0)
          throw new Error("Esta postulación ya no está disponible. Actualiza la lista.");
        return;
      }
      const { error } = await sb.rpc("decline_application", {
        p_application_id: card.id,
        p_note: note?.trim() ? note.trim() : null,
      });
      if (error) throw error;
    },
    onSettled: invalidate,
  });

  const reveal = useMutation({
    mutationFn: async (card: ApplicantCard): Promise<RevealedContact> => {
      const { data, error } =
        card.source === "slots"
          ? await sb.rpc("reveal_applicant_contact", { p_proposal_id: card.id })
          : await sb.rpc("reveal_application_contact", { p_application_id: card.id });
      if (error) throw error;
      const row = ((data ?? []) as RevealRow[])[0];
      if (!row) throw new Error("No se pudo desbloquear el contacto.");
      return {
        fullName: row.full_name ?? card.displayName,
        phone: row.phone,
        whatsapp: row.whatsapp,
        city: row.city,
        revealsLeft: Number(row.reveals_left ?? 0),
      };
    },
    onSettled: invalidate,
  });

  return { accept, reject, reveal };
}
