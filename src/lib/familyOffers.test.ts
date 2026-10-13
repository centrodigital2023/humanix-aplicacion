import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_FILTERS,
  applicationBadge,
  applyOfferFilters,
  buildOfferApplicationDraft,
  hourlyEquivalent,
  normalizeOfferRow,
  offerPayView,
  rankOffers,
  scoreOffer,
  type InstitutionOfferRow,
} from "./institutionOffers";
import { professionalNet } from "./institutionNegotiation";
import {
  normalizeFamilyOfferRow,
  summarizeFamilyOffers,
  type FamilyOfferRow,
} from "./familyOffers";
import type { ProContext } from "./opportunities";

const NOW = Date.parse("2026-10-13T15:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

function row(over: Partial<FamilyOfferRow> = {}): FamilyOfferRow {
  return {
    offer_id: "f1",
    family_user_id: "fam1",
    display_name: "Ana G.",
    title: "Cuidado de adulto mayor",
    description: "Acompañamiento diurno de enfermería",
    city: "Bogotá",
    specialty_required: "Enfermería",
    requirements: ["Experiencia con adultos mayores"],
    modality: "hour",
    amount: 24_000,
    is_urgent: false,
    start_date: at(20),
    end_date: at(200),
    created_at: at(-3),
    my_application_id: null,
    my_status: null,
    my_awaiting: null,
    my_amount: null,
    family_stars: null,
    family_ratings: 0,
    family_completed: 0,
    family_trust: 30,
    family_trust_level: "building",
    family_trust_enough: false,
    family_verified: false,
    distance_band_km: 5,
    ...over,
  };
}

const pro: ProContext = {
  specialty: "Enfermería",
  subSpecialties: [],
  cities: ["Bogotá"],
  hourlyRate: 22_000,
  busy: [],
};

describe("normalizeFamilyOfferRow", () => {
  it("es una oferta de familia sin turnos: el horario se acuerda al aceptar", () => {
    const o = normalizeFamilyOfferRow(row());
    expect(o.party).toBe("family");
    expect(o.institutionName).toBe("Ana G.");
    expect(o.institutionId).toBe("fam1");
    expect(o.hasAgenda).toBe(false);
    expect(o.shifts).toEqual([]);
    expect(o.firstStart).toBe(at(20));
    expect(o.lastEnd).toBe(at(200));
    expect(o.modality).toBe("hour");
    expect(o.institutionType).toBeNull();
  });

  it("trae el Trust Score de la familia y la cercanía en rangos", () => {
    const o = normalizeFamilyOfferRow(
      row({
        family_trust: 88,
        family_trust_level: "excellent",
        family_trust_enough: true,
        family_verified: true,
        distance_band_km: 10,
      }),
    );
    expect(o.trust).toEqual({ score: 88, level: "excellent", enough: true, verified: true });
    expect(o.distanceBand).toBe(10);
    expect(o.verified).toBe(true);
  });

  it("familia nueva: Trust Score sin historial y sin cercanía si no hay ubicación", () => {
    const o = normalizeFamilyOfferRow(row({ distance_band_km: null }));
    expect(o.trust).toEqual({ score: 30, level: "building", enough: false, verified: false });
    expect(o.distanceBand).toBeNull();
    expect(o.rating).toEqual({ stars: null, ratings: 0 });
  });

  it("sin nombre se llama «Familia» (nunca «Institución de salud»)", () => {
    expect(normalizeFamilyOfferRow(row({ display_name: "  " })).institutionName).toBe("Familia");
    expect(normalizeFamilyOfferRow(row({ display_name: null })).institutionName).toBe("Familia");
  });

  it("la calificación de la familia llega como número o como texto", () => {
    expect(normalizeFamilyOfferRow(row({ family_stars: 4.8, family_ratings: 5 })).rating).toEqual({
      stars: 4.8,
      ratings: 5,
    });
    expect(
      normalizeFamilyOfferRow(row({ family_stars: "4.50", family_ratings: 3 })).rating,
    ).toEqual({ stars: 4.5, ratings: 3 });
  });

  it("la negociación en curso: a quién le toca responder y el valor propuesto", () => {
    const o = normalizeFamilyOfferRow(
      row({
        my_application_id: "a1",
        my_status: "pending",
        my_awaiting: "professional",
        my_amount: 26_000,
      }),
    );
    expect(o.application).toEqual({
      id: "a1",
      status: "pending",
      awaiting: "professional",
      amount: 26_000,
    });
    expect(applicationBadge(o)?.label).toBe("Te respondieron: contraoferta pendiente");
    const waiting = normalizeFamilyOfferRow(
      row({ my_application_id: "a1", my_status: "pending", my_awaiting: "institution" }),
    );
    expect(applicationBadge(waiting)?.label).toBe("Postulación enviada");
  });

  it("si la familia rechazó, lo dice con «la familia» y no con «la institución»", () => {
    const o = normalizeFamilyOfferRow(row({ my_application_id: "a1", my_status: "rejected" }));
    expect(applicationBadge(o)?.label).toBe("La familia respondió tu postulación");
  });

  it("no incluye campos de dirección o teléfono", () => {
    const o = normalizeFamilyOfferRow(row()) as unknown as Record<string, unknown>;
    for (const k of Object.keys(o)) expect(k).not.toMatch(/address|phone|contact|direccion/i);
  });
});

describe("compatibilidad con una oferta de familia", () => {
  it("por hora: el valor por hora es el publicado y se compara con la tarifa del profesional", () => {
    const o = normalizeFamilyOfferRow(row({ amount: 24_000 }));
    expect(hourlyEquivalent(o)).toBe(24_000);
    const m = scoreOffer(o, pro);
    expect(m.reasons).toContain("Paga igual o más que tu tarifa");
    expect(m.conflict).toBe(false);
  });

  it("por turno sin agenda no tiene equivalente por hora", () => {
    expect(
      hourlyEquivalent(normalizeFamilyOfferRow(row({ modality: "shift", amount: 150_000 }))),
    ).toBeNull();
  });

  it("los textos hablan de la familia, no de la institución", () => {
    const m = scoreOffer(normalizeFamilyOfferRow(row({ specialty_required: null })), pro);
    const all = [...m.reasons, ...m.warnings].join(" | ");
    expect(all).not.toMatch(/instituci/i);
    expect(m.warnings).toContain("Horario por coordinar con la familia");
  });

  it("familia verificada y bien calificada suma confianza y lo explica", () => {
    const good = scoreOffer(
      normalizeFamilyOfferRow(row({ family_verified: true, family_stars: 4.8, family_ratings: 6 })),
      pro,
    );
    expect(good.reasons).toEqual(
      expect.arrayContaining([
        "Familia con identidad verificada",
        "Familia con excelente reputación (4.8 · 6 reseñas)",
      ]),
    );
    const bad = scoreOffer(
      normalizeFamilyOfferRow(row({ family_stars: 2.8, family_ratings: 4 })),
      pro,
    );
    expect(bad.warnings).toContain("Familia con calificación baja (2.8 · 4 reseñas)");
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it("una familia nueva sin verificar no recibe la advertencia «sin verificar» de las instituciones", () => {
    const m = scoreOffer(normalizeFamilyOfferRow(row()), pro);
    expect(m.warnings.join(" ")).not.toMatch(/sin verificar/i);
  });

  it("fuera de las ciudades del profesional lo advierte", () => {
    const m = scoreOffer(normalizeFamilyOfferRow(row({ city: "Cali" })), pro);
    expect(m.warnings).toContain("Fuera de tus ciudades de servicio");
  });
});

describe("orden, filtros y resumen de las ofertas de familias", () => {
  const rows = [
    row({ offer_id: "lejos-caro", amount: 40_000, distance_band_km: 50, start_date: at(40) }),
    row({ offer_id: "cerca-barato", amount: 15_000, distance_band_km: 2, start_date: at(30) }),
    row({
      offer_id: "medio",
      amount: 28_000,
      distance_band_km: 10,
      start_date: at(20),
      is_urgent: true,
    }),
    row({ offer_id: "sin-ubicacion", amount: 30_000, distance_band_km: null, start_date: at(60) }),
    row({
      offer_id: "ya-aplique",
      amount: 26_000,
      distance_band_km: 5,
      my_application_id: "a1",
      my_status: "pending",
      my_awaiting: "institution",
    }),
  ];
  const ranked = rankOffers(rows.map(normalizeFamilyOfferRow), pro, NOW);
  const ids = (items: typeof ranked) => items.map((r) => r.offer.id);

  it("más cerca de ti: por rango y las que no tienen ubicación al final", () => {
    const out = applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, sort: "nearest" });
    expect(ids(out)).toEqual([
      "cerca-barato",
      "ya-aplique",
      "medio",
      "lejos-caro",
      "sin-ubicacion",
    ]);
  });

  it("mejor pago por hora: de mayor a menor", () => {
    const out = applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, sort: "hourly" });
    expect(ids(out)).toEqual([
      "lejos-caro",
      "sin-ubicacion",
      "medio",
      "ya-aplique",
      "cerca-barato",
    ]);
  });

  it("valor mínimo por hora, urgentes y ocultar las que ya apliqué", () => {
    expect(
      ids(applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, minHourly: 27_000 })).sort(),
    ).toEqual(["lejos-caro", "medio", "sin-ubicacion"]);
    expect(ids(applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, urgentOnly: true }))).toEqual([
      "medio",
    ]);
    expect(
      ids(applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, hideApplied: true })),
    ).not.toContain("ya-aplique");
  });

  it("el resumen cuenta lo que aún se puede tomar", () => {
    expect(summarizeFamilyOffers(ranked)).toEqual({
      open: 4,
      urgent: 1,
      bestHourly: 40_000,
      nearestBand: 2,
      applied: 1,
    });
    expect(summarizeFamilyOffers([])).toEqual({
      open: 0,
      urgent: 0,
      bestHourly: null,
      nearestBand: null,
      applied: 0,
    });
  });
});

describe("borrador de la postulación a una familia", () => {
  it("menciona la oferta de la familia y no a una «institución»", () => {
    const o = normalizeFamilyOfferRow(row());
    const text = buildOfferApplicationDraft(
      o,
      { name: "Laura Pérez", specialty: "Enfermería", yearsExperience: 6, rethusVerified: true },
      [],
    );
    expect(text).toContain(
      "Hola, soy Laura, Enfermería con 6 años de experiencia y RETHUS verificado.",
    );
    expect(text).toContain("Me interesa «Cuidado de adulto mayor», la oferta de Ana G.");
    expect(text).not.toMatch(/instituci/i);
    expect(text).not.toMatch(/\d{7,}/);
  });
});

describe("lo que le queda al profesional", () => {
  it("por hora sin turnos: no hay total, y el neto es por hora (nunca un guion)", () => {
    const o = normalizeFamilyOfferRow(row({ amount: 24_000 }));
    const free = offerPayView(o, 12);
    expect(free.total).toBeNull();
    expect(free.perUnit).toBe(true);
    expect(free.net).toBe(professionalNet(24_000, 12).net);
    expect(free.net).toBeLessThan(24_000);
    expect(offerPayView(o, 0).net).toBe(24_000);
  });

  it("con el valor propuesto: el neto sigue ese valor", () => {
    const o = normalizeFamilyOfferRow(row({ amount: 24_000 }));
    expect(offerPayView(o, 0, 27_000).net).toBe(27_000);
  });

  it("mensual y paquete: el total es el valor y el neto sale del total", () => {
    const o = normalizeFamilyOfferRow(row({ modality: "month", amount: 2_400_000 }));
    const v = offerPayView(o, 0);
    expect(v.total).toBe(2_400_000);
    expect(v.perUnit).toBe(false);
    expect(v.net).toBe(2_400_000);
  });

  it("una institución con turnos conserva su total", () => {
    const inst: InstitutionOfferRow = {
      offer_id: "i1",
      institution_user_id: "inst1",
      institution_name: "Clínica Santa Fe",
      institution_type: "Clínica",
      institution_verified: true,
      title: "Auxiliar UCI",
      description: null,
      city: "Bogotá",
      service_area: null,
      specialty_required: null,
      requirements: null,
      modality: "shift",
      amount: 180_000,
      is_urgent: false,
      start_date: at(30),
      end_date: at(66),
      positions_total: 2,
      positions_filled: 0,
      shifts: [
        { id: "s1", starts_at: at(30), ends_at: at(42), positions: 1, filled: 0 },
        { id: "s2", starts_at: at(54), ends_at: at(66), positions: 1, filled: 0 },
      ],
      created_at: at(-2),
      lat: null,
      lng: null,
      my_application_id: null,
      my_status: null,
      my_awaiting: null,
      my_amount: null,
      rating_count: 0,
      rating_avg: null,
      completed_services: 0,
    };
    const v = offerPayView(normalizeOfferRow(inst), 0);
    expect(v.total).toBe(360_000);
    expect(v.perUnit).toBe(false);
  });
});

describe("el borrador no duplica el punto final del nombre", () => {
  it("«Ana G.» y «Clínica X S.A.» terminan con un solo punto", () => {
    const fam = buildOfferApplicationDraft(
      normalizeFamilyOfferRow(row()),
      { name: "Laura", specialty: null, yearsExperience: null, rethusVerified: false },
      [],
    );
    expect(fam).toContain("la oferta de Ana G. Quedo atento");
    expect(fam).not.toContain("..");
    const inst = buildOfferApplicationDraft(
      { title: "Turno noche", institutionName: "Clínica Los Andes S.A.", shifts: [] },
      { name: "Laura", specialty: null, yearsExperience: null, rethusVerified: false },
      [],
    );
    expect(inst).toContain("en Clínica Los Andes S.A. Quedo atento");
    expect(inst).not.toContain("..");
    const plain = buildOfferApplicationDraft(
      { title: "Turno noche", institutionName: "Clínica Santa Fe", shifts: [] },
      { name: "Laura", specialty: null, yearsExperience: null, rethusVerified: false },
      [],
    );
    expect(plain).toContain("en Clínica Santa Fe. Quedo atento");
  });
});
