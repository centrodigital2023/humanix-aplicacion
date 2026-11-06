import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { liveMapKeys, useLiveMapPing } from "@/hooks/use-live-map";

/**
 * Bajo la raíz del mapa: el aviso en vivo `live_map_ping` (lo emite `trg_map_ping` cuando cambia `available`) recarga esta
 * consulta. Así el interruptor queda igual en todas las pantallas y dispositivos de la misma persona, sin depender de que
 * `professional_profiles` esté en la publicación de Realtime (no lo está: sus filas no se difunden).
 */
export const myAvailabilityKey = (userId: string) =>
  [...liveMapKeys.all, "my-availability", userId] as const;

export type AvailabilityResult = { ok: true; available: boolean } | { ok: false; reason: string };

/** Lee `available` del perfil. `null` = aún no hay perfil profesional. */
export async function fetchMyAvailability(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("professional_profiles")
    .select("available")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return Boolean((data as { available?: boolean | null }).available);
}

/**
 * Cambia `available` y confirma con la fila devuelta: un UPDATE que no toca filas (sin perfil, RLS) no da error en
 * PostgREST, así que sin `.select()` la pantalla diría «¡Listo!» sin haber guardado nada.
 */
export async function saveMyAvailability(
  userId: string,
  next: boolean,
): Promise<AvailabilityResult> {
  const { data, error } = await supabase
    .from("professional_profiles")
    .update({ available: next } as never)
    .eq("user_id", userId)
    .select("available")
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: "no_profile" };
  const saved = Boolean((data as { available?: boolean | null }).available);
  if (saved !== next) return { ok: false, reason: "not_saved" };
  return { ok: true, available: saved };
}

/** Interruptor «Disponible» del profesional, compartido por el inicio y el panel, y sincronizado en vivo. */
export function useProAvailability(userId: string | null | undefined, enabled = true) {
  const qc = useQueryClient();
  const on = Boolean(userId) && enabled;
  const key = myAvailabilityKey(userId ?? "");
  const query = useQuery({
    queryKey: key,
    enabled: on,
    refetchOnWindowFocus: true,
    queryFn: () => fetchMyAvailability(userId as string),
  });
  useLiveMapPing(on);
  const [saving, setSaving] = useState(false);

  const setAvailable = useCallback(
    async (next: boolean): Promise<AvailabilityResult> => {
      if (!userId) return { ok: false, reason: "no_user" };
      const k = myAvailabilityKey(userId);
      const prev = qc.getQueryData<boolean | null>(k);
      await qc.cancelQueries({ queryKey: k });
      qc.setQueryData(k, next);
      setSaving(true);
      try {
        const res = await saveMyAvailability(userId, next);
        qc.setQueryData(k, res.ok ? res.available : (prev ?? null));
        return res;
      } catch (e) {
        qc.setQueryData(k, prev ?? null);
        return { ok: false, reason: e instanceof Error ? e.message : "error" };
      } finally {
        setSaving(false);
      }
    },
    [qc, userId],
  );

  return {
    available: Boolean(query.data),
    hasProfile: query.data !== null && query.data !== undefined,
    loading: query.isLoading,
    saving,
    setAvailable,
    refetch: query.refetch,
  };
}
