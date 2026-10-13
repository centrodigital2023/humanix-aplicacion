import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_FILTERS,
  MAX_ACTIVE_SERVICE_OFFERS,
  SERVICE_OFFER_LIMIT_MESSAGE,
  amountRangeMessage,
  applyServiceOfferFilters,
  availableUntilToIso,
  buildServiceOfferSchema,
  classifyServiceOfferError,
  countActiveServiceOffers,
  distinctServiceOfferCities,
  hasActiveServiceFilters,
  isoToBogotaDate,
  myOfferHeadline,
  normalizeMyOfferRow,
  normalizeServiceOfferRow,
  serviceOfferFormDefaults,
  serviceOfferHourly,
  serviceOfferPriceLabel,
  summarizeServiceOffers,
  toServiceOfferPayload,
  type ServiceOfferFeedRow,
  type ServiceOfferFormValues,
  type ServiceOfferRow,
} from "./serviceOffers";
import { OFFER_ISSUE_MESSAGE } from "./contentModeration";

const NOW = Date.parse("2026-10-14T15:00:00Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

const valid: ServiceOfferFormValues = {
  title: "Enfermera profesional para cuidado domiciliario",
  description: "Cuidado de adultos mayores, curaciones y acompañamiento en casa",
  specialty: "Enfermería",
  modality: "hour",
  amount: 28_000,
  city: "Bogotá",
  availableUntil: "",
};

function issues(over: Partial<ServiceOfferFormValues>) {
  const r = buildServiceOfferSchema(NOW).safeParse({ ...valid, ...over });
  return r.success
    ? []
    : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function row(over: Partial<ServiceOfferRow> = {}): ServiceOfferRow {
  return {
    id: "so1",
    professional_id: "p1",
    title: valid.title,
    description: valid.description,
    specialty: "Enfermería",
    modality: "hour",
    amount: 28_000,
    city: "Bogotá",
    available_from: at(-5),
    available_until: null,
    status: "open",
    blocked: false,
    created_at: at(-5),
    updated_at: at(-5),
    ...over,
  };
}

function feed(over: Partial<ServiceOfferFeedRow> = {}): ServiceOfferFeedRow {
  return {
    offer_id: "s1",
    professional_id: "p1",
    display_name: "Laura Pérez",
    avatar_url: null,
    profile_specialty: "Enfermería",
    title: "Enfermera profesional para cuidado domiciliario",
    description: "Cuidado de adultos mayores",
    specialty: "Enfermería",
    modality: "hour",
    amount: 28_000,
    city: "Bogotá",
    available_from: at(-5),
    available_until: null,
    created_at: at(-5),
    avg_rating: "4.80",
    total_jobs: 12,
    rethus_verified: true,
    verified: true,
    trust_score: 82,
    trust_level: "high",
    trust_enough: true,
    availability_status: "available",
    live: true,
    distance_band_km: 5,
    ...over,
  };
}

describe("fechas de la oferta (hora de Colombia)", () => {
  it("«hasta» es el final de ese día en Colombia", () => {
    expect(availableUntilToIso("2026-10-20")).toBe("2026-10-21T04:59:59.000Z");
    expect(isoToBogotaDate("2026-10-21T04:59:59.000Z")).toBe("2026-10-20");
  });

  it("vacío o inválido no es una fecha", () => {
    expect(availableUntilToIso("")).toBeNull();
    expect(availableUntilToIso(null)).toBeNull();
    expect(availableUntilToIso("20/10/2026")).toBeNull();
    expect(availableUntilToIso("2026-13-45")).toBeNull();
    expect(isoToBogotaDate(null)).toBe("");
  });
});

describe("formulario de la oferta de servicio", () => {
  it("una oferta de cuidado completa es válida", () => {
    expect(issues({})).toEqual([]);
  });

  it("título corto o largo, ciudad vacía y valor fuera de lo que acepta el servidor", () => {
    expect(issues({ title: "Hola" })).toEqual([
      { path: "title", message: "El título debe tener al menos 5 caracteres." },
    ]);
    expect(issues({ title: "A".repeat(121) + " enfermería" }).map((i) => i.path)).toContain(
      "title",
    );
    expect(issues({ city: " " }).map((i) => i.path)).toContain("city");
    expect(issues({ amount: 500 }).map((i) => i.path)).toContain("amount");
    expect(issues({ amount: 30_000_000, modality: "month" }).map((i) => i.path)).toContain(
      "amount",
    );
  });

  it("el valor debe tener sentido para la modalidad (evita «2.400» en vez de 24.000)", () => {
    expect(issues({ amount: 2_400 })).toEqual([
      { path: "amount", message: amountRangeMessage("hour") },
    ]);
    expect(amountRangeMessage("hour")).toMatch(
      /por hora debe estar entre \$\s*8\.000 y \$\s*250\.000/,
    );
    expect(issues({ amount: 400_000 }).map((i) => i.path)).toContain("amount");
    expect(issues({ modality: "shift", amount: 150_000 })).toEqual([]);
    expect(issues({ modality: "month", amount: 2_400_000 })).toEqual([]);
    expect(issues({ modality: "package", amount: 40_000 }).map((i) => i.path)).toContain("amount");
  });

  it("sin decimales y sin dejarlo vacío", () => {
    expect(issues({ amount: 28_000.5 }).map((i) => i.path)).toContain("amount");
    expect(issues({ amount: Number.NaN }).map((i) => i.message)).toContain(
      "Escribe el valor de tu servicio.",
    );
  });

  it("«hasta» es opcional y debe ser de hoy en adelante", () => {
    expect(issues({ availableUntil: "2026-10-14" })).toEqual([]);
    expect(issues({ availableUntil: "2026-12-31" })).toEqual([]);
    expect(issues({ availableUntil: "2026-10-13" }).map((i) => i.path)).toContain("availableUntil");
    expect(issues({ availableUntil: "2026-02-31" }).map((i) => i.path)).toContain("availableUntil");
  });

  it("la moderación avisa al instante, con los mismos casos que prueba la base", () => {
    expect(issues({ title: "Enfermera para cuidado, no se aceptan pendejos" })).toEqual([
      { path: "title", message: OFFER_ISSUE_MESSAGE.rude },
    ]);
    expect(
      issues({
        title: "Vendo ropa y artículos usados",
        description: "Cuidado y envío gratis",
        specialty: "",
      }).map((i) => i.message),
    ).toContain(OFFER_ISSUE_MESSAGE.sale);
    expect(
      issues({
        title: "Clases de guitarra y canto",
        description: "Aprende rápido con un profesor experimentado",
        specialty: "",
      }),
    ).toEqual([{ path: "description", message: OFFER_ISSUE_MESSAGE.offtopic }]);
    expect(issues({ description: "Llámame al 3001234567 para acordar" })).toEqual([
      { path: "description", message: OFFER_ISSUE_MESSAGE.contact },
    ]);
  });

  it("el conjunto cuenta: «Terapia» en el título basta para que sea de salud", () => {
    expect(issues({ title: "Terapia física a domicilio", description: "", specialty: "" })).toEqual(
      [],
    );
  });

  it("valores iniciales: los de la oferta o los del perfil; y lo que se manda a la tabla", () => {
    const fresh = serviceOfferFormDefaults(null, {
      specialty: " Enfermería ",
      city: "Bogotá",
      hourlyRate: 22_000.4,
    });
    expect(fresh).toMatchObject({
      specialty: "Enfermería",
      city: "Bogotá",
      amount: 22_000,
      modality: "hour",
      title: "",
    });
    expect(serviceOfferFormDefaults(null).amount).toBe(0);
    const existing = normalizeMyOfferRow(row({ available_until: "2026-10-21T04:59:59.000Z" }), NOW);
    expect(serviceOfferFormDefaults(existing)).toMatchObject({
      availableUntil: "2026-10-20",
      title: existing.title,
    });
    expect(
      toServiceOfferPayload({
        ...valid,
        description: "  ",
        specialty: "",
        availableUntil: "2026-10-20",
      }),
    ).toEqual({
      title: valid.title,
      description: null,
      specialty: null,
      modality: "hour",
      amount: 28_000,
      city: "Bogotá",
      available_until: "2026-10-21T04:59:59.000Z",
    });
    // Nunca viaja el dueño, el estado ni «bloqueada»: lo fijan la política y el disparador.
    const keys = Object.keys(toServiceOfferPayload(valid));
    for (const k of ["professional_id", "status", "blocked"]) expect(keys).not.toContain(k);
  });
});

describe("mis ofertas", () => {
  it("visible = abierta, sin bloqueo y vigente", () => {
    expect(normalizeMyOfferRow(row(), NOW).visible).toBe(true);
    expect(normalizeMyOfferRow(row({ status: "paused" }), NOW).visible).toBe(false);
    expect(normalizeMyOfferRow(row({ status: "closed" }), NOW).visible).toBe(false);
    expect(normalizeMyOfferRow(row({ blocked: true }), NOW).visible).toBe(false);
    expect(normalizeMyOfferRow(row({ available_until: at(-1) }), NOW).visible).toBe(false);
    expect(normalizeMyOfferRow(row({ available_until: at(24) }), NOW).visible).toBe(true);
  });

  it("filas raras no rompen la pantalla", () => {
    const o = normalizeMyOfferRow(
      row({ status: "weird", modality: "weird", description: null, specialty: null }),
      NOW,
    );
    expect(o.status).toBe("closed");
    expect(o.modality).toBe("hour");
    expect(o.description).toBe("");
    expect(o.specialty).toBe("");
  });

  it("cuenta las vigentes (abiertas o en pausa) contra el tope de 5", () => {
    expect(MAX_ACTIVE_SERVICE_OFFERS).toBe(5);
    expect(
      countActiveServiceOffers([{ status: "open" }, { status: "paused" }, { status: "closed" }]),
    ).toBe(2);
    expect(countActiveServiceOffers([])).toBe(0);
  });

  it("el titular de cada oferta dice la verdad sobre su situación", () => {
    const h = (over: Partial<ServiceOfferRow>) =>
      myOfferHeadline(normalizeMyOfferRow(row(over), NOW), NOW);
    expect(h({})).toMatch(/Publicada.*Trust Score/);
    expect(h({ status: "paused" })).toMatch(/En pausa/);
    expect(h({ status: "closed" })).toMatch(/Cerrada/);
    expect(h({ blocked: true })).toMatch(/Bloqueada por Humanix/);
    expect(h({ available_until: at(-2) })).toMatch(/Venció/);
  });
});

describe("errores del servidor", () => {
  it("la moderación de la base trae su pista", () => {
    for (const k of ["rude", "sale", "offtopic", "contact"] as const) {
      expect(
        classifyServiceOfferError({ code: "23514", hint: `offer_${k}`, message: "x" }),
      ).toEqual({ kind: k, message: OFFER_ISSUE_MESSAGE[k] });
    }
  });

  it("tope de ofertas vigentes, cuenta en revisión, permisos y datos inválidos", () => {
    expect(
      classifyServiceOfferError({
        code: "23514",
        hint: "service_offer_limit",
        message:
          "Ya tienes 5 ofertas de servicio vigentes. Cierra o elimina una para publicar otra.",
      }),
    ).toEqual({ kind: "limit", message: SERVICE_OFFER_LIMIT_MESSAGE });
    expect(
      classifyServiceOfferError({ code: "42501", message: "Tu cuenta está en revisión" }).kind,
    ).toBe("review");
    expect(
      classifyServiceOfferError({
        code: "42501",
        message:
          'new row violates row-level security policy for table "professional_service_offers"',
      }).kind,
    ).toBe("forbidden");
    expect(
      classifyServiceOfferError({ code: "23514", message: "violates check constraint" }).kind,
    ).toBe("invalid");
    expect(classifyServiceOfferError({ message: "boom" })).toEqual({
      kind: "other",
      message: "boom",
    });
    expect(classifyServiceOfferError(null).message).toMatch(/No pudimos guardar/);
  });
});

describe("lo que ven las familias y las instituciones", () => {
  it("normaliza: nombre, calificación, RETHUS, Trust Score, estado y cercanía", () => {
    const o = normalizeServiceOfferRow(feed());
    expect(o).toMatchObject({
      id: "s1",
      professionalId: "p1",
      name: "Laura Pérez",
      rethusVerified: true,
      verified: true,
      availability: "available",
      live: true,
      distanceBand: 5,
      specialty: "Enfermería",
    });
    expect(o.rating).toEqual({ stars: 4.8, jobs: 12 });
    expect(o.trust).toEqual({ score: 82, level: "high", enough: true, verified: true });
  });

  it("sin calificaciones no hay estrellas y sin Trust Score dice «Sin validar»", () => {
    const o = normalizeServiceOfferRow(
      feed({
        avg_rating: 0,
        total_jobs: 0,
        trust_score: null,
        trust_level: null,
        trust_enough: null,
        display_name: " ",
      }),
    );
    expect(o.rating).toEqual({ stars: null, jobs: 0 });
    expect(o.trust.score).toBeNull();
    expect(o.trust.level).toBe("unrated");
    expect(o.name).toBe("Profesional de la salud");
  });

  it("estado desconocido = no disponible; la especialidad cae a la del perfil", () => {
    const o = normalizeServiceOfferRow(
      feed({ availability_status: "weird", specialty: null, live: null }),
    );
    expect(o.availability).toBe("unavailable");
    expect(o.live).toBe(false);
    expect(o.specialty).toBe("Enfermería");
  });

  it("no incluye teléfono ni dirección", () => {
    const o = normalizeServiceOfferRow(feed()) as unknown as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      expect(k).not.toMatch(/address|phone|contact|direccion|telefono|email/i);
    }
  });

  it("valor por hora solo si la oferta es por hora", () => {
    expect(serviceOfferHourly({ modality: "hour", amount: 28_000 })).toBe(28_000);
    expect(serviceOfferHourly({ modality: "shift", amount: 150_000 })).toBeNull();
    expect(serviceOfferPriceLabel({ modality: "shift", amount: 150_000 })).toMatch(
      /\$\s*150\.000 por turno/,
    );
  });
});

describe("orden y filtros de las ofertas de servicio", () => {
  const items = [
    feed({
      offer_id: "lejos-top",
      professional_id: "a",
      display_name: "Ana Top",
      distance_band_km: 50,
      trust_score: 95,
      trust_level: "excellent",
      avg_rating: 4.9,
      amount: 40_000,
    }),
    feed({
      offer_id: "cerca-ocupada",
      professional_id: "b",
      display_name: "Beto Ocupado",
      distance_band_km: 2,
      availability_status: "busy",
      trust_score: 90,
      trust_level: "excellent",
      amount: 25_000,
      created_at: at(-3),
    }),
    feed({
      offer_id: "cerca-libre",
      professional_id: "c",
      display_name: "Cata Libre",
      distance_band_km: 2,
      availability_status: "available",
      trust_score: 70,
      trust_level: "high",
      avg_rating: 4.0,
      amount: 22_000,
      created_at: at(-1),
    }),
    feed({
      offer_id: "sin-ubicacion",
      professional_id: "d",
      display_name: "Dani Sin",
      distance_band_km: null,
      trust_score: null,
      trust_level: null,
      avg_rating: 0,
      total_jobs: 0,
      rethus_verified: false,
      modality: "shift",
      amount: 150_000,
      city: "Cali",
      created_at: at(-9),
    }),
  ].map(normalizeServiceOfferRow);
  const ids = (xs: typeof items) => xs.map((o) => o.id);
  const sorted = (sort: (typeof DEFAULT_SERVICE_FILTERS)["sort"]) =>
    ids(applyServiceOfferFilters(items, { ...DEFAULT_SERVICE_FILTERS, sort }));

  it("más cerca: por rango; dentro del rango, disponibles primero; sin ubicación al final", () => {
    expect(sorted("nearest")).toEqual([
      "cerca-libre",
      "cerca-ocupada",
      "lejos-top",
      "sin-ubicacion",
    ]);
  });

  it("mayor Trust Score: sin validar al final", () => {
    expect(sorted("trust")).toEqual(["lejos-top", "cerca-ocupada", "cerca-libre", "sin-ubicacion"]);
  });

  it("mejor calificados: sin calificación al final", () => {
    expect(sorted("rating")).toEqual([
      "lejos-top",
      "cerca-ocupada",
      "cerca-libre",
      "sin-ubicacion",
    ]);
  });

  it("más económicos por hora: lo que no es por hora va al final", () => {
    expect(sorted("price")).toEqual(["cerca-libre", "cerca-ocupada", "lejos-top", "sin-ubicacion"]);
  });

  it("más nuevas", () => {
    expect(sorted("recent")).toEqual([
      "cerca-libre",
      "cerca-ocupada",
      "lejos-top",
      "sin-ubicacion",
    ]);
  });

  it("filtros: ciudad, modalidad, disponibles, RETHUS, tope por hora y búsqueda", () => {
    const f = (o: Partial<typeof DEFAULT_SERVICE_FILTERS>) =>
      ids(applyServiceOfferFilters(items, { ...DEFAULT_SERVICE_FILTERS, ...o }));
    expect(f({ city: "Cali" })).toEqual(["sin-ubicacion"]);
    expect(f({ city: "bogota" })).toHaveLength(3);
    expect(f({ modality: "shift" })).toEqual(["sin-ubicacion"]);
    expect(f({ availableOnly: true }).sort()).toEqual([
      "cerca-libre",
      "lejos-top",
      "sin-ubicacion",
    ]);
    expect(f({ rethusOnly: true })).not.toContain("sin-ubicacion");
    expect(f({ maxHourly: 30_000 }).sort()).toEqual([
      "cerca-libre",
      "cerca-ocupada",
      "sin-ubicacion",
    ]);
    expect(f({ query: "dani" })).toEqual(["sin-ubicacion"]);
    expect(f({ query: "ENFERMERÍA" })).toHaveLength(4);
  });

  it("limpiar filtros y ciudades distintas", () => {
    expect(hasActiveServiceFilters(DEFAULT_SERVICE_FILTERS)).toBe(false);
    expect(hasActiveServiceFilters({ ...DEFAULT_SERVICE_FILTERS, sort: "trust" })).toBe(false);
    expect(hasActiveServiceFilters({ ...DEFAULT_SERVICE_FILTERS, maxHourly: 1 })).toBe(true);
    expect(distinctServiceOfferCities(items)).toEqual(["Bogotá", "Cali"]);
  });

  it("resumen: totales, disponibles, en vivo, rango por hora y la más cercana", () => {
    expect(summarizeServiceOffers(items)).toEqual({
      total: 4,
      available: 3,
      live: 4,
      hourly: { min: 22_000, max: 40_000 },
      nearestBand: 2,
    });
    expect(summarizeServiceOffers([])).toEqual({
      total: 0,
      available: 0,
      live: 0,
      hourly: null,
      nearestBand: null,
    });
  });
});
