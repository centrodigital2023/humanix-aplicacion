import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  bogotaToday,
  buildProContext,
  groupNeedsIntoShifts,
  isShiftApplied,
  rankShifts,
  splitOpenNeedRows,
  summarizeOpportunities,
  type OpenNeedRow,
  type ProContext,
  type ProIntro,
} from "@/lib/opportunities";
import type { MarketStats } from "@/lib/negotiation";
import type { FamilyReputationRaw } from "@/lib/familyReputation";

// Tablas y funciones nuevas aún no están en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const hubKeys = {
  needs: (uid: string) => ["hub", "needs", uid] as const,
  pro: (uid: string) => ["hub", "pro", uid] as const,
  reveals: (uid: string) => ["hub", "reveals-today", uid] as const,
  alerts: (uid: string) => ["hub", "alerts", uid] as const,
  market: (city: string) => ["hub", "market", city] as const,
  reputation: (familyId: string) => ["hub", "reputation", familyId] as const,
  proposals: (uid: string) => ["hub", "proposals", uid] as const,
};

// El aviso «hay cambios» llega por UN canal privado con tema fijo (la política de Realtime autoriza ese
// tema exacto). Varios componentes lo usan a la vez (barra «En vivo», agenda de familias y de
// instituciones), así que se comparte una sola suscripción con conteo de usuarios en lugar de abrir
// varios canales con el mismo nombre. El servidor emite dos eventos sin datos: `changed` (necesidades
// de familias) y `offers_changed` (ofertas y turnos de instituciones).
type PingEvent = "changed" | "offers_changed";
const pingListeners: Record<PingEvent, Set<() => void>> = {
  changed: new Set(),
  offers_changed: new Set(),
};
let pingChannel: ReturnType<typeof sb.channel> | null = null;

function subscribeOpenPing(event: PingEvent, listener: () => void): () => void {
  pingListeners[event].add(listener);
  if (!pingChannel) {
    pingChannel = sb
      .channel("open_needs_ping", { config: { private: true } })
      .on("broadcast", { event: "changed" }, () => pingListeners.changed.forEach((l) => l()))
      .on("broadcast", { event: "offers_changed" }, () =>
        pingListeners.offers_changed.forEach((l) => l()),
      )
      .subscribe();
  }
  return () => {
    pingListeners[event].delete(listener);
    if (pingListeners.changed.size + pingListeners.offers_changed.size === 0 && pingChannel) {
      void sb.removeChannel(pingChannel);
      pingChannel = null;
    }
  };
}

const subscribeOpenNeedsPing = (listener: () => void) => subscribeOpenPing("changed", listener);
/** Aviso en vivo de ofertas y turnos de instituciones (sin datos; se recarga por el RPC seguro). */
export const subscribeOpenOffersPing = (listener: () => void) =>
  subscribeOpenPing("offers_changed", listener);

/** Necesidades abiertas (sin dirección) + avisos en vivo del servidor. */
export function useOpenNeeds(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: hubKeys.needs(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("list_open_family_needs", { p_limit: 400 });
      if (error) throw error;
      return (data ?? []) as OpenNeedRow[];
    },
  });

  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // La familia marca hora por hora: se agrupan los avisos para recargar una sola vez.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: hubKeys.needs(userId) });
      }, 1200);
    };
    // El servidor emite «hay cambios» (sin datos); los datos se piden por el RPC seguro.
    const unsubscribePing = subscribeOpenNeedsPing(refresh);
    const mine = sb
      .channel(`hub_proposals_${userId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "slot_proposals",
          filter: `professional_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      clearTimeout(timer);
      unsubscribePing();
      void sb.removeChannel(mine);
    };
  }, [userId, qc]);

  return query;
}

export interface ProBundle {
  pro: ProContext;
  intro: ProIntro;
}

/** Perfil profesional + reservas confirmadas (para detectar cruces de horario). */
export function useProBundle(userId: string | null | undefined) {
  return useQuery({
    queryKey: hubKeys.pro(userId ?? ""),
    enabled: !!userId,
    queryFn: async (): Promise<ProBundle> => {
      const since = new Date(Date.now() - 36 * 3_600_000).toISOString();
      const [pp, pr, bk] = await Promise.all([
        sb
          .from("professional_profiles")
          .select(
            "specialty, sub_specialties, service_cities, home_city, hourly_rate, years_experience, rethus_verified",
          )
          .eq("user_id", userId)
          .maybeSingle(),
        sb.from("profiles").select("full_name, city").eq("user_id", userId).maybeSingle(),
        sb
          .from("service_bookings")
          .select("scheduled_at, duration_hours")
          .eq("professional_id", userId)
          .in("status", ["confirmed", "in_route", "in_progress"])
          .gte("scheduled_at", since),
      ]);
      const p = (pp.data ?? {}) as Record<string, unknown>;
      const prof = (pr.data ?? {}) as { full_name?: string | null; city?: string | null };
      return {
        pro: buildProContext({
          specialty: (p.specialty as string | null) ?? null,
          sub_specialties: (p.sub_specialties as string[] | null) ?? null,
          service_cities: (p.service_cities as string[] | null) ?? null,
          home_city: (p.home_city as string | null) ?? null,
          hourly_rate: (p.hourly_rate as number | null) ?? null,
          profileCity: prof.city ?? null,
          bookings: (bk.data ?? []) as Array<{
            scheduled_at: string;
            duration_hours: number | string;
          }>,
        }),
        intro: {
          name: prof.full_name ?? null,
          specialty: (p.specialty as string | null) ?? null,
          yearsExperience: (p.years_experience as number | null) ?? null,
          rethusVerified: Boolean(p.rethus_verified),
        },
      };
    },
  });
}

/** Turnos puntuados y ordenados + resumen. Todo el cálculo es local y explicable. */
export function useOpportunityFeed(userId: string | null | undefined) {
  const needs = useOpenNeeds(userId);
  const bundle = useProBundle(userId);

  const model = useMemo(() => {
    if (!needs.data || !bundle.data) return null;
    const { blocks, families, appliedNeedIds } = splitOpenNeedRows(needs.data);
    const ranked = rankShifts(groupNeedsIntoShifts(blocks), bundle.data.pro, families);
    const open = ranked.filter((r) => !isShiftApplied(r.shift, appliedNeedIds));
    return {
      ranked,
      families,
      appliedNeedIds,
      summary: summarizeOpportunities(open),
      bundle: bundle.data,
    };
  }, [needs.data, bundle.data]);

  return {
    model,
    isLoading: needs.isLoading || bundle.isLoading,
    error: (needs.error ?? bundle.error) as Error | null,
    refetch: () => {
      void needs.refetch();
      void bundle.refetch();
    },
  };
}

/** Familias distintas cuyo contacto desbloqueó el profesional hoy (cupo diario). */
export function useRevealsToday(userId: string | null | undefined) {
  return useQuery({
    queryKey: hubKeys.reveals(userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("opportunity_contact_reveals")
        .select("family_user_id")
        .eq("professional_id", userId)
        .eq("revealed_on", bogotaToday());
      if (error) throw error;
      return new Set((data ?? []).map((r: { family_user_id: string }) => r.family_user_id));
    },
  });
}

/** Rango de mercado de la ciudad (percentiles solo con muestra suficiente). */
export function useMarketStats(city: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: hubKeys.market(city ?? ""),
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MarketStats> => {
      const { data, error } = await sb.rpc("market_rate_stats", { p_city: city ?? null });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { n: number; p25: number | null; median: number | null; p75: number | null }
        | undefined;
      return {
        n: row?.n ?? 0,
        p25: row?.p25 ?? null,
        median: row?.median ?? null,
        p75: row?.p75 ?? null,
      };
    },
  });
}

/** Reputación detallada de una familia (se pide al abrir el detalle). */
export function useFamilyReputation(familyId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: hubKeys.reputation(familyId ?? ""),
    enabled: enabled && !!familyId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<FamilyReputationRaw> => {
      const { data, error } = await sb.rpc("family_reputation", { p_family: familyId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as FamilyReputationRaw | undefined;
      return row ?? { ratings_count: 0, stars_avg: null, completed_services: 0, dimensions: [] };
    },
  });
}
