import { describe, expect, it } from "vitest";
import {
  DIMENSION_TIPS,
  GOALS,
  MAX_PRAISE,
  MAX_SERVICES_TO_GOAL,
  MIN_DIM_RATINGS,
  MIN_RATINGS_FOR_TREND,
  TIP_BELOW,
  buildReputationReport,
  fiveStarsNeeded,
  type DimensionRow,
  type ReputationInsight,
  type StarRow,
} from "./proReputation";
import { DAY, iso, mulberry32 } from "./intel.fixture";

let seq = 0;
/** Calificación con estrellas; `ago` = hace cuántos días. */
const star = (stars: number | string | null, ago = 1, over: Partial<StarRow> = {}): StarRow => ({
  booking_id: `b${++seq}`,
  created_at: iso(-ago * DAY),
  stars,
  comment: null,
  ...over,
});
const dim = (scores: [number, number, number, number], ago = 1): DimensionRow => ({
  booking_id: `d${++seq}`,
  created_at: iso(-ago * DAY),
  scores: {
    punctuality: scores[0],
    treatment: scores[1],
    compliance: scores[2],
    communication: scores[3],
  },
});
const many = (n: number, scores: [number, number, number, number]) =>
  Array.from({ length: n }, (_, i) => dim(scores, i + 1));
const ids = (xs: ReputationInsight[]) => xs.map((i) => i.id);
const find = (xs: ReputationInsight[], id: string) => xs.find((i) => i.id === id);
const report = (stars: StarRow[] = [], dimensions: DimensionRow[] = [], profile = {}) =>
  buildReputationReport({ stars, dimensions, profile });

describe("sin calificaciones", () => {
  it("lo explica con calidez y no inventa promedios", () => {
    const r = report();
    expect(r.hasData).toBe(false);
    expect(ids(r.insights)).toEqual(["no_data"]);
    expect(r.stars).toMatchObject({ count: 0, average: null, fiveStarShare: null });
    expect(r.stars.trend.direction).toBe("unknown");
    expect(r.dimensions).toHaveLength(4);
    expect(r.dimensions.every((d) => d.average === null && d.count === 0)).toBe(true);
    expect(r.strongest).toBeNull();
    expect(r.weakest).toBeNull();
    expect(r.nextGoal).toBeNull();
    expect(r.praise).toEqual([]);
  });
});

describe("estrellas", () => {
  it("solo cuentan los enteros de 1 a 5, también como texto; lo demás se descarta", () => {
    const r = report([
      star(5),
      star("4"),
      star(3),
      star(0),
      star(6),
      star(4.5),
      star(null),
      star(""),
      star("x"),
      star(-1),
    ]);
    expect(r.stars.count).toBe(3);
    expect(r.stars.average).toBe(4);
    expect(r.stars.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  });

  it("el promedio lleva un decimal y la distribución suma el total", () => {
    const r = report([star(5), star(5), star(4), star(4), star(4), star(3), star(5)]);
    expect(r.stars.count).toBe(7);
    expect(r.stars.average).toBe(4.3);
    const total = Object.values(r.stars.distribution).reduce((a, b) => a + b, 0);
    expect(total).toBe(7);
  });

  it("el porcentaje de 5 estrellas exige al menos 3 calificaciones", () => {
    expect(report([star(5), star(5)]).stars.fiveStarShare).toBeNull();
    expect(report([star(5), star(5), star(4)]).stars.fiveStarShare).toBe(67);
  });
});

describe("tendencia", () => {
  const series = (recent: number[], previous: number[]) => [
    ...recent.map((v, i) => star(v, i + 1)),
    ...previous.map((v, i) => star(v, 10 + i)),
  ];

  it("necesita al menos 8 calificaciones", () => {
    expect(MIN_RATINGS_FOR_TREND).toBe(8);
    expect(report(series([5, 5, 5, 5, 5], [3, 3])).stars.trend.direction).toBe("unknown");
    expect(report(series([5, 5, 5, 5, 5], [3, 3, 3])).stars.trend.direction).toBe("up");
  });

  it("compara las 5 más recientes contra las 5 anteriores, sin importar el orden de llegada", () => {
    const rows = series([5, 5, 5, 5, 5], [4, 4, 4, 4, 4]);
    const shuffled = [...rows].reverse();
    for (const input of [rows, shuffled]) {
      const t = report(input).stars.trend;
      expect(t).toEqual({ direction: "up", recent: 5, previous: 4, delta: 1 });
    }
  });

  it("0,2 puntos ya es cambio; 0,1 es estable", () => {
    // recientes 4,8 (24/5) vs anteriores 4,6 (23/5) → +0,2
    const up = report(series([5, 5, 5, 5, 4], [5, 5, 5, 4, 4]));
    expect(up.stars.trend.delta).toBe(0.2);
    expect(up.stars.trend.direction).toBe("up");
    // +0,0
    const same = report(series([5, 5, 4, 4, 4], [5, 5, 4, 4, 4]));
    expect(same.stars.trend.direction).toBe("steady");
    // −0,2
    const down = report(series([5, 5, 5, 4, 4], [5, 5, 5, 5, 4]));
    expect(down.stars.trend.delta).toBe(-0.2);
    expect(down.stars.trend.direction).toBe("down");
    // +0,2 con valores que dan +0,1 al redondear a un decimal no se confunden
    const tiny = report(series([5, 5, 5, 5, 5], [5, 5, 5, 5, 4]));
    expect(tiny.stars.trend.delta).toBe(0.2);
  });

  it("calificaciones sin fecha se consideran las más viejas", () => {
    const withoutDate = Array.from({ length: 5 }, () => star(2, 1, { created_at: null }));
    const dated = Array.from({ length: 5 }, (_, i) => star(5, i + 1));
    const t = report([...withoutDate, ...dated]).stars.trend;
    expect(t.recent).toBe(5);
    expect(t.previous).toBe(2);
  });
});

describe("dimensiones", () => {
  it("con menos de 3 calificaciones no se muestra el promedio", () => {
    expect(MIN_DIM_RATINGS).toBe(3);
    const r = report([], many(2, [5, 5, 5, 5]));
    expect(r.dimensions.every((d) => d.average === null && d.count === 2)).toBe(true);
    expect(r.hasData).toBe(true);
  });

  it("calcula el promedio por dimensión con un decimal y nombra las 4 dimensiones de la familia", () => {
    const r = report([], [dim([5, 4, 4, 3]), dim([4, 4, 5, 3]), dim([5, 5, 4, 4])]);
    expect(r.dimensions.map((d) => d.key)).toEqual([
      "punctuality",
      "treatment",
      "compliance",
      "communication",
    ]);
    expect(r.dimensions.map((d) => d.average)).toEqual([4.7, 4.3, 4.3, 3.3]);
    expect(r.dimensions.map((d) => d.label)).toEqual([
      "Puntualidad",
      "Trato humano",
      "Cumplimiento del servicio",
      "Comunicación",
    ]);
  });

  it("ignora puntajes inválidos (0, 6, decimales, texto) en lugar de contarlos", () => {
    const rows: DimensionRow[] = [
      { scores: { punctuality: 5 } },
      { scores: { punctuality: "4" } },
      { scores: { punctuality: 0 } },
      { scores: { punctuality: 6 } },
      { scores: { punctuality: 4.5 } },
      { scores: { punctuality: "x" } },
      { scores: null },
      { scores: { punctuality: 3 } },
    ];
    const p = report([], rows).dimensions[0];
    expect(p.count).toBe(3);
    expect(p.average).toBe(4);
  });

  it("señala la fortaleza y la dimensión a cuidar solo si hay al menos 0,2 de diferencia y es menor a 4,5", () => {
    const r = report([], many(4, [5, 4.0 as 4, 5, 3]));
    expect(r.strongest?.average).toBe(5);
    expect(r.weakest?.key).toBe("communication");

    // todas altas (la más baja promedia 4,7): no hay «dimensión débil» aunque una sea un poco menor
    const even = report([], [dim([5, 5, 5, 5]), dim([5, 5, 5, 5]), dim([4, 5, 5, 5])]);
    expect(even.dimensions[0].average).toBe(4.7);
    expect(even.weakest).toBeNull();

    // diferencia de solo 0,1: no se señala
    const close = report([], [...many(9, [4, 4, 4, 4]), dim([5, 4, 4, 4])]);
    expect(close.strongest?.average).toBe(4.1);
    expect(close.weakest).toBeNull();
  });

  it("con una sola dimensión medible y alta (4,8) no hay «dimensión débil»", () => {
    const rows = Array.from({ length: 3 }, () => ({ scores: { punctuality: 5 } }));
    const r = report([], [...rows, { scores: { punctuality: 4 } }, { scores: { punctuality: 5 } }]);
    expect(r.dimensions[0].average).toBe(4.8);
    expect(r.weakest).toBeNull();
  });

  it("con una sola dimensión medible, la débil es esa si está bajo 4,5", () => {
    const rows = Array.from({ length: 3 }, () => ({ scores: { punctuality: 3 } }));
    const r = report([], rows);
    expect(r.strongest?.key).toBe("punctuality");
    expect(r.weakest?.key).toBe("punctuality");
    expect(ids(r.insights)).toContain("improve");
    expect(ids(r.insights)).not.toContain("strength");
  });
});

describe("consejos", () => {
  it("solo para dimensiones bajo 4,5, de la más baja a la más alta y máximo 2", () => {
    expect(TIP_BELOW).toBe(4.5);
    const r = report([], many(3, [3, 4, 4.0 as 4, 5]));
    expect(r.tips.map((t) => t.key)).toEqual(["punctuality", "treatment"]);
    expect(r.tips[0].tip).toBe(DIMENSION_TIPS.punctuality);
    expect(r.tips[0].average).toBe(3);
  });

  it("una dimensión justo en 4,5 no recibe consejo", () => {
    const rows = [dim([5, 5, 5, 5]), dim([4, 5, 5, 5]), dim([5, 5, 5, 5]), dim([4, 5, 5, 5])]; // punctuality 4,5
    const r = report([], rows);
    expect(r.dimensions[0].average).toBe(4.5);
    expect(r.tips).toEqual([]);
  });

  it("todos los consejos son amables: sin culpa ni medicina ni pagos", () => {
    for (const tip of Object.values(DIMENSION_TIPS)) {
      expect(tip).not.toMatch(/mal|peor|culpa|error|whatsapp|pago|diagn|cura/i);
      expect(tip.length).toBeGreaterThan(40);
    }
  });
});

describe("lo que dicen de ti", () => {
  const praise = (comment: string, stars = 5, ago = 1, over: Partial<StarRow> = {}) =>
    star(stars, ago, { comment, ...over });

  it("muestra solo comentarios positivos, completos y más recientes primero", () => {
    const r = report([
      praise("Muy puntual y cariñosa con mi mamá, la recomiendo.", 5, 5),
      praise("Excelente atención, mi papá estuvo muy tranquilo.", 4, 1),
      praise("Todo regular, nada especial en el servicio.", 3, 2),
      praise("Buena", 5, 3),
      praise("   ", 5, 4),
    ]);
    expect(r.praise.map((p) => p.text)).toEqual([
      "Excelente atención, mi papá estuvo muy tranquilo.",
      "Muy puntual y cariñosa con mi mamá, la recomiendo.",
    ]);
  });

  it("nunca muestra comentarios con teléfonos, correos o enlaces", () => {
    const r = report([
      praise("Excelente servicio, llámeme al 3001234567 para más.", 5, 1),
      praise("Escríbame a maria@correo.com si necesita referencias.", 5, 2),
      praise("Mire mi página https://ejemplo.com, muy recomendada.", 5, 3),
      praise("Una profesional muy atenta y puntual con los horarios.", 5, 4),
    ]);
    expect(r.praise).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/3001234567|maria@correo|ejemplo\.com/);
  });

  it("no muestra comentarios marcados con alerta por el análisis de sentimiento", () => {
    const r = report([
      praise("Excelente servicio, muy atenta y amable siempre.", 5, 1, { ai_alert: true }),
    ]);
    expect(r.praise).toEqual([]);
  });

  it("muestra a lo sumo 3, normaliza los espacios y recorta los textos largos con puntos suspensivos", () => {
    const long = `Muy buena profesional. ${"Siempre atenta y cuidadosa con todo. ".repeat(20)}`;
    const r = report([
      praise(long, 5, 1),
      praise("Muy   buena    atención    y    trato   humano.", 5, 2),
      praise("Súper recomendada para el cuidado de adultos mayores.", 5, 3),
      praise("Siempre llega a tiempo y deja todo en orden en casa.", 5, 4),
    ]);
    expect(MAX_PRAISE).toBe(3);
    expect(r.praise).toHaveLength(3);
    expect(r.praise[0].text.length).toBeLessThanOrEqual(240);
    expect(r.praise[0].text.endsWith("…")).toBe(true);
    expect(r.praise[1].text).toBe("Muy buena atención y trato humano.");
  });
});

describe("siguiente meta", () => {
  it("calcula cuántos servicios más de 5 estrellas faltan, con coma decimal", () => {
    // 10 calificaciones: 5 de 5 y 5 de 4 → promedio 4,5 → meta 4,7
    const stars = [...Array(5)].map(() => star(5)).concat([...Array(5)].map(() => star(4)));
    const r = report(stars);
    expect(r.nextGoal).toMatchObject({ target: 4.7, needed: 7 });
    expect(r.nextGoal?.text).toBe("Con 7 servicios más de 5 estrellas llegarías a 4,7.");
  });

  it("con un solo servicio que falta lo dice en singular", () => {
    // [5,5,4,4,4] promedia 4,4: un 5 más da 27/6 = 4,5
    const r = report([star(5), star(5), star(4), star(4), star(4)]);
    expect(r.nextGoal).toMatchObject({ target: 4.5, needed: 1 });
    expect(r.nextGoal?.text).toBe("Con 1 servicio más de 5 estrellas llegarías a 4,5.");
  });

  it("si el promedio mostrado (con un decimal) ya es la meta, se propone la siguiente", () => {
    // 4,75 se muestra como 4,8: la meta de 4,8 ya «se ve» lograda y la siguiente es 4,9
    const r = report([star(5), star(5), star(5), star(4)]);
    expect(r.stars.average).toBe(4.8);
    expect(r.nextGoal?.target).toBe(4.9);
  });

  it("no hay meta con menos de 3 calificaciones ni cuando ya está en la última", () => {
    expect(report([star(4), star(4)]).nextGoal).toBeNull();
    expect(report([...Array(6)].map(() => star(5))).nextGoal).toBeNull();
    expect(GOALS[GOALS.length - 1]).toBe(4.9);
  });

  it("si la meta queda muy lejos no desmotiva: no se muestra", () => {
    const stars = [...Array(40)].map(() => star(3)); // promedio 3 → meta 4,5 pide 60 más
    expect(fiveStarsNeeded(3, 40, 4.5)).toBeGreaterThan(MAX_SERVICES_TO_GOAL);
    expect(report(stars).nextGoal).toBeNull();
  });

  it("cuando la cuenta da un entero exacto no pide una calificación de más", () => {
    // 10 con promedio 4,5 → meta 4,8: (45 + 5k) / (10 + k) = 4,8 ⇒ k = 15 exactos
    expect(fiveStarsNeeded(4.5, 10, 4.8)).toBe(15);
    // 4 con promedio 4,0 → meta 4,5: k = 4 exactos
    expect(fiveStarsNeeded(4, 4, 4.5)).toBe(4);
  });

  it("una meta que pide entre 31 y 100 servicios tampoco se muestra (desmotiva)", () => {
    const stars = [...Array(40)].map(() => star(4)); // 40 × 4 → meta 4,5 pide 40 más
    expect(fiveStarsNeeded(4, 40, 4.5)).toBe(40);
    expect(report(stars).nextGoal).toBeNull();
    // 30 exactos sí se muestran
    const thirty = [...Array(30)].map(() => star(4));
    expect(report(thirty).nextGoal).toMatchObject({ target: 4.5, needed: 30 });
  });

  it("propiedad: k calificaciones de 5 alcanzan la meta y k−1 no", () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      const n = 3 + Math.floor(rnd() * 80);
      const sum = n * (1 + rnd() * 3.9) + n * 0; // promedio entre 1 y ~4,9
      const avg = Math.min(4.89, sum / n);
      const target = GOALS[Math.floor(rnd() * GOALS.length)];
      const k = fiveStarsNeeded(avg, n, target);
      if (target <= avg) {
        expect(k).toBeNull();
        continue;
      }
      expect(k).not.toBeNull();
      const kk = k as number;
      expect((avg * n + 5 * kk) / (n + kk)).toBeGreaterThanOrEqual(target - 1e-9);
      if (kk > 1) expect((avg * n + 5 * (kk - 1)) / (n + kk - 1)).toBeLessThan(target);
    }
  });

  it("nunca promete llegar a 5 ni a una meta ya superada", () => {
    expect(fiveStarsNeeded(4.2, 10, 5)).toBeNull();
    expect(fiveStarsNeeded(4.8, 10, 4.7)).toBeNull();
    expect(fiveStarsNeeded(4.7, 10, 4.7)).toBeNull();
    expect(fiveStarsNeeded(4, 0, 4.5)).toBeNull();
  });
});

describe("palancas del perfil", () => {
  it("avisa de verificación y de perfil incompleto solo cuando se sabe que faltan", () => {
    expect(report([], [], {}).levers).toEqual([]);
    expect(
      report([], [], { verified: true, rethusVerified: true, profileCompletion: 100 }).levers,
    ).toEqual([]);
    const l = report([], [], { verified: false, profileCompletion: 62 }).levers;
    expect(l).toHaveLength(2);
    expect(l[0]).toMatch(/Verifica/);
    expect(l[1]).toMatch(/62 %/);
    expect(report([], [], { rethusVerified: false }).levers).toHaveLength(1);
    expect(report([], [], { profileCompletion: 90 }).levers).toEqual([]);
    expect(report([], [], { profileCompletion: 89.6 }).levers[0]).toMatch(/90 %/);
  });
});

describe("hallazgos", () => {
  it("con pocas calificaciones lo dice, sin juzgar", () => {
    const r = report([star(5), star(4)]);
    const i = find(r.insights, "few_ratings")!;
    expect(i.title).toBe("Llevas 2 calificaciones");
    expect(report([star(5)]).insights[0].title).toBe("Llevas 1 calificación");
  });

  it("con exactamente 3 calificaciones ya no se dice «llevas pocas»", () => {
    expect(ids(report([star(5), star(5), star(4)]).insights)).not.toContain("few_ratings");
  });

  it("los umbrales exactos cuentan: dimensión en 4,5 es fortaleza y 70 % de cinco estrellas se celebra", () => {
    const four5 = [dim([5, 5, 5, 5]), dim([4, 5, 5, 5]), dim([5, 5, 5, 5]), dim([4, 5, 5, 5])];
    const r = report([], four5);
    expect(r.dimensions[0].average).toBe(4.5);
    // la fortaleza es una de las que promedian 5; para probar el 4,5 exacto, solo hay una dimensión medible
    const only = report(
      [],
      [
        { scores: { punctuality: 5 } },
        { scores: { punctuality: 4 } },
        { scores: { punctuality: 5 } },
        { scores: { punctuality: 4 } },
      ],
    );
    expect(only.strongest?.average).toBe(4.5);
    expect(ids(only.insights)).toContain("strength");

    const seventy = [...Array(7)]
      .map((_, i) => star(5, i + 1))
      .concat([...Array(3)].map((_, i) => star(4, 10 + i)));
    expect(report(seventy).stars.fiveStarShare).toBe(70);
    expect(ids(report(seventy).insights)).toContain("five_stars");
  });

  it("si suben las calificaciones se celebra; si bajan se acompaña con un consejo, sin alarmar", () => {
    const rising = report(
      [
        ...[5, 5, 5, 5, 5].map((v, i) => star(v, i + 1)),
        ...[4, 4, 4, 4, 4].map((v, i) => star(v, 10 + i)),
      ],
      many(4, [5, 5, 5, 3]),
    );
    expect(find(rising.insights, "trend_up")?.severity).toBe("good");

    const falling = report(
      [
        ...[4, 4, 4, 4, 4].map((v, i) => star(v, i + 1)),
        ...[5, 5, 5, 5, 5].map((v, i) => star(v, 10 + i)),
      ],
      many(4, [5, 5, 5, 3]),
    );
    const down = find(falling.insights, "trend_down")!;
    expect(down.severity).toBe("info");
    expect(down.action).toBe(DIMENSION_TIPS.communication);
    expect(down.detail).toMatch(/no define tu trayectoria/);
  });

  it("nunca hay hallazgos de gravedad «warn»: la reputación se acompaña, no se castiga", () => {
    const r = report(
      [...Array(10)].map((_, i) => star(2, i + 1)),
      many(5, [2, 2, 2, 2]),
      { verified: false, profileCompletion: 10 },
    );
    expect(r.insights.every((i) => i.severity !== "warn")).toBe(true);
  });

  it("fortaleza, dimensión a cuidar, 5 estrellas y meta aparecen cuando corresponde", () => {
    const stars = [...Array(8)].map((_, i) => star(5, i + 1)).concat([star(4, 20), star(4, 21)]);
    const r = report(stars, many(4, [5, 5, 4, 3]));
    expect(ids(r.insights)).toEqual(
      expect.arrayContaining(["strength", "improve", "five_stars", "goal"]),
    );
    expect(find(r.insights, "five_stars")?.title).toBe(
      "80 % de tus calificaciones son de 5 estrellas",
    );
    expect(find(r.insights, "strength")?.title).toBe("Tu fortaleza es puntualidad");
  });

  it("los hallazgos van de lo que alegra a lo que se acompaña según su gravedad y sin repetirse", () => {
    const r = report(
      [...Array(10)].map((_, i) => star(i < 6 ? 5 : 3, i + 1)),
      many(4, [5, 5, 4, 3]),
    );
    const order = { warn: 0, info: 1, good: 2 } as const;
    for (let i = 1; i < r.insights.length; i++)
      expect(order[r.insights[i - 1].severity]).toBeLessThanOrEqual(order[r.insights[i].severity]);
    expect(new Set(ids(r.insights)).size).toBe(r.insights.length);
  });

  it("propiedad: con datos al azar nunca salen NaN ni textos rotos y los promedios están entre 1 y 5", () => {
    const rnd = mulberry32(99);
    for (let i = 0; i < 200; i++) {
      const stars = Array.from({ length: Math.floor(rnd() * 25) }, (_, k) =>
        star(rnd() < 0.1 ? "x" : 1 + Math.floor(rnd() * 5), k + 1, {
          comment: rnd() < 0.5 ? "Una profesional muy atenta y cuidadosa con todo." : null,
        }),
      );
      const dims = Array.from({ length: Math.floor(rnd() * 12) }, (_, k) => ({
        booking_id: `x${k}`,
        created_at: iso(-k * DAY),
        scores: {
          punctuality: 1 + Math.floor(rnd() * 5),
          treatment: 1 + Math.floor(rnd() * 5),
          compliance: rnd() < 0.1 ? null : 1 + Math.floor(rnd() * 5),
          communication: 1 + Math.floor(rnd() * 5),
        },
      }));
      const r = report(stars, dims, {
        verified: rnd() < 0.5,
        profileCompletion: Math.floor(rnd() * 100),
      });
      expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity|undefined|\[object/);
      if (r.stars.average !== null) {
        expect(r.stars.average).toBeGreaterThanOrEqual(1);
        expect(r.stars.average).toBeLessThanOrEqual(5);
      }
      for (const d of r.dimensions)
        if (d.average !== null) expect(d.average).toBeGreaterThanOrEqual(1);
      expect(r.praise.length).toBeLessThanOrEqual(MAX_PRAISE);
    }
  });
});
