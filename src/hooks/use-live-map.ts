// Datos de los mapas y de los contadores en vivo, por las funciones seguras de la base (migración 20261012210000_live_map.sql):
// `map_professionals`, `map_open_demand`, `map_institutions` y `get_live_counts`. Ninguna entrega teléfono ni dirección, y toda posición
// llega aproximada a una cuadrícula de ~1 km.
//
// En vivo: la base emite un aviso sin datos («algo que ve el mapa cambió») por un canal privado de difusión; aquí se escucha y se
// vuelven a pedir los datos por las funciones seguras. Una sola suscripción compartida por todos los componentes. Los visitantes sin
// sesión escuchan un canal público separado que solo emite avisos vacíos, nunca filas ni ubicaciones.
// Además se programa UNA recarga justo cuando vence el «en vivo» más próximo (una presencia que se apaga sin avisar no genera evento).

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { LatLng } from "@/lib/geo";
import {
  countsFromLegacy,
  countsFromRow,
  fromDemandRow,
  fromInstitutionRow,
  fromProfessionalRow,
  type LegacyCountsRow,
  type LiveCounts,
  type LiveCountsRow,
  type MapDemand,
  type MapDemandRow,
  type MapInstitution,
  type MapInstitutionRow,
  type MapProfessional,
  type MapProfessionalRow,
} from "@/lib/liveMap";
import { PRESENCE_TTL_MS, nextLiveExpiry, toCell } from "@/lib/presence";
import {
  directoryIdsKey,
  pendingMapProfessionals,
  validatedMapProfessionals,
  type ValidatedMapProfessional,
} from "@/lib/mapDirectory";
import { fetchPublicProfessionals } from "@/hooks/use-public-professionals";

const sb = supabase as unknown as SupabaseClient;

const ROOT = ["live-map"] as const;
/** Raíz de las consultas de ofertas de servicio de profesionales (`use-service-offers`): las recarga el aviso `service_offers_changed`. */
export const SERVICE_OFFERS_ROOT = ["service-offers"] as const;
export const liveMapKeys = {
  all: ROOT,
  professionals: (o: string) => [...ROOT, "professionals", o] as const,
  demand: (o: string) => [...ROOT, "demand", o] as const,
  institutions: [...ROOT, "institutions"] as const,
  counts: [...ROOT, "counts"] as const,
  /** Bajo la misma raíz: el aviso en vivo del mapa también recarga los datos validados del directorio. */
  directory: (ids: string) => [...ROOT, "directory", ids] as const,
};

/** Códigos que no son un fallo para la persona: sin sesión, sin permiso o la función aún no está en la base. */
function isQuiet(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42883" ||
    err.code === "PGRST202" ||
    err.code === "42501" ||
    err.code === "28000" ||
    /could not find the function/i.test(err.message ?? "")
  );
}

// ─── Aviso en vivo (una suscripción compartida) ──────────────────────────────

const DEBOUNCE_MS = 800;
/** Quién escucha, con cuántos componentes lo usan: un aviso recarga UNA vez por cliente de consultas, no una vez por componente. */
function mapSubscriptionState() {
  return {
    clients: new Map<QueryClient, number>(),
    channel: null as ReturnType<typeof sb.channel> | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    offersTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  };
}
const privateMapState = mapSubscriptionState();
const publicMapState = mapSubscriptionState();

function subscribeMapPing(qc: QueryClient, publicMode = false): () => void {
  const state = publicMode ? publicMapState : privateMapState;
  const { clients } = state;
  const refresh = () => {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      clients.forEach((_n, client) => void client.invalidateQueries({ queryKey: ROOT }));
    }, DEBOUNCE_MS);
  };
  clients.set(qc, (clients.get(qc) ?? 0) + 1);
  if (!state.channel) {
    state.channel = sb
      .channel(publicMode ? "live_map_public_ping" : "live_map_ping", {
        config: { private: !publicMode },
      })
      .on("broadcast", { event: "map_changed" }, refresh)
      .on("broadcast", { event: "service_offers_changed" }, () => {
        // Un profesional publica, pausa o cierra una oferta de servicio: las familias e instituciones recargan su lista segura.
        clearTimeout(state.offersTimer);
        state.offersTimer = setTimeout(() => {
          clients.forEach(
            (_n, client) => void client.invalidateQueries({ queryKey: SERVICE_OFFERS_ROOT }),
          );
        }, DEBOUNCE_MS);
      })
      .subscribe((status) => {
        // Reconcile events missed while disconnected, including a new professional arriving.
        if (status === "SUBSCRIBED") refresh();
      });
  }
  return () => {
    const left = (clients.get(qc) ?? 1) - 1;
    if (left <= 0) clients.delete(qc);
    else clients.set(qc, left);
    if (clients.size === 0 && state.channel) {
      clearTimeout(state.timer);
      clearTimeout(state.offersTimer);
      void sb.removeChannel(state.channel);
      state.channel = null;
    }
  };
}

/** Escucha los avisos en vivo de la base (mapa y ofertas de servicio) por el canal privado compartido. Solo con sesión. */
export function useLiveMapPing(enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return subscribeMapPing(qc);
  }, [enabled, qc]);
}

/** Recarga todo lo del mapa cuando la base avisa que algo cambió. Con sesión, por el canal privado; sin sesión, por lo público. */
export function useLiveMapRefresh(authed: boolean, enabled = true) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    return subscribeMapPing(qc, !authed);
  }, [authed, enabled, qc]);
}

/** Una recarga programada para cuando venza el «en vivo» más próximo (sin sondeo: solo si alguien está en vivo). */
function useExpiryRefetch(
  rows: Array<{ live: boolean; lastSeen?: string | null }> | undefined,
  refetch: () => unknown,
) {
  useEffect(() => {
    if (!rows) return;
    const wait = nextLiveExpiry(rows, Date.now(), PRESENCE_TTL_MS);
    if (wait == null) return;
    const t = setTimeout(() => void refetch(), wait + 500);
    return () => clearTimeout(t);
  }, [rows, refetch]);
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export interface MapQueryOptions {
  /** Hay una sesión iniciada (decide cómo se escucha el aviso en vivo). */
  authed?: boolean;
  enabled?: boolean;
  /** Punto de partida (la posición de quien mira): ordena por cercanía y permite filtrar por radio. */
  origin?: LatLng | null;
  radiusKm?: number | null;
  limit?: number;
}

/** La posición de partida se aproxima para no pedir de nuevo por cada metro que se mueva el GPS. */
function originKey(
  o: LatLng | null | undefined,
  radius: number | null | undefined,
  limit: number | undefined,
): string {
  const pos = o ? `${toCell(o.lat)},${toCell(o.lng)}` : "sin-origen";
  return `${pos}|${radius ?? "sin-radio"}|${limit ?? "def"}`;
}

const rpcArgs = (o: MapQueryOptions) => ({
  p_lat: o.origin ? toCell(o.origin.lat) : null,
  p_lng: o.origin ? toCell(o.origin.lng) : null,
  p_radius_km: o.origin && o.radiusKm ? o.radiusKm : null,
  p_limit: o.limit ?? 300,
});

/** Profesionales publicados con su estado (disponible / ocupado / no disponible) y si están en vivo. */
export function useMapProfessionals(opts: MapQueryOptions = {}) {
  const enabled = opts.enabled ?? true;
  useLiveMapRefresh(!!opts.authed, enabled);
  const query = useQuery({
    queryKey: liveMapKeys.professionals(originKey(opts.origin, opts.radiusKm, opts.limit)),
    enabled,
    staleTime: 20_000,
    queryFn: async (): Promise<MapProfessional[]> => {
      const { data, error } = await sb.rpc("map_professionals", rpcArgs(opts));
      if (error) {
        if (isQuiet(error)) return [];
        throw error;
      }
      return ((data ?? []) as MapProfessionalRow[]).map(fromProfessionalRow);
    },
  });
  useExpiryRefetch(query.data, query.refetch);
  return query;
}

/**
 * Profesionales del mapa para familias e IPS/EPS, solo con los datos validados del buscador (`searchProfessionalDetails`): nombre
 * autorizado, ciudad y turnos. Quien no los tiene no aparece (ver `lib/mapDirectory.ts`). Se actualiza con el mismo aviso en vivo.
 * `data` solo trae perfiles con documentos validados (se pueden pedir); `pending`, los que tienen documentos pendientes (pin ámbar).
 */
export function useValidatedMapProfessionals(opts: MapQueryOptions = {}) {
  const enabled = opts.enabled ?? true;
  const prosQ = useMapProfessionals(opts);
  const pros = prosQ.data;
  const idsKey = useMemo(
    () => (pros ? directoryIdsKey(pros.filter((p) => p.verification === "verified")) : ""),
    [pros],
  );
  const dirQ = useQuery({
    queryKey: liveMapKeys.directory(idsKey),
    enabled: enabled && idsKey !== "",
    staleTime: 20_000,
    queryFn: () => {
      const ids = idsKey.split(",");
      return fetchPublicProfessionals({ ids, limit: ids.length });
    },
  });
  const data = useMemo<ValidatedMapProfessional[] | undefined>(() => {
    if (!pros) return undefined;
    if (idsKey === "") return [];
    // Si el directorio falla no se muestra nada sin validar.
    if (dirQ.isError) return [];
    return dirQ.data ? validatedMapProfessionals(pros, dirQ.data) : undefined;
  }, [pros, idsKey, dirQ.data, dirQ.isError]);
  const pending = useMemo<MapProfessional[]>(
    () => (pros ? pendingMapProfessionals(pros) : []),
    [pros],
  );
  return {
    data,
    pending,
    isLoading: data === undefined && enabled,
    isError: prosQ.isError || dirQ.isError,
  };
}

/** Familias e instituciones con ofertas u horas abiertas, un pin por quien publica. Solo para profesionales y personal. */
export function useMapDemand(opts: MapQueryOptions = {}) {
  const enabled = opts.enabled ?? true;
  useLiveMapRefresh(!!opts.authed, enabled);
  return useQuery({
    queryKey: liveMapKeys.demand(originKey(opts.origin, opts.radiusKm, opts.limit)),
    enabled,
    staleTime: 20_000,
    queryFn: async (): Promise<MapDemand[]> => {
      const { data, error } = await sb.rpc("map_open_demand", rpcArgs(opts));
      if (error) {
        if (isQuiet(error)) return [];
        throw error;
      }
      return ((data ?? []) as MapDemandRow[]).map(fromDemandRow);
    },
  });
}

/** Instituciones visibles con su estado. */
export function useMapInstitutions(
  opts: Pick<MapQueryOptions, "authed" | "enabled" | "limit"> = {},
) {
  const enabled = opts.enabled ?? true;
  useLiveMapRefresh(!!opts.authed, enabled);
  const query = useQuery({
    queryKey: liveMapKeys.institutions,
    enabled,
    staleTime: 20_000,
    queryFn: async (): Promise<MapInstitution[]> => {
      const { data, error } = await sb.rpc("map_institutions", { p_limit: opts.limit ?? 300 });
      if (error) {
        if (isQuiet(error)) return [];
        throw error;
      }
      return ((data ?? []) as MapInstitutionRow[]).map(fromInstitutionRow);
    },
  });
  useExpiryRefetch(query.data, query.refetch);
  return query;
}

/**
 * Contadores reales por rol: registrados, disponibles, ocupados y en vivo. Si la función nueva aún no está en la base, cae a la
 * antigua (sin «ocupados»).
 */
export function useLiveCounts(opts: { authed?: boolean; enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  useLiveMapRefresh(!!opts.authed, enabled);
  const query = useQuery({
    queryKey: liveMapKeys.counts,
    enabled,
    staleTime: 20_000,
    queryFn: async (): Promise<LiveCounts> => {
      const live = await sb.rpc("get_live_counts").single();
      if (!live.error && live.data) return countsFromRow(live.data as LiveCountsRow);
      if (live.error && !isQuiet(live.error)) throw live.error;
      const legacy = await sb.rpc("get_platform_counts").single();
      if (legacy.error) throw legacy.error;
      return countsFromLegacy(legacy.data as LegacyCountsRow);
    },
  });
  // Mientras alguien esté en vivo, se vuelve a mirar cuando venza un latido: nadie avisa a la base de una pestaña que se cerró sola.
  const anyLive = useMemo(() => {
    const c = query.data;
    return !!c && c.professionals.live + c.families.live + c.institutions.live > 0;
  }, [query.data]);
  const { refetch, dataUpdatedAt } = query;
  useEffect(() => {
    if (!anyLive) return;
    const t = setTimeout(() => void refetch(), PRESENCE_TTL_MS + 500);
    return () => clearTimeout(t);
    // `dataUpdatedAt` vuelve a armar el plazo cada vez que llegan datos nuevos.
  }, [anyLive, dataUpdatedAt, refetch]);
  return query;
}
