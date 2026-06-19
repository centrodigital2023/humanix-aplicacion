import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveLocation = {
  userId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  isOnline: boolean;
  userType: "professional" | "family" | "institution" | null;
  updatedAt: string;
};

type Options = {
  /** ID del usuario autenticado (undefined = solo lectura) */
  userId?: string;
  /** Tipo de perfil del usuario actual */
  userType?: "professional" | "family" | "institution";
  /** Cargar y suscribirse a todas las ubicaciones en vivo (default true) */
  loadAll?: boolean;
};

/** Mínimo de ms entre upserts GPS consecutivos a Supabase */
const GPS_THROTTLE_MS = 3000;

/**
 * Hook de presencia en vivo estilo Uber/InDrive.
 *
 * - Carga todas las ubicaciones online desde `user_locations`
 * - Suscribe a postgres_changes para recibir movimientos en tiempo real
 * - startTracking(): activa watchPosition → upsert a `user_locations` throttled
 * - stopTracking(): cancela el watch y marca al usuario como offline
 */
export function useLivePresence({ userId, userType, loadAll = true }: Options) {
  const [liveLocations, setLiveLocations] = useState<Map<string, LiveLocation>>(new Map());
  const [isTracking, setIsTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const lastUpsertRef = useRef<number>(0);

  // ── Carga inicial + suscripción realtime ──────────────────────────────────
  useEffect(() => {
    if (!loadAll) return;

    const loadOnline = async () => {
      const { data } = await (supabase as any)
        .from("user_locations")
        .select("user_id, lat, lng, accuracy, heading, speed, is_online, user_type, updated_at")
        .eq("is_online", true);

      if (!data) return;
      setLiveLocations(() => {
        const m = new Map<string, LiveLocation>();
        for (const row of data) m.set(row.user_id, rowToLocation(row));
        return m;
      });
    };

    loadOnline();

    const suffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`humanix-live-locations-${suffix}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "user_locations" },
        (payload: any) => {
          const newRow = payload.new as any;
          const oldId = (payload.old as any)?.user_id;

          if (payload.eventType === "DELETE") {
            setLiveLocations((prev) => {
              const next = new Map(prev);
              if (oldId) next.delete(oldId);
              return next;
            });
            return;
          }

          if (!newRow) return;

          if (newRow.is_online === false) {
            setLiveLocations((prev) => {
              const next = new Map(prev);
              next.delete(newRow.user_id);
              return next;
            });
          } else {
            setLiveLocations((prev) => {
              const next = new Map(prev);
              next.set(newRow.user_id, rowToLocation(newRow));
              return next;
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [loadAll]);

  // ── Activar seguimiento GPS en vivo ───────────────────────────────────────
  const startTracking = useCallback(async () => {
    if (!userId || !userType) return;
    if (watchIdRef.current !== null) return; // ya activo
    if (!navigator.geolocation) return;

    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastUpsertRef.current < GPS_THROTTLE_MS) return;
        lastUpsertRef.current = now;

        await (supabase as any).from("user_locations").upsert(
          {
            user_id: userId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            heading: pos.coords.heading ?? null,
            speed: pos.coords.speed ?? null,
            is_online: true,
            user_type: userType,
          },
          { onConflict: "user_id" },
        );
      },
      (err) => console.warn("[LivePresence] GPS watch error:", err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
    );
  }, [userId, userType]);

  // ── Detener seguimiento GPS ───────────────────────────────────────────────
  const stopTracking = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    if (userId) {
      await (supabase as any)
        .from("user_locations")
        .update({ is_online: false })
        .eq("user_id", userId);
    }
  }, [userId]);

  // ── Marcar offline al cerrar la pestaña ──────────────────────────────────
  useEffect(() => {
    if (!userId) return;

    const markOffline = () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      void (supabase as any)
        .from("user_locations")
        .update({ is_online: false })
        .eq("user_id", userId);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") markOffline();
    };

    window.addEventListener("beforeunload", markOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("beforeunload", markOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId]);

  // ── Limpiar watch al desmontar ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { liveLocations, isTracking, startTracking, stopTracking };
}

function rowToLocation(row: any): LiveLocation {
  return {
    userId: row.user_id,
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy: row.accuracy ?? null,
    heading: row.heading ?? null,
    speed: row.speed ?? null,
    isOnline: row.is_online,
    userType: row.user_type ?? null,
    updatedAt: row.updated_at,
  };
}
