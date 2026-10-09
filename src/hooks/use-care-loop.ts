// Lazo de cuidado: parte del turno en vivo, gracias, trayectoria, equipo de confianza e historia exportable.
//
// Todo lo que decide la seguridad vive en el servidor (migración 20261010100000_care_loop.sql): quién escribe,
// quién ve, el plan y los avisos. Estos hooks solo piden y presentan. Tablas y funciones nuevas aún no están en los
// tipos generados (se regeneran tras aplicar la migración), por eso el cliente se tipa a mano.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCareLogInsert,
  mergeLog,
  parseCareReport,
  sortLogsDesc,
  type CareLogFormValues,
  type CareLogRow,
  type CareReport,
} from "@/lib/careLog";
import { buildKudosCall, type KudosFormValues, type KudosSummaryRow } from "@/lib/kudos";
import { parseCareerStats, type CareerStats } from "@/lib/careerStats";
import { parseTeam, type TrustedMember } from "@/lib/careLoop";
import { parseHistory, type HistoryRow } from "@/lib/careExport";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { parseActiveServices, type ActiveService } from "@/lib/careLoop";

const sb = supabase as unknown as SupabaseClient;

export const careKeys = {
  logs: (bookingId: string) => ["care", "logs", bookingId] as const,
  report: (bookingId: string) => ["care", "report", bookingId] as const,
  kudos: (bookingId: string, uid: string) => ["care", "kudos", bookingId, uid] as const,
  received: (uid: string) => ["care", "received", uid] as const,
  publicKudos: (proId: string) => ["care", "public-kudos", proId] as const,
  stats: (uid: string) => ["care", "stats", uid] as const,
  publicStats: (proId: string) => ["care", "public-stats", proId] as const,
  team: (uid: string) => ["care", "team", uid] as const,
  history: (uid: string, from: string, to: string) => ["care", "history", uid, from, to] as const,
  active: (uid: string) => ["care", "active", uid] as const,
};

/** Mensaje para la persona: el del servidor cuando es una regla de negocio (ya viene en español) o uno genérico. */
export function friendlyError(err: unknown, fallback: string): string {
  const e = err as { message?: string; code?: string } | null;
  const msg = e?.message ?? "";
  // Reglas de negocio de la guardia: 42501 (permiso), 23514 (regla), 23505 (duplicado), 22023/22001 (datos).
  if (msg && ["42501", "23514", "23505", "22023", "22001", "23503"].includes(e?.code ?? "")) {
    return msg.startsWith("plan_required") ? "Esta función requiere un plan de pago." : msg;
  }
  return fallback;
}

// ─── Parte del turno ─────────────────────────────────────────────────────────

/**
 * Registros del parte de un servicio, en vivo. Realtime respeta RLS: la familia, el círculo aceptado, la
 * institución y el profesional del servicio reciben cada registro apenas se guarda. Sin polling: si el canal
 * no está disponible, la lista se actualiza al volver a la pestaña o con «Actualizar».
 */
export function useCareLogs(bookingId: string | null | undefined) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const query = useQuery({
    queryKey: careKeys.logs(bookingId ?? ""),
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("care_logs")
        // `*` a propósito: si la migración «lazo de cuidado» aún no se aplicó, las columnas nuevas (mood,
        // system_generated) no existen y una lista explícita fallaría; con `*` el parte sigue cargando.
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      return sortLogsDesc((data ?? []) as CareLogRow[]);
    },
  });

  useEffect(() => {
    if (!bookingId) return;
    const channel = sb
      .channel(`care_logs_${bookingId}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "care_logs",
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          const incoming = payload.new as CareLogRow;
          qc.setQueryData<CareLogRow[]>(careKeys.logs(bookingId), (prev) =>
            mergeLog(prev ?? [], incoming),
          );
          void qc.invalidateQueries({ queryKey: careKeys.report(bookingId) });
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      setLive(false);
      void sb.removeChannel(channel);
    };
  }, [bookingId, qc]);

  return { ...query, live };
}

/** Parte final / resumen del turno (cifras, último signo vital, ánimo). */
export function useCareReport(bookingId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: careKeys.report(bookingId ?? ""),
    enabled: !!bookingId && enabled,
    queryFn: async (): Promise<CareReport | null> => {
      const { data, error } = await sb.rpc("care_report", { p_booking_id: bookingId });
      if (error) throw error;
      return parseCareReport(data);
    },
  });
}

/** Guarda un registro del parte (solo el profesional del servicio, mientras está en curso: lo impone la base de datos). */
export function useAddCareLog(
  bookingId: string,
  professionalId: string,
  patientName?: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CareLogFormValues) => {
      const payload = buildCareLogInsert(values, { bookingId, professionalId, patientName });
      const { data, error } = await sb.from("care_logs").insert(payload).select("*").single();
      if (error) throw error;
      return data as CareLogRow;
    },
    onSuccess: (row) => {
      qc.setQueryData<CareLogRow[]>(careKeys.logs(bookingId), (prev) => mergeLog(prev ?? [], row));
      void qc.invalidateQueries({ queryKey: careKeys.report(bookingId) });
    },
  });
}

// ─── Gracias ─────────────────────────────────────────────────────────────────

export interface KudosRow {
  id: string;
  booking_id: string;
  from_user: string;
  to_user: string;
  from_role: "client" | "professional";
  kinds: string[];
  message: string | null;
  created_at: string;
}

/** Los gracias de un servicio que yo di y los que recibí (RLS: solo veo los míos). */
export function useBookingKudos(bookingId: string, userId: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.kudos(bookingId, userId ?? ""),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("care_kudos")
        .select("id, booking_id, from_user, to_user, from_role, kinds, message, created_at")
        .eq("booking_id", bookingId);
      if (error) throw error;
      const rows = (data ?? []) as KudosRow[];
      return {
        sent: rows.find((r) => r.from_user === userId) ?? null,
        received: rows.find((r) => r.to_user === userId) ?? null,
      };
    },
  });
}

export function useSendKudos(bookingId: string, userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: KudosFormValues) => {
      const { data, error } = await sb.rpc("send_kudos", buildKudosCall(bookingId, values));
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      if (userId) {
        void qc.invalidateQueries({ queryKey: careKeys.kudos(bookingId, userId) });
        void qc.invalidateQueries({ queryKey: careKeys.received(userId) });
      }
    },
  });
}

export interface ReceivedKudos {
  id: string;
  booking_id: string;
  from_name: string;
  from_role: "client" | "professional";
  kinds: string[];
  message: string | null;
  created_at: string;
}

export function useReceivedKudos(userId: string | null | undefined, limit = 30) {
  return useQuery({
    queryKey: [...careKeys.received(userId ?? ""), limit],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("my_received_kudos", { p_limit: limit });
      if (error) throw error;
      return (data ?? []) as ReceivedKudos[];
    },
  });
}

/** Reconocimientos públicos de un profesional (personas distintas por tipo; sin mensajes ni identidades). */
export function usePublicKudos(proId: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.publicKudos(proId ?? ""),
    enabled: !!proId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("professional_kudos_summary", { p_user: proId });
      if (error) throw error;
      return (data ?? []) as KudosSummaryRow[];
    },
  });
}

// ─── Trayectoria ─────────────────────────────────────────────────────────────

export function useMyCareerStats(userId: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.stats(userId ?? ""),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<CareerStats | null> => {
      const { data, error } = await sb.rpc("my_career_stats");
      if (error) throw error;
      return parseCareerStats(data);
    },
  });
}

export function usePublicCareerStats(proId: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.publicStats(proId ?? ""),
    enabled: !!proId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CareerStats | null> => {
      const { data, error } = await sb.rpc("professional_public_stats", { p_user: proId });
      if (error) throw error;
      return parseCareerStats(data);
    },
  });
}

// ─── Equipo de confianza ─────────────────────────────────────────────────────

export function useTrustedTeam(userId: string | null | undefined) {
  return useQuery({
    queryKey: careKeys.team(userId ?? ""),
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<TrustedMember[]> => {
      const { data, error } = await sb.rpc("my_trusted_team");
      if (error) throw error;
      return parseTeam(data);
    },
  });
}

export function useRemoveFromTeam(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (professionalId: string) => {
      const { error } = await sb
        .from("care_favorites")
        .delete()
        .eq("client_id", userId)
        .eq("professional_id", professionalId);
      if (error) throw error;
    },
    onSuccess: () => {
      if (!userId) return;
      void qc.invalidateQueries({ queryKey: careKeys.team(userId) });
      void qc.invalidateQueries({ queryKey: ["inst", "team", userId] });
    },
  });
}

// ─── Historia de cuidado (plan de pago) ──────────────────────────────────────

export function useCareHistory(
  userId: string | null | undefined,
  range: { from: string; to: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: careKeys.history(userId ?? "", range.from, range.to),
    enabled: !!userId && enabled,
    retry: false,
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await sb.rpc("care_history_report", {
        p_from: range.from || null,
        p_to: range.to || null,
      });
      if (error) throw error;
      return parseHistory(data);
    },
  });
}

// ─── Servicios en curso (tablero de cada rol) ────────────────────────────────

/**
 * Servicios en curso o por empezar de la persona (como cliente, como profesional o desde su círculo de cuidado),
 * con lo esencial del parte. Se actualiza en vivo cuando cambia una reserva o llega un registro del parte.
 */
export function useActiveServices(userId: string | null | undefined, limit = 12) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: careKeys.active(userId ?? ""),
    enabled: !!userId,
    queryFn: async (): Promise<ActiveService[]> => {
      const { data, error } = await sb.rpc("my_active_services", { p_limit: limit });
      if (error) throw error;
      return parseActiveServices(data);
    },
  });
  useRealtimeRefresh(
    `care-active-${userId ?? "anon"}`,
    [{ table: "service_bookings" }, { table: "care_logs", event: "INSERT" }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: careKeys.active(userId) });
    },
    !!userId,
  );
  return query;
}
