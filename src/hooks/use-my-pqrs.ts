// «Mis solicitudes» de PQRS: lo que la cuenta radicó y cómo va. La lectura pasa por `my_pqrs_tickets` (migración
// 20261012200000_pqrs_my_tickets.sql), que entrega solo lo que le corresponde a la dueña — nunca el triaje interno del equipo.
// La tabla ya no se lee directo desde la aplicación.

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const sb = supabase as unknown as SupabaseClient;

export interface MyPqrsTicket {
  id: string;
  radicado: string | null;
  type: string;
  subject: string | null;
  status: string;
  created_at: string;
  due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
}

export const pqrsKeys = {
  mine: (uid: string) => ["pqrs", "mine", uid] as const,
};

/** `42883` (función inexistente) o `PGRST202`: la base aún no tiene la función; la lista queda vacía en vez de fallar. */
function isMissingFunction(err: { code?: string; message?: string }): boolean {
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    /could not find the function/i.test(err.message ?? "")
  );
}

export function useMyPqrs(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: pqrsKeys.mine(userId ?? ""),
    enabled: !!userId && enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<MyPqrsTicket[]> => {
      const { data, error } = await sb.rpc("my_pqrs_tickets", { p_limit: 20 });
      if (error) {
        if (isMissingFunction(error)) return [];
        throw error;
      }
      return (data ?? []) as MyPqrsTicket[];
    },
  });
}
