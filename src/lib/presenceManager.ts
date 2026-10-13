// Administrador de la presencia propia: late mientras la aplicación está abierta y a la vista y, solo si la persona lo decide
// (profesionales), envía su posición — que el servidor aproxima a una cuadrícula de ~1 km.
//
// Sin dependencias del navegador ni de Supabase (se inyectan): así se prueba con relojes y ubicaciones falsas. Hay UNA instancia por
// pestaña (la crea `use-presence.ts`); todos los componentes que la usan comparten el mismo latido y el mismo estado.
//
// Reglas (ver la migración 20261012210000_live_map.sql):
//   • un latido cada minuto mientras la pestaña está visible; si se oculta se deja de latir (el servidor da por apagada la presencia a
//     los 3 minutos) y al volver se late de inmediato;
//   • la posición solo se envía si cambió de cuadrícula o si ya toca el latido (no por cada metro);
//   • al cerrar la pestaña o irse el último componente se avisa «me fui» (el servidor borra la posición).

import {
  HEARTBEAT_MS,
  cellOf,
  shouldSendPosition,
  validPosition,
  type LatLng,
  type SentPosition,
} from "./presence";

export interface PresenceState {
  /** Está compartiendo su posición aproximada. */
  sharing: boolean;
  /** Último problema que la persona puede arreglar (permiso de ubicación, sin GPS). */
  error: string | null;
}

export interface PresenceDeps {
  /** Latido: `null` en las coordenadas = sin posición. Devuelve el código de error de la base, si lo hubo. */
  touch(lat: number | null, lng: number | null): Promise<{ code?: string } | null>;
  stop(): Promise<void>;
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  isVisible(): boolean;
  onVisible(cb: () => void): () => void;
  onPageHide(cb: () => void): () => void;
  /** Nulo si el aparato no tiene ubicación. */
  geolocation: {
    watch(ok: (p: LatLng) => void, fail: (message: string) => void): unknown;
    clear(id: unknown): void;
  } | null;
}

/** Códigos que significan «la base no puede recibir presencia»: no se insiste (falta la función o no hay sesión). */
const GIVE_UP = new Set(["42883", "PGRST202", "42501", "28000"]);

export function createPresenceManager(deps: PresenceDeps) {
  let state: PresenceState = { sharing: false, error: null };
  const subscribers = new Set<() => void>();
  let attached = 0;
  let timer: unknown = null;
  let watchId: unknown = null;
  let position: LatLng | null = null;
  let sent: SentPosition | null = null;
  let givenUp = false;
  let offVisible: (() => void) | null = null;
  let offPageHide: (() => void) | null = null;

  const set = (patch: Partial<PresenceState>) => {
    state = { ...state, ...patch };
    subscribers.forEach((l) => l());
  };

  async function send(lat: number | null, lng: number | null) {
    if (givenUp) return;
    // El punto exacto no sale del aparato: se aproxima a la cuadrícula de ~1 km antes de enviarlo (el servidor la vuelve a aproximar).
    const cell = lat != null && lng != null ? cellOf({ lat, lng }) : null;
    const err = await deps
      .touch(cell?.lat ?? null, cell?.lng ?? null)
      .catch(() => ({ code: "network" }));
    if (err?.code && GIVE_UP.has(err.code)) givenUp = true;
    if (!err) sent = cell ? { ...cell, at: deps.now() } : null;
  }

  /** Latido normal: con la posición compartida si se está compartiendo. */
  function beat() {
    if (!deps.isVisible()) return;
    void send(
      state.sharing && position ? position.lat : null,
      state.sharing && position ? position.lng : null,
    );
  }

  function onPosition(p: LatLng) {
    if (!validPosition(p.lat, p.lng)) {
      set({ error: "La ubicación está fuera de Colombia: no se comparte." });
      return;
    }
    position = p;
    if (state.error) set({ error: null });
    if (state.sharing && shouldSendPosition(sent, p, deps.now())) void send(p.lat, p.lng);
  }

  function start() {
    givenUp = false;
    void send(null, null);
    timer = deps.setInterval(beat, HEARTBEAT_MS);
    offVisible = deps.onVisible(beat);
    offPageHide = deps.onPageHide(() => {
      void deps.stop();
    });
  }

  function shutdown() {
    if (timer != null) deps.clearInterval(timer);
    timer = null;
    offVisible?.();
    offPageHide?.();
    offVisible = offPageHide = null;
    if (watchId != null && deps.geolocation) deps.geolocation.clear(watchId);
    watchId = null;
    position = null;
    sent = null;
    state = { sharing: false, error: null };
    subscribers.forEach((l) => l());
    void deps.stop();
  }

  return {
    /** Un componente empieza a usar la presencia. Devuelve cómo dejar de usarla. */
    attach(): () => void {
      attached += 1;
      if (attached === 1) start();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        attached -= 1;
        if (attached === 0) shutdown();
      };
    },
    getState: () => state,
    subscribe(listener: () => void): () => void {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    /** Empieza a compartir la posición aproximada. `false` si el aparato no tiene ubicación. */
    startSharing(): boolean {
      if (attached === 0) return false;
      if (!deps.geolocation) {
        set({ error: "Este aparato no tiene ubicación." });
        return false;
      }
      if (state.sharing) return true;
      set({ sharing: true, error: null });
      watchId = deps.geolocation.watch(onPosition, (message) => {
        // Sin permiso o sin señal: se deja de compartir, pero se sigue «en vivo».
        if (watchId != null && deps.geolocation) deps.geolocation.clear(watchId);
        watchId = null;
        position = null;
        set({ sharing: false, error: message });
        void send(null, null);
      });
      return true;
    },
    /** Deja de compartir la posición (sigue «en vivo», sin sitio). */
    stopSharing() {
      if (watchId != null && deps.geolocation) deps.geolocation.clear(watchId);
      watchId = null;
      position = null;
      sent = null;
      if (state.sharing || state.error) set({ sharing: false, error: null });
      if (attached > 0) void send(null, null);
    },
  };
}

export type PresenceManager = ReturnType<typeof createPresenceManager>;
