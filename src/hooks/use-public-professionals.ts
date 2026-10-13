// Lectura del directorio público de profesionales por `public.public_professionals` (migración 20261013100000). Reemplaza a las vistas
// `public_professionals_safe` / `public_profiles_safe`, que por ser security_invoker devolvían cero filas a toda cuenta que no fuera
// personal. La función decide qué viaja: sin teléfono, posición en cuadrícula de ~1 km y nombre completo / foto / RETHUS solo con sesión.

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  isEmptyIdLookup,
  publicProfessionalsArgs,
  type PublicProfessional,
  type PublicProfessionalFilters,
} from "@/lib/publicProfessionals";

// La función nueva todavía no está en los tipos generados (se regeneran tras aplicar la migración).
const sb = supabase as unknown as SupabaseClient;

export const publicProsKeys = {
  all: ["public-professionals"] as const,
  list: (f: PublicProfessionalFilters) =>
    ["public-professionals", "list", JSON.stringify(publicProfessionalsArgs(f))] as const,
};

/** Profesionales publicados que cumplen los filtros (o los ids pedidos), mejor calificados primero. */
export async function fetchPublicProfessionals(
  filters: PublicProfessionalFilters = {},
  opts: { signal?: AbortSignal } = {},
): Promise<PublicProfessional[]> {
  if (isEmptyIdLookup(filters)) return [];
  let query = sb.rpc("public_professionals", publicProfessionalsArgs(filters));
  if (opts.signal) query = query.abortSignal(opts.signal);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PublicProfessional[];
}

/** Cuántos profesionales publicados cumplen los filtros (hasta el tope de 500 de la función). */
export async function countPublicProfessionals(
  filters: PublicProfessionalFilters = {},
  opts: { signal?: AbortSignal } = {},
): Promise<number> {
  if (isEmptyIdLookup(filters)) return 0;
  let query = sb.rpc("public_professionals", publicProfessionalsArgs({ ...filters, limit: 500 }), {
    head: true,
    count: "exact",
  });
  if (opts.signal) query = query.abortSignal(opts.signal);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export function usePublicProfessionals(filters: PublicProfessionalFilters, enabled = true) {
  return useQuery({
    queryKey: publicProsKeys.list(filters),
    enabled,
    staleTime: 60_000,
    queryFn: () => fetchPublicProfessionals(filters),
  });
}
