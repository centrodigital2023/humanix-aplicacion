import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_PROS_DEFAULT_LIMIT,
  PUBLIC_PROS_MAX_LIMIT,
  isEmptyIdLookup,
  proCity,
  publicProfessionalsArgs,
} from "./publicProfessionals";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20261013100000_public_professionals.sql", import.meta.url),
  "utf8",
);

describe("publicProfessionalsArgs", () => {
  it("sin filtros solo pide el límite por defecto", () => {
    expect(publicProfessionalsArgs()).toEqual({ p_limit: PUBLIC_PROS_DEFAULT_LIMIT });
    expect(publicProfessionalsArgs({})).toEqual({ p_limit: 60 });
  });

  it("arma los parámetros con los nombres de la función", () => {
    expect(
      publicProfessionalsArgs({
        specialty: "  Enfermería ",
        city: "Bogotá",
        verified: true,
        minRate: 18000,
        maxRate: 40000,
        minRating: 4.5,
        limit: 40,
      }),
    ).toEqual({
      p_specialty: "Enfermería",
      p_city: "Bogotá",
      p_verified: true,
      p_min_rate: 18000,
      p_max_rate: 40000,
      p_min_rating: 4.5,
      p_limit: 40,
    });
  });

  it("lo vacío o inválido no se envía", () => {
    const args = publicProfessionalsArgs({
      specialty: "   ",
      city: "",
      verified: false,
      minRate: 0,
      maxRate: -5,
      minRating: 0,
    });
    expect(Object.keys(args)).toEqual(["p_limit"]);
    expect(
      publicProfessionalsArgs({ minRate: Number.NaN, maxRate: Number.POSITIVE_INFINITY }),
    ).toEqual({
      p_limit: 60,
    });
    expect(publicProfessionalsArgs({ specialty: null, city: null, verified: null })).toEqual({
      p_limit: 60,
    });
  });

  it("verificado = falso significa «sin restricción», igual que en la base", () => {
    expect(publicProfessionalsArgs({ verified: false })).not.toHaveProperty("p_verified");
    expect(publicProfessionalsArgs({ verified: true })).toHaveProperty("p_verified", true);
  });

  it("las tarifas se redondean hacia abajo a enteros y la calificación no pasa de 5", () => {
    expect(publicProfessionalsArgs({ minRate: 20000.9 }).p_min_rate).toBe(20000);
    expect(publicProfessionalsArgs({ minRating: 9 }).p_min_rating).toBe(5);
  });

  it("el límite se acota entre 1 y 500", () => {
    expect(publicProfessionalsArgs({ limit: 0 }).p_limit).toBe(1);
    expect(publicProfessionalsArgs({ limit: -3 }).p_limit).toBe(1);
    expect(publicProfessionalsArgs({ limit: 100000 }).p_limit).toBe(PUBLIC_PROS_MAX_LIMIT);
    expect(publicProfessionalsArgs({ limit: 12.8 }).p_limit).toBe(12);
    expect(publicProfessionalsArgs({ limit: Number.NaN }).p_limit).toBe(60);
  });

  it("los ids se limpian, no se repiten y no pasan de 500", () => {
    expect(publicProfessionalsArgs({ ids: ["a", " b ", "a", ""] }).p_ids).toEqual(["a", "b"]);
    const many = Array.from({ length: 700 }, (_, i) => `id-${i}`);
    expect((publicProfessionalsArgs({ ids: many }).p_ids as string[]).length).toBe(500);
  });

  it("un texto largo se recorta", () => {
    expect(
      (publicProfessionalsArgs({ specialty: "x".repeat(300) }).p_specialty as string).length,
    ).toBe(80);
  });
});

describe("isEmptyIdLookup", () => {
  it("solo es vacío cuando se pidieron ids y no quedó ninguno", () => {
    expect(isEmptyIdLookup({ ids: [] })).toBe(true);
    expect(isEmptyIdLookup({ ids: ["", "  "] })).toBe(true);
    expect(isEmptyIdLookup({ ids: ["a"] })).toBe(false);
    expect(isEmptyIdLookup({})).toBe(false);
    expect(isEmptyIdLookup({ ids: null })).toBe(false);
  });
});

describe("proCity", () => {
  it("usa la ciudad base y, si no hay, la primera de servicio", () => {
    expect(proCity({ home_city: " Bogotá ", service_cities: ["Soacha"] })).toBe("Bogotá");
    expect(proCity({ home_city: null, service_cities: ["", " Cali "] })).toBe("Cali");
    expect(proCity({ home_city: "  ", service_cities: null })).toBeNull();
  });
});

// El contrato con la base: los nombres de los parámetros y sus valores por defecto no pueden separarse del SQL.
describe("contrato con la función del servidor", () => {
  const sqlParams = [...MIGRATION.matchAll(/^\s{2}(p_[a-z_]+)\s+[a-z[\]]+\s+DEFAULT/gm)].map(
    (m) => m[1],
  );

  it("todos los parámetros que envía el cliente existen en la función", () => {
    const sent = Object.keys(
      publicProfessionalsArgs({
        ids: ["a"],
        specialty: "x",
        city: "y",
        verified: true,
        minRate: 1,
        maxRate: 2,
        minRating: 3,
        limit: 4,
      }),
    );
    for (const k of sent) expect(sqlParams).toContain(k);
    expect(sqlParams.sort()).toEqual([...sent].sort());
  });

  it("la función tiene el mismo tope de filas y el mismo valor por defecto", () => {
    expect(MIGRATION).toContain(`COALESCE(p_limit, ${PUBLIC_PROS_DEFAULT_LIMIT})`);
    expect(MIGRATION).toContain(`, ${PUBLIC_PROS_MAX_LIMIT});`);
  });

  it("no entrega teléfono y deja los permisos explícitos", () => {
    const returns = MIGRATION.slice(
      MIGRATION.indexOf("RETURNS TABLE"),
      MIGRATION.indexOf("LANGUAGE plpgsql"),
    );
    expect(returns).not.toMatch(/phone|whatsapp|address/i);
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.public_professionals\([^)]*\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.public_professionals\([^)]*\) TO anon, authenticated;/,
    );
    expect(MIGRATION).toContain("SECURITY DEFINER SET search_path = public");
  });
});
