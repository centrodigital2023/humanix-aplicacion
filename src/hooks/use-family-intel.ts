// Datos del panel de familia para las funciones inteligentes (resumen del día, informe de bienestar, comparador de
// postulaciones, presupuesto y radar de cobertura).
//
// Todo se pide con la sesión de la propia familia: lo que RLS ya le permite leer (sus reservas, el parte de sus
// servicios, su agenda, el perfil público de los profesionales). No hay tablas ni funciones nuevas en la base de datos
// y nada se envía a terceros: las cuentas las hacen las funciones puras de `src/lib`. Las actualizaciones llegan por
// Realtime; no hay sondeo.

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { hubKeys } from "@/hooks/use-opportunity-feed";
import { fetchPublicProfessionals } from "@/hooks/use-public-professionals";
import type { ProFacts, ProposalSource } from "@/lib/applicantSources";
import { DAY_MS } from "@/lib/intelShared";
import type { RadarNeed } from "@/lib/coverageRadar";
import type { WellbeingLog } from "@/lib/wellbeing";

const sb = supabase as unknown as SupabaseClient;

export const familyKeys = {
  bookings: (uid: string) => ["family", "bookings", uid] as const,
  logs: (uid: string, ids: string) => ["family", "logs", uid, ids] as const,
  needs: (uid: string) => ["family", "needs", uid] as const,
  rated: (uid: string, ids: string) => ["family", "rated", uid, ids] as const,
  circle: (uid: string) => ["family", "circle", uid] as const,
  names: (ids: string) => ["family", "names", ids] as const,
  facts: (ids: string) => ["family", "facts", ids] as const,
};

/** Huella corta y estable de una lista de ids, para que la clave de la consulta no cargue 100 UUID. */
export function hashIds(ids: string[]): string {
  let h = 5381;
  for (const id of [...ids].sort())
    for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return `${ids.length}:${(h >>> 0).toString(36)}`;
}

/** Reservas que se leen: hasta 200 días atrás (cubre 6 meses de presupuesto y el historial reciente). */
export const BOOKINGS_LOOKBACK_DAYS = 200;
export const BOOKINGS_LIMIT = 600;
/** Servicios cuyos partes se leen para el informe (los más recientes dentro de 90 días). */
export const LOG_BOOKINGS_MAX = 100;
export const LOG_ROWS_CAP = 1000;
export const LOG_LOOKBACK_DAYS = 90;
/** Horizonte de la agenda que mira el radar. */
export const NEEDS_HORIZON_DAYS = 14;

export interface FamilyBookingRow {
  id: string;
  status: string;
  scheduled_at: string;
  completed_at: string | null;
  duration_hours: number | string | null;
  hourly_rate: number | string | null;
  total_amount: number | string | null;
  professional_id: string;
}

export { useNow } from "@/hooks/use-now";

// ─── Reservas de la familia ──────────────────────────────────────────────────

export function useFamilyBookings(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: familyKeys.bookings(userId ?? ""),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<FamilyBookingRow[]> => {
      const since = new Date(Date.now() - BOOKINGS_LOOKBACK_DAYS * DAY_MS).toISOString();
      const { data, error } = await sb
        .from("service_bookings")
        .select(
          "id, status, scheduled_at, completed_at, duration_hours, hourly_rate, total_amount, professional_id",
        )
        .eq("client_id", userId)
        .gte("scheduled_at", since)
        .order("scheduled_at", { ascending: false })
        .limit(BOOKINGS_LIMIT);
      if (error) throw error;
      return (data ?? []) as FamilyBookingRow[];
    },
  });
  useRealtimeRefresh(
    `fam-intel-bookings-${userId ?? "anon"}`,
    [{ table: "service_bookings", filter: `client_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: familyKeys.bookings(userId) });
    },
    !!userId,
  );
  return query;
}

// ─── Parte de los servicios (informe de bienestar) ───────────────────────────

/**
 * Registros del parte de los servicios recientes. RLS deja leer solo los de los servicios de la propia familia. Se
 * piden 90 días de una vez para que cambiar de periodo (7/30/90) no vuelva a consultar. Si llega al tope de filas,
 * `truncated` lo dice para que el informe lo avise.
 */
export function useFamilyCareLogs(
  userId: string | null | undefined,
  bookings: FamilyBookingRow[] | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const ids = useMemo(() => {
    const since = Date.now() - LOG_LOOKBACK_DAYS * DAY_MS;
    return (bookings ?? [])
      .filter(
        (b) =>
          (b.status === "completed" || b.status === "in_progress") &&
          new Date(b.scheduled_at).getTime() >= since,
      )
      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
      .slice(0, LOG_BOOKINGS_MAX)
      .map((b) => b.id);
  }, [bookings]);
  const key = hashIds(ids);

  const query = useQuery({
    queryKey: familyKeys.logs(userId ?? "", key),
    enabled: !!userId && enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<{ rows: WellbeingLog[]; truncated: boolean }> => {
      const { data, error } = await sb
        .from("care_logs")
        // `*` como en el resto del lazo de cuidado: si faltara una columna nueva, el parte sigue cargando.
        .select("*")
        .in("booking_id", ids)
        .order("created_at", { ascending: false })
        .limit(LOG_ROWS_CAP);
      if (error) throw error;
      const rows = (data ?? []) as WellbeingLog[];
      return { rows, truncated: rows.length >= LOG_ROWS_CAP };
    },
  });

  useRealtimeRefresh(
    `fam-intel-logs-${userId ?? "anon"}`,
    [{ table: "care_logs", event: "INSERT" }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: familyKeys.logs(userId, key) });
    },
    !!userId && enabled && ids.length > 0,
  );
  return query;
}

// ─── Agenda (horas que la familia necesita) ──────────────────────────────────

export function useFamilyNeeds(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: familyKeys.needs(userId ?? ""),
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<RadarNeed[]> => {
      const now = Date.now();
      const { data, error } = await sb
        .from("family_needs")
        .select("id, starts_at, ends_at, hourly_rate, status, care_type, created_at")
        .eq("family_user_id", userId)
        .gte("ends_at", new Date(now).toISOString())
        .lte("starts_at", new Date(now + NEEDS_HORIZON_DAYS * DAY_MS).toISOString())
        .order("starts_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RadarNeed[];
    },
  });
  useRealtimeRefresh(
    `fam-intel-needs-${userId ?? "anon"}`,
    [{ table: "family_needs", filter: `family_user_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: familyKeys.needs(userId) });
    },
    !!userId,
  );
  return query;
}

// ─── Propuestas de profesionales ─────────────────────────────────────────────

export interface FamilyProposalRow extends ProposalSource {
  family_need_id: string | null;
  starts_at: string;
  ends_at: string;
}

/** Misma consulta y misma clave que la bandeja de propuestas: se comparte el caché y no se pide dos veces. */
export function useFamilyProposals(userId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: hubKeys.proposals(userId ?? ""),
    enabled: !!userId,
    queryFn: async (): Promise<FamilyProposalRow[]> => {
      const { data, error } = await sb.rpc("my_slot_proposals", { p_limit: 80 });
      if (error) throw error;
      return (data ?? []) as FamilyProposalRow[];
    },
  });
  useRealtimeRefresh(
    `fam-intel-proposals-${userId ?? "anon"}`,
    [{ table: "slot_proposals", filter: `family_user_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: hubKeys.proposals(userId) });
    },
    !!userId,
  );
  return query;
}

// ─── Calificaciones, círculo, nombres y perfiles públicos ────────────────────

/** Cuáles de estos servicios ya calificó la propia familia. */
export function useRatedBookingIds(userId: string | null | undefined, bookingIds: string[]) {
  return useQuery({
    queryKey: familyKeys.rated(userId ?? "", hashIds(bookingIds)),
    enabled: !!userId && bookingIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb
        .from("service_ratings")
        .select("booking_id")
        .eq("rater_id", userId)
        .in("booking_id", bookingIds);
      if (error) throw error;
      return ((data ?? []) as Array<{ booking_id: string }>).map((r) => r.booking_id);
    },
  });
}

/** Cuántas personas hay en el círculo de cuidado (aceptadas o con invitación enviada). */
export function useCircleMemberCount(userId: string | null | undefined) {
  return useQuery({
    queryKey: familyKeys.circle(userId ?? ""),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await sb
        .from("care_circle_members")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .in("status", ["invited", "accepted"]);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Nombres de los profesionales (directorio público seguro: función `public_professionals`). */
export function useProfessionalNames(ids: string[]) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))], [ids]);
  return useQuery({
    queryKey: familyKeys.names(hashIds(unique)),
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const rows = await fetchPublicProfessionals({ ids: unique });
      const out: Record<string, string> = {};
      for (const r of rows) if (r.user_id && r.full_name) out[r.user_id] = r.full_name;
      return out;
    },
  });
}

/** Lo que muestra el perfil público de cada profesional (verificación, calificación, experiencia, ubicación). */
export function useApplicantFacts(ids: string[], enabled = true) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))], [ids]);
  return useQuery({
    queryKey: familyKeys.facts(hashIds(unique)),
    enabled: enabled && unique.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, ProFacts>> => {
      const rows = await fetchPublicProfessionals({ ids: unique });
      const out: Record<string, ProFacts> = {};
      for (const r of rows) if (r.user_id) out[r.user_id] = r;
      return out;
    },
  });
}
