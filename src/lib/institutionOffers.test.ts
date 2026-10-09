import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_FILTERS,
  applicationBadge,
  buildOfferApplicationDraft,
  applyOfferFilters,
  distinctOfferCities,
  estimatedOfferTotal,
  groupOffersByDay,
  hourlyEquivalent,
  normalizeOfferRow,
  rankOffers,
  scoreOffer,
  summarizeOffers,
  type InstitutionOfferRow,
} from "./institutionOffers";
import type { ProContext } from "./opportunities";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

function row(over: Partial<InstitutionOfferRow> = {}): InstitutionOfferRow {
  return {
    offer_id: "o1",
    institution_user_id: "i1",
    institution_name: "Clínica Santa Fe",
    institution_type: "Clínica",
    institution_verified: true,
    title: "Auxiliar de enfermería UCI adultos",
    description: "Noches en UCI",
    city: "Bogotá",
    service_area: "UCI adultos",
    specialty_required: "Auxiliar de enfermería",
    requirements: ["RETHUS vigente"],
    modality: "shift",
    amount: 180_000,
    is_urgent: false,
    start_date: at(30),
    end_date: at(66),
    positions_total: 2,
    positions_filled: 0,
    shifts: [
      { id: "s2", starts_at: at(54), ends_at: at(66), positions: 1, filled: 0 },
      { id: "s1", starts_at: at(30), ends_at: at(42), positions: 1, filled: 0 },
    ],
    created_at: at(-2),
    lat: 4.68,
    lng: -74.04,
    my_application_id: null,
    my_status: null,
    my_awaiting: null,
    my_amount: null,
    rating_count: 0,
    rating_avg: null,
    completed_services: 0,
    ...over,
  };
}

const pro: ProContext = {
  specialty: "Auxiliar de enfermería",
  subSpecialties: [],
  cities: ["Bogotá"],
  hourlyRate: 15_000,
  busy: [],
};

describe("normalizeOfferRow", () => {
  it("ordena los turnos, calcula horas y cupos abiertos", () => {
    const o = normalizeOfferRow(row());
    expect(o.shifts.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(o.hasAgenda).toBe(true);
    expect(o.firstStart).toBe(at(30));
    expect(o.lastEnd).toBe(at(66));
    expect(o.totalHours).toBe(24);
    expect(o.positionsOpen).toBe(2);
    expect(o.modality).toBe("shift");
  });

  it("nunca incluye campos de dirección o teléfono", () => {
    const o = normalizeOfferRow(row()) as unknown as Record<string, unknown>;
    for (const k of Object.keys(o)) expect(k).not.toMatch(/address|phone|contact|direccion/i);
  });

  it("ofertas antiguas sin agenda usan las fechas de la oferta", () => {
    const o = normalizeOfferRow(row({ shifts: null, start_date: at(20), end_date: at(32) }));
    expect(o.hasAgenda).toBe(false);
    expect(o.firstStart).toBe(at(20));
    expect(o.lastEnd).toBe(at(32));
    expect(o.positionsOpen).toBe(0);
  });

  it("completa nombre y modalidad faltantes o inválidos", () => {
    const o = normalizeOfferRow(row({ institution_name: "  ", modality: "weird", city: null }));
    expect(o.institutionName).toBe("Institución de salud");
    expect(o.modality).toBe("shift");
    expect(o.city).toBe("");
  });

  it("la calificación solo viene si el servidor la entrega", () => {
    expect(normalizeOfferRow(row({ rating_avg: "4.67", rating_count: 3 })).rating).toEqual({
      stars: 4.67,
      ratings: 3,
    });
    expect(normalizeOfferRow(row()).rating).toEqual({ stars: null, ratings: 0 });
  });

  it("distingue postulación vigente de una ya cerrada", () => {
    const active = normalizeOfferRow(
      row({
        my_application_id: "a1",
        my_status: "pending",
        my_awaiting: "professional",
        my_amount: 190_000,
      }),
    );
    expect(active.application).toEqual({
      id: "a1",
      status: "pending",
      awaiting: "professional",
      amount: 190_000,
    });
    expect(active.lastClosedStatus).toBeNull();
    const closed = normalizeOfferRow(row({ my_application_id: "a1", my_status: "withdrawn" }));
    expect(closed.application).toBeNull();
    expect(closed.lastClosedStatus).toBe("withdrawn");
  });
});

describe("valor equivalente y total estimado", () => {
  it("por hora: directo; por turno: según la duración; mensual y paquete: sin equivalente", () => {
    expect(hourlyEquivalent(normalizeOfferRow(row({ modality: "hour", amount: 20_000 })))).toBe(
      20_000,
    );
    expect(hourlyEquivalent(normalizeOfferRow(row()))).toBe(15_000);
    expect(
      hourlyEquivalent(normalizeOfferRow(row({ modality: "month", amount: 3_000_000 }))),
    ).toBeNull();
    expect(hourlyEquivalent(normalizeOfferRow(row({ shifts: null })))).toBeNull();
  });

  it("estima el total de todos los turnos abiertos", () => {
    expect(estimatedOfferTotal(normalizeOfferRow(row()))).toBe(360_000);
    expect(estimatedOfferTotal(normalizeOfferRow(row()), 200_000)).toBe(400_000);
    expect(estimatedOfferTotal(normalizeOfferRow(row({ modality: "hour", amount: 20_000 })))).toBe(
      480_000,
    );
    expect(
      estimatedOfferTotal(normalizeOfferRow(row({ modality: "month", amount: 3_000_000 }))),
    ).toBe(3_000_000);
    expect(estimatedOfferTotal(normalizeOfferRow(row({ shifts: null })))).toBeNull();
  });
});

describe("scoreOffer", () => {
  it("una oferta ideal puntúa alto y explica por qué", () => {
    const m = scoreOffer(normalizeOfferRow(row({ rating_avg: 4.8, rating_count: 6 })), pro);
    expect(m.score).toBeGreaterThanOrEqual(90);
    expect(m.label).toBe("Excelente");
    expect(m.reasons).toEqual(
      expect.arrayContaining([
        "Está en tu zona de servicio",
        "Paga igual o más que tu tarifa",
        "Sin cruces con tu agenda",
        "Institución verificada por Humanix",
      ]),
    );
    expect(m.conflict).toBe(false);
    expect(m.freeShiftIds).toEqual(["s1", "s2"]);
  });

  it("fuera de la zona y de otra especialidad baja el puntaje", () => {
    const m = scoreOffer(
      normalizeOfferRow(
        row({
          city: "Cali",
          specialty_required: "Cirugía cardiovascular",
          title: "Cirujano",
          service_area: "Quirófano",
        }),
      ),
      pro,
    );
    expect(m.score).toBeLessThan(60);
    expect(m.warnings).toEqual(expect.arrayContaining(["Fuera de tus ciudades de servicio"]));
  });

  it("detecta cruces parciales y totales con la agenda", () => {
    const partial = scoreOffer(normalizeOfferRow(row()), {
      ...pro,
      busy: [{ start: at(31), end: at(40) }],
    });
    expect(partial.conflict).toBe(false);
    expect(partial.conflictingShiftIds).toEqual(["s1"]);
    expect(partial.freeShiftIds).toEqual(["s2"]);
    expect(partial.warnings.join(" ")).toContain("1 de 2 turnos se cruzan");

    const total = scoreOffer(normalizeOfferRow(row()), {
      ...pro,
      busy: [
        { start: at(29), end: at(43) },
        { start: at(53), end: at(67) },
      ],
    });
    expect(total.conflict).toBe(true);
    expect(total.score).toBeLessThanOrEqual(40);
    expect(total.freeShiftIds).toEqual([]);
  });

  it("avisa cuando paga menos que la tarifa del profesional", () => {
    const m = scoreOffer(normalizeOfferRow(row({ amount: 120_000 })), {
      ...pro,
      hourlyRate: 20_000,
    });
    expect(m.warnings.join(" ")).toMatch(/Paga \d+% menos que tu tarifa/);
  });

  it("sin agenda no hay cruces pero se avisa que el horario se coordina", () => {
    const m = scoreOffer(normalizeOfferRow(row({ shifts: null })), pro);
    expect(m.conflict).toBe(false);
    expect(m.warnings).toContain("Horario por coordinar con la institución");
  });

  it("institución sin verificar o con baja calificación genera advertencias; sin historial no penaliza", () => {
    const unverified = scoreOffer(normalizeOfferRow(row({ institution_verified: false })), pro);
    expect(unverified.warnings).toContain("Institución aún sin verificar");
    const low = scoreOffer(normalizeOfferRow(row({ rating_avg: 2.9, rating_count: 5 })), pro);
    expect(low.warnings.join(" ")).toContain("calificación baja");
    const fresh = scoreOffer(normalizeOfferRow(row({ rating_avg: 1, rating_count: 2 })), pro);
    expect(fresh.warnings.join(" ")).not.toContain("calificación baja");
  });

  it("el puntaje siempre está entre 0 y 100", () => {
    for (const r of [row(), row({ city: null, specialty_required: null }), row({ shifts: [] })]) {
      const s = scoreOffer(normalizeOfferRow(r), pro).score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("rankOffers, filtros y resumen", () => {
  const offers = [
    normalizeOfferRow(row({ offer_id: "a", title: "Auxiliar UCI", is_urgent: false })),
    normalizeOfferRow(
      row({ offer_id: "b", title: "Auxiliar urgencias", is_urgent: true, city: "Cali" }),
    ),
    normalizeOfferRow(
      row({
        offer_id: "c",
        title: "Hospitalización noche",
        shifts: [{ id: "c1", starts_at: at(30), ends_at: at(42), positions: 1, filled: 0 }],
        institution_verified: false,
      }),
    ),
  ];

  it("urgentes primero, sin conflicto antes que con conflicto", () => {
    const ranked = rankOffers(offers, { ...pro, cities: ["Bogotá", "Cali"] }, NOW);
    expect(ranked[0].offer.id).toBe("b");
    const clash = rankOffers(offers, { ...pro, busy: [{ start: at(29), end: at(43) }] }, NOW);
    expect(clash[clash.length - 1].match.conflict).toBe(true);
  });

  it("filtra por ciudad, texto, modalidad, verificación y urgencia", () => {
    const ranked = rankOffers(offers, { ...pro, cities: ["Bogotá", "Cali"] }, NOW);
    expect(
      applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, city: "cali" }).map((r) => r.offer.id),
    ).toEqual(["b"]);
    expect(
      applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, query: "hospitalizacion" }).map(
        (r) => r.offer.id,
      ),
    ).toEqual(["c"]);
    expect(
      applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, verifiedOnly: true }),
    ).toHaveLength(2);
    expect(
      applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, urgentOnly: true }).map(
        (r) => r.offer.id,
      ),
    ).toContain("b");
    expect(applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, modality: "hour" })).toHaveLength(
      0,
    );
    expect(applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, minHourly: 99_000 })).toHaveLength(
      0,
    );
  });

  it("ordena por inicio o por pago", () => {
    const ranked = rankOffers(offers, pro, NOW);
    const soon = applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, sort: "soonest" });
    expect(soon.map((r) => r.offer.firstStart)).toEqual(
      [...soon.map((r) => r.offer.firstStart)].sort(),
    );
    const pay = applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, sort: "pay" });
    expect(pay[0].offer.shifts.length).toBe(2);
  });

  it("oculta las ofertas a las que ya se postuló cuando se pide", () => {
    const applied = [
      normalizeOfferRow(
        row({ my_application_id: "a1", my_status: "pending", my_awaiting: "institution" }),
      ),
      ...offers,
    ];
    const ranked = rankOffers(applied, pro, NOW);
    expect(
      applyOfferFilters(ranked, { ...DEFAULT_OFFER_FILTERS, hideApplied: true }).every(
        (r) => !r.offer.application,
      ),
    ).toBe(true);
  });

  it("resume solo lo que aún se puede tomar", () => {
    const applied = normalizeOfferRow(
      row({
        offer_id: "z",
        my_application_id: "a1",
        my_status: "pending",
        my_awaiting: "institution",
      }),
    );
    const s = summarizeOffers(
      rankOffers([...offers, applied], { ...pro, cities: ["Bogotá", "Cali"] }, NOW),
    );
    expect(s.offers).toBe(3);
    expect(s.shifts).toBe(5);
    expect(s.hours).toBe(60);
    expect(s.urgent).toBeGreaterThanOrEqual(1);
  });

  it("lista las ciudades sin repetir", () => {
    expect(distinctOfferCities(offers)).toEqual(["Bogotá", "Cali"]);
  });
});

describe("groupOffersByDay y etiquetas", () => {
  it("agrupa por el día de Colombia del primer turno y deja las ofertas sin agenda al final", () => {
    const a = normalizeOfferRow(row({ offer_id: "a" }));
    const b = normalizeOfferRow(
      row({
        offer_id: "b",
        shifts: [
          {
            id: "x",
            starts_at: "2026-10-12T02:30:00Z",
            ends_at: "2026-10-12T10:00:00Z",
            positions: 1,
            filled: 0,
          },
        ],
      }),
    );
    const c = normalizeOfferRow(
      row({ offer_id: "c", shifts: null, start_date: null, end_date: null }),
    );
    const groups = groupOffersByDay([c, b, a].map((offer) => ({ offer })));
    expect(groups[groups.length - 1].label).toBe("Horario por coordinar");
    // 02:30Z del 12 de octubre es 21:30 del 11 de octubre en Colombia.
    expect(groups.find((g) => g.items[0].offer.id === "b")?.label).toBe("dom 11 oct");
  });

  it("etiqueta el estado de la postulación", () => {
    expect(applicationBadge(normalizeOfferRow(row()))).toBeNull();
    expect(
      applicationBadge(
        normalizeOfferRow(
          row({ my_application_id: "a", my_status: "pending", my_awaiting: "institution" }),
        ),
      )?.label,
    ).toBe("Postulación enviada");
    expect(
      applicationBadge(
        normalizeOfferRow(
          row({ my_application_id: "a", my_status: "pending", my_awaiting: "professional" }),
        ),
      )?.tone,
    ).toBe("warn");
    expect(
      applicationBadge(normalizeOfferRow(row({ my_application_id: "a", my_status: "accepted" })))
        ?.tone,
    ).toBe("ok");
    expect(
      applicationBadge(normalizeOfferRow(row({ my_application_id: "a", my_status: "rejected" })))
        ?.tone,
    ).toBe("muted");
  });
});

describe("buildOfferApplicationDraft", () => {
  const offer = normalizeOfferRow(row());
  const intro = {
    name: "Laura Gómez Pérez",
    specialty: "Auxiliar de enfermería",
    yearsExperience: 5,
    rethusVerified: true,
  };

  it("presenta al profesional con lo relevante y menciona los turnos", () => {
    const d = buildOfferApplicationDraft(offer, intro);
    expect(d).toContain(
      "Hola, soy Laura, Auxiliar de enfermería con 5 años de experiencia y RETHUS verificado.",
    );
    expect(d).toContain("«Auxiliar de enfermería UCI adultos» en Clínica Santa Fe");
    expect(d).toContain("Puedo cubrir 2 de los turnos publicados.");
  });

  it("con un solo turno seleccionado lo describe", () => {
    const d = buildOfferApplicationDraft(offer, intro, ["s1"]);
    expect(d).toMatch(/Puedo cubrir el turno del \S+ \d{1,2} \S+ · /);
  });

  it("tolera perfiles incompletos y nunca incluye contacto", () => {
    const d = buildOfferApplicationDraft(offer, {
      name: null,
      specialty: null,
      yearsExperience: null,
      rethusVerified: false,
    });
    expect(d.startsWith("Hola, soy un profesional.")).toBe(true);
    expect(d).not.toMatch(/\d{7,}|@|https?:/);
  });
});
