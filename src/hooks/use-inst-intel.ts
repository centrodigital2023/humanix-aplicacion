// Datos del panel de la institución para las funciones inteligentes (resumen del día, costos, calidad y cumplimiento,
// equipo, pronóstico de cobertura e informe de gestión).
//
// Todo se pide con la sesión de la propia institución: lo que RLS ya le permite leer (sus reservas, el parte de sus
// servicios, sus contratos, sus ofertas y el perfil público de los profesionales). No hay tablas ni funciones nuevas en
// la base de datos y nada se envía a terceros: las cuentas las hacen las funciones puras de `src/lib`. Las
// actualizaciones llegan por Realtime; no hay sondeo. Un dato que no se pudo leer no se confunde con un cero: llega como
// `null` y el informe dice «todavía no se cargaron estos datos».

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { hashIds, useApplicantFacts, useProfessionalNames } from "@/hooks/use-family-intel";
import { useNow } from "@/hooks/use-now";
import type { CostOffer } from "@/lib/instCost";
import type { InstBooking, InstContractShift, InstLog, InstProFact } from "@/lib/instData";
import { buildQualityReport, type QualityReport } from "@/lib/instQuality";
import { DAY_MS, msOf, type Period } from "@/lib/intelShared";

const sb = supabase as unknown as SupabaseClient;

export const instIntelKeys = {
  bookings: (uid: string) => ["inst-intel", "bookings", uid] as const,
  offers: (uid: string) => ["inst-intel", "offers", uid] as const,
  logs: (uid: string, ids: string) => ["inst-intel", "logs", uid, ids] as const,
  contractShifts: (uid: string) => ["inst-intel", "contract-shifts", uid] as const,
};

/** Reservas que se leen: hasta 200 días atrás (6 meses de gasto, el mes pasado y 90 días de calidad) y todo lo futuro. */
export const INST_BOOKINGS_LOOKBACK_DAYS = 200;
export const INST_BOOKINGS_LIMIT = 800;
/** Servicios cuyo parte se lee: los terminados de los últimos 100 días, hasta 150. */
export const INST_LOG_LOOKBACK_DAYS = 100;
export const INST_LOG_BOOKINGS_MAX = 150;
export const INST_LOG_ROWS_CAP = 3000;
export const INST_CONTRACT_SHIFTS_LIMIT = 2000;
export const INST_OFFERS_LIMIT = 500;

// ─── Reservas de la institución ──────────────────────────────────────────────

export function useInstBookings(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: instIntelKeys.bookings(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<InstBooking[]> => {
      const since = new Date(Date.now() - INST_BOOKINGS_LOOKBACK_DAYS * DAY_MS).toISOString();
      const { data, error } = await sb
        .from("service_bookings")
        .select(
          "id, status, scheduled_at, started_at, arrived_at, completed_at, cancelled_at, cancel_reason, duration_hours, hourly_rate, total_amount, professional_id, job_offer_id",
        )
        .eq("client_id", userId)
        .gte("scheduled_at", since)
        .order("scheduled_at", { ascending: false })
        .limit(INST_BOOKINGS_LIMIT);
      if (error) throw error;
      return (data ?? []) as InstBooking[];
    },
  });
  useRealtimeRefresh(
    `inst-intel-bookings-${userId ?? "anon"}`,
    [{ table: "service_bookings", filter: `client_id=eq.${userId}` }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: instIntelKeys.bookings(userId) });
    },
    !!userId && enabled,
  );
  return query;
}

// ─── Ofertas propias (para saber en qué se va el dinero) ─────────────────────

export function useInstOffers(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: instIntelKeys.offers(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, CostOffer>> => {
      const { data, error } = await sb
        .from("job_offers")
        .select("id, title, specialty_required")
        .eq("posted_by", userId)
        .order("created_at", { ascending: false })
        .limit(INST_OFFERS_LIMIT);
      if (error) throw error;
      const out: Record<string, CostOffer> = {};
      for (const r of (data ?? []) as Array<{
        id: string;
        title: string | null;
        specialty_required: string | null;
      }>) {
        out[r.id] = { title: r.title, specialty: r.specialty_required };
      }
      return out;
    },
  });
}

// ─── Parte de los servicios ──────────────────────────────────────────────────

export interface InstLogsData {
  rows: InstLog[];
  /** Servicios cuyo parte se pidió (los que no tienen registros cuentan como «sin parte»). */
  queried: string[];
  /** Llegó al tope de filas: puede faltar parte de los más antiguos. */
  truncated: boolean;
}

/**
 * Registros del parte de los servicios terminados recientes. RLS deja leer solo los de los servicios de la propia
 * institución. Si la lectura falla, el resultado queda en `undefined` y el informe lo dice (no cuenta ceros).
 */
export function useInstCareLogs(
  userId: string | null | undefined,
  bookings: InstBooking[] | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  const ids = useMemo(() => {
    const since = Date.now() - INST_LOG_LOOKBACK_DAYS * DAY_MS;
    return (bookings ?? [])
      .filter((b) => b.status === "completed" && msOf(b.scheduled_at) >= since)
      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
      .slice(0, INST_LOG_BOOKINGS_MAX)
      .map((b) => b.id);
  }, [bookings]);
  const key = hashIds(ids);

  const query = useQuery({
    queryKey: instIntelKeys.logs(userId ?? "", key),
    enabled: !!userId && enabled && ids.length > 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<InstLogsData> => {
      const { data, error } = await sb
        .from("care_logs")
        .select("booking_id, event_type, is_alert, created_at")
        .in("booking_id", ids)
        .order("created_at", { ascending: false })
        .limit(INST_LOG_ROWS_CAP);
      if (error) throw error;
      const rows = (data ?? []) as InstLog[];
      return { rows, queried: ids, truncated: rows.length >= INST_LOG_ROWS_CAP };
    },
  });
  useRealtimeRefresh(
    `inst-intel-logs-${userId ?? "anon"}`,
    [{ table: "care_logs", event: "INSERT" }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: instIntelKeys.logs(userId, key) });
    },
    !!userId && enabled && ids.length > 0,
  );
  return { query, ids };
}

// ─── Contratos ───────────────────────────────────────────────────────────────

/** Turnos de los contratos de la institución con el estado de cada contrato. */
export function useInstContractShifts(userId: string | null | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: instIntelKeys.contractShifts(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<InstContractShift[]> => {
      const { data, error } = await sb
        .from("smart_contract_shifts")
        .select("booking_id, smart_contracts!inner(status, institution_user_id)")
        .eq("smart_contracts.institution_user_id", userId)
        .limit(INST_CONTRACT_SHIFTS_LIMIT);
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const contract = Array.isArray(r.smart_contracts)
          ? r.smart_contracts[0]
          : r.smart_contracts;
        return {
          booking_id: typeof r.booking_id === "string" ? r.booking_id : null,
          contract_status:
            contract && typeof (contract as { status?: unknown }).status === "string"
              ? ((contract as { status: string }).status as string)
              : null,
        };
      });
    },
  });
  useRealtimeRefresh(
    `inst-intel-contracts-${userId ?? "anon"}`,
    [{ table: "smart_contracts" }],
    () => {
      if (userId) void qc.invalidateQueries({ queryKey: instIntelKeys.contractShifts(userId) });
    },
    !!userId && enabled,
  );
  return query;
}

// ─── Perfil público de los profesionales ─────────────────────────────────────

/**
 * Nombre y verificación de los profesionales que prestaron servicios. `pros` es `null` mientras se leen (o si no se
 * pudieron leer): así «sin verificar» nunca se confunde con «todavía no sé».
 */
export function useInstProFacts(proIds: string[], enabled: boolean) {
  const ids = useMemo(() => [...new Set(proIds.filter(Boolean))], [proIds]);
  const namesQ = useProfessionalNames(enabled ? ids : []);
  const factsQ = useApplicantFacts(ids, enabled);
  const pros = useMemo<Record<string, InstProFact> | null>(() => {
    if (!enabled) return null;
    if (ids.length === 0) return {};
    if (!factsQ.data) return null;
    const out: Record<string, InstProFact> = {};
    for (const id of ids) {
      const f = factsQ.data[id];
      out[id] = {
        name: namesQ.data?.[id] ?? null,
        rethusVerified: f ? (f.rethus_verified ?? null) : null,
        verified: f ? (f.verified ?? null) : null,
      };
    }
    return out;
  }, [enabled, ids, factsQ.data, namesQ.data]);
  return { pros, loading: enabled && ids.length > 0 && (factsQ.isLoading || namesQ.isLoading) };
}

// ─── Calidad y cumplimiento (se usa en el resumen del día y en el centro de gestión) ──────────────

/** Ids de los profesionales que prestaron servicios terminados. */
export function proIdsOf(bookings: InstBooking[]): string[] {
  return [
    ...new Set(bookings.filter((b) => b.status === "completed").map((b) => b.professional_id)),
  ];
}

/** Lo leído de la base para la calidad y el informe: cada parte es `null` mientras no se haya podido cargar. */
export interface InstQualityData {
  bookings: InstBooking[];
  logs: { rows: InstLog[]; queried: string[] } | null;
  contractShifts: InstContractShift[] | null;
  pros: Record<string, InstProFact> | null;
}

export function useInstQuality(
  userId: string | null | undefined,
  period: Period,
  enabled: boolean,
): { report: QualityReport | null; loading: boolean; error: boolean; data: InstQualityData } {
  const now = useNow();
  const bookingsQ = useInstBookings(userId, enabled);
  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data]);
  const { query: logsQ, ids: logIds } = useInstCareLogs(userId, bookingsQ.data, enabled);
  const contractsQ = useInstContractShifts(userId, enabled);
  const proIds = useMemo(() => proIdsOf(bookings), [bookings]);
  const { pros, loading: prosLoading } = useInstProFacts(proIds, enabled);

  // Sin servicios terminados recientes no hay parte que pedir: eso es «nada que documentar», no «no se cargó».
  const logs = useMemo(() => {
    if (logsQ.data) return { rows: logsQ.data.rows, queried: logsQ.data.queried };
    return enabled && bookingsQ.data && logIds.length === 0 ? { rows: [], queried: [] } : null;
  }, [logsQ.data, enabled, bookingsQ.data, logIds.length]);
  const contractShifts = contractsQ.data ?? null;
  const data = useMemo<InstQualityData>(
    () => ({ bookings, logs, contractShifts, pros }),
    [bookings, logs, contractShifts, pros],
  );

  const report = useMemo(
    () => (enabled && bookingsQ.data ? buildQualityReport({ ...data, period, now }) : null),
    [enabled, bookingsQ.data, data, period, now],
  );
  return {
    report,
    loading:
      enabled && (bookingsQ.isLoading || prosLoading || logsQ.isLoading || contractsQ.isLoading),
    error: bookingsQ.isError,
    data,
  };
}
