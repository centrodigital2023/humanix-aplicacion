// Datos del portal EPS/IPS: la identidad de la institución y las alertas y puntajes de riesgo clínico ligados a SUS
// servicios (antes el portal leía todas las alertas y todos los puntajes de la plataforma, sin filtrar por institución).
//
// Se piden con la sesión de la propia institución, por los ids de sus servicios recientes, de a 100 para no pasarse del
// largo de la dirección. No hay tablas ni funciones nuevas en la base de datos. Las actualizaciones llegan por Realtime;
// no hay sondeo. Lo que no se pudo leer llega como `undefined` y la pantalla lo dice: nunca se confunde con un cero.
//
// Nota de seguridad: este filtro es de la pantalla. Las reglas de la base de datos (RLS) de `clinical_alerts` y
// `patient_risk_scores` dejan leer a cualquier institución; cerrarlo exige una migración (ver AUDIT_REPORT.md).

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { hashIds } from "@/hooks/use-family-intel";
import { recentBookingIds, type EpsAlertRow, type EpsRiskRow } from "@/lib/epsMetrics";
import type { InstBooking } from "@/lib/instData";
import { chunk } from "@/lib/intelShared";

const sb = supabase as unknown as SupabaseClient;

export const epsKeys = {
  identity: (uid: string) => ["eps-intel", "identity", uid] as const,
  alerts: (uid: string, ids: string) => ["eps-intel", "alerts", uid, ids] as const,
  risks: (uid: string, ids: string) => ["eps-intel", "risks", uid, ids] as const,
};

/** Servicios de los últimos 120 días (y los futuros): de ahí salen las alertas y los puntajes que se leen. */
export const EPS_LOOKBACK_DAYS = 120;
/** Cuántos servicios (los más recientes) se consultan como máximo. */
export const EPS_BOOKING_IDS_MAX = 300;
/** Ids por petición. */
export const EPS_CHUNK = 100;
export const EPS_ROWS_PER_CHUNK = 500;

export interface InstitutionIdentity {
  institution_name: string;
  institution_type: string | null;
  city: string | null;
  verified: boolean | null;
}

/** Nombre, tipo y ciudad de la institución (su propio perfil: RLS deja leer solo el suyo). */
export function useInstitutionIdentity(userId: string | null | undefined) {
  return useQuery({
    queryKey: epsKeys.identity(userId ?? ""),
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<InstitutionIdentity | null> => {
      const { data, error } = await sb
        .from("institution_profiles")
        .select("institution_name, institution_type, city, verified")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as InstitutionIdentity | null) ?? null;
    },
  });
}

async function readByBooking<T>(
  table: string,
  columns: string,
  orderBy: string,
  ids: string[],
): Promise<T[]> {
  const parts = await Promise.all(
    chunk(ids, EPS_CHUNK).map(async (part) => {
      const { data, error } = await sb
        .from(table)
        .select(columns)
        .in("booking_id", part)
        .order(orderBy, { ascending: false })
        .limit(EPS_ROWS_PER_CHUNK);
      if (error) throw error;
      return (data ?? []) as T[];
    }),
  );
  return parts.flat();
}

/**
 * Alertas clínicas y puntajes de riesgo de los servicios de la institución. Cada lectura es independiente: si falla una,
 * la otra se muestra igual y la que falló queda en `undefined`.
 */
export function useEpsClinical(
  userId: string | null | undefined,
  bookings: InstBooking[] | undefined,
  now: number,
) {
  const qc = useQueryClient();
  const { ids, truncated } = useMemo(
    () => recentBookingIds(bookings ?? [], now, EPS_LOOKBACK_DAYS, EPS_BOOKING_IDS_MAX),
    [bookings, now],
  );
  const key = hashIds(ids);
  const enabled = !!userId && ids.length > 0;

  const alerts = useQuery({
    queryKey: epsKeys.alerts(userId ?? "", key),
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      readByBooking<EpsAlertRow>(
        "clinical_alerts",
        "booking_id, patient_id, severity, status, created_at",
        "created_at",
        ids,
      ),
  });
  const risks = useQuery({
    queryKey: epsKeys.risks(userId ?? "", key),
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      readByBooking<EpsRiskRow>(
        "patient_risk_scores",
        "patient_id, score, level, calculated_at",
        "calculated_at",
        ids,
      ),
  });

  useRealtimeRefresh(
    `eps-intel-clinical-${userId ?? "anon"}`,
    [{ table: "clinical_alerts" }, { table: "patient_risk_scores", event: "INSERT" }],
    () => {
      if (!userId) return;
      void qc.invalidateQueries({ queryKey: epsKeys.alerts(userId, key) });
      void qc.invalidateQueries({ queryKey: epsKeys.risks(userId, key) });
    },
    enabled,
  );

  // Sin servicios que consultar no hay alertas ni puntajes: eso es «ninguno», no «no se cargó».
  const none = !!userId && bookings !== undefined && ids.length === 0;
  return {
    alerts: alerts.data ?? (none ? [] : null),
    risks: risks.data ?? (none ? [] : null),
    loading: enabled && (alerts.isLoading || risks.isLoading),
    alertsFailed: alerts.isError,
    risksFailed: risks.isError,
    truncated,
    updatedAt: Math.max(alerts.dataUpdatedAt, risks.dataUpdatedAt),
    refresh: () => {
      if (!userId) return Promise.resolve();
      return Promise.all([
        qc.invalidateQueries({ queryKey: epsKeys.alerts(userId, key) }),
        qc.invalidateQueries({ queryKey: epsKeys.risks(userId, key) }),
      ]).then(() => undefined);
    },
  };
}
