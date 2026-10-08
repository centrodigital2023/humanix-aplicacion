import { describe, it, expect } from "vitest";
import {
  reputationLevel,
  summarizeFamilyReputation,
  toFamilySignal,
  type FamilyReputationRaw,
} from "./familyReputation";

const raw = (o: Partial<FamilyReputationRaw> = {}): FamilyReputationRaw => ({
  ratings_count: 8,
  stars_avg: 4.6,
  completed_services: 11,
  dimensions: [
    { dimension: "payment", average: 4.8, ratings: 8 },
    { dimension: "clarity", average: 4.2, ratings: 8 },
    { dimension: "treatment", average: 4.9, ratings: 2 },
  ],
  ...o,
});

describe("summarizeFamilyReputation", () => {
  it("una familia sin datos es «nueva», no «mala»", () => {
    const r = summarizeFamilyReputation(null);
    expect(r).toMatchObject({
      ratings: 0,
      stars: null,
      level: "new",
      label: "Familia nueva en Humanix",
      dimensions: [],
      reliablePayer: false,
    });
  });

  it("no muestra promedios con menos de 3 calificaciones", () => {
    const r = summarizeFamilyReputation(raw({ ratings_count: 2, stars_avg: 5 }));
    expect(r.stars).toBeNull();
    expect(r.level).toBe("new");
  });

  it("ordena las dimensiones como la calificación y oculta las de poca muestra", () => {
    const r = summarizeFamilyReputation(raw());
    expect(r.dimensions.map((d) => d.key)).toEqual(["clarity", "payment"]);
    expect(r.dimensions[1]).toMatchObject({ label: "Cumplimiento del pago", average: 4.8 });
    expect(r.reliablePayer).toBe(true);
    expect(r.level).toBe("reliable");
    expect(r.completedServices).toBe(11);
  });

  it("«pago puntual» exige evidencia en la dimensión de pago", () => {
    const r = summarizeFamilyReputation(
      raw({ dimensions: [{ dimension: "payment", average: 4.4, ratings: 9 }] }),
    );
    expect(r.reliablePayer).toBe(false);
    const few = summarizeFamilyReputation(
      raw({ dimensions: [{ dimension: "payment", average: 5, ratings: 2 }] }),
    );
    expect(few.reliablePayer).toBe(false);
  });

  it("clasifica el nivel por estrellas", () => {
    expect(reputationLevel(4.3, 5)).toBe("reliable");
    expect(reputationLevel(3.9, 5)).toBe("mixed");
    expect(reputationLevel(3.2, 5)).toBe("caution");
    expect(reputationLevel(5, 2)).toBe("new");
    expect(reputationLevel(null, 10)).toBe("new");
  });

  it("entrega la señal que usa el match", () => {
    expect(toFamilySignal(summarizeFamilyReputation(raw()))).toEqual({ stars: 4.6, ratings: 8 });
  });
});
