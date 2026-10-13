// Ofertas publicadas por las familias (`list_open_family_offers`) para el profesional, con avisos en vivo del servidor.
// El servidor ya quitó lo privado (teléfono, dirección); aquí solo se piden, se puntúan con el perfil y la agenda del profesional
// y se ordenan. Realtime, no polling: el servidor emite «hay cambios» (sin datos) y los datos se piden por el RPC seguro.

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeOpenOffersPing, useProBundle } from "@/hooks/use-opportunity-feed";
import { useDebouncedInvalidate } from "@/hooks/use-institution-hub";
import {
  normalizeFamilyOfferRow,
  summarizeFamilyOffers,
  type FamilyOfferRow,
} from "@/lib/familyOffers";
import { applyOfferFilters, rankOffers, type OfferFilters } from "@/lib/institutionOffers";

// La función v2 todavía no está en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const familyOfferKeys = {
  all: ["fam-offers"] as const,
  offers: (uid: string) => ["fam-offers", uid] as const,
};

/** Ofertas abiertas de las familias (sin dirección ni teléfono), con las postulaciones propias y avisos en vivo. */
export function useFamilyOffers(userId: string | null | undefined) {
  const refresh = useDebouncedInvalidate(userId ? [familyOfferKeys.offers(userId)] : []);
  const query = useQuery({
    queryKey: familyOfferKeys.offers(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_open_family_offers", { p_limit: 300 });
      if (error) throw error;
      return (data ?? []) as FamilyOfferRow[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    // Cualquier oferta nueva, cerrada o eliminada, y cualquier cambio en mis postulaciones (RLS: solo las mías).
    const unsubscribe = subscribeOpenOffersPing(refresh);
    const mine = sb
      .channel(`fam_offers_apps_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "applications",
          filter: `professional_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      refresh.cancel();
      unsubscribe();
      void sb.removeChannel(mine);
    };
  }, [userId, refresh]);

  return query;
}

/** Ofertas de familias puntuadas con el perfil y la agenda del profesional, filtradas y ordenadas. */
export function useFamilyOffersFeed(userId: string | null | undefined, filters?: OfferFilters) {
  const offers = useFamilyOffers(userId);
  const bundle = useProBundle(userId);

  const model = useMemo(() => {
    if (!offers.data || !bundle.data) return null;
    const normalized = offers.data.map(normalizeFamilyOfferRow);
    const ranked = rankOffers(normalized, bundle.data.pro);
    return {
      offers: normalized,
      ranked,
      visible: filters ? applyOfferFilters(ranked, filters) : ranked,
      summary: summarizeFamilyOffers(ranked),
      bundle: bundle.data,
    };
  }, [offers.data, bundle.data, filters]);

  return {
    model,
    isLoading: offers.isLoading || bundle.isLoading,
    error: (offers.error ?? bundle.error) as Error | null,
    refetch: () => {
      void offers.refetch();
      void bundle.refetch();
    },
  };
}
