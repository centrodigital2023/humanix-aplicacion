// Cómo ven los profesionales a la institución — lógica pura.
//
// Con la reputación agregada que el servidor ya publica (promedio y cuatro dimensiones, solo con 3 calificaciones o más)
// arma un resumen para la propia institución: su nivel, en qué es más fuerte, en qué puede mejorar y un consejo
// concreto por dimensión. Los comentarios de texto siguen privados: aquí solo hay agregados. No inventa promedios con
// muestra pequeña ni compara con otras instituciones.

import { MIN_RATINGS_TO_SHOW } from "./familyReputation";
import { plural } from "./intelShared";
import {
  summarizeInstitutionReputation,
  type InstitutionReputation,
  type InstitutionReputationRaw,
} from "./institutionReputation";

/** Promedio por debajo del cual se ofrece un consejo. */
export const TIP_BELOW = 4.5;
/** Cuántos consejos se muestran como máximo. */
export const MAX_TIPS = 2;

export const EMPLOYER_TIPS: Record<string, string> = {
  clarity:
    "Describe cada turno con claridad: funciones, número de pacientes, horario real y a quién reportarse al llegar.",
  treatment:
    "Presenta al profesional con el equipo desde el primer día y asígnale una persona de referencia durante el turno.",
  payment:
    "Cumple los tiempos de pago acordados: es justamente lo que los profesionales califican en esta dimensión.",
  environment:
    "Cuida la bioseguridad: entrega elementos de protección personal y un lugar donde descansar durante el turno.",
};

export interface EmployerDimension {
  key: string;
  label: string;
  average: number;
  ratings: number;
}

export interface EmployerTip {
  key: string;
  label: string;
  average: number;
  tip: string;
}

export interface EmployerReport {
  reputation: InstitutionReputation;
  /** Hay algo que mostrar (promedio o alguna dimensión con muestra suficiente). */
  hasData: boolean;
  /** Cuántas calificaciones faltan para mostrar el promedio (0 si ya se muestra). */
  ratingsToUnlock: number;
  strongest: EmployerDimension | null;
  weakest: EmployerDimension | null;
  tips: EmployerTip[];
  headline: string;
}

const fmt = (n: number) => n.toFixed(1).replace(".", ",");

export function buildEmployerReport(
  raw: InstitutionReputationRaw | null | undefined,
): EmployerReport {
  const reputation = summarizeInstitutionReputation(raw);
  const dims = reputation.dimensions;
  const hasData = reputation.stars !== null || dims.length > 0;
  const ratingsToUnlock =
    reputation.stars !== null ? 0 : Math.max(0, MIN_RATINGS_TO_SHOW - reputation.ratings);

  // Con una sola dimensión no hay «más fuerte» ni «más débil»: no se comparan consigo misma.
  let strongest: EmployerDimension | null = null;
  let weakest: EmployerDimension | null = null;
  if (dims.length >= 2) {
    // `dims` ya viene en el orden fijo de las dimensiones: el primero gana los empates.
    strongest = dims.reduce((a, b) => (b.average > a.average ? b : a));
    const low = dims.reduce((a, b) => (b.average < a.average ? b : a));
    weakest = low.average < strongest.average ? low : null;
  }

  const tips: EmployerTip[] = dims
    .filter((d) => d.average < TIP_BELOW && EMPLOYER_TIPS[d.key])
    .sort((a, b) => a.average - b.average)
    .slice(0, MAX_TIPS)
    .map((d) => ({ key: d.key, label: d.label, average: d.average, tip: EMPLOYER_TIPS[d.key] }));

  let headline: string;
  if (reputation.stars !== null) {
    headline = `${fmt(reputation.stars)} de 5 según ${plural(reputation.ratings, "calificación", "calificaciones")} de profesionales.`;
  } else if (reputation.ratings >= MIN_RATINGS_TO_SHOW) {
    headline = `Tienes ${plural(reputation.ratings, "calificación", "calificaciones")}, pero el promedio aún no está disponible.`;
  } else if (reputation.ratings > 0) {
    headline = `Tienes ${plural(reputation.ratings, "calificación", "calificaciones")}: ${
      ratingsToUnlock === 1 ? "falta 1" : `faltan ${ratingsToUnlock}`
    } para mostrar tu promedio.`;
  } else {
    headline = "Aún no hay calificaciones de los profesionales.";
  }

  return { reputation, hasData, ratingsToUnlock, strongest, weakest, tips, headline };
}
