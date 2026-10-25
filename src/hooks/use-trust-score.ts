// Trust Score de una cuenta, tal como lo explica la base (`get_trust_score`, migración 20261012190000). La base decide quién puede
// verlo y qué parte: el desglose (`components`) solo llega a la propia cuenta y al personal.

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import {
  trustFromColumns,
  type IdentityParts,
  type TrustComponents,
  type TrustKind,
  type TrustSummary,
} from "@/lib/trustScore";

const sb = supabase as unknown as SupabaseClient;

interface TrustRow {
  user_id: string;
  kind: string;
  score: number | null;
  level: string | null;
  enough_data: boolean | null;
  ratings_count: number | null;
  stars_avg: number | string | null;
  completed_services: number | null;
  verified: boolean | null;
  source: string | null;
  components:
    | (Partial<Record<keyof TrustComponents, number>> & {
        identity_parts?: IdentityParts | null;
        ai_validation?: number | null;
      })
    | null;
}

export interface TrustScoreInfo {
  userId: string;
  kind: TrustKind;
  summary: TrustSummary;
  ratingsCount: number;
  starsAvg: number | null;
  completedServices: number;
  /** Solo para la propia cuenta y el personal. */
  components: TrustComponents | null;
  /** Qué pieza de la identidad está entregada (solo la propia cuenta y el personal). */
  identityParts: IdentityParts | null;
  /** Profesionales: el número de la validación con IA, que ahora es solo una pieza de la identidad. */
  aiValidation: number | null;
}

export const trustKeys = {
  one: (id: string) => ["trust", "one", id] as const,
};

/** Tras guardar el perfil o un documento: el puntaje se vuelve a pedir para que la tarjeta muestre lo nuevo. */
export function refreshTrustScore(
  qc: ReturnType<typeof useQueryClient>,
  userId: string | null | undefined,
) {
  if (!userId) return;
  void qc.invalidateQueries({ queryKey: trustKeys.one(userId) });
}

function toComponents(raw: TrustRow["components"]): TrustComponents | null {
  if (!raw || typeof raw !== "object") return null;
  const n = (k: keyof TrustComponents) => Number(raw[k] ?? 0);
  // Una base sin la migración 20261025100000 aún trae solo `ai_validation` para el profesional: sin desglose.
  if (!("base" in raw)) return null;
  return {
    base: n("base"),
    ratings: n("ratings"),
    services: n("services"),
    identity: n("identity"),
    seniority: n("seniority"),
    adjustments: n("adjustments"),
  };
}

function fromRow(row: TrustRow): TrustScoreInfo {
  const kind: TrustKind =
    row.kind === "professional" || row.kind === "institution" ? row.kind : "family";
  return {
    userId: row.user_id,
    kind,
    summary: trustFromColumns(row.score, row.level, row.enough_data, row.verified),
    ratingsCount: Number(row.ratings_count ?? 0),
    starsAvg: row.stars_avg == null ? null : Number(row.stars_avg),
    completedServices: Number(row.completed_services ?? 0),
    components: toComponents(row.components),
    identityParts:
      row.components && typeof row.components.identity_parts === "object"
        ? (row.components.identity_parts ?? null)
        : null,
    aiValidation:
      row.components?.ai_validation == null ? null : Number(row.components.ai_validation),
  };
}

/** `42883`/`PGRST202`: la base aún no tiene la función. `42501`/`28000`: sin permiso o sin sesión. Ninguno es un fallo visible. */
function isQuietError(err: { code?: string; message?: string }): boolean {
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    err.code === "42501" ||
    err.code === "28000" ||
    /could not find the function/i.test(err.message ?? "")
  );
}

/** El Trust Score de `targetId` (lo que el rol de quien mira puede ver). `null` si no hay o no se puede ver. */
export function useTrustScore(
  targetId: string | null | undefined,
  enabled = true,
  staleTime = 60_000,
) {
  return useQuery({
    queryKey: trustKeys.one(targetId ?? ""),
    enabled: !!targetId && enabled,
    staleTime,
    queryFn: async (): Promise<TrustScoreInfo | null> => {
      const { data, error } = await sb.rpc("get_trust_score", { p_user: targetId });
      if (error) {
        if (isQuietError(error)) return null;
        throw error;
      }
      const row = ((data ?? []) as TrustRow[])[0];
      return row ? fromRow(row) : null;
    },
  });
}

/**
 * El puntaje de la propia cuenta, con desglose, en vivo: cambia cuando llega una calificación o termina un servicio (Realtime;
 * las políticas de la base filtran lo que se puede escuchar).
 */
export function useOwnTrustScore(userId: string | null | undefined, kind: TrustKind = "family") {
  const qc = useQueryClient();
  // Siempre fresco al volver a la tarjeta: lo que se completa en el perfil o en Documentos tiene que verse enseguida.
  const query = useTrustScore(userId, true, 0);
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: trustKeys.one(userId ?? "") });
  }, [qc, userId]);
  useRealtimeRefresh(
    `own-trust-score-${kind}`,
    [
      { table: "service_ratings", filter: `rated_id=eq.${userId}` },
      {
        table: "service_bookings",
        filter: kind === "professional" ? `professional_id=eq.${userId}` : `client_id=eq.${userId}`,
      },
    ],
    refresh,
    !!userId,
  );
  return query;
}
