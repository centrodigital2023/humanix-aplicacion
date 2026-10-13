import { describe, it, expect } from "vitest";
import {
  CONTACT_STATE_COPY,
  acceptNeedsSchedule,
  amountLabel,
  applicantError,
  applicantWhatsAppLink,
  contactState,
  defaultAcceptShifts,
  deltaFromPosted,
  expiryText,
  familyToProMessage,
  fromOfferRow,
  fromSlotRow,
  hourlyEquivalent,
  initialsOf,
  negotiationState,
  partitionApplicants,
  priceLine,
  sortApplicants,
  starsText,
  summarizeApplicants,
  turnLabel,
  type ApplicantCard,
  type OfferApplicantRow,
  type SlotApplicantRow,
} from "./applicants";

const NOW = Date.parse("2026-10-13T12:00:00Z");

const slotRow = (over: Partial<SlotApplicantRow> = {}): SlotApplicantRow => ({
  proposal_id: "p-1",
  professional_id: "pro-1",
  family_need_id: "need-1",
  display_name: "Andrea Torres",
  name_is_short: false,
  avatar_url: null,
  specialty: "Enfermería",
  years_experience: 5,
  city: "Bogotá",
  distance_band_km: 2,
  ratings_count: 3,
  stars_avg: "4.67",
  total_jobs: 12,
  trust_score: 82,
  trust_level: "high",
  rethus_verified: true,
  hourly_rate: 21000,
  posted_rate: 20000,
  round_no: 1,
  proposed_by: "professional",
  status: "pending",
  awaiting: "family",
  message: "Tengo experiencia nocturna",
  starts_at: "2026-10-20T13:00:00Z",
  ends_at: "2026-10-20T17:00:00Z",
  hours: "4.00",
  estimated_total: 84000,
  expires_at: "2026-10-13T15:30:00Z",
  created_at: "2026-10-13T11:00:00Z",
  booking_id: null,
  can_negotiate: true,
  can_reveal: true,
  has_phone: true,
  contact_unlocked: false,
  reveals_left: 15,
  plan_key: "essential_monthly",
  ...over,
});

const offerRow = (over: Partial<OfferApplicantRow> = {}): OfferApplicantRow => ({
  application_id: "a-1",
  job_offer_id: "o-1",
  offer_title: "Cuidadora de noche",
  modality: "hour",
  offer_start: "2026-10-20T23:00:00Z",
  offer_end: "2026-10-21T07:00:00Z",
  has_shifts: false,
  professional_id: "pro-2",
  display_name: "Gloria O.",
  name_is_short: true,
  avatar_url: null,
  specialty: "Auxiliar de enfermería",
  years_experience: null,
  city: "Soacha",
  distance_band_km: 50,
  ratings_count: 2,
  stars_avg: 4,
  total_jobs: null,
  trust_score: null,
  trust_level: "unrated",
  rethus_verified: false,
  posted_amount: 18000,
  proposed_amount: 19500,
  round_no: 1,
  status: "pending",
  awaiting: "family",
  message: null,
  expires_at: null,
  created_at: "2026-10-13T10:00:00Z",
  can_negotiate: false,
  can_reveal: false,
  has_phone: false,
  contact_unlocked: false,
  reveals_left: 0,
  plan_key: "free",
  ...over,
});

describe("normalización de las filas del servidor", () => {
  it("una postulación por horas", () => {
    const c = fromSlotRow(slotRow());
    expect(c).toMatchObject({
      key: "slots:p-1",
      source: "slots",
      id: "p-1",
      professionalId: "pro-1",
      targetId: "need-1",
      title: "Cuidado por horas",
      displayName: "Andrea Torres",
      nameIsShort: false,
      amount: 21000,
      postedAmount: 20000,
      modality: "hour",
      hourlyEquivalent: 21000,
      turn: "family",
      hours: 4,
      estimatedTotal: 84000,
      starsAvg: 4.67,
      ratingsCount: 3,
      hasShifts: true,
      revealsLeft: 15,
    });
    expect(c.trust).toEqual({ score: 82, level: "high", enough: true, verified: true });
  });

  it("una postulación a una oferta de trabajo, con valor por turno o por mes convertido para comparar", () => {
    const c = fromOfferRow(offerRow());
    expect(c).toMatchObject({
      key: "offer:a-1",
      source: "offer",
      title: "Cuidadora de noche",
      amount: 19500,
      postedAmount: 18000,
      modality: "hour",
      hourlyEquivalent: 19500,
      turn: "family",
      nameIsShort: true,
      hasShifts: false,
      starsAvg: 4,
    });
    expect(c.trust.score).toBeNull();
    expect(c.trust.level).toBe("unrated");
    expect(
      fromOfferRow(offerRow({ modality: "shift", proposed_amount: 160000 })).hourlyEquivalent,
    ).toBe(20000);
    expect(
      fromOfferRow(offerRow({ modality: "month", proposed_amount: 3840000 })).hourlyEquivalent,
    ).toBe(20000);
    expect(
      fromOfferRow(offerRow({ modality: "package", proposed_amount: 500000 })).hourlyEquivalent,
    ).toBeNull();
    expect(fromOfferRow(offerRow({ modality: "rara" })).modality).toBe("hour");
  });

  it("sin valor propuesto usa el publicado", () => {
    expect(fromOfferRow(offerRow({ proposed_amount: null })).amount).toBe(18000);
  });

  it("estrellas que no son número no rompen", () => {
    expect(fromSlotRow(slotRow({ stars_avg: null })).starsAvg).toBeNull();
    expect(fromSlotRow(slotRow({ stars_avg: "" })).starsAvg).toBeNull();
    expect(fromSlotRow(slotRow({ stars_avg: "x" })).starsAvg).toBeNull();
  });

  it("el equivalente por hora", () => {
    expect(hourlyEquivalent(20000, "hour")).toBe(20000);
    expect(hourlyEquivalent(null, "hour")).toBeNull();
    expect(hourlyEquivalent(0, "hour")).toBeNull();
    expect(hourlyEquivalent(-5, "shift")).toBeNull();
  });
});

describe("grupos y orden", () => {
  const a = fromSlotRow(
    slotRow({
      proposal_id: "a",
      created_at: "2026-10-13T11:00:00Z",
      hourly_rate: 22000,
      stars_avg: 4.5,
      ratings_count: 5,
      trust_score: 70,
      distance_band_km: 10,
    }),
  );
  const b = fromSlotRow(
    slotRow({
      proposal_id: "b",
      created_at: "2026-10-13T10:00:00Z",
      hourly_rate: 19000,
      stars_avg: 4.9,
      ratings_count: 3,
      trust_score: 90,
      distance_band_km: 2,
      awaiting: "professional",
      proposed_by: "family",
    }),
  );
  const c = fromSlotRow(
    slotRow({
      proposal_id: "c",
      created_at: "2026-10-13T09:00:00Z",
      hourly_rate: 25000,
      stars_avg: null,
      ratings_count: 0,
      trust_score: null,
      trust_level: "unrated",
      distance_band_km: null,
      awaiting: "done",
      status: "accepted",
    }),
  );
  const d = fromOfferRow(
    offerRow({
      application_id: "d",
      created_at: "2026-10-13T08:00:00Z",
      proposed_amount: 160000,
      modality: "shift",
      distance_band_km: 5,
      trust_score: 80,
      trust_level: "high",
    }),
  );
  const cards = [c, a, d, b];

  it("tres grupos: te toca, esperando y aceptadas", () => {
    const g = partitionApplicants(cards);
    expect(g.action.map((x) => x.id)).toEqual(["a", "d"]);
    expect(g.waiting.map((x) => x.id)).toEqual(["b"]);
    expect(g.done.map((x) => x.id)).toEqual(["c"]);
    expect(summarizeApplicants(cards)).toEqual({ toAnswer: 2, waiting: 1, accepted: 1 });
  });

  it("más recientes por defecto", () => {
    expect(sortApplicants(cards, "recent").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("menor valor por hora (el turno de 160.000 equivale a 20.000/h; lo que no se puede comparar va al final)", () => {
    expect(sortApplicants(cards, "price").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("mejor calificados, con más calificaciones como desempate; sin estrellas al final", () => {
    expect(sortApplicants(cards, "rating").map((x) => x.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("más confianza primero; los sin validar al final", () => {
    expect(sortApplicants(cards, "trust").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("más cercanos primero; sin distancia al final", () => {
    expect(sortApplicants(cards, "near").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("no cambia la lista original", () => {
    const before = cards.map((x) => x.id).join();
    sortApplicants(cards, "price");
    expect(cards.map((x) => x.id).join()).toBe(before);
  });

  it("empates: gana la más reciente", () => {
    const x = fromSlotRow(
      slotRow({ proposal_id: "x", created_at: "2026-10-13T11:30:00Z", hourly_rate: 22000 }),
    );
    const y = fromSlotRow(
      slotRow({ proposal_id: "y", created_at: "2026-10-13T10:30:00Z", hourly_rate: 22000 }),
    );
    expect(sortApplicants([y, x], "price").map((k) => k.id)).toEqual(["x", "y"]);
  });
});

describe("turno y negociación según el plan", () => {
  it("las etiquetas de turno", () => {
    expect(turnLabel(fromSlotRow(slotRow()))).toBe("Nueva postulación");
    expect(turnLabel(fromSlotRow(slotRow({ round_no: 2 })))).toBe("Te toca responder");
    expect(turnLabel(fromSlotRow(slotRow({ awaiting: "professional" })))).toBe(
      "Esperando su respuesta",
    );
    expect(turnLabel(fromSlotRow(slotRow({ awaiting: "done", status: "accepted" })))).toBe(
      "Aceptada",
    );
  });

  it("con plan Esencial y su turno, negocia", () => {
    expect(negotiationState(fromSlotRow(slotRow())).state).toBe("available");
  });

  it("en el plan gratuito, el botón se bloquea con el motivo del plan", () => {
    const n = negotiationState(fromSlotRow(slotRow({ can_negotiate: false, plan_key: "free" })));
    expect(n.state).toBe("locked_plan");
    expect(n.reason).toMatch(/plan Esencial/);
  });

  it("la última ronda solo se acepta o se rechaza, aun con plan", () => {
    const n = negotiationState(fromSlotRow(slotRow({ round_no: 3, can_negotiate: false })));
    expect(n.state).toBe("final_round");
  });

  it("si espera al profesional o ya está aceptada, no hay qué negociar", () => {
    expect(negotiationState(fromSlotRow(slotRow({ awaiting: "professional" }))).state).toBe(
      "waiting",
    );
    expect(
      negotiationState(fromSlotRow(slotRow({ awaiting: "done", status: "accepted" }))).state,
    ).toBe("closed");
  });
});

describe("contacto del postulante", () => {
  it("el plan gratuito no desbloquea", () => {
    expect(
      contactState(fromSlotRow(slotRow({ can_reveal: false, reveals_left: 0, plan_key: "free" }))),
    ).toBe("plan");
  });
  it("ya desbloqueado hoy", () => {
    expect(contactState(fromSlotRow(slotRow({ contact_unlocked: true })))).toBe("unlocked");
  });
  it("sin teléfono registrado", () => {
    expect(contactState(fromSlotRow(slotRow({ has_phone: false })))).toBe("no_phone");
  });
  it("cupo agotado", () => {
    expect(contactState(fromSlotRow(slotRow({ reveals_left: 0 })))).toBe("quota");
  });
  it("listo para desbloquear", () => {
    expect(contactState(fromSlotRow(slotRow()))).toBe("ready");
  });
  it("un contacto ya desbloqueado se muestra aunque el cupo esté en cero", () => {
    expect(contactState(fromSlotRow(slotRow({ contact_unlocked: true, reveals_left: 0 })))).toBe(
      "unlocked",
    );
  });
  it("cada estado tiene su texto", () => {
    expect(Object.keys(CONTACT_STATE_COPY).sort()).toEqual([
      "no_phone",
      "plan",
      "quota",
      "ready",
      "unlocked",
    ]);
  });

  it("el mensaje de WhatsApp: saluda, cita la oferta y recuerda que se paga solo en la web", () => {
    const msg = familyToProMessage({
      familyName: "Alicia Rey",
      proName: "Andrea Torres",
      title: "Cuidadora de noche",
    });
    expect(msg).toContain("Hola Andrea, soy Alicia de Humanix.");
    expect(msg).toContain("«Cuidadora de noche»");
    expect(msg).toMatch(/pagos se gestionan únicamente en la página web de Humanix/);
    expect(msg).not.toMatch(/\d{7,}|https?:|@/);
  });
  it("sin nombres, el mensaje sigue siendo correcto", () => {
    const msg = familyToProMessage({ familyName: null, proName: "", title: "x" });
    expect(msg.startsWith("Hola, soy una familia de Humanix.")).toBe(true);
  });
  it("el enlace de WhatsApp sale de un celular colombiano y no sale sin teléfono", () => {
    expect(applicantWhatsAppLink("300 123 4567", "hola")).toBe(
      "https://wa.me/573001234567?text=hola",
    );
    expect(applicantWhatsAppLink(null, "hola")).toBeNull();
    expect(applicantWhatsAppLink("123", "hola")).toBeNull();
  });
});

describe("aceptar una oferta de trabajo sin horario", () => {
  it("las postulaciones por horas y las ofertas con turnos abiertos no piden horario", () => {
    expect(acceptNeedsSchedule(fromSlotRow(slotRow()))).toBe(false);
    expect(acceptNeedsSchedule(fromOfferRow(offerRow({ has_shifts: true })))).toBe(false);
    expect(defaultAcceptShifts(fromSlotRow(slotRow()), NOW)).toEqual([]);
    expect(defaultAcceptShifts(fromOfferRow(offerRow({ has_shifts: true })), NOW)).toEqual([]);
  });

  it("una oferta sin turnos pide horario si está pendiente", () => {
    expect(acceptNeedsSchedule(fromOfferRow(offerRow()))).toBe(true);
    expect(
      acceptNeedsSchedule(fromOfferRow(offerRow({ status: "accepted", awaiting: "done" }))),
    ).toBe(false);
  });

  it("si la oferta trae un inicio y un fin vigentes de hasta 24 h, los propone", () => {
    const shifts = defaultAcceptShifts(fromOfferRow(offerRow()), NOW);
    expect(shifts).toEqual([
      { starts_at: "2026-10-20T23:00:00.000Z", ends_at: "2026-10-21T07:00:00.000Z" },
    ]);
  });

  it("si no caben en un turno, vencieron o no están completos, hay que preguntar", () => {
    expect(
      defaultAcceptShifts(fromOfferRow(offerRow({ offer_end: "2026-10-22T07:00:00Z" })), NOW),
    ).toBeNull();
    expect(
      defaultAcceptShifts(
        fromOfferRow(
          offerRow({ offer_start: "2026-10-01T00:00:00Z", offer_end: "2026-10-01T08:00:00Z" }),
        ),
        NOW,
      ),
    ).toBeNull();
    expect(defaultAcceptShifts(fromOfferRow(offerRow({ offer_end: null })), NOW)).toBeNull();
    expect(defaultAcceptShifts(fromOfferRow(offerRow({ offer_start: null })), NOW)).toBeNull();
    expect(
      defaultAcceptShifts(fromOfferRow(offerRow({ offer_end: "2026-10-20T22:00:00Z" })), NOW),
    ).toBeNull();
  });
});

describe("textos de la tarjeta", () => {
  it("el valor y el total estimado", () => {
    const c = fromSlotRow(slotRow());
    expect(amountLabel(c)).toMatch(/21\.000.* por hora/);
    expect(priceLine(c)).toMatch(/por hora · 4 h · ≈ .*84\.000/);
    expect(
      priceLine(fromOfferRow(offerRow({ modality: "shift", proposed_amount: 160000 }))),
    ).toMatch(/160\.000.* por turno$/);
    expect(priceLine(fromSlotRow(slotRow({ hours: "2.5", estimated_total: null })))).toMatch(
      /2\.5 h$/,
    );
  });

  it("cuánto se aparta de lo publicado", () => {
    expect(deltaFromPosted(fromSlotRow(slotRow()))).toEqual({
      pct: 5,
      label: "+5 % sobre lo publicado",
    });
    expect(deltaFromPosted(fromSlotRow(slotRow({ hourly_rate: 18000 })))).toEqual({
      pct: -10,
      label: "−10 % sobre lo publicado",
    });
    expect(deltaFromPosted(fromSlotRow(slotRow({ hourly_rate: 20000 })))).toEqual({
      pct: 0,
      label: "Valor publicado",
    });
    expect(deltaFromPosted(fromSlotRow(slotRow({ posted_rate: null })))).toEqual({
      pct: 0,
      label: "Valor publicado",
    });
  });

  it("vencimiento: solo mientras hay qué responder", () => {
    const c = fromSlotRow(slotRow({ expires_at: "2026-10-13T15:30:00Z" }));
    expect(expiryText(c, NOW)).toBe("Vence en 3 h 30 min");
    expect(
      expiryText(fromSlotRow(slotRow({ awaiting: "done", status: "accepted" })), NOW),
    ).toBeNull();
    expect(expiryText(fromSlotRow(slotRow({ expires_at: null })), NOW)).toBeNull();
    expect(expiryText(fromSlotRow(slotRow({ expires_at: "2026-10-13T11:00:00Z" })), NOW)).toBe(
      "Venció",
    );
  });

  it("las estrellas y las iniciales", () => {
    expect(starsText(fromSlotRow(slotRow()))).toBe("4.7 (3)");
    expect(starsText(fromSlotRow(slotRow({ stars_avg: null, ratings_count: 0 })))).toBe(
      "Sin calificaciones",
    );
    expect(initialsOf("Andrea Torres")).toBe("AT");
    expect(initialsOf("Gloria O.")).toBe("GO");
    expect(initialsOf("Camila")).toBe("C");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("errores del servidor", () => {
  it("negociar sin plan invita a mejorar de plan", () => {
    const e = applicantError({
      code: "42501",
      hint: "negotiate_rate_requires_plan",
      message: "Negociar…",
    });
    expect(e).toMatchObject({ kind: "negotiate_plan", upsell: true });
  });
  it("ver el WhatsApp sin plan también", () => {
    expect(applicantError({ code: "42501", hint: "plan_required", message: "Ver…" })).toMatchObject(
      { kind: "contact_plan", upsell: true },
    );
  });
  it("el cupo diario", () => {
    expect(
      applicantError({
        code: "42501",
        hint: "quota_exceeded",
        message: "Alcanzaste el límite diario de contactos desbloqueados (15)",
      }),
    ).toMatchObject({
      kind: "quota",
      upsell: false,
    });
  });
  it("una postulación que ya no está vigente", () => {
    expect(applicantError({ code: "42501", hint: "proposal_not_active", message: "x" }).kind).toBe(
      "not_active",
    );
    expect(applicantError({ message: "La propuesta ya no está disponible (countered)" }).kind).toBe(
      "not_active",
    );
  });
  it("falta el horario, última ronda, valor fuera de rango, cruce de agenda, texto prohibido", () => {
    expect(applicantError({ hint: "shifts_required", message: "x" }).kind).toBe("shifts_required");
    expect(applicantError({ hint: "final_round", message: "Esta es la última oferta" }).kind).toBe(
      "final_round",
    );
    expect(
      applicantError({ hint: "rate_out_of_band", message: "El valor debe estar entre…" }).kind,
    ).toBe("rate_out_of_band");
    expect(applicantError({ code: "23P01", message: "x" }).kind).toBe("conflict");
    expect(applicantError({ message: "No incluyas teléfonos, correos…" }).kind).toBe(
      "forbidden_content",
    );
  });
  it("lo desconocido conserva el texto del servidor", () => {
    expect(applicantError({ message: "algo raro" })).toMatchObject({
      kind: "other",
      message: "algo raro",
      upsell: false,
    });
    expect(applicantError(null).message).toMatch(/No se pudo completar/);
  });
});

describe("tipos", () => {
  it("una tarjeta cumple la forma esperada por la pantalla", () => {
    const c: ApplicantCard = fromSlotRow(slotRow());
    expect(Object.keys(c)).toEqual(
      expect.arrayContaining([
        "key",
        "source",
        "id",
        "professionalId",
        "displayName",
        "trust",
        "turn",
        "canNegotiate",
        "canReveal",
      ]),
    );
  });
});
