// Mapa de los profesionales: familias e instituciones. Lógica pura y probada (`proMapDemand.test.ts`).
//
// - Familias e instituciones con ofertas u horas abiertas llegan por `map_open_demand` (zona aproximada, ~1 km).
// - Las instituciones visibles SIN turnos abiertos también se muestran (`map_institutions`): son empresas, y el profesional las conoce
//   antes de que publiquen. Las familias sin solicitud abierta NO se muestran: la ubicación de un hogar con un paciente solo se comparte
//   mientras ese hogar está pidiendo ayuda (lo que promete `FamilyMapVisibility`).
// - Una solicitud sin ninguna ubicación no puede ser un punto (no se inventa un sitio), pero tampoco se pierde: va a una lista aparte.
import type { MapDemand, MapInstitution } from "./liveMap";

const hasPos = (p: { lat: number | null; lng: number | null }) =>
  p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** Instituciones con ubicación que no salen ya como solicitud abierta (para no repetir el punto). */
export function idleInstitutions(
  institutions: readonly MapInstitution[],
  demand: readonly Pick<MapDemand, "id" | "kind">[],
): MapInstitution[] {
  const withDemand = new Set(demand.filter((d) => d.kind === "institution").map((d) => d.id));
  return institutions.filter((i) => hasPos(i) && !withDemand.has(i.id));
}

/** Solicitudes abiertas sin ubicación: urgentes primero, luego la mejor tarifa. */
export function unplacedDemand(demand: readonly MapDemand[]): MapDemand[] {
  return demand
    .filter((d) => !hasPos(d))
    .sort(
      (a, b) =>
        Number(b.urgent) - Number(a.urgent) ||
        (b.topHourly ?? 0) - (a.topHourly ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

/** Ciudad para mostrar: los textos de relleno («No especificada…», «A convenir») no son una ciudad. */
export function displayCity(city: string | null | undefined): string | null {
  const c = (city ?? "").trim();
  if (!c || /^(no especificad|a convenir|sin ciudad|n\/a|colombia$)/i.test(c)) return null;
  return c;
}
