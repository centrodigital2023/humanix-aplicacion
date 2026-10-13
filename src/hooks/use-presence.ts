// Presencia propia («en vivo») y, para profesionales que lo deciden, posición aproximada. Reemplaza al hook antiguo `use-live-presence`
// (que guardaba el GPS exacto y lo dejaba leer a cualquiera): ahora todo pasa por `touch_presence` / `stop_presence` y el servidor
// aproxima la posición a una cuadrícula de ~1 km. La lógica está en `lib/presenceManager.ts`; aquí solo se conecta con el navegador y
// con Supabase. Hay UNA instancia por pestaña: todos los componentes que usan este hook comparten latido y estado.

import { useEffect, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  createPresenceManager,
  type PresenceDeps,
  type PresenceManager,
  type PresenceState,
} from "@/lib/presenceManager";

const sb = supabase as unknown as SupabaseClient;

const SERVER_STATE: PresenceState = { sharing: false, error: null };

function geolocation(): PresenceDeps["geolocation"] {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return {
    watch: (ok, fail) =>
      navigator.geolocation.watchPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) =>
          fail(
            e.code === e.PERMISSION_DENIED
              ? "No diste permiso de ubicación: tu zona sale desde tu perfil."
              : "No pudimos leer tu ubicación.",
          ),
        // Posición de baja precisión y con memoria de medio minuto: al mapa solo llega una cuadrícula de ~1 km.
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 },
      ),
    clear: (id) => navigator.geolocation.clearWatch(id as number),
  };
}

let manager: PresenceManager | null = null;
function getManager(): PresenceManager {
  if (manager) return manager;
  manager = createPresenceManager({
    touch: async (lat, lng) => {
      const { error } = await sb.rpc("touch_presence", { p_lat: lat, p_lng: lng });
      return error ? { code: error.code } : null;
    },
    stop: async () => {
      await sb.rpc("stop_presence");
    },
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    isVisible: () => document.visibilityState === "visible",
    onVisible: (cb) => {
      const h = () => {
        if (document.visibilityState === "visible") cb();
      };
      document.addEventListener("visibilitychange", h);
      return () => document.removeEventListener("visibilitychange", h);
    },
    onPageHide: (cb) => {
      window.addEventListener("pagehide", cb);
      return () => window.removeEventListener("pagehide", cb);
    },
    get geolocation() {
      return geolocation();
    },
  });
  return manager;
}

/**
 * Marca a la cuenta como «en vivo» mientras el componente esté montado y la pestaña a la vista.
 * `enabled` debe ser falso para cuentas que no son profesional, familia ni institución (el servidor las ignora de todos modos).
 */
export function usePresence({
  userId,
  enabled = true,
}: {
  userId: string | null | undefined;
  enabled?: boolean;
}) {
  const active = !!userId && enabled && typeof window !== "undefined";
  useEffect(() => {
    if (!active) return;
    return getManager().attach();
  }, [active, userId]);

  const state = useSyncExternalStore(
    (l) => (typeof window === "undefined" ? () => {} : getManager().subscribe(l)),
    () => (typeof window === "undefined" ? SERVER_STATE : getManager().getState()),
    () => SERVER_STATE,
  );

  return {
    isSharing: state.sharing,
    error: state.error,
    /** Comparte la posición aproximada (pide permiso de ubicación). `false` si el aparato no tiene ubicación. */
    startSharing: () => (active ? getManager().startSharing() : false),
    stopSharing: () => getManager().stopSharing(),
  };
}
