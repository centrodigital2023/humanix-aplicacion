import { describe, expect, it } from "vitest";
import {
  summarizeInstitutionReputation,
  type InstitutionReputationRaw,
} from "./institutionReputation";

const raw = (o: Partial<InstitutionReputationRaw> = {}): InstitutionReputationRaw => ({
  ratings_count: 8,
  stars_avg: 4.6,
  completed_services: 20,
  dimensions: [
    { dimension: "payment", average: 4.8, ratings: 8 },
    { dimension: "environment", average: 4.1, ratings: 5 },
    { dimension: "treatment", average: 4.9, ratings: 2 },
  ],
  ...o,
});

describe("summarizeInstitutionReputation", () => {
  it("una institución sin datos es «nueva», no «mala»", () => {
    expect(summarizeInstitutionReputation(null)).toMatchObject({
      ratings: 0,
      stars: null,
      level: "new",
      label: "Institución nueva en Humanix",
      dimensions: [],
      reliablePayer: false,
    });
  });

  it("no muestra promedios con menos de 3 calificaciones", () => {
    const r = summarizeInstitutionReputation(raw({ ratings_count: 2, stars_avg: 5 }));
    expect(r.stars).toBeNull();
    expect(r.level).toBe("new");
  });

  it("nombra y ordena las dimensiones propias de una institución y oculta las de poca muestra", () => {
    const r = summarizeInstitutionReputation(raw());
    expect(r.dimensions.map((d) => d.label)).toEqual([
      "Cumplimiento del pago",
      "Ambiente y bioseguridad",
    ]);
    expect(r.reliablePayer).toBe(true);
    expect(r.level).toBe("reliable");
    expect(r.completedServices).toBe(20);
  });

  it("clasifica por calificación", () => {
    expect(summarizeInstitutionReputation(raw({ stars_avg: 3.8 })).level).toBe("mixed");
    expect(summarizeInstitutionReputation(raw({ stars_avg: 2.9 })).level).toBe("caution");
    expect(
      summarizeInstitutionReputation(
        raw({ dimensions: [{ dimension: "payment", average: 4.0, ratings: 9 }] }),
      ).reliablePayer,
    ).toBe(false);
  });
});
