// Datos del panel del profesional para las funciones inteligentes (resumen del día, ingresos, «Mi semana», descanso y
// reputación).
//
// Todo se pide con la sesión del propio profesional: lo que RLS ya le permite leer (sus reservas, las calificaciones que
// recibió, sus propuestas). No hay tablas ni funciones nuevas en la base de datos y nada se envía a terceros: las
// cuentas las hacen las funciones puras de `src/lib`. Las actualizaciones llegan por Realtime; no hay sondeo.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { hubKeys } from "@/hooks/use-opportunity-feed";
import { DAY_MS } from "@/lib/intelShared";
import type { DimensionRow, StarRow } from "@/lib/proReputation";
import type { EarningsBooking } from "@/lib/proEarnings";

const sb = supabase as unknown as SupabaseClient;

export const proKeys = {
  bookings: (uid: string) => ["pro-intel", "bookings", uid] as const,
  ratings: (uid: string) => ["pro-intel", "ratings", uid] as const,
};

/** Reservas que se leen: hasta 200 días atrás (6 meses de ingresos y las ventanas de 90 y 180 días) y todo lo futuro. */
export const PRO_BOOKINGS_LOOKBACK_DAYS = 200;
export const PRO_BOOKINGS_LIMIT = 600;
/** Calificaciones recientes que se leen. */
export const PRO_RATINGS_LIMIT = 100;

export type ProBookingRow = EarningsBooking;

export function useProBookings(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: proKeys.bookings(userId ?? ""),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<ProBookingRow[]> => {
      const since = new Date(Date.now() - PRO_BOOKINGS_LOOKBACK_DAYS * DAY_MS).toISOString();
      const { data, error } = await sb
        .from("service_bookings")
        .select(
          "id, status, scheduled_at, completed_at, duration_hours, hourly_rate, total_amount, professional_payout, platform_fee_amount, client_id",
        )
        .eq("professional_id", userId)
        .gte("scheduled_at", since)
        .order("scheduled_at", { ascending: false })
        .limit(PRO_BOOKINGS_LIMIT);
      if (error) throw error;
      return (data ?? []) as ProBookingRow[];
    },
  });
  useRealtimeRefresh(
    `pro-intel-bookings-${userId ?? "anon"}`,
    [{ table: "service_bookings", filter: `professional_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: proKeys.bookings(userId) });
    },
    !!userId,
  );
  return query;
}

export interface ProRatingsData {
  stars: StarRow[];
  dimensions: DimensionRow[];
}

/**
 * Las calificaciones que recibió: estrellas con su comentario y las 4 dimensiones que dan quienes lo contratan. RLS deja
 * leer solo las propias. Solo se piden si la persona tiene el plan que las muestra.
 */
export function useProRatings(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: proKeys.ratings(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<ProRatingsData> => {
      const [stars, dims] = await Promise.all([
        sb
          .from("service_ratings")
          .select("booking_id, created_at, stars, comment, ai_alert")
          .eq("rated_id", userId)
          .order("created_at", { ascending: false })
          .limit(PRO_RATINGS_LIMIT),
        sb
          .from("service_rating_dimensions")
          .select("booking_id, created_at, scores")
          .eq("rated_id", userId)
          .eq("rater_role", "family")
          .order("created_at", { ascending: false })
          .limit(PRO_RATINGS_LIMIT),
      ]);
      if (stars.error) throw stars.error;
      if (dims.error) throw dims.error;
      return {
        stars: (stars.data ?? []) as StarRow[],
        dimensions: (dims.data ?? []) as DimensionRow[],
      };
    },
  });
  useRealtimeRefresh(
    `pro-intel-ratings-${userId ?? "anon"}`,
    [
      { table: "service_ratings", filter: `rated_id=eq.${userId}` },
      { table: "service_rating_dimensions", filter: `rated_id=eq.${userId}` },
    ],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: proKeys.ratings(userId) });
    },
    !!userId && enabled,
  );
  return query;
}

export interface ProProposalRow {
  id: string;
  status: string;
  proposed_by: string;
  expires_at: string | null;
  peer_name: string | null;
}

/** Misma consulta y misma clave que la bandeja de propuestas del profesional: se comparte el caché. */
export function useProProposals(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: hubKeys.proposals(userId ?? ""),
    enabled: !!userId,
    queryFn: async (): Promise<ProProposalRow[]> => {
      const { data, error } = await sb.rpc("my_slot_proposals", { p_limit: 80 });
      if (error) throw error;
      return (data ?? []) as ProProposalRow[];
    },
  });
  useRealtimeRefresh(
    `pro-intel-proposals-${userId ?? "anon"}`,
    [{ table: "slot_proposals", filter: `professional_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: hubKeys.proposals(userId) });
    },
    !!userId,
  );
  return query;
}
