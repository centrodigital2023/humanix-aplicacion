// Respuestas del formulario de validación de mercado para el panel de superadmin, en vivo.
//
// Solo el superadmin puede leer la tabla (política `validation_responses_superadmin_select`) y la tabla está en la
// publicación de Realtime, que respeta RLS: cada formulario nuevo llega al panel apenas se guarda y la
// tabulación se recalcula sola. Sin polling.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { ResponseRow } from "@/lib/marketValidation";

// Las columnas nuevas aún no están en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const VALIDATION_KEY = ["superadmin", "validation-responses"] as const;

/** Tope de filas que se traen al panel. Si se alcanza, el panel avisa que muestra solo las más recientes. */
export const MAX_ROWS = 5000;
/** Varios eventos seguidos (un formulario genera tres: guardar, verificar, código) se juntan en una sola recarga. */
const REFETCH_DEBOUNCE_MS = 1200;

const COLUMNS =
  "id, created_at, profile_type, full_name, whatsapp, email, city, service_offer, pain_point, target_customer, " +
  "key_benefit, pays_currently, alternatives, competitors, search_channels, retention_channels, willingness_pct, " +
  "comments, signal_score, total_score, quality_flags, contact_verified_at, verified_channel, promo_code, " +
  "benefit_status, benefit_expires_at, premium_activated, redeemed_at";

export function useValidationResponses() {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  const query = useQuery({
    queryKey: VALIDATION_KEY,
    queryFn: async (): Promise<ResponseRow[]> => {
      const { data, error } = await sb
        .from("validation_responses")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
      if (error) throw error;
      return (data ?? []) as unknown as ResponseRow[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void qc.invalidateQueries({ queryKey: VALIDATION_KEY }),
        REFETCH_DEBOUNCE_MS,
      );
    };
    const channel = supabase
      .channel(`superadmin-validation-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { event: "*", schema: "public", table: "validation_responses" } as any,
        refresh,
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  return { ...query, live, truncated: (query.data?.length ?? 0) >= MAX_ROWS };
}
