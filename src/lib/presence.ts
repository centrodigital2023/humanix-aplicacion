// Presencia en vivo: cuándo una cuenta cuenta como «en vivo», cómo se aproxima una posición y cuándo vale la pena avisar al servidor.
//
// Espejo de la migración 20261012210000_live_map.sql (`hx_cell`, `hx_presence_ttl`, límites de `touch_presence`). El servidor es el que
// decide y aproxima de verdad; esto evita viajes inútiles y da los mismos números a la pantalla. `presence.test.ts` compara las
// constantes con el texto de la migración.

/** Lado de la cuadrícula en grados (≈ 1,1 km). Nunca se publica una posición más fina. */
export const CELL_DEGREES = 0.01;
/** Cada cuánto late una cuenta con la aplicación abierta. */
export const HEARTBEAT_MS = 60_000;
/** Cuánto vale un latido (igual que `hx_presence_ttl()`). */
export const PRESENCE_TTL_MS = 3 * 60_000;
/** Mismos límites que `touch_presence` (Colombia y alrededores). */
export const COLOMBIA_BOUNDS = { latMin: -5, latMax: 14, lngMin: -82, lngMax: -66 } as const;

export interface LatLng {
  lat: number;
  lng: number;
}

export function validPosition(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const b = COLOMBIA_BOUNDS;
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

/**
 * Espejo de `hx_cell`: redondea a la cuadrícula y limpia el error de los decimales binarios (0,01 → 2 decimales; 0,005 → 3).
 * En un empate exacto el servidor redondea «alejándose del cero» y esto «hacia arriba»: no importa, solo sirve para saber si
 * se cambió de cuadrícula; la que se guarda es la del servidor.
 */
export function toCell(value: number, size = CELL_DEGREES): number {
  const decimals = (String(size).split(".")[1] ?? "").length;
  return Number((Math.round(value / size) * size).toFixed(decimals));
}

export function cellOf(p: LatLng, size = CELL_DEGREES): LatLng {
  return { lat: toCell(p.lat, size), lng: toCell(p.lng, size) };
}

export interface SentPosition extends LatLng {
  /** Marca de tiempo (ms) del último envío. */
  at: number;
}

/**
 * ¿Vale la pena avisar al servidor? Sí si es la primera posición, si cambió de cuadrícula o si ya pasó el intervalo de latido.
 * Moverse dentro de la misma cuadrícula no cambia nada de lo que ve el mapa.
 */
export function shouldSendPosition(
  prev: SentPosition | null,
  next: LatLng,
  now: number,
  heartbeatMs = HEARTBEAT_MS,
): boolean {
  if (!prev) return true;
  const a = cellOf(prev);
  const b = cellOf(next);
  if (a.lat !== b.lat || a.lng !== b.lng) return true;
  return now - prev.at >= heartbeatMs;
}

/** ¿El último latido sigue vigente? */
export function isLive(
  lastSeen: string | number | Date | null | undefined,
  now = Date.now(),
  ttlMs = PRESENCE_TTL_MS,
): boolean {
  if (lastSeen == null) return false;
  const t =
    lastSeen instanceof Date
      ? lastSeen.getTime()
      : typeof lastSeen === "number"
        ? lastSeen
        : Date.parse(lastSeen);
  return Number.isFinite(t) && now - t < ttlMs;
}

/**
 * Cuántos milisegundos faltan para que el primer «en vivo» de la lista deje de serlo (para recargar justo entonces, sin sondeo).
 * Nulo si nadie está en vivo. Mínimo 1 s para no entrar en un ciclo de recargas.
 */
export function nextLiveExpiry(
  rows: Array<{ live: boolean; lastSeen?: string | null }>,
  now = Date.now(),
  ttlMs = PRESENCE_TTL_MS,
): number | null {
  let best: number | null = null;
  for (const r of rows) {
    if (!r.live) continue;
    // Sin hora del último latido (las instituciones no la traen): se vuelve a mirar dentro de un plazo completo.
    const t = r.lastSeen ? Date.parse(r.lastSeen) : now;
    if (!Number.isFinite(t)) continue;
    const left = t + ttlMs - now;
    if (best == null || left < best) best = left;
  }
  return best == null ? null : Math.max(best, 1_000);
}
