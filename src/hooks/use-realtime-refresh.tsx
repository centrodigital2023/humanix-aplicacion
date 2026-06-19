import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type TableEvent = "*" | "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeTable {
  table: string;
  event?: TableEvent;
  filter?: string;
}

/**
 * Suscribe en tiempo real a una o varias tablas de Supabase.
 * Cuando ocurre cualquier cambio en las tablas indicadas, llama `onRefresh`.
 *
 * @param channelName - nombre único del canal (evita duplicados)
 * @param tables      - lista de tablas e eventos a escuchar
 * @param onRefresh   - función que recarga los datos (p.ej. loadData)
 * @param enabled     - si false, no suscribe (por defecto true)
 */
export function useRealtimeRefresh(
  channelName: string,
  tables: RealtimeTable[],
  onRefresh: () => void,
  enabled = true,
) {
  // Usamos ref para evitar re-suscripciones innecesarias si onRefresh cambia
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  });

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    const ch = tables.reduce(
      (channel, { table, event = "*", filter }) =>
        channel.on(
          "postgres_changes",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { event, schema: "public", table, ...(filter ? { filter } : {}) } as any,
          () => refreshRef.current(),
        ),
      supabase.channel(channelName),
    );

    ch.subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelName, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
