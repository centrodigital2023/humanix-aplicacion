// Profesionales del mapa (familias e IPS/EPS) con los MISMOS datos validados del buscador: lógica pura y probada (`mapDirectory.test.ts`).
//
// `map_professionals` decide quién está publicado, su estado y su posición aproximada; `public_professionals` decide qué nombre está
// autorizado a ver quien mira. Un pin solo se muestra si su fila del directorio pasa `searchProfessionalDetails` (nombre real, ciudad y
// turnos): así el mapa, la lista «cerca de ti» y el buscador nunca muestran «Profesional» sin nombre ni perfiles a medias.
//
// «Disponible» vive en el perfil (no en el aparato): sigue encendido aunque el profesional cierre Humanix o apague el celular.
// «En vivo» es otra cosa: la aplicación abierta en este momento.
import type { MapProfessional } from "./liveMap";
import { searchProfessionalDetails, type PublicProfessional } from "./publicProfessionals";

export type DirectoryRow = Pick<
  PublicProfessional,
  "user_id" | "full_name" | "home_city" | "service_cities" | "total_jobs"
>;

export interface ValidatedMapProfessional extends MapProfessional {
  city: string;
  turns: number;
}

/** Solo los profesionales del mapa con fila validada en el directorio; nombre y ciudad salen del directorio. */
export function validatedMapProfessionals(
  map: readonly MapProfessional[],
  directory: readonly DirectoryRow[],
): ValidatedMapProfessional[] {
  const byId = new Map(directory.map((d) => [d.user_id, d]));
  const out: ValidatedMapProfessional[] = [];
  for (const p of map) {
    const row = byId.get(p.id);
    const details = row ? searchProfessionalDetails(row) : null;
    if (!details) continue;
    out.push({ ...p, name: details.name, city: details.city, turns: details.turns });
  }
  return out;
}

/** Clave estable de la consulta al directorio: los mismos ids en otro orden no vuelven a pedir. */
export function directoryIdsKey(map: readonly Pick<MapProfessional, "id">[]): string {
  return [...new Set(map.map((p) => p.id))].sort().join(",");
}

/** Selection always reads the latest authorized pin, never a retained location or availability. */
export function currentMapSelection<T extends { id: string }>(
  pins: readonly T[],
  id: string | null,
): T | null {
  return id === null ? null : (pins.find((pin) => pin.id === id) ?? null);
}

/** «Enfermería · Pasto · 12 turnos» */
export function proSubtitle(
  p: Pick<ValidatedMapProfessional, "specialty" | "city" | "turns">,
): string {
  const turns =
    p.turns === 0 ? "Nuevo en Humanix" : `${p.turns} ${p.turns === 1 ? "turno" : "turnos"}`;
  return [p.specialty?.trim() || "Cuidado en casa", p.city, turns].join(" · ");
}

/** Hace cuánto se conectó, en palabras. Nulo si no hay dato o la fecha es inválida. */
export function lastSeenText(lastSeen: string | null | undefined, now: number): string | null {
  if (!lastSeen) return null;
  const t = Date.parse(lastSeen);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / 60_000));
  if (min < 60) return "hace unos minutos";
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} ${h === 1 ? "hora" : "horas"}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? "día" : "días"}`;
  return "hace más de un mes";
}

/**
 * Cómo está el profesional ahora, para quien lo busca:
 *  - con la aplicación abierta: «En vivo ahora»;
 *  - disponible pero sin la aplicación abierta: «Disponible · se conectó hace 3 horas» (sigue recibiendo solicitudes);
 *  - ocupado o no disponible: nulo (el estado ya lo dice).
 */
export function presenceLine(
  p: Pick<MapProfessional, "status" | "live" | "lastSeen">,
  now: number,
): string | null {
  if (p.status !== "available") return null;
  if (p.live) return "En vivo ahora";
  const seen = lastSeenText(p.lastSeen, now);
  return seen ? `Disponible · se conectó ${seen}` : "Disponible · recibe tu solicitud en la app";
}
