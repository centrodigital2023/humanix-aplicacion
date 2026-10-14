import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BAND_INFO,
  NEWS2_PARAM_COUNT,
  TRIAGE_OF_BAND,
  explainNews2,
  news2,
  news2Applicable,
  news2Band,
  obsIntervalMinutes,
  scoreAvpu,
  scoreHr,
  scoreRr,
  scoreSbp,
  scoreSpo2,
  scoreTemp,
  type Avpu,
  type News2Input,
} from "./news2";

interface Vector {
  name: string;
  input: {
    rr: number | null;
    spo2: number | null;
    on_o2: boolean | null;
    sbp: number | null;
    hr: number | null;
    avpu: string | null;
    temp_c: number | null;
    scale: 1 | 2;
  };
  expect: { score: number; max_single: number; measured: number };
}

// Los MISMOS vectores los usa la suite SQL (supabase/e2e/institution_care) contra `public.hx_news2(...)`: si una de las dos
// implementaciones cambia un umbral, la otra deja de coincidir y una de las dos pruebas falla.
const VECTORS = JSON.parse(
  readFileSync(
    new URL("../../supabase/e2e/institution_care/news2_vectors.json", import.meta.url),
    "utf8",
  ),
) as Vector[];

const toInput = (i: Vector["input"]): News2Input => ({
  rr: i.rr,
  spo2: i.spo2,
  onO2: i.on_o2,
  sbp: i.sbp,
  hr: i.hr,
  avpu: i.avpu as Avpu | null,
  tempC: i.temp_c,
  spo2Scale: i.scale,
});

describe("NEWS2: vectores de la tabla oficial", () => {
  it("hay vectores para cada umbral de cada parámetro", () => {
    expect(VECTORS.length).toBeGreaterThan(90);
    expect(new Set(VECTORS.map((v) => v.name)).size).toBe(VECTORS.length);
  });

  for (const vec of VECTORS) {
    it(vec.name, () => {
      const r = news2(toInput(vec.input));
      expect({ score: r.score, max_single: r.maxSingle, measured: r.measured }).toEqual(vec.expect);
    });
  }
});

describe("NEWS2: parámetros sueltos (umbrales exactos)", () => {
  it("frecuencia respiratoria", () => {
    expect([4, 8, 9, 11, 12, 20, 21, 24, 25].map(scoreRr)).toEqual([3, 3, 1, 1, 0, 0, 2, 2, 3]);
  });

  it("saturación, escala 1", () => {
    expect([90, 91, 92, 93, 94, 95, 96, 100].map((s) => scoreSpo2(s, 1, false))).toEqual([
      3, 3, 2, 2, 1, 1, 0, 0,
    ]);
  });

  it("saturación, escala 2: con aire 93 % o más es 0; con oxígeno sube", () => {
    expect([83, 84, 85, 86, 87, 88, 92, 93, 100].map((s) => scoreSpo2(s, 2, false))).toEqual([
      3, 2, 2, 1, 1, 0, 0, 0, 0,
    ]);
    expect([88, 92, 93, 94, 95, 96, 97, 100].map((s) => scoreSpo2(s, 2, true))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3,
    ]);
  });

  it("presión sistólica, pulso, conciencia y temperatura", () => {
    expect([90, 91, 100, 101, 110, 111, 219, 220].map(scoreSbp)).toEqual([3, 2, 2, 1, 1, 0, 0, 3]);
    expect([40, 41, 50, 51, 90, 91, 110, 111, 130, 131].map(scoreHr)).toEqual([
      3, 1, 1, 0, 0, 1, 1, 2, 2, 3,
    ]);
    expect((["A", "C", "V", "P", "U"] as Avpu[]).map(scoreAvpu)).toEqual([0, 3, 3, 3, 3]);
    expect([35.0, 35.1, 36.0, 36.1, 38.0, 38.1, 39.0, 39.1].map(scoreTemp)).toEqual([
      3, 1, 1, 0, 0, 1, 1, 2,
    ]);
  });
});

describe("NEWS2: resultado, bandas y datos faltantes", () => {
  it("completo = 7 parámetros medidos y no es parcial", () => {
    const r = news2({
      rr: 16,
      spo2: 97,
      onO2: false,
      sbp: 120,
      hr: 70,
      avpu: "A",
      tempC: 36.8,
    });
    expect(r.measured).toBe(NEWS2_PARAM_COUNT);
    expect(r.partial).toBe(false);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
    expect(r.triage).toBe("verde");
  });

  it("lo que falta suma 0 pero marca el resultado como parcial", () => {
    const r = news2({ hr: 120 });
    expect(r.partial).toBe(true);
    expect(r.measured).toBe(1);
    expect(r.parts.find((p) => p.key === "hr")?.score).toBe(2);
    expect(r.parts.filter((p) => !p.measured).every((p) => p.score === 0 && p.value === null)).toBe(
      true,
    );
  });

  it("ignora lo que no es un número (NaN, Infinity, texto)", () => {
    const r = news2({
      rr: Number.NaN,
      spo2: Infinity,
      hr: "80" as unknown as number,
      avpu: "X" as unknown as Avpu,
    });
    expect(r.measured).toBe(0);
    expect(r.score).toBe(0);
  });

  it("la banda sale del total y del mayor puntaje de un solo parámetro", () => {
    expect(news2Band(0, 0)).toBe("low");
    expect(news2Band(4, 2)).toBe("low");
    expect(news2Band(3, 3)).toBe("low_medium");
    expect(news2Band(4, 3)).toBe("low_medium");
    expect(news2Band(5, 2)).toBe("medium");
    expect(news2Band(6, 3)).toBe("medium");
    expect(news2Band(7, 2)).toBe("high");
    expect(news2Band(20, 3)).toBe("high");
    expect(TRIAGE_OF_BAND).toEqual({
      low: "verde",
      low_medium: "amarillo",
      medium: "naranja",
      high: "rojo",
    });
    for (const info of Object.values(BAND_INFO)) {
      expect(info.label.length).toBeGreaterThan(2);
      expect(info.guidance.length).toBeGreaterThan(20);
    }
  });

  it("la frecuencia mínima de controles baja el intervalo cuando sube el riesgo", () => {
    expect(obsIntervalMinutes(0, 0)).toBe(720);
    expect(obsIntervalMinutes(2, 2)).toBe(360);
    expect(obsIntervalMinutes(3, 3)).toBe(60);
    expect(obsIntervalMinutes(5, 2)).toBe(60);
    expect(obsIntervalMinutes(7, 2)).toBe(15);
    expect(obsIntervalMinutes(12, 3)).toBe(15);
  });

  it("solo aplica a personas de 16 años o más (sin edad se asume adulta)", () => {
    expect(news2Applicable(null)).toBe(true);
    expect(news2Applicable(undefined)).toBe(true);
    expect(news2Applicable(16)).toBe(true);
    expect(news2Applicable(15)).toBe(false);
    expect(news2Applicable(0)).toBe(false);
    expect(news2Applicable(Number.NaN)).toBe(true);
  });

  it("explica de dónde sale cada punto", () => {
    const r = news2({ hr: 118, spo2: 93, onO2: true, avpu: "C", rr: null });
    const text = explainNews2(r);
    expect(text).toContain("Pulso: 118 /min → 2 pts");
    expect(text).toContain("Saturación (SpO₂): 93 % → 2 pts");
    expect(text).toContain("Oxígeno suplementario: sí → 2 pts");
    expect(text).toContain("Conciencia: confusión nueva → 3 pts");
    expect(text).toContain("Frecuencia respiratoria: sin dato");
  });
});
