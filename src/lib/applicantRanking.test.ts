import { describe, expect, it } from "vitest";
import {
  MIN_COMPLETENESS,
  TOP_MIN_SCORE,
  WEIGHTS,
  labelFor,
  rankApplicants,
  rankingHeadline,
  smoothedRating,
  type Applicant,
  type RankedApplicant,
} from "./applicantRanking";
import { HOUR, applicant, bareApplicant, iso, mulberry32 } from "./familyIntel.fixture";
import type { MarketStats } from "./negotiation";

const market: MarketStats = { n: 12, p25: 20_000, median: 24_000, p75: 28_000 };

const one = (a: Applicant, m: MarketStats | null = market): RankedApplicant =>
  rankApplicants([a, applicant({ id: "relleno" })], { market: m }).find(
    (r) => r.applicant.id === a.id,
  )!;
const factor = (r: RankedApplicant, key: string) => r.factors.find((f) => f.key === key)!;

describe("pesos", () => {
  it("suman 100 y cada factor respeta su máximo", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const r = one(applicant({ id: "x" }));
    for (const f of r.factors) expect(f.max).toBe(WEIGHTS[f.key]);
  });
});

describe("el candidato sólido, con cada punto a la vista", () => {
  const r = one(applicant({ id: "x" }));

  it("puntaje y etiqueta", () => {
    expect(r.score).toBe(83);
    expect(r.label).toBe("Muy buena opción");
    expect(r.completeness).toBe(1);
  });

  it("de dónde sale cada punto", () => {
    expect(factor(r, "trust").points).toBe(28.8); // RETHUS 14 + identidad 4 + 90/100 × 12
    expect(factor(r, "experience").points).toBe(21.5); // calificación suavizada 12,9 + experiencia 8,6
    expect(factor(r, "price").points).toBe(20);
    expect(factor(r, "distance").points).toBe(8);
    expect(factor(r, "familiarity").points).toBe(0);
    expect(factor(r, "availability").points).toBe(5);
  });

  it("lo bueno se explica en español y no hay advertencias", () => {
    expect(r.pros).toEqual([
      "Verificación RETHUS vigente",
      "Puntaje de confianza alto (90/100)",
      "Calificación 4.8 con 20 servicios",
      "8 años de experiencia",
      "Vive cerca (3.0 km)",
      "Tarifa dentro del rango de tu ciudad",
      "Pide lo que publicaste o menos",
      "Disponible ahora",
    ]);
    expect(r.cautions).toEqual([]);
    expect(r.counter).toBeNull();
  });
});

describe("calificación suavizada", () => {
  it("una reseña perfecta no le gana a muchas buenas", () => {
    const lucky = smoothedRating(5, 1)!;
    const solid = smoothedRating(4.6, 40)!;
    expect(lucky).toBeCloseTo(4.4, 5);
    expect(solid).toBeCloseTo(4.572, 3);
    expect(solid).toBeGreaterThan(lucky);
  });

  it("sin servicios cae a la media; sin calificación no hay valor", () => {
    expect(smoothedRating(4.5, 0)).toBeCloseTo(4.2, 5);
    expect(smoothedRating(0, 5)).toBeNull();
    expect(smoothedRating(null, 5)).toBeNull();
    expect(smoothedRating(Number.NaN, 5)).toBeNull();
  });

  it("con muchos servicios manda la calificación propia", () => {
    expect(smoothedRating(4.9, 500)!).toBeGreaterThan(4.89);
  });
});

describe("precio", () => {
  it("por encima del rango y de lo publicado: baja el puntaje, avisa y propone contraoferta", () => {
    const r = one(applicant({ id: "x", offeredRate: 35_000 }));
    const price = factor(r, "price");
    // 35.000 es 25 % sobre el techo (28.000): 20 − 40 × 0,25 = 10; y 46 % sobre lo publicado: × 0,3125
    expect(price.points).toBe(3.1);
    expect(r.cautions).toContain("Pide 25 % sobre el techo del rango de tu ciudad");
    expect(r.cautions).toContain("Pide 46 % más de lo que publicaste");
    expect(r.counter?.suggested).toBe(26_000); // punto medio entre la mediana y el techo
    expect(r.counter?.rationale).toMatch(/mediana.*24\.000.*techo.*28\.000/);
  });

  it("nunca propone una contraoferta más alta que la oferta (rango casi sin ancho)", () => {
    // mediana = techo = 28.300: el punto medio redondeado a $500 sería 28.500, más que los 28.400 que piden
    const narrow: MarketStats = { n: 12, p25: 27_000, median: 28_300, p75: 28_300 };
    const r = one(applicant({ id: "x", offeredRate: 28_400, postedRate: null }), narrow);
    expect(factor(r, "price").note).toMatch(/sobre el techo del rango/);
    expect(r.counter).toBeNull();
  });

  it("dentro del rango pero por encima de lo que publicó: contraoferta al punto medio", () => {
    const r = one(applicant({ id: "x", offeredRate: 24_000, postedRate: 20_000 }));
    expect(factor(r, "price").points).toBe(14); // 20 × 0,7
    expect(r.cautions).toContain("Pide 20 % más de lo que publicaste");
    expect(r.counter?.suggested).toBe(22_000);
    expect(r.counter?.rationale).toMatch(/publicaste.*20\.000.*pide.*24\.000/);
  });

  it("un pequeño sobreprecio no genera contraoferta ni advertencia", () => {
    const r = one(applicant({ id: "x", offeredRate: 25_000, postedRate: 24_000 }));
    expect(r.counter).toBeNull();
    expect(r.cautions.some((c) => /más de lo que publicaste/.test(c))).toBe(false);
  });

  it("por debajo del rango: buen precio, algo menos de puntos que el centro del rango", () => {
    const r = one(applicant({ id: "x", offeredRate: 18_000, postedRate: 24_000 }));
    expect(factor(r, "price").points).toBe(17);
    expect(r.pros).toContain("Tarifa por debajo del rango de tu ciudad");
    expect(factor(r, "price").note).toMatch(/por debajo del rango/);
    expect(factor(r, "price").note).toMatch(/25 % menos de lo que publicaste/);
  });

  it("tarifa por turno o por mes: no se compara con el rango por hora", () => {
    const r = one(
      applicant({ id: "x", hourly: false, offeredRate: 3_000_000, postedRate: 2_800_000 }),
    );
    expect(factor(r, "price").points).toBe(12.5); // neutral 14 × 0,8929
    expect(factor(r, "price").note).toMatch(/sin referencia por hora/);
    expect(r.counter).toBeNull();
  });

  it("sin mercado la tarifa por hora puntúa neutral", () => {
    const r = one(applicant({ id: "x" }), null);
    expect(factor(r, "price").points).toBe(14);
    expect(factor(r, "price").note).toMatch(/sin referencia de mercado/);
  });

  it("sin tarifa indicada no se premia ni se castiga", () => {
    const r = one(applicant({ id: "x", offeredRate: null }));
    expect(factor(r, "price").points).toBe(14);
    expect(factor(r, "price").note).toBe("sin tarifa indicada");
    expect(r.counter).toBeNull();
  });

  it("pasar mucho del techo del rango llega a cero (nunca negativo)", () => {
    const r = one(applicant({ id: "x", offeredRate: 80_000, postedRate: null }));
    expect(factor(r, "price").points).toBe(0);
  });
});

describe("cercanía", () => {
  const km = (v: number | null) => factor(one(applicant({ id: "x", km: v })), "distance");

  it("escalones exactos", () => {
    expect([1, 2, 2.01, 5, 5.01, 10, 10.5, 20, 20.5].map((v) => km(v).points)).toEqual([
      10, 10, 8, 8, 6, 6, 3, 3, 1,
    ]);
  });

  it("sin dato o con un dato imposible es neutral y lo dice", () => {
    expect(km(null)).toMatchObject({ points: 5, note: "distancia desconocida" });
    expect(km(-3)).toMatchObject({ points: 5, note: "distancia desconocida" });
  });

  it("más de 20 km se advierte", () => {
    expect(one(applicant({ id: "x", km: 35 })).cautions).toContain("Está lejos (35 km)");
  });
});

describe("ya te conoce", () => {
  const fam = (inTeam: boolean, together: number) =>
    factor(one(applicant({ id: "x", inTeam, servicesTogether: together })), "familiarity");

  it("equipo de confianza 6; cada servicio juntos 2, hasta 4", () => {
    expect(fam(true, 0).points).toBe(6);
    expect(fam(false, 1).points).toBe(2);
    expect(fam(false, 2).points).toBe(4);
    expect(fam(false, 9).points).toBe(4);
    expect(fam(true, 2).points).toBe(10);
    expect(fam(false, 0)).toMatchObject({ points: 0, note: "aún no han trabajado juntos" });
  });

  it("lo dice en singular y en plural", () => {
    expect(fam(true, 1).note).toBe("en tu equipo de confianza · te atendió 1 vez");
    expect(fam(true, 3).note).toBe("en tu equipo de confianza · te atendió 3 veces");
  });
});

describe("verificación, disponibilidad y calificaciones", () => {
  it("RETHUS falso se advierte; desconocido no se acusa", () => {
    expect(one(applicant({ id: "x", rethusVerified: false })).cautions).toContain(
      "Sin verificación RETHUS",
    );
    expect(one(applicant({ id: "x", rethusVerified: null })).cautions).not.toContain(
      "Sin verificación RETHUS",
    );
    expect(factor(one(applicant({ id: "x", rethusVerified: false })), "trust").points).toBe(14.8); // 4 + 10,8
  });

  it("identidad sin verificar se advierte", () => {
    expect(one(applicant({ id: "x", verified: false })).cautions).toContain(
      "Identidad sin verificar",
    );
  });

  it("el puntaje de confianza se limita a 0–100", () => {
    expect(factor(one(applicant({ id: "x", trustScore: 150 })), "trust").points).toBe(30);
    expect(factor(one(applicant({ id: "x", trustScore: -20 })), "trust").points).toBe(18);
  });

  it("disponibilidad: sí 5, no 0 con aviso, sin dato 2", () => {
    expect(factor(one(applicant({ id: "x", available: true })), "availability").points).toBe(5);
    const no = one(applicant({ id: "x", available: false }));
    expect(factor(no, "availability").points).toBe(0);
    expect(no.cautions).toContain("No aparece disponible ahora");
    expect(factor(one(applicant({ id: "x", available: null })), "availability").points).toBe(2);
  });

  it("sin calificaciones lo dice; con calificación baja y varios servicios, también", () => {
    expect(one(applicant({ id: "x", avgRating: 0, totalJobs: 0 })).cautions).toContain(
      "Aún no tiene calificaciones en Humanix",
    );
    expect(one(applicant({ id: "x", avgRating: 3.4, totalJobs: 8 })).cautions).toContain(
      "Calificación baja (3.4 con 8 servicios)",
    );
    // con 1 solo servicio no se juzga
    expect(
      one(applicant({ id: "x", avgRating: 3.4, totalJobs: 1 })).cautions.some((c) =>
        /Calificación baja/.test(c),
      ),
    ).toBe(false);
  });
});

describe("pocos datos", () => {
  it("un candidato sin información no recibe etiqueta de calidad ni es «mejor opción»", () => {
    const rows = rankApplicants(
      [bareApplicant({ id: "a" }), bareApplicant({ id: "b", offeredRate: 30_000 })],
      { market },
    );
    expect(rows.every((r) => r.label === "Pocos datos")).toBe(true);
    expect(rows.every((r) => !r.isTop)).toBe(true);
    expect(rows[0].completeness).toBe(0);
  });

  it(`con ${MIN_COMPLETENESS * 100} % de los datos o más ya se etiqueta`, () => {
    const three = bareApplicant({ id: "x", avgRating: 4.9, totalJobs: 30, trustScore: 95 }); // 3 de 8 = 37,5 %
    expect(one(three).label).toBe("Pocos datos");
    const four = { ...three, rethusVerified: true as boolean | null }; // 4 de 8 = 50 %
    expect(one(four).label).not.toBe("Pocos datos");
  });

  it("labelFor: fronteras exactas", () => {
    expect([49, 50, 64, 65, 79, 80].map((s) => labelFor(s, 1))).toEqual([
      "Revisa con cuidado",
      "Para considerar",
      "Para considerar",
      "Buena opción",
      "Buena opción",
      "Muy buena opción",
    ]);
    expect(labelFor(95, 0.39)).toBe("Pocos datos");
  });
});

describe("orden y mejor opción", () => {
  const strong = applicant({ id: "fuerte", name: "Fuerte" });
  const medium = applicant({
    id: "medio",
    name: "Medio",
    rethusVerified: false,
    verified: null,
    trustScore: 60,
    km: 12,
    available: null,
    avgRating: 4.2,
    totalJobs: 4,
    yearsExperience: 2,
  });
  const weak = applicant({
    id: "debil",
    name: "Débil",
    rethusVerified: false,
    trustScore: 20,
    avgRating: 3.2,
    totalJobs: 6,
    yearsExperience: 0,
    km: 30,
    available: false,
    offeredRate: 40_000,
  });

  it("ordena de mayor a menor puntaje y numera", () => {
    const r = rankApplicants([weak, strong, medium], { market });
    expect(r.map((x) => x.applicant.id)).toEqual(["fuerte", "medio", "debil"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r.map((x) => x.score)).toEqual([...r.map((x) => x.score)].sort((a, b) => b - a));
    expect(r[0].score).toBeGreaterThanOrEqual(TOP_MIN_SCORE);
  });

  it("solo la primera puede ser «mejor opción», y solo si hay con quién compararla", () => {
    const r = rankApplicants([weak, strong, medium], { market });
    expect(r.map((x) => x.isTop)).toEqual([true, false, false]);
    expect(rankApplicants([strong], { market })[0].isTop).toBe(false);
  });

  it("si la primera no llega al mínimo, nadie es «mejor opción»", () => {
    const r = rankApplicants(
      [
        weak,
        applicant({
          id: "otro-debil",
          rethusVerified: false,
          verified: false,
          trustScore: 10,
          avgRating: 3,
          totalJobs: 4,
          yearsExperience: 0,
          km: 40,
          available: false,
          offeredRate: 45_000,
        }),
      ],
      { market },
    );
    expect(r[0].score).toBeLessThan(TOP_MIN_SCORE);
    expect(r.every((x) => !x.isTop)).toBe(true);
  });

  it("los empates se resuelven por la tarifa más baja, luego por quien llegó primero, luego por id", () => {
    const base = {
      rethusVerified: null,
      verified: null,
      trustScore: null,
      available: null,
      km: null,
      avgRating: null,
      totalJobs: null,
      yearsExperience: null,
    } as const;
    const cheap = bareApplicant({
      ...base,
      id: "b",
      offeredRate: 20_000,
      postedRate: null,
      hourly: false,
    });
    const dear = bareApplicant({
      ...base,
      id: "a",
      offeredRate: 30_000,
      postedRate: null,
      hourly: false,
    });
    expect(rankApplicants([dear, cheap]).map((x) => x.applicant.id)).toEqual(["b", "a"]);

    const early = bareApplicant({
      ...base,
      id: "z",
      createdAt: iso(-5 * HOUR),
      postedRate: null,
      hourly: false,
    });
    const late = bareApplicant({
      ...base,
      id: "y",
      createdAt: iso(-1 * HOUR),
      postedRate: null,
      hourly: false,
    });
    expect(rankApplicants([late, early]).map((x) => x.applicant.id)).toEqual(["z", "y"]);

    const x1 = bareApplicant({
      ...base,
      id: "m",
      createdAt: null,
      offeredRate: null,
      postedRate: null,
    });
    const x2 = bareApplicant({
      ...base,
      id: "k",
      createdAt: null,
      offeredRate: null,
      postedRate: null,
    });
    expect(rankApplicants([x1, x2]).map((x) => x.applicant.id)).toEqual(["k", "m"]);
  });

  it("el orden de entrada no cambia el resultado", () => {
    const a = rankApplicants([weak, strong, medium], { market });
    const b = rankApplicants([medium, weak, strong], { market });
    expect(b.map((x) => [x.applicant.id, x.score, x.rank])).toEqual(
      a.map((x) => [x.applicant.id, x.score, x.rank]),
    );
  });

  it("sin candidatos devuelve una lista vacía", () => {
    expect(rankApplicants([], { market })).toEqual([]);
  });
});

describe("titular", () => {
  const strong = applicant({ id: "fuerte", name: "Laura" });
  it("sin nadie, con uno, con varios y con ninguno destacado", () => {
    expect(rankingHeadline([])).toBe(
      "Cuando lleguen postulaciones o propuestas, las comparamos por ti.",
    );
    expect(rankingHeadline(rankApplicants([strong], { market }))).toBe(
      "Una persona se ofreció: muy buena opción (83/100).",
    );
    expect(
      rankingHeadline(
        rankApplicants([strong, applicant({ id: "b", name: "Marta", trustScore: 40, km: 15 })], {
          market,
        }),
      ),
    ).toBe("Entre 2 opciones, Laura destaca (83/100).");
    const flat = rankApplicants([bareApplicant({ id: "a" }), bareApplicant({ id: "b" })], {
      market,
    });
    expect(rankingHeadline(flat)).toBe(
      "Comparamos 2 opciones: ninguna destaca con claridad todavía.",
    );
  });

  it("si la mejor no tiene nombre, no inventa uno", () => {
    const r = rankApplicants(
      [
        applicant({ id: "a", name: null }),
        applicant({ id: "b", name: "Marta", trustScore: 40, km: 15 }),
      ],
      { market },
    );
    expect(rankingHeadline(r)).toMatch(/^Entre 2 opciones, una de las personas destaca/);
  });
});

describe("datos sucios", () => {
  it("lee tarifas como texto, limita lo imposible y no lanza", () => {
    const dirty = applicant({
      id: "sucio",
      offeredRate: "24000" as unknown as number,
      postedRate: "24000" as unknown as number,
      trustScore: Number.NaN,
      km: Number.POSITIVE_INFINITY,
      yearsExperience: -4,
      totalJobs: -2,
      servicesTogether: -1,
    });
    const r = one(dirty);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("invariantes (candidatos aleatorios)", () => {
  for (const seed of [4, 21, 99, 2026, 8080]) {
    it(`semilla ${seed}: puntajes en rango, factores dentro de su máximo y orden estable`, () => {
      const rnd = mulberry32(seed);
      const maybe = <T>(v: T, p = 0.25): T | null => (rnd() < p ? null : v);
      const pool: Applicant[] = Array.from({ length: 60 }, (_, i) =>
        applicant({
          id: `r${i}`,
          name: maybe(`Persona ${i}`),
          hourly: rnd() < 0.7,
          offeredRate: maybe(Math.round(rnd() * 60_000)),
          postedRate: maybe(Math.round(rnd() * 40_000)),
          createdAt: maybe(iso(-rnd() * 50 * HOUR)),
          avgRating: maybe(Math.round(rnd() * 50) / 10),
          totalJobs: maybe(Math.floor(rnd() * 60)),
          trustScore: maybe(Math.round(rnd() * 130 - 15)),
          rethusVerified: maybe(rnd() < 0.5),
          verified: maybe(rnd() < 0.5),
          yearsExperience: maybe(Math.round(rnd() * 30)),
          available: maybe(rnd() < 0.5),
          km: maybe(Math.round(rnd() * 600) / 10),
          inTeam: rnd() < 0.2,
          servicesTogether: Math.floor(rnd() * 6),
        }),
      );
      const ranked = rankApplicants(pool, { market: rnd() < 0.8 ? market : null });
      expect(ranked).toHaveLength(pool.length);
      ranked.forEach((r, i) => {
        expect(r.rank).toBe(i + 1);
        expect(Number.isInteger(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        expect(r.completeness).toBeGreaterThanOrEqual(0);
        expect(r.completeness).toBeLessThanOrEqual(1);
        for (const f of r.factors) {
          expect(f.points).toBeGreaterThanOrEqual(0);
          expect(f.points).toBeLessThanOrEqual(f.max);
          expect(f.note).not.toMatch(/undefined|NaN|Infinity|\[object/);
        }
        for (const t of [...r.pros, ...r.cautions, r.counter?.rationale ?? ""]) {
          expect(t).not.toMatch(/undefined|NaN|Infinity|\[object/);
        }
        if (r.counter) expect(r.counter.suggested).toBeLessThan(r.applicant.offeredRate as number);
        if (i > 0) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(r.score);
      });
      expect(ranked.filter((r) => r.isTop).length).toBeLessThanOrEqual(1);
      if (ranked.some((r) => r.isTop)) expect(ranked[0].isTop).toBe(true);
      const shuffled = [...pool].sort(() => rnd() - 0.5);
      expect(rankApplicants(shuffled, { market }).map((r) => r.applicant.id)).toEqual(
        rankApplicants(pool, { market }).map((r) => r.applicant.id),
      );
    });
  }
});
