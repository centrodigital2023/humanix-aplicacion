// Pruebas de propiedades: miles de filas aleatorias (con nulos, datos antiguos y valores raros) y las reglas que
// siempre deben cumplirse. Complementan las pruebas con ejemplos de `marketValidation.test.ts`.
import { describe, expect, it } from "vitest";
import { NOW, makeRows, mulberry32 } from "./marketRows.fixture";
import {
  PROFILES,
  filterRows,
  normalizeContact,
  responsesToCsv,
  signalOf,
  tabulate,
  tierFor,
} from "./marketValidation";

/** Lector mínimo de CSV con «;» y comillas dobles (RFC 4180) para comprobar la exportación. */
function parseCsv(csv: string): string[][] {
  const text = csv.replace(/^\uFEFF/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

describe("invariantes de la tabulación (filas aleatorias)", () => {
  for (const seed of [1, 7, 42, 2026, 31415]) {
    const rows = makeRows(seed, 400);
    const t = tabulate(rows, NOW);

    it(`semilla ${seed}: nunca lanza y los totales cuadran`, () => {
      expect(t.total).toBe(rows.length);
      expect(Object.values(t.pays).reduce((s, n) => s + n, 0)).toBe(rows.length);
      const known = rows.filter((r) => (PROFILES as readonly string[]).includes(r.profile_type));
      expect(t.byProfile.reduce((s, p) => s + p.count, 0)).toBe(known.length);
      expect(t.verified).toBe(rows.filter((r) => r.contact_verified_at).length);
      for (const v of [t.verifiedPct, t.payingPct]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(t.redeemed).toBeLessThanOrEqual(t.total);
      expect(t.withBenefit).toBeLessThanOrEqual(t.total);
    });

    it(`semilla ${seed}: los tramos cuentan solo disposiciones válidas (0–100)`, () => {
      const valid = rows.filter(
        (r) =>
          typeof r.willingness_pct === "number" &&
          r.willingness_pct >= 0 &&
          r.willingness_pct <= 100,
      ).length;
      expect(t.wtpBuckets.reduce((s, b) => s + b.count, 0)).toBe(valid);
      expect(t.avgWtp).toBeGreaterThanOrEqual(0);
      expect(t.avgWtp).toBeLessThanOrEqual(100);
      expect(t.medianWtp).toBeGreaterThanOrEqual(0);
      expect(t.medianWtp).toBeLessThanOrEqual(100);
    });

    it(`semilla ${seed}: señal entre 0 y 100 y niveles que suman las filas con señal`, () => {
      const withSignal = rows.map(signalOf).filter((x): x is number => x !== null);
      withSignal.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      });
      expect(t.tiers.strong + t.tiers.medium + t.tiers.weak).toBe(withSignal.length);
      expect(t.avgSignal).toBeGreaterThanOrEqual(0);
      expect(t.avgSignal).toBeLessThanOrEqual(100);
    });

    it(`semilla ${seed}: la serie diaria tiene 14 días consecutivos y no inventa respuestas`, () => {
      expect(t.daily).toHaveLength(14);
      for (let i = 1; i < 14; i++) {
        expect(Date.parse(t.daily[i].day) - Date.parse(t.daily[i - 1].day)).toBe(86_400_000);
      }
      const sum = t.daily.reduce((s, d) => s + d.count, 0);
      expect(sum).toBeLessThanOrEqual(rows.length);
      expect(t.daily.every((d) => d.count >= 0)).toBe(true);
    });

    it(`semilla ${seed}: los conteos por nombre nunca superan el total ni salen vacíos`, () => {
      for (const list of [t.topAlternatives, t.topChannels, t.byCity, t.keywords]) {
        list.forEach((x) => {
          expect(x.name.trim().length).toBeGreaterThan(0);
          expect(x.count).toBeGreaterThan(0);
          expect(x.count).toBeLessThanOrEqual(rows.length);
          expect(x.pct).toBeGreaterThanOrEqual(0);
          expect(x.pct).toBeLessThanOrEqual(100);
        });
      }
    });
  }
});

describe("invariantes de los filtros y de la exportación", () => {
  const rows = makeRows(99, 300);

  it("sin filtros devuelve todo; cada filtro devuelve un subconjunto; combinar = intersección", () => {
    expect(filterRows(rows, {})).toHaveLength(rows.length);
    expect(filterRows(rows, { profile: "all", verified: "all", tier: "all", q: "" })).toHaveLength(
      rows.length,
    );
    for (const profile of PROFILES) {
      const a = filterRows(rows, { profile });
      expect(a.every((r) => r.profile_type === profile)).toBe(true);
      const b = filterRows(rows, { verified: "yes" });
      expect(b.every((r) => r.contact_verified_at)).toBe(true);
      const both = filterRows(rows, { profile, verified: "yes" });
      const inter = a.filter((r) => b.includes(r));
      expect(both.map((r) => r.id).sort()).toEqual(inter.map((r) => r.id).sort());
    }
    const yes = filterRows(rows, { verified: "yes" }).length;
    const no = filterRows(rows, { verified: "no" }).length;
    expect(yes + no).toBe(rows.length);
  });

  it("el filtro por nivel coincide con tierFor(signalOf)", () => {
    for (const tier of ["strong", "medium", "weak"] as const) {
      const got = filterRows(rows, { tier });
      expect(
        got.every((r) => {
          const s = signalOf(r);
          return s !== null && tierFor(s) === tier;
        }),
      ).toBe(true);
    }
  });

  it("la búsqueda ignora tildes y mayúsculas", () => {
    const hit = filterRows(rows, { q: "MEDELLIN" });
    expect(hit.length).toBeGreaterThan(0);
    expect(filterRows(rows, { q: "medellín" }).map((r) => r.id)).toEqual(hit.map((r) => r.id));
  });

  it("el CSV tiene una fila por respuesta y ninguna celda se interpreta como fórmula", () => {
    const parsed = parseCsv(responsesToCsv(rows));
    expect(parsed).toHaveLength(rows.length + 1);
    const width = parsed[0].length;
    expect(parsed.every((r) => r.length === width)).toBe(true);
    for (const r of parsed) {
      for (const cell of r) expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    }
  });
});

describe("invariantes de los contactos", () => {
  const rnd = mulberry32(5);
  const digits = () => Array.from({ length: 9 }, () => Math.floor(rnd() * 10)).join("");

  it("un celular colombiano se normaliza igual escrito de cualquier forma", () => {
    for (let i = 0; i < 300; i++) {
      const d = `3${digits()}`;
      const forms = [
        d,
        `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`,
        `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
        `+57 ${d}`,
        `57${d}`,
        `0057${d}`,
      ];
      const keys = new Set(forms.map((f) => normalizeContact(f)?.key));
      expect(keys).toEqual(new Set([`57${d}`]));
      // idempotente: normalizar el valor normalizado da lo mismo
      const n = normalizeContact(d)!;
      expect(normalizeContact(n.value)?.key).toBe(n.key);
    }
  });

  it("un mismo correo con etiquetas, mayúsculas y puntos de Gmail comparte clave", () => {
    for (let i = 0; i < 200; i++) {
      const local = `ana${i}bc`;
      const variants = [
        `${local}@gmail.com`,
        `${local.toUpperCase()}@Gmail.com`,
        `${local}+promo@gmail.com`,
        `${local.split("").join(".")}@googlemail.com`,
      ];
      expect(new Set(variants.map((v) => normalizeContact(v)?.key)).size).toBe(1);
    }
    // fuera de Gmail los puntos sí distinguen a las personas
    expect(normalizeContact("a.na@empresa.co")?.key).not.toBe(
      normalizeContact("ana@empresa.co")?.key,
    );
  });

  it("lo que no es contacto se rechaza sin lanzar", () => {
    for (const bad of [
      "",
      "   ",
      "hola",
      "123",
      "3001234",
      "a@b",
      "@@",
      "x".repeat(300),
      "3" + "9".repeat(12),
    ]) {
      expect(() => normalizeContact(bad)).not.toThrow();
      expect(normalizeContact(bad)).toBeNull();
    }
  });
});
