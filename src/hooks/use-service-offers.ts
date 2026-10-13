// «Mi oferta de servicio» (profesional) y «Profesionales que se ofrecen» (familias e instituciones), por la tabla con RLS y la función
// segura de la migración 20261013110000_professional_panel.sql.
//
//  • Las ofertas propias se leen y se escriben por la tabla: la política deja ver y tocar solo lo del dueño y el disparador de la base
//    modera el texto (ofensivo, venta de artículos, ajeno a salud/cuidado, contactos), limita a 5 vigentes y no deja desbloquearla.
//  • Lo que ven los demás llega por `list_open_service_offers`, sin teléfono ni dirección, con Trust Score y cercanía por rangos.
//  • En vivo, sin polling: el servidor avisa «service_offers_changed» por el canal privado compartido del mapa y se vuelve a pedir.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { SERVICE_OFFERS_ROOT, useLiveMapPing } from "@/hooks/use-live-map";
import {
  classifyServiceOfferError,
  normalizeMyOfferRow,
  normalizeServiceOfferRow,
  summarizeServiceOffers,
  toServiceOfferPayload,
  type MyServiceOffer,
  type ServiceOffer,
  type ServiceOfferErrorKind,
  type ServiceOfferFeedRow,
  type ServiceOfferFormValues,
  type ServiceOfferRow,
  type ServiceOfferStatus,
} from "@/lib/serviceOffers";

// La tabla y la función nuevas todavía no están en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const serviceOfferKeys = {
  all: SERVICE_OFFERS_ROOT,
  mine: (uid: string) => [...SERVICE_OFFERS_ROOT, "mine", uid] as const,
  feed: [...SERVICE_OFFERS_ROOT, "feed"] as const,
};

/** Error de una escritura, ya traducido a lo que se le dice a la persona. */
export class ServiceOfferError extends Error {
  kind: ServiceOfferErrorKind;
  constructor(kind: ServiceOfferErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function fail(error: {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}): never {
  const { kind, message } = classifyServiceOfferError(error);
  throw new ServiceOfferError(kind, message);
}

// ─── Profesional: sus ofertas ────────────────────────────────────────────────

/** Las ofertas de servicio del profesional (RLS: solo las suyas), las más nuevas primero. */
export function useMyServiceOffers(userId: string | null | undefined) {
  return useQuery({
    queryKey: serviceOfferKeys.mine(userId ?? ""),
    enabled: !!userId,
    queryFn: async (): Promise<MyServiceOffer[]> => {
      const { data, error } = await sb
        .from("professional_service_offers")
        .select(
          "id, professional_id, title, description, specialty, modality, amount, city, available_from, available_until, status, blocked, created_at, updated_at",
        )
        .eq("professional_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const now = Date.now();
      return ((data ?? []) as ServiceOfferRow[]).map((r) => normalizeMyOfferRow(r, now));
    },
  });
}

/** Publicar, editar, pausar, reanudar, cerrar y eliminar. Cada acción recarga las ofertas propias y la lista que ven los demás. */
export function useServiceOfferActions(userId: string | null | undefined) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: serviceOfferKeys.all });

  const create = useMutation({
    mutationFn: async (values: ServiceOfferFormValues) => {
      if (!userId)
        throw new ServiceOfferError("forbidden", "Inicia sesión para publicar tu oferta.");
      const { data, error } = await sb
        .from("professional_service_offers")
        .insert({ professional_id: userId, ...toServiceOfferPayload(values) })
        .select("id")
        .single();
      if (error) fail(error);
      return (data as { id: string }).id;
    },
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: ServiceOfferFormValues }) => {
      const { data, error } = await sb
        .from("professional_service_offers")
        .update(toServiceOfferPayload(values))
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) fail(error);
      if (!data) throw new ServiceOfferError("other", "Esta oferta ya no existe.");
    },
    onSuccess: refresh,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ServiceOfferStatus }) => {
      const { data, error } = await sb
        .from("professional_service_offers")
        .update({ status })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) fail(error);
      if (!data) throw new ServiceOfferError("other", "Esta oferta ya no existe.");
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("professional_service_offers").delete().eq("id", id);
      if (error) fail(error);
    },
    onSuccess: refresh,
  });

  return { create, update, setStatus, remove };
}

// ─── Familias e instituciones: lo que se ofrece ──────────────────────────────

/** Ofertas de servicio abiertas de profesionales publicados, con Trust Score, estado y cercanía. Solo familias, instituciones y personal. */
export function useServiceOffersFeed(viewerId: string | null | undefined, limit = 300) {
  // Con sesión se escucha el aviso en vivo del servidor; los datos se piden por la función segura.
  useLiveMapPing(!!viewerId);
  const query = useQuery({
    queryKey: [...serviceOfferKeys.feed, viewerId ?? "", limit],
    enabled: !!viewerId,
    staleTime: 20_000,
    queryFn: async (): Promise<ServiceOffer[]> => {
      const { data, error } = await sb.rpc("list_open_service_offers", { p_limit: limit });
      if (error) throw error;
      return ((data ?? []) as ServiceOfferFeedRow[]).map(normalizeServiceOfferRow);
    },
  });
  const summary = useMemo(() => summarizeServiceOffers(query.data ?? []), [query.data]);
  return { ...query, summary };
}
