export type RaterRole = "family" | "professional";

export const RATING_DIMENSIONS: Record<RaterRole, Array<{ key: string; label: string }>> = {
  family: [
    { key: "punctuality", label: "Puntualidad" },
    { key: "treatment", label: "Trato humano" },
    { key: "compliance", label: "Cumplimiento del servicio" },
    { key: "communication", label: "Comunicación" },
  ],
  professional: [
    { key: "clarity", label: "Claridad de la solicitud" },
    { key: "treatment", label: "Trato" },
    { key: "payment", label: "Cumplimiento del pago" },
    { key: "environment", label: "Condiciones del entorno" },
  ],
};

export const DIMENSION_LABELS: Record<string, string> = Object.fromEntries(
  [...RATING_DIMENSIONS.family, ...RATING_DIMENSIONS.professional].map((d) => [d.key, d.label]),
);

export function isCompleteScores(role: RaterRole, scores: Record<string, number>): boolean {
  return RATING_DIMENSIONS[role].every((d) => Number.isInteger(scores[d.key]) && scores[d.key] >= 1 && scores[d.key] <= 5);
}
