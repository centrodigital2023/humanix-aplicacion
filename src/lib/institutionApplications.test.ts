import { describe, expect, it } from "vitest";
import {
  acceptanceWarning,
  closedReasonLabel,
  expiryLabel,
  groupInbox,
  headlineFor,
  needsMyAction,
  normalizeInboxRow,
  normalizeMyApplication,
  shiftsSummary,
  sortByUrgency,
  trustBadges,
  type InboxRow,
  type MyApplicationRow,
} from "./institutionApplications";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;

function mine(over: Partial<MyApplicationRow> = {}): MyApplicationRow {
  return {
    application_id: "a1",
    job_offer_id: "o1",
    offer_title: "UCI noches",
    institution_name: "Clínica Santa Fe",
    institution_id: "i1",
    city: "Bogotá",
    modality: "shift",
    posted_amount: 180_000,
    proposed_amount: 180_000,
    agreed_amount: null,
    status: "pending",
    awaiting: "institution",
    round_no: 1,
    expires_at: at(40),
    created_at: at(-2),
    accepted_at: null,
    closed_reason: null,
    shifts: [
      { id: "s2", starts_at: at(54), ends_at: at(66) },
      { id: "s1", starts_at: at(30), ends_at: at(42) },
    ],
    booking_ids: null,
    contract_id: null,
    contract_status: null,
    i_signed: null,
    other_signed: null,
    ...over,
  };
}

function inbox(over: Partial<InboxRow> = {}): InboxRow {
  return {
    application_id: "a1",
    job_offer_id: "o1",
    offer_title: "UCI noches",
    modality: "shift",
    posted_amount: 180_000,
    proposed_amount: 180_000,
    agreed_amount: null,
    status: "pending",
    awaiting: "institution",
    round_no: 1,
    expires_at: at(40),
    message: "Tengo 5 años en UCI",
    created_at: at(-2),
    accepted_at: null,
    closed_reason: null,
    shifts: [],
    professional_id: "p1",
    professional_name: "Laura Gómez",
    professional_avatar: null,
    professional_city: "Bogotá",
    specialty: "Auxiliar de enfermería",
    years_experience: 5,
    rethus_verified: true,
    profile_verified: false,
    avg_rating: "4.80",
    total_jobs: 12,
    jobs_with_me: 2,
    contract_id: null,
    contract_status: null,
    ...over,
  };
}

describe("normalización", () => {
  it("vista del profesional: ordena turnos y completa nombres", () => {
    const a = normalizeMyApplication(mine({ institution_name: " " }));
    expect(a.institutionName).toBe("Institución de salud");
    expect(a.shifts.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(a.bookingIds).toEqual([]);
    expect(a.iSigned).toBe(false);
    expect(a.status).toBe("pending");
  });

  it("vista de la institución: calificación numérica y datos del postulante", () => {
    const a = normalizeInboxRow(inbox());
    expect(a).toMatchObject({
      name: "Laura Gómez",
      stars: 4.8,
      totalJobs: 12,
      jobsWithMe: 2,
      rethusVerified: true,
    });
    expect(normalizeInboxRow(inbox({ avg_rating: 0 })).stars).toBeNull();
    expect(normalizeInboxRow(inbox({ avg_rating: null, professional_name: null })).name).toBe(
      "Profesional",
    );
  });

  it("estados y modalidades desconocidos no rompen la vista", () => {
    const a = normalizeMyApplication(mine({ status: "raro", awaiting: "otro", modality: "x" }));
    expect(a).toMatchObject({ status: "pending", awaiting: "institution", modality: "shift" });
  });
});

describe("headlineFor", () => {
  it("le toca responder a la institución con una postulación al valor publicado", () => {
    const h = headlineFor(normalizeMyApplication(mine()), "institution", fmt, NOW);
    expect(h).toMatchObject({ title: "Te toca responder", tone: "action" });
    expect(h.detail).toContain("acepta el valor publicado de $180.000");
  });

  it("explica una propuesta distinta y la última oferta", () => {
    const proposed = normalizeMyApplication(mine({ proposed_amount: 200_000 }));
    expect(headlineFor(proposed, "institution", fmt, NOW).detail).toContain("propone $200.000");
    const last = normalizeMyApplication(
      mine({ proposed_amount: 190_000, round_no: 3, awaiting: "professional" }),
    );
    expect(headlineFor(last, "professional", fmt, NOW).detail).toContain(
      "última oferta de $190.000",
    );
  });

  it("el profesional espera a la institución", () => {
    const h = headlineFor(
      normalizeMyApplication(mine({ proposed_amount: 200_000 })),
      "professional",
      fmt,
      NOW,
    );
    expect(h).toMatchObject({ title: "Esperando a la institución", tone: "waiting" });
    expect(h.detail).toContain("Propuesta enviada: $200.000");
  });

  it("aceptada: contrato por firmar, vigente, cumplido o fallido", () => {
    const base = { status: "accepted", agreed_amount: 200_000 };
    expect(
      headlineFor(
        normalizeMyApplication(mine({ ...base, contract_status: "pending_signature" })),
        "professional",
        fmt,
        NOW,
      ).tone,
    ).toBe("action");
    expect(
      headlineFor(
        normalizeMyApplication(mine({ ...base, contract_status: "active" })),
        "professional",
        fmt,
        NOW,
      ).title,
    ).toBe("Contrato vigente");
    expect(
      headlineFor(
        normalizeMyApplication(mine({ ...base, contract_status: "completed" })),
        "professional",
        fmt,
        NOW,
      ).title,
    ).toBe("Servicio cumplido");
    expect(
      headlineFor(
        normalizeMyApplication(mine({ ...base, contract_status: "expired" })),
        "professional",
        fmt,
        NOW,
      ).tone,
    ).toBe("alert");
    expect(
      headlineFor(normalizeMyApplication(mine(base)), "professional", fmt, NOW).title,
    ).toContain("reserva confirmada");
  });

  it("vencida o cerrada, con el motivo según quién mira", () => {
    expect(
      headlineFor(normalizeMyApplication(mine({ expires_at: at(-1) })), "professional", fmt, NOW)
        .title,
    ).toBe("Venció sin respuesta");
    const closed = normalizeMyApplication(
      mine({ status: "withdrawn", closed_reason: "professional_declined_counter" }),
    );
    expect(headlineFor(closed, "professional", fmt, NOW).detail).toBe(
      "Rechazaste la contraoferta.",
    );
    expect(headlineFor(closed, "institution", fmt, NOW).detail).toBe(
      "El profesional rechazó tu contraoferta.",
    );
  });

  it("todos los motivos de cierre tienen texto", () => {
    for (const r of [
      "expired",
      "professional_withdrew",
      "professional_declined_counter",
      "institution_declined",
      "offer_filled",
      "offer_closed",
      "overlapping_booking",
      null,
      "otro",
    ]) {
      expect(closedReasonLabel(r, "professional").length).toBeGreaterThan(5);
      expect(closedReasonLabel(r, "institution").length).toBeGreaterThan(5);
    }
  });
});

describe("prioridad y agrupación", () => {
  it("needsMyAction considera respuestas y firmas pendientes", () => {
    expect(needsMyAction(normalizeMyApplication(mine()), "institution", false, NOW)).toBe(true);
    expect(needsMyAction(normalizeMyApplication(mine()), "professional", false, NOW)).toBe(false);
    expect(
      needsMyAction(
        normalizeMyApplication(mine({ expires_at: at(-1) })),
        "institution",
        false,
        NOW,
      ),
    ).toBe(false);
    const toSign = normalizeMyApplication(
      mine({ status: "accepted", contract_status: "partially_signed" }),
    );
    expect(needsMyAction(toSign, "professional", false, NOW)).toBe(true);
    expect(needsMyAction(toSign, "professional", true, NOW)).toBe(false);
  });

  it("ordena: responder (la más antigua primero) → esperar → aceptadas → cerradas", () => {
    const items = [
      normalizeInboxRow(
        inbox({
          application_id: "closed",
          status: "rejected",
          closed_reason: "institution_declined",
        }),
      ),
      normalizeInboxRow(
        inbox({ application_id: "acc", status: "accepted", contract_status: "active" }),
      ),
      normalizeInboxRow(inbox({ application_id: "wait", awaiting: "professional", round_no: 2 })),
      normalizeInboxRow(inbox({ application_id: "new", created_at: at(-1) })),
      normalizeInboxRow(inbox({ application_id: "old", created_at: at(-20) })),
    ];
    expect(sortByUrgency(items, "institution", () => false, NOW).map((a) => a.id)).toEqual([
      "old",
      "new",
      "wait",
      "acc",
      "closed",
    ]);
    const groups = groupInbox(items, NOW);
    expect(groups.needsResponse.map((a) => a.id)).toEqual(["old", "new"]);
    expect(groups.waiting.map((a) => a.id)).toEqual(["wait"]);
    expect(groups.accepted.map((a) => a.id)).toEqual(["acc"]);
    expect(groups.closed.map((a) => a.id)).toEqual(["closed"]);
  });
});

describe("confianza del postulante", () => {
  it("lista las señales de la más fuerte a la más débil", () => {
    const badges = trustBadges(normalizeInboxRow(inbox()));
    expect(badges.map((b) => b.id)).toEqual(["rethus", "repeat", "stars", "jobs", "years"]);
    expect(badges[1].label).toBe("Ha trabajado 2 veces con ustedes");
  });

  it("sin verificación lo dice y avisa antes de aceptar", () => {
    const a = normalizeInboxRow(
      inbox({
        rethus_verified: false,
        profile_verified: false,
        jobs_with_me: 0,
        total_jobs: 0,
        years_experience: 0,
        avg_rating: null,
      }),
    );
    expect(trustBadges(a)).toEqual([{ id: "unverified", label: "Sin verificar", tone: "muted" }]);
    expect(acceptanceWarning(a)).toContain("RETHUS");
    expect(acceptanceWarning(normalizeInboxRow(inbox()))).toBeNull();
    expect(
      acceptanceWarning(
        normalizeInboxRow(inbox({ rethus_verified: false, profile_verified: true })),
      ),
    ).toBeNull();
  });

  it("resume los turnos", () => {
    expect(shiftsSummary([])).toBe("Horario por coordinar");
    expect(shiftsSummary([{ id: "a", starts_at: at(1), ends_at: at(2) }])).toBe("1 turno");
    expect(
      shiftsSummary([
        { id: "a", starts_at: at(1), ends_at: at(2) },
        { id: "b", starts_at: at(3), ends_at: at(4) },
      ]),
    ).toBe("2 turnos");
  });

  it("dice cuánto queda para responder", () => {
    expect(expiryLabel(null, NOW)).toBeNull();
    expect(expiryLabel("no-es-fecha", NOW)).toBeNull();
    expect(expiryLabel(at(-1), NOW)).toBe("Venció");
    expect(expiryLabel(at(0), NOW)).toBe("Venció");
    expect(expiryLabel(new Date(NOW + 20 * 60_000).toISOString(), NOW)).toBe("Vence en 20 min");
    expect(expiryLabel(new Date(NOW + 10_000).toISOString(), NOW)).toBe("Vence en 1 min");
    expect(expiryLabel(at(5.5), NOW)).toBe("Vence en 5 h");
    expect(expiryLabel(at(47), NOW)).toBe("Vence en 47 h");
    expect(expiryLabel(at(72), NOW)).toBe("Vence en 3 días");
  });
});
