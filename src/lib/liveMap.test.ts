import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COUNTER_KEYS,
  EMPTY_COUNTS,
  STATUS_LABEL,
  counterItems,
  countsFromLegacy,
  countsFromRow,
  demandHeadline,
  fromDemandRow,
  fromInstitutionRow,
  fromProfessionalRow,
  hasPosition,
  kmTo,
  sortProfessionals,
  summarizeProfessionals,
  withPosition,
  type LiveCountsRow,
  type MapDemandRow,
  type MapInstitutionRow,
  type MapProfessionalRow,
} from "./liveMap";

const MIGRATION = readFileSync(
  require("node:path").resolve(process.cwd(), "supabase/migrations/20261012210000_live_map.sql"),
  "utf8",
);

const proRow = (over: Partial<MapProfessionalRow> = {}): MapProfessionalRow => ({
  pro_id: "p1",
  display_name: "Laura P.",
  avatar_url: null,
  specialty: "Enfermería",
  sub_specialties: ["Curaciones"],
  gender: "f",
  years_experience: 6,
  hourly_rate: 25000,
  avg_rating: "4.80",
  trust_score: 82,
  rethus_verified: true,
  verified: true,
  home_city: "Bogotá",
  lat: 4.61,
  lng: -74.08,
  status: "available",
  live: true,
  last_seen: "2026-10-14T14:59:00Z",
  ...over,
});

const demandRow = (over: Partial<MapDemandRow> = {}): MapDemandRow => ({
  poster_id: "f1",
  poster_kind: "family",
  display_name: "Ana G.",
  city: "Bogotá",
  lat: 4.7,
  lng: -74.03,
  open_offers: 1,
  open_hours: "0",
  top_hourly: 24000,
  is_urgent: false,
  offer_id: "o1",
  trust_score: 30,
  trust_level: "building",
  trust_enough: false,
  distance_band: null,
  ...over,
});

describe("el contrato con la base", () => {
  const outCols = (fn: string): string[] => {
    const m = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS TABLE \\(([\\s\\S]*?)\\)\\s*LANGUAGE`,
    ).exec(MIGRATION);
    if (!m) throw new Error(`no encontré ${fn}`);
    return m[2]
      .split(",")
      .map((c) => c.trim().split(/\s+/)[0])
      .filter(Boolean);
  };
  const keysOf = (o: object) => Object.keys(o).sort();

  it("MapProfessionalRow tiene exactamente las columnas de map_professionals", () => {
    expect(outCols("map_professionals").sort()).toEqual(keysOf(proRow()));
  });
  it("MapDemandRow tiene exactamente las columnas de map_open_demand", () => {
    expect(outCols("map_open_demand").sort()).toEqual(keysOf(demandRow()));
  });
  it("MapInstitutionRow tiene exactamente las columnas de map_institutions", () => {
    const row: MapInstitutionRow = {
      inst_id: "i",
      name: "x",
      institution_type: null,
      city: null,
      lat: null,
      lng: null,
      verified: false,
      status: "idle",
      live: false,
      open_offers: 0,
    };
    expect(outCols("map_institutions").sort()).toEqual(keysOf(row));
  });
  it("LiveCountsRow tiene exactamente las columnas de get_live_counts", () => {
    const row: LiveCountsRow = {
      pro_total: 0,
      pro_available: 0,
      pro_busy: 0,
      pro_live: 0,
      pro_rethus: 0,
      fam_total: 0,
      fam_available: 0,
      fam_busy: 0,
      fam_live: 0,
      inst_total: 0,
      inst_available: 0,
      inst_busy: 0,
      inst_live: 0,
      completed_services: 0,
    };
    expect(outCols("get_live_counts").sort()).toEqual(keysOf(row));
  });
  it("las filas de los mapas no traen teléfono, dirección ni correo", () => {
    for (const fn of ["map_professionals", "map_open_demand", "map_institutions"]) {
      expect(outCols(fn).join(",")).not.toMatch(/phone|whatsapp|address|email|exact|patient/);
    }
  });
});

describe("fromProfessionalRow", () => {
  it("normaliza una fila completa", () => {
    const p = fromProfessionalRow(proRow());
    expect(p).toMatchObject({
      id: "p1",
      name: "Laura P.",
      specialty: "Enfermería",
      hourlyRate: 25000,
      rating: 4.8,
      rethus: true,
      verified: true,
      city: "Bogotá",
      lat: 4.61,
      lng: -74.08,
      status: "available",
      live: true,
    });
    expect(p.trust.score).toBe(82);
    expect(p.trust.level).toBe("high");
  });
  it("sin puntaje (0 o vacío) queda «sin validar», no inventa un número", () => {
    expect(fromProfessionalRow(proRow({ trust_score: 0 })).trust.score).toBeNull();
    expect(fromProfessionalRow(proRow({ trust_score: null })).trust.level).toBe("unrated");
  });
  it("sin calificaciones ni tarifa no muestra ceros", () => {
    const p = fromProfessionalRow(proRow({ avg_rating: 0, hourly_rate: 0 }));
    expect(p.rating).toBeNull();
    expect(p.hourlyRate).toBeNull();
  });
  it("trae subespecialidades y género (para los filtros del mapa); sin dato, lista vacía", () => {
    const p = fromProfessionalRow(proRow());
    expect(p.subSpecialties).toEqual(["Curaciones"]);
    expect(p.gender).toBe("f");
    expect(
      fromProfessionalRow(proRow({ sub_specialties: null, gender: null })).subSpecialties,
    ).toEqual([]);
  });
  it("sin nombre dice «Profesional»", () => {
    expect(fromProfessionalRow(proRow({ display_name: null })).name).toBe("Profesional");
    expect(fromProfessionalRow(proRow({ display_name: "  " })).name).toBe("Profesional");
  });
  it("un estado desconocido es «no disponible», nunca «disponible»", () => {
    expect(fromProfessionalRow(proRow({ status: "raro" })).status).toBe("unavailable");
    expect(fromProfessionalRow(proRow({ status: null })).status).toBe("unavailable");
  });
  it("etiquetas de estado", () => {
    expect(STATUS_LABEL).toEqual({
      available: "Disponible",
      busy: "Ocupado",
      unavailable: "No disponible",
    });
  });
});

describe("fromDemandRow y demandHeadline", () => {
  it("una familia con una oferta", () => {
    const d = fromDemandRow(demandRow());
    expect(d).toMatchObject({
      id: "f1",
      kind: "family",
      name: "Ana G.",
      openOffers: 1,
      openHours: 0,
      topHourly: 24000,
      offerId: "o1",
      urgent: false,
    });
    expect(d.trust.level).toBe("building");
    expect(d.trust.enough).toBe(false);
  });
  it("una institución", () => {
    const d = fromDemandRow(
      demandRow({ poster_kind: "institution", display_name: "Clínica Norte" }),
    );
    expect(d.kind).toBe("institution");
    expect(d.name).toBe("Clínica Norte");
  });
  it("las horas llegan como texto numérico", () => {
    expect(
      fromDemandRow(demandRow({ open_hours: "1.5", open_offers: 0, offer_id: null })).openHours,
    ).toBe(1.5);
  });
  it("sin nombre: «Familia» o «Institución»", () => {
    expect(fromDemandRow(demandRow({ display_name: null })).name).toBe("Familia");
    expect(fromDemandRow(demandRow({ display_name: null, poster_kind: "institution" })).name).toBe(
      "Institución",
    );
  });
  it("el resumen de lo abierto", () => {
    expect(demandHeadline({ openOffers: 1, openHours: 0, topHourly: 24000 })).toMatch(
      /^1 oferta · hasta \$\s?24\.000\/h$/,
    );
    expect(demandHeadline({ openOffers: 2, openHours: 3, topHourly: 18000 })).toMatch(
      /^2 ofertas · 3 h sueltas · hasta \$\s?18\.000\/h$/,
    );
    expect(demandHeadline({ openOffers: 0, openHours: 1.5, topHourly: null })).toBe(
      "1.5 h sueltas",
    );
    expect(demandHeadline({ openOffers: 0, openHours: 0, topHourly: null })).toBe(
      "Sin ofertas abiertas",
    );
  });
});

describe("fromInstitutionRow", () => {
  it("normaliza y no inventa estados", () => {
    const base: MapInstitutionRow = {
      inst_id: "i1",
      name: "Clínica Norte",
      institution_type: "clinica",
      city: "Bogotá",
      lat: 4.65,
      lng: -74.065,
      verified: true,
      status: "available",
      live: true,
      open_offers: 2,
    };
    expect(fromInstitutionRow(base)).toMatchObject({
      id: "i1",
      name: "Clínica Norte",
      status: "available",
      live: true,
      openOffers: 2,
      verified: true,
    });
    expect(fromInstitutionRow({ ...base, status: "x" }).status).toBe("idle");
    expect(fromInstitutionRow({ ...base, name: null }).name).toBe("Institución");
  });
});

describe("contadores", () => {
  const row: LiveCountsRow = {
    pro_total: "5",
    pro_available: "1",
    pro_busy: 2,
    pro_live: "2",
    pro_rethus: "1",
    fam_total: 4,
    fam_available: 3,
    fam_busy: 1,
    fam_live: 1,
    inst_total: 3,
    inst_available: 1,
    inst_busy: 1,
    inst_live: 1,
    completed_services: "1",
  };
  it("convierte los bigint (llegan como texto) en números", () => {
    const c = countsFromRow(row);
    expect(c.professionals).toEqual({ total: 5, available: 1, busy: 2, live: 2 });
    expect(c.families).toEqual({ total: 4, available: 3, busy: 1, live: 1 });
    expect(c.institutions).toEqual({ total: 3, available: 1, busy: 1, live: 1 });
    expect(c.professionalsRethus).toBe(1);
    expect(c.completedServices).toBe(1);
  });
  it("sin fila, todo en cero; con basura, cero y nunca negativo", () => {
    expect(countsFromRow(null)).toEqual(EMPTY_COUNTS);
    expect(countsFromRow({ ...row, pro_total: "abc", pro_live: -3 }).professionals).toMatchObject({
      total: 0,
      live: 0,
    });
  });
  it("la función antigua sigue sirviendo mientras no exista la nueva (sin ocupados)", () => {
    const c = countsFromLegacy({
      professionals_total: 5,
      professionals_available: 1,
      professionals_rethus: 1,
      professionals_online: 2,
      families_total: 4,
      families_online: 1,
      institutions_total: 3,
      institutions_online: 1,
      completed_services: 1,
    });
    expect(c.professionals).toEqual({ total: 5, available: 1, busy: 0, live: 2 });
    expect(c.families).toEqual({ total: 4, available: 0, busy: 0, live: 1 });
  });
  it("cada quien mira a quien le sirve", () => {
    const c = countsFromRow(row);
    expect(counterItems("professional", c).map((i) => i.key)).toEqual(["families", "institutions"]);
    expect(counterItems("family", c).map((i) => i.key)).toEqual(["professionals", "institutions"]);
    expect(counterItems("institution", c).map((i) => i.key)).toEqual([
      "professionals",
      "institutions",
    ]);
    expect(counterItems("guest", c).map((i) => i.key)).toEqual([
      "professionals",
      "families",
      "institutions",
    ]);
    expect(Object.keys(COUNTER_KEYS).sort()).toEqual([
      "family",
      "guest",
      "institution",
      "professional",
    ]);
  });
  it("cada grupo dice qué significa «disponible»", () => {
    const [pros] = counterItems("family", countsFromRow(row));
    expect(pros).toMatchObject({
      key: "professionals",
      label: "Profesionales",
      availableLabel: "disponibles",
      busyLabel: "ocupados",
      available: 1,
      busy: 2,
      live: 2,
      total: 5,
    });
    const [fams] = counterItems("professional", countsFromRow(row));
    expect(fams).toMatchObject({
      key: "families",
      availableLabel: "buscando cuidado",
      available: 3,
      busy: 1,
    });
  });
});

describe("posición, orden y resumen", () => {
  const origin = { lat: 4.6097, lng: -74.0817 };
  const list = [
    fromProfessionalRow(
      proRow({
        pro_id: "far",
        display_name: "Lejos",
        lat: 6.24,
        lng: -75.58,
        live: false,
        status: "available",
        avg_rating: 5,
      }),
    ),
    fromProfessionalRow(
      proRow({
        pro_id: "near",
        display_name: "Cerca",
        lat: 4.61,
        lng: -74.08,
        live: false,
        status: "available",
        avg_rating: 3,
      }),
    ),
    fromProfessionalRow(
      proRow({
        pro_id: "busy",
        display_name: "Ocupada",
        lat: 4.61,
        lng: -74.08,
        live: false,
        status: "busy",
      }),
    ),
    fromProfessionalRow(
      proRow({
        pro_id: "off",
        display_name: "Fuera",
        lat: 4.61,
        lng: -74.08,
        live: false,
        status: "unavailable",
      }),
    ),
    fromProfessionalRow(
      proRow({
        pro_id: "live",
        display_name: "En vivo",
        lat: 4.9,
        lng: -74.0,
        live: true,
        status: "busy",
      }),
    ),
    fromProfessionalRow(
      proRow({
        pro_id: "nopos",
        display_name: "Sin sitio",
        lat: null,
        lng: null,
        live: false,
        status: "available",
      }),
    ),
  ];
  it("hasPosition y withPosition no inventan sitios", () => {
    expect(hasPosition({ lat: 4.6, lng: -74 })).toBe(true);
    expect(hasPosition({ lat: null, lng: -74 })).toBe(false);
    expect(hasPosition({ lat: Number.NaN, lng: -74 })).toBe(false);
    expect(withPosition(list).map((p) => p.id)).not.toContain("nopos");
    expect(withPosition(list)).toHaveLength(5);
  });
  it("en vivo primero, luego disponible/ocupado/no disponible, luego cercanía", () => {
    expect(sortProfessionals(list, origin).map((p) => p.id)).toEqual([
      "live",
      "near",
      "far",
      "nopos",
      "busy",
      "off",
    ]);
  });
  it("sin punto de partida ordena por estado y calificación", () => {
    expect(sortProfessionals(list, null).map((p) => p.id)).toEqual([
      "live",
      "far",
      "nopos",
      "near",
      "busy",
      "off",
    ]);
  });
  it("no modifica la lista original", () => {
    const copy = list.map((p) => p.id);
    sortProfessionals(list, origin);
    expect(list.map((p) => p.id)).toEqual(copy);
  });
  it("kmTo", () => {
    expect(kmTo(origin, { lat: 4.6097, lng: -74.0817 })).toBeCloseTo(0, 5);
    expect(kmTo(null, { lat: 4.6, lng: -74 })).toBeNull();
    expect(kmTo(origin, { lat: null, lng: null })).toBeNull();
  });
  it("resumen para los filtros del mapa", () => {
    expect(summarizeProfessionals(list)).toEqual({
      total: 6,
      available: 3,
      busy: 2,
      unavailable: 1,
      live: 1,
      withoutPosition: 1,
    });
  });
});
