// Reputación de una institución vista por los profesionales — solo agregados, nunca comentarios.
//
// El servidor (`institution_reputation`) ya aplica el mínimo de 3 calificaciones por dimensión; aquí se
// convierte esa respuesta en etiquetas y señales. Los comentarios de texto son privados: solo los ve la
// institución calificada y el equipo de Humanix.

import {
  MIN_RATINGS_TO_SHOW,
  reputationLevel,
  type FamilyReputationRaw,
  type ReputationLevel,
} from "./familyReputation";

export type InstitutionReputationRaw = FamilyReputationRaw;

/** Las mismas cuatro dimensiones que califica el profesional, con nombres propios de una institución. */
export const INSTITUTION_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "clarity", label: "Claridad del turno" },
  { key: "treatment", label: "Trato del equipo" },
  { key: "payment", label: "Cumplimiento del pago" },
  { key: "environment", label: "Ambiente y bioseguridad" },
];

export interface InstitutionReputation {
  ratings: number;
  completedServices: number;
  stars: number | null;
  level: ReputationLevel;
  label: string;
  dimensions: Array<{ key: string; label: string; average: number; ratings: number }>;
  /** «Paga puntual» solo con evidencia suficiente en la dimensión de pago. */
  reliablePayer: boolean;
}

const LEVEL_LABEL: Record<ReputationLevel, string> = {
  new: "Institución nueva en Humanix",
  reliable: "Institución de confianza",
  mixed: "Reputación mixta",
  caution: "Reputación baja: revisa los detalles",
};

export function summarizeInstitutionReputation(
  raw: InstitutionReputationRaw | null | undefined,
): InstitutionReputation {
  const ratings = Math.max(0, raw?.ratings_count ?? 0);
  const stars =
    ratings >= MIN_RATINGS_TO_SHOW && raw?.stars_avg != null ? Number(raw.stars_avg) : null;
  const byKey = new Map((raw?.dimensions ?? []).map((d) => [d.dimension, d]));
  const dimensions = INSTITUTION_DIMENSIONS.flatMap((d) => {
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
