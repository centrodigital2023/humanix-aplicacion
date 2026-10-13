import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FAMILY_IDENTITY_POINTS,
  FRAUD_PENALTY,
  INSTITUTION_IDENTITY_POINTS,
  TRUST_BASE,
  TRUST_CAPS,
  TRUST_LEVEL_LABEL,
  TRUST_LEVEL_MIN,
  TRUST_MIN_RATINGS,
  TRUST_SENIORITY_MONTHS_CAP,
  TRUST_SERVICES_CAP,
  computePartyTrust,
  distanceBand,
  distanceBandLabel,
  distanceBandRank,
  trustBadgeText,
  trustFromColumns,
  trustLevel,
  trustLines,
  trustTips,
  trustTone,
  type PartyTrustInput,
} from "./trustScore";

const SQL = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261012190000_offer_alerts_and_plans.sql"),
  "utf-8",
);

const family = (over: Partial<PartyTrustInput> = {}): PartyTrustInput => ({
  kind: "family",
  ratingsCount: 0,
  starsAvg: null,
  completedServices: 0,
  identity: {},
  accountAgeDays: null,
  flags: [],
  ...over,
});

const FULL_FAMILY = { habeasData: true, idNumber: true, idDocument: true };
const FULL_INSTITUTION = { verified: true, nit: true, chamber: true };

describe("espejo de las constantes de la base (hx_trust_calc, hx_trust_level, hx_distance_band)", () => {
  it("base, tope de estrellas, servicios, antigüedad y castigo", () => {
    expect(SQL).toContain(`${TRUST_BASE} + v_rating + v_services + v_ident + v_senior - v_flags`);
    expect(SQL).toContain(`round((v_avg - 1) / 4 * ${TRUST_CAPS.ratings})`);
    expect(SQL).toContain(`CASE WHEN v_n >= ${TRUST_MIN_RATINGS} THEN round(`);
    expect(SQL).toContain(`round(LEAST(v_done, ${TRUST_SERVICES_CAP}) * 1.5)`);
    expect(SQL).toContain(
      `2592000.0, 0), ${TRUST_SENIORITY_MONTHS_CAP}) / ${TRUST_SENIORITY_MONTHS_CAP} * ${TRUST_CAPS.seniority}`,
    );
    expect(SQL).toContain(`v_flags := LEAST(COALESCE(v_flags, 0), ${TRUST_CAPS.adjustments});`);
    expect(SQL).toContain(
      `v_enough := v_n >= ${TRUST_MIN_RATINGS} OR v_done >= ${TRUST_MIN_RATINGS};`,
    );
  });

  it("el castigo por alerta sin resolver", () => {
    expect(SQL).toContain(
      `WHEN 'low' THEN ${FRAUD_PENALTY.low} WHEN 'medium' THEN ${FRAUD_PENALTY.medium} WHEN 'high' THEN ${FRAUD_PENALTY.high} ELSE ${FRAUD_PENALTY.critical}`,
    );
  });

  it("los puntos de identidad de familias (5 + 5 + 5) y de instituciones (9 + 3 + 3)", () => {
    const f = FAMILY_IDENTITY_POINTS;
    expect(SQL).toContain(`COALESCE(fp.habeas_data_accepted, false) THEN ${f.habeas} ELSE 0`);
    expect(SQL).toContain(`COALESCE(fp.id_number, '')), '') IS NOT NULL THEN ${f.idNumber} ELSE 0`);
    expect(SQL).toContain(
      `COALESCE(fp.id_doc_url, '')), '') IS NOT NULL THEN ${f.idDocument} ELSE 0`,
    );
    const i = INSTITUTION_IDENTITY_POINTS;
    expect(SQL).toContain(`COALESCE(ip.verified, false) THEN ${i.verified} ELSE 0`);
    expect(SQL).toContain(`COALESCE(ip.nit, '')), '') IS NOT NULL THEN ${i.nit} ELSE 0`);
    expect(SQL).toContain(
      `COALESCE(ip.chamber_of_commerce_number, '')), '') IS NOT NULL THEN ${i.chamber} ELSE 0`,
    );
    expect(f.habeas + f.idNumber + f.idDocument).toBe(TRUST_CAPS.identity);
    expect(i.verified + i.nit + i.chamber).toBe(TRUST_CAPS.identity);
  });

  it("los niveles", () => {
    expect(SQL).toContain(`WHEN p_score >= ${TRUST_LEVEL_MIN.excellent} THEN 'excellent'`);
    expect(SQL).toContain(`WHEN p_score >= ${TRUST_LEVEL_MIN.high} THEN 'high'`);
    expect(SQL).toContain(`WHEN p_score >= ${TRUST_LEVEL_MIN.medium} THEN 'medium'`);
  });

  it("los rangos de cercanía", () => {
    for (const [km, band] of [
      [2, 2],
      [5, 5],
      [10, 10],
      [20, 20],
      [50, 50],
    ] as const) {
      expect(SQL).toContain(`WHEN p_km <= ${km} THEN ${band}`);
    }
    expect(SQL).toContain("ELSE 100 END");
  });

  it("el máximo posible es 100", () => {
    expect(
      TRUST_BASE +
        TRUST_CAPS.ratings +
        TRUST_CAPS.services +
        TRUST_CAPS.identity +
        TRUST_CAPS.seniority,
    ).toBe(100);
  });
});

describe("niveles y colores", () => {
  it.each([
    [null, "unrated"],
    [undefined, "unrated"],
    [100, "excellent"],
    [85, "excellent"],
    [84, "high"],
    [70, "high"],
    [69, "medium"],
    [50, "medium"],
    [49, "building"],
    [0, "building"],
  ])("%s → %s", (score, level) => {
    expect(trustLevel(score as number | null | undefined)).toBe(level);
  });

  it("cada nivel tiene su texto y su color del tema", () => {
    expect(Object.keys(TRUST_LEVEL_LABEL).sort()).toEqual([
      "building",
      "excellent",
      "high",
      "medium",
      "unrated",
    ]);
    expect(trustTone("excellent")).toBe("ok");
    expect(trustTone("high")).toBe("trust");
    expect(trustTone("medium")).toBe("warn");
    expect(trustTone("building")).toBe("muted");
    expect(trustTone("unrated")).toBe("muted");
  });

  it("la insignia dice la verdad: sin validar, nuevo o puntaje y nivel", () => {
    expect(trustBadgeText({ score: null, level: "unrated", enough: false })).toBe("Sin validar");
    expect(trustBadgeText({ score: 30, level: "building", enough: false })).toBe("Nuevo · 30");
    expect(trustBadgeText({ score: 82, level: "high", enough: true })).toBe("82 · Alto");
  });

  it("las columnas del servidor se vuelven un resumen, aun con un nivel desconocido", () => {
    expect(trustFromColumns(84, "high", true, true)).toEqual({
      score: 84,
      level: "high",
      enough: true,
      verified: true,
    });
    expect(trustFromColumns(null, "unrated", null)).toEqual({
      score: null,
      level: "unrated",
      enough: false,
      verified: false,
    });
    expect(trustFromColumns(72, "raro", true).level).toBe("high");
    expect(trustFromColumns(undefined, undefined, undefined).score).toBeNull();
  });
});

// Los mismos casos que prueba supabase/e2e/offers/scenario_alerts.sql sobre la base real.
describe("computePartyTrust — los mismos casos que la base", () => {
  it("una familia nueva, sin nada: 30, en construcción, sin datos suficientes", () => {
    const t = computePartyTrust(family());
    expect(t.score).toBe(30);
    expect(t.level).toBe("building");
    expect(t.enough).toBe(false);
    expect(t.starsAvg).toBeNull();
  });

  it("identidad completa (15) + antigüedad (5) + 5 estrellas de 4,2 (28) + 4 servicios (6) = 84, nivel alto", () => {
    const t = computePartyTrust(
      family({
        ratingsCount: 5,
        starsAvg: 4.2,
        completedServices: 4,
        identity: FULL_FAMILY,
        accountAgeDays: 540,
      }),
    );
    expect(t.components).toEqual({
      base: 30,
      ratings: 28,
      services: 6,
      identity: 15,
      seniority: 5,
      adjustments: 0,
    });
    expect(t.score).toBe(84);
    expect(t.level).toBe("high");
    expect(t.enough).toBe(true);
    expect(t.verified).toBe(true);
    expect(t.starsAvg).toBe(4.2);
  });

  it("con menos de 3 calificaciones las estrellas ni suben ni bajan", () => {
    const t = computePartyTrust(family({ ratingsCount: 2, starsAvg: 5 }));
    expect(t.components.ratings).toBe(0);
    expect(t.score).toBe(30);
    expect(t.enough).toBe(false);
    expect(t.starsAvg).toBeNull();
  });

  it("la alerta alta sin resolver resta 20: 64, nivel medio", () => {
    const base = family({
      ratingsCount: 5,
      starsAvg: 4.2,
      completedServices: 4,
      identity: FULL_FAMILY,
      accountAgeDays: 540,
    });
    expect(computePartyTrust({ ...base, flags: ["high"] }).score).toBe(64);
    expect(computePartyTrust({ ...base, flags: ["high"] }).level).toBe("medium");
    expect(computePartyTrust({ ...base, flags: ["high", "low", "medium"] }).score).toBe(53);
    expect(computePartyTrust({ ...base, flags: ["low", "medium"] }).score).toBe(73);
    expect(computePartyTrust({ ...base, flags: [] }).score).toBe(84);
  });

  it("el castigo tiene tope de 50: 34, en construcción", () => {
    const base = family({
      ratingsCount: 5,
      starsAvg: 4.2,
      completedServices: 4,
      identity: FULL_FAMILY,
      accountAgeDays: 540,
    });
    const t = computePartyTrust({ ...base, flags: ["critical", "high"] });
    expect(t.components.adjustments).toBe(-50);
    expect(t.score).toBe(34);
    expect(t.level).toBe("building");
  });

  it("nunca baja de 0 ni sube de 100", () => {
    expect(computePartyTrust(family({ flags: ["critical", "critical", "critical"] })).score).toBe(
      0,
    );
    const top = computePartyTrust({
      kind: "institution",
      ratingsCount: 50,
      starsAvg: 5,
      completedServices: 500,
      identity: FULL_INSTITUTION,
      accountAgeDays: 5000,
      flags: [],
    });
    expect(top.score).toBe(100);
  });

  it("una institución verificada, con NIT y cámara, 3 calificaciones de 5 y 12 servicios: 100, excelente (tope de servicios 10)", () => {
    const t = computePartyTrust({
      kind: "institution",
      ratingsCount: 3,
      starsAvg: 5,
      completedServices: 12,
      identity: FULL_INSTITUTION,
      accountAgeDays: 540,
      flags: [],
    });
    expect(t.components).toEqual({
      base: 30,
      ratings: 35,
      services: 15,
      identity: 15,
      seniority: 5,
      adjustments: 0,
    });
    expect(t.score).toBe(100);
    expect(t.level).toBe("excellent");
    expect(t.verified).toBe(true);
  });

  it("una institución verificada pero sin historial: 30 + 15 + 5 = 50, medio y sin datos suficientes", () => {
    const t = computePartyTrust({
      kind: "institution",
      ratingsCount: 0,
      starsAvg: null,
      completedServices: 0,
      identity: FULL_INSTITUTION,
      accountAgeDays: 540,
      flags: [],
    });
    expect(t.score).toBe(50);
    expect(t.level).toBe("medium");
    expect(t.enough).toBe(false);
  });

  it("las estrellas: 1 → 0, 3 → 18, 5 → 35 (nunca negativas)", () => {
    const stars = (s: number) =>
      computePartyTrust(family({ ratingsCount: 3, starsAvg: s })).components.ratings;
    expect(stars(1)).toBe(0);
    expect(stars(3)).toBe(18);
    expect(stars(5)).toBe(35);
    expect(stars(0.5)).toBe(0);
  });

  it("los servicios cuentan 1,5 puntos cada uno, redondeados, hasta 10", () => {
    const svc = (n: number) =>
      computePartyTrust(family({ completedServices: n })).components.services;
    expect([0, 1, 2, 3, 4, 10, 11, 99].map(svc)).toEqual([0, 2, 3, 5, 6, 15, 15, 15]);
    expect(svc(-3)).toBe(0);
  });

  it("la antigüedad: 0 sin perfil, proporcional hasta 12 meses y ahí se detiene", () => {
    const age = (d: number | null) =>
      computePartyTrust(family({ accountAgeDays: d })).components.seniority;
    expect([null, 0, 30, 180, 360, 540, 5000].map(age)).toEqual([0, 0, 0, 3, 5, 5, 5]);
  });

  it("una cuenta con dos servicios y una con tres: «datos suficientes» desde 3 de cualquiera", () => {
    expect(computePartyTrust(family({ completedServices: 2 })).enough).toBe(false);
    expect(computePartyTrust(family({ completedServices: 3 })).enough).toBe(true);
    expect(computePartyTrust(family({ ratingsCount: 3, starsAvg: 4 })).enough).toBe(true);
  });

  it("para la familia, «verificada» es entregar número y documento", () => {
    expect(computePartyTrust(family({ identity: { idNumber: true } })).verified).toBe(false);
    expect(
      computePartyTrust(family({ identity: { idNumber: true, idDocument: true } })).verified,
    ).toBe(true);
  });
});

describe("explicación para la propia cuenta", () => {
  const full = computePartyTrust(
    family({
      ratingsCount: 5,
      starsAvg: 4.2,
      completedServices: 4,
      identity: FULL_FAMILY,
      accountAgeDays: 540,
    }),
  );
  const empty = computePartyTrust(family());

  it("el desglose suma el puntaje (sin ajustes, no muestra la línea)", () => {
    const lines = trustLines(full.components, "family");
    expect(lines.map((l) => l.key)).toEqual([
      "base",
      "ratings",
      "services",
      "identity",
      "seniority",
    ]);
    expect(lines.reduce((s, l) => s + l.value, 0)).toBe(full.score);
    expect(lines.find((l) => l.key === "identity")?.label).toBe("Identidad entregada");
    expect(
      trustLines(full.components, "institution").find((l) => l.key === "identity")?.label,
    ).toBe("Institución verificada");
  });

  it("con ajustes por alertas, los muestra restando", () => {
    const flagged = computePartyTrust(family({ flags: ["high"] }));
    const lines = trustLines(flagged.components, "family");
    expect(lines.at(-1)).toMatchObject({ key: "adjustments", value: -20, max: null });
    expect(lines.reduce((s, l) => s + l.value, 0)).toBe(flagged.score);
  });

  it("los consejos van de lo que más suma a lo que menos, y solo lo que falta", () => {
    // Faltan 9 puntos de servicios y 7 de estrellas: primero lo que más suma.
    expect(trustTips(full.components, "family")).toEqual([
      "Cada servicio completado suma hasta llegar a 10.",
      "Pide a quienes te atienden que te califiquen: cuentan desde 3 calificaciones.",
    ]);
    const tips = trustTips(empty.components, "family");
    expect(tips[0]).toMatch(/Pide a quienes te atienden/);
    expect(tips).toHaveLength(4);
    expect(trustTips(empty.components, "institution").some((t) => /NIT/.test(t))).toBe(true);
  });
});

describe("cercanía por rangos", () => {
  it.each([
    [null, null],
    [undefined, null],
    [NaN, null],
    [0, 2],
    [2, 2],
    [2.01, 5],
    [5, 5],
    [5.01, 10],
    [10, 10],
    [10.5, 20],
    [20, 20],
    [20.01, 50],
    [50, 50],
    [50.01, 100],
    [300, 100],
  ])("%s km → rango %s", (km, band) => {
    expect(distanceBand(km as number | null | undefined)).toBe(band);
  });

  it("los textos y el orden (lo que no tiene distancia va al final)", () => {
    expect([2, 5, 10, 20, 50, 100, null].map(distanceBandLabel)).toEqual([
      "A menos de 2 km",
      "A 2–5 km",
      "A 5–10 km",
      "A 10–20 km",
      "A 20–50 km",
      "A más de 50 km",
      "Distancia no disponible",
    ]);
    const sorted = [100, null, 5, 2, 50].sort((a, b) => distanceBandRank(a) - distanceBandRank(b));
    expect(sorted).toEqual([2, 5, 50, 100, null]);
  });
});
