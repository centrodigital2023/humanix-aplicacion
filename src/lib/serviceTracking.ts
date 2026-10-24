// Rastreo del profesional durante un servicio: cuándo se comparte y cada cuánto se envía. Lógica pura (`serviceTracking.test.ts`).
// La base lo impone igual (migración 20261024120000_map_verification.sql): solo se aceptan posiciones con el servicio «En camino»
// (`in_route`) o «Cuidando» (`in_progress`), y el cliente solo las lee mientras dure ese estado (Habeas Data, Ley 1581 de 2012).
import { distanceKm, type LatLng } from "./geo";

export const TRACKED_STATUSES = ["in_route", "in_progress"] as const;

/** ¿Este estado del servicio comparte la ubicación del profesional? */
export function isTrackedStatus(status: string | null | undefined): boolean {
  return (TRACKED_STATUSES as readonly string[]).includes(status ?? "");
}

/** Un envío como mucho cada 15 s; antes del minuto, solo si se movió al menos 25 m. */
export const PING_MIN_MS = 15_000;
export const PING_MAX_MS = 60_000;
export const PING_MIN_METERS = 25;

export interface SentPing extends LatLng {
  at: number;
}

/** ¿Se envía esta lectura del GPS? Evita llenar la tabla con lecturas casi iguales. */
export function shouldSendPing(prev: SentPing | null, next: LatLng, now: number): boolean {
  if (!prev) return true;
  const elapsed = now - prev.at;
  if (elapsed < PING_MIN_MS) return false;
  if (elapsed >= PING_MAX_MS) return true;
  return distanceKm(prev, next) * 1000 >= PING_MIN_METERS;
}

/** Texto para quien espera la ubicación, según el estado del servicio. */
export function trackingWaitText(status: string, isProfessional: boolean): string {
  if (isProfessional) {
    if (status === "in_route") return "Compartiendo tu ubicación mientras vas en camino";
    if (status === "in_progress") return "Compartiendo tu ubicación mientras cuidas";
    return "Tu ubicación se comparte solo cuando marques «En camino»";
  }
  if (status === "in_route" || status === "in_progress")
    return "Esperando la primera ubicación del profesional…";
  return "Verás al profesional en el mapa cuando salga hacia el servicio";
}
