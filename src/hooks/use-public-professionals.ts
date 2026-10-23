// Lectura del directorio público de profesionales por `public.public_professionals` (migración 20261013100000). Reemplaza a las vistas
// `public_professionals_safe` / `public_profiles_safe`, que por ser security_invoker devolvían cero filas a toda cuenta que no fuera
// personal. La función decide qué viaja: sin teléfono, posición en cuadrícula de ~1 km y nombre completo / foto / RETHUS solo con sesión.

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  isEmptyIdLookup,
  publicProfessionalsArgs,
  uniqueProfessionalCount,
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

/**
 * Quiénes de `ids` llevan el badge «verificado destacado» (plan Premium Profesional). Si la función aún no existe en la
 * base (migración 20261023100000 sin aplicar) o falla, nadie lo lleva: el directorio sigue igual.
 */
export async function fetchFeaturedProfessionals(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await sb.rpc("featured_professionals", { p_ids: ids.slice(0, 500) });
  if (error || !Array.isArray(data)) return new Set();
  return new Set((data as Array<{ user_id: string }>).map((r) => r.user_id));
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

/**
 * Cuántos profesionales publicados coinciden con ALGUNO de los términos de especialidad (por ejemplo «Médico», «Medic», «Médic»): la
 * búsqueda por especialidad del servidor no distingue ni tildes ni la «a/o» final, así que se piden por término y se cuentan sin repetir.
 */
export async function countPublicProfessionalsForTerms(
  terms: readonly string[],
  filters: Omit<PublicProfessionalFilters, "specialty"> = {},
  opts: { signal?: AbortSignal } = {},
): Promise<number> {
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return 0;
  if (unique.length === 1)
    return countPublicProfessionals({ ...filters, specialty: unique[0] }, opts);
  const lists = await Promise.all(
    unique.map((specialty) =>
      fetchPublicProfessionals({ ...filters, specialty, limit: 500 }, opts),
    ),
  );
  return uniqueProfessionalCount(lists);
}

export function usePublicProfessionals(filters: PublicProfessionalFilters, enabled = true) {
  return useQuery({
    queryKey: publicProsKeys.list(filters),
    enabled,
    staleTime: 60_000,
    queryFn: () => fetchPublicProfessionals(filters),
  });
}
