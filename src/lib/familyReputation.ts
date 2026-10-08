// Reputación de una familia vista por los profesionales — solo agregados, nunca comentarios.
//
// El servidor (`family_reputation`) ya aplica el mínimo de 3 calificaciones por dimensión; aquí se
// convierte esa respuesta en etiquetas y señales para el match. Los comentarios de texto son
// privados: solo los ve la familia calificada y el equipo de Humanix.

import { RATING_DIMENSIONS } from "./ratingDimensions";
import type { FamilySignal } from "./opportunities";

export const MIN_RATINGS_TO_SHOW = 3;

export interface FamilyReputationRaw {
  ratings_count: number | null;
  stars_avg: number | null;
  completed_services: number | null;
  dimensions: Array<{ dimension: string; average: number; ratings: number }> | null;
}

export type ReputationLevel = "new" | "reliable" | "mixed" | "caution";

export interface FamilyReputation {
  ratings: number;
  completedServices: number;
  stars: number | null;
  level: ReputationLevel;
  label: string;
  dimensions: Array<{ key: string; label: string; average: number; ratings: number }>;
  /** «Pago puntual» solo con evidencia suficiente en la dimensión de pago. */
  reliablePayer: boolean;
}

export function reputationLevel(stars: number | null, ratings: number): ReputationLevel {
  if (stars == null || ratings < MIN_RATINGS_TO_SHOW) return "new";
  if (stars >= 4.3) return "reliable";
  if (stars >= 3.5) return "mixed";
  return "caution";
}

const LEVEL_LABEL: Record<ReputationLevel, string> = {
  new: "Familia nueva en Humanix",
  reliable: "Familia de confianza",
  mixed: "Reputación mixta",
  caution: "Reputación baja: revisa los detalles",
};

export function summarizeFamilyReputation(
  raw: FamilyReputationRaw | null | undefined,
): FamilyReputation {
  const ratings = Math.max(0, raw?.ratings_count ?? 0);
  const stars =
    ratings >= MIN_RATINGS_TO_SHOW && raw?.stars_avg != null ? Number(raw.stars_avg) : null;
  const order = RATING_DIMENSIONS.professional;
  const byKey = new Map((raw?.dimensions ?? []).map((d) => [d.dimension, d]));
  const dimensions = order.flatMap((d) => {
    const row = byKey.get(d.key);
    return row && row.ratings >= MIN_RATINGS_TO_SHOW
      ? [{ key: d.key, label: d.label, average: Number(row.average), ratings: row.ratings }]
      : [];
  });
  const level = reputationLevel(stars, ratings);
  const payment = dimensions.find((d) => d.key === "payment");
  return {
    ratings,
    completedServices: Math.max(0, raw?.completed_services ?? 0),
    stars,
    level,
    label: LEVEL_LABEL[level],
    dimensions,
    reliablePayer: !!payment && payment.average >= 4.5,
  };
}

export function toFamilySignal(rep: FamilyReputation): FamilySignal {
  return { stars: rep.stars, ratings: rep.ratings };
}
