import { describe, expect, it } from "vitest";
import { EMPLOYER_TIPS, MAX_TIPS, TIP_BELOW, buildEmployerReport } from "./instEmployer";
import type { InstitutionReputationRaw } from "./institutionReputation";

const dim = (dimension: string, average: number, ratings = 5) => ({ dimension, average, ratings });
const raw = (over: Partial<InstitutionReputationRaw> = {}): InstitutionReputationRaw => ({
  ratings_count: 8,
  stars_avg: 4.6,
  completed_services: 20,
  dimensions: [
    dim("clarity", 4.8),
    dim("treatment", 4.9),
    dim("payment", 4.7),
    dim("environment", 4.2),
  ],
  ...over,
});

describe("sin calificaciones", () => {
  it("lo dice sin inventar y sin tratarlo como mala reputación", () => {
    for (const r of [
      buildEmployerReport(null),
      buildEmployerReport(undefined),
      buildEmployerReport(raw({ ratings_count: 0, stars_avg: null, dimensions: [] })),
    ]) {
      expect(r.hasData).toBe(false);
      expect(r.headline).toBe("Aún no hay calificaciones de los profesionales.");
      expect(r.ratingsToUnlock).toBe(3);
      expect(r.tips).toEqual([]);
      expect(r.strongest).toBeNull();
      expect(r.weakest).toBeNull();
    }
  });

  it("con 1 o 2 calificaciones dice cuántas faltan para mostrar el promedio", () => {
    const one = buildEmployerReport(raw({ ratings_count: 1, stars_avg: 5, dimensions: [] }));
    expect(one.headline).toBe("Tienes 1 calificación: faltan 2 para mostrar tu promedio.");
    expect(one.ratingsToUnlock).toBe(2);
    expect(one.hasData).toBe(false);
    const two = buildEmployerReport(raw({ ratings_count: 2, stars_avg: 4, dimensions: [] }));
    expect(two.headline).toBe("Tienes 2 calificaciones: falta 1 para mostrar tu promedio.");
    expect(two.ratingsToUnlock).toBe(1);
  });
});

describe("datos incompletos del servidor", () => {
  it("con 3 o más calificaciones pero sin promedio, no pide «faltan 0» ni inventa el promedio", () => {
    const r = buildEmployerReport(raw({ ratings_count: 5, stars_avg: null, dimensions: [] }));
    expect(r.reputation.stars).toBeNull();
    expect(r.ratingsToUnlock).toBe(0);
    expect(r.hasData).toBe(false);
    expect(r.headline).toBe("Tienes 5 calificaciones, pero el promedio aún no está disponible.");
  });

  it("con exactamente 3 calificaciones y sin promedio, tampoco pide «faltan 0»", () => {
    const r = buildEmployerReport(raw({ ratings_count: 3, stars_avg: null, dimensions: [] }));
    expect(r.headline).toBe("Tienes 3 calificaciones, pero el promedio aún no está disponible.");
  });

  it("con dimensiones pero sin promedio, hay datos que mostrar", () => {
    const r = buildEmployerReport(raw({ stars_avg: null }));
    expect(r.hasData).toBe(true);
    expect(r.reputation.dimensions.length).toBeGreaterThan(0);
  });

  it("con promedio pero sin dimensiones, también hay datos que mostrar", () => {
    const r = buildEmployerReport(raw({ dimensions: [] }));
    expect(r.hasData).toBe(true);
    expect(r.strongest).toBeNull();
  });
});

describe("con calificaciones", () => {
  it("si dos dimensiones empatan en lo más bajo, gana la primera en el orden fijo", () => {
    const r = buildEmployerReport(
      raw({ dimensions: [dim("clarity", 4.0), dim("treatment", 4.0), dim("payment", 4.8)] }),
    );
    expect(r.weakest?.key).toBe("clarity");
    expect(r.strongest?.key).toBe("payment");
  });

  it("muestra el promedio con coma decimal y la cantidad", () => {
    const r = buildEmployerReport(raw());
    expect(r.hasData).toBe(true);
    expect(r.headline).toBe("4,6 de 5 según 8 calificaciones de profesionales.");
    expect(r.ratingsToUnlock).toBe(0);
    expect(r.reputation.level).toBe("reliable");
  });

  it("la dimensión más fuerte y la más débil, solo si hay al menos dos y no empatan", () => {
    const r = buildEmployerReport(raw());
    expect(r.strongest?.key).toBe("treatment");
    expect(r.weakest?.key).toBe("environment");
    const one = buildEmployerReport(raw({ dimensions: [dim("clarity", 4.0)] }));
    expect(one.strongest).toBeNull();
    expect(one.weakest).toBeNull();
    const tie = buildEmployerReport(
      raw({ dimensions: [dim("clarity", 4.5), dim("payment", 4.5)] }),
    );
    expect(tie.strongest?.key).toBe("clarity"); // el primero en el orden fijo gana
    expect(tie.weakest).toBeNull();
  });

  it("las dimensiones con menos de 3 calificaciones no cuentan", () => {
    const r = buildEmployerReport(
      raw({ dimensions: [dim("clarity", 5, 2), dim("payment", 4.0, 6)] }),
    );
    expect(r.reputation.dimensions.map((d) => d.key)).toEqual(["payment"]);
    expect(r.strongest).toBeNull();
  });
});

describe("consejos", () => {
  it("solo para las dimensiones por debajo de 4,5, de la más baja a la más alta, con un máximo", () => {
    expect(TIP_BELOW).toBe(4.5);
    expect(MAX_TIPS).toBe(2);
    const r = buildEmployerReport(
      raw({
        dimensions: [
          dim("clarity", 4.4),
          dim("treatment", 3.9),
          dim("payment", 4.5),
          dim("environment", 4.1),
        ],
      }),
    );
    expect(r.tips.map((t) => t.key)).toEqual(["treatment", "environment"]);
    expect(r.tips[0]).toEqual({
      key: "treatment",
      label: "Trato del equipo",
      average: 3.9,
      tip: EMPLOYER_TIPS.treatment,
    });
  });

  it("a 4,5 exacto no hay consejo", () => {
    const r = buildEmployerReport(raw({ dimensions: [dim("clarity", 4.5), dim("payment", 4.9)] }));
    expect(r.tips).toEqual([]);
  });

  it("hay un consejo para cada dimensión y ninguno habla de pagos por fuera ni de WhatsApp", () => {
    for (const key of ["clarity", "treatment", "payment", "environment"]) {
      expect(EMPLOYER_TIPS[key].length).toBeGreaterThan(30);
    }
    expect(JSON.stringify(EMPLOYER_TIPS)).not.toMatch(
      /whatsapp|efectivo|transferencia|nequi|daviplata/i,
    );
  });
});
