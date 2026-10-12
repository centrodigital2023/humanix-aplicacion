import { describe, expect, it } from "vitest";
import { buildBudgetReport } from "./careBudget";
import type { ActiveService } from "./careLoop";
import { buildCoverageRadar } from "./coverageRadar";
import { buildFamilyBrief } from "./familyBrief";
import {
  MIN_SPEND_FOR_PACE,
  buildSnapshot,
  completedByProfessional,
  premiumHints,
  type SnapshotBooking,
} from "./familySnapshot";
import {
  DAY,
  HOUR,
  NOW,
  aheadIn,
  bundle,
  doneAgo,
  iso,
  needBlock,
  service,
} from "./familyIntel.fixture";
import { buildWellbeingReport } from "./wellbeing";

const active = (over: Partial<ActiveService> = {}): ActiveService => ({
  booking_id: "b1",
  side: "client",
  status: "in_progress",
  scheduled_at: iso(-2 * HOUR),
  duration_hours: 6,
  counterpart_id: "pro-1",
  counterpart_name: "Laura Pérez",
  owner_name: null,
  started_at: iso(-2 * HOUR),
  events: 3,
  alerts: 0,
  last_mood: null,
  last_vitals: null,
  ...over,
});

const booking = (over: Partial<SnapshotBooking> = {}): SnapshotBooking => ({
  id: "x1",
  status: "completed",
  scheduled_at: iso(-3 * DAY),
  completed_at: iso(-3 * DAY + 6 * HOUR),
  professional_id: "pro-1",
  ...over,
});

const base = {
  now: NOW,
  active: [] as ActiveService[],
  bookings: [] as SnapshotBooking[],
  ratedBookingIds: [] as string[],
  names: {} as Record<string, string>,
  proposals: [],
  applications: [],
  gaps: [],
  profile: { complete: true, hasEmergencyContact: true },
  teamSize: 1,
  circleMembers: 1,
  premium: false,
};
const snap = (over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) =>
  buildSnapshot({ ...base, ...over });

describe("servicios en curso", () => {
  it("pasan los de la familia y los del círculo, con primer nombre y alertas", () => {
    const s = snap({
      active: [
        active({ booking_id: "a", alerts: 2 }),
        active({
          booking_id: "b",
          side: "circle",
          owner_name: "María Gómez",
          counterpart_name: "Ana Ruiz",
          status: "confirmed",
        }),
      ],
    });
    expect(s.services).toEqual([
      {
        bookingId: "a",
        side: "client",
        status: "in_progress",
        scheduledAt: iso(-2 * HOUR),
        counterpartName: "Laura",
        ownerName: null,
        alerts: 2,
      },
      {
        bookingId: "b",
        side: "circle",
        status: "confirmed",
        scheduledAt: iso(-2 * HOUR),
        counterpartName: "Ana",
        ownerName: "María",
        alerts: 0,
      },
    ]);
  });

  it("no pasan los del lado del profesional ni los estados que no son de seguimiento", () => {
    const s = snap({
      active: [
        active({ booking_id: "a", side: "professional" }),
        active({ booking_id: "b", status: "completed" }),
        active({ booking_id: "c", status: "cancelled" }),
        active({ booking_id: "d", status: "pending" }),
        active({ booking_id: "ok", status: "in_route" }),
      ],
    });
    expect(s.services.map((x) => x.bookingId)).toEqual(["ok"]);
  });
});

describe("servicios por calificar", () => {
  it("los terminados que la familia aún no calificó, el más reciente primero", () => {
    const s = snap({
      bookings: [
        booking({ id: "viejo", completed_at: iso(-9 * DAY) }),
        booking({ id: "nuevo", completed_at: iso(-1 * DAY), professional_id: "pro-2" }),
        booking({ id: "calificado", completed_at: iso(-2 * DAY) }),
        booking({ id: "cancelado", status: "cancelled", completed_at: null }),
        booking({ id: "futuro", status: "confirmed", completed_at: null }),
      ],
      ratedBookingIds: new Set(["calificado"]),
      names: { "pro-1": "Laura Pérez", "pro-2": "Marta Ruiz" },
    });
    expect(s.unrated).toEqual([
      { bookingId: "nuevo", proName: "Marta", completedAt: iso(-1 * DAY) },
      { bookingId: "viejo", proName: "Laura", completedAt: iso(-9 * DAY) },
    ]);
    expect(s.completedServices).toBe(3);
  });

  it("sin fecha de cierre usa la programada; sin nombre queda en null", () => {
    const s = snap({ bookings: [booking({ id: "a", completed_at: null })] });
    expect(s.unrated).toEqual([{ bookingId: "a", proName: null, completedAt: iso(-3 * DAY) }]);
  });

  it("solo mira los 20 servicios terminados más recientes", () => {
    const bookings = Array.from({ length: 25 }, (_, i) =>
      booking({ id: `b${i}`, completed_at: iso(-(i + 1) * DAY) }),
    );
    const s = snap({ bookings });
    expect(s.unrated).toHaveLength(20);
    expect(s.unrated[0].bookingId).toBe("b0");
    expect(s.completedServices).toBe(25);
  });
});

describe("propuestas, postulaciones y huecos", () => {
  it("se traducen sin perder lo que importa", () => {
    const radar = buildCoverageRadar({ needs: needBlock(3 * HOUR, 4), now: NOW });
    const s = snap({
      proposals: [
        {
          id: "p",
          status: "pending",
          proposed_by: "professional",
          expires_at: iso(HOUR),
          peer_name: "Marta Ruiz",
        },
      ],
      applications: [{ id: "a", status: "pending", created_at: iso(-HOUR) }],
      gaps: radar.gaps,
    });
    expect(s.proposals).toEqual([
      {
        id: "p",
        status: "pending",
        proposedBy: "professional",
        expiresAt: iso(HOUR),
        peerName: "Marta",
      },
    ]);
    expect(s.applications).toEqual([{ id: "a", status: "pending", createdAt: iso(-HOUR) }]);
    expect(s.gaps).toEqual([
      { startsAt: iso(3 * HOUR), endsAt: iso(7 * HOUR), hours: 4, level: "critical" },
    ]);
  });

  it("los datos de la familia pasan tal cual", () => {
    const s = snap({
      profile: { complete: false, hasEmergencyContact: false },
      teamSize: 3,
      circleMembers: 2,
      premium: true,
    });
    expect(s).toMatchObject({
      now: NOW,
      teamSize: 3,
      circleMembers: 2,
      premium: true,
      profile: { complete: false, hasEmergencyContact: false },
    });
  });
});

describe("avisos del plan de pago", () => {
  const wb = buildWellbeingReport({
    ...bundle(
      service(3, { id: "a", mood: "calm", alert: "Fiebre" }),
      service(2, { id: "b", mood: "calm" }),
    ),
    now: NOW,
  });

  it("sin informes no hay avisos (y el gasto no inventa nada)", () => {
    expect(premiumHints(null, null)).toEqual({
      alerts7d: undefined,
      moodTrend: undefined,
      budgetDeltaPct: null,
      aboveMarketPct: null,
    });
  });

  it("del informe de bienestar salen las alertas de la semana y la tendencia del ánimo", () => {
    const h = premiumHints(wb, null);
    expect(h.alerts7d).toBe(1);
    expect(h.moodTrend).toBe("unknown");
  });

  it("del presupuesto sale el cambio de ritmo (solo con un gasto que valga la pena) y lo que se paga sobre el mercado", () => {
    const rows = [
      doneAgo(12),
      doneAgo(9),
      doneAgo(5),
      doneAgo(2),
      doneAgo(41),
      doneAgo(34),
      doneAgo(24),
      aheadIn(6),
    ];
    const above = buildBudgetReport({
      bookings: rows,
      market: { n: 12, p25: 18_000, median: 20_000, p75: 22_000 },
      now: NOW,
    });
    expect(above.vsLastMonth.spentToDate).toBeGreaterThanOrEqual(MIN_SPEND_FOR_PACE);
    const h = premiumHints(null, above);
    expect(h.budgetDeltaPct).toBe(100);
    expect(h.aboveMarketPct).toBe(25);

    const within = buildBudgetReport({
      bookings: rows,
      market: { n: 12, p25: 20_000, median: 24_000, p75: 28_000 },
      now: NOW,
    });
    expect(premiumHints(null, within).aboveMarketPct).toBeNull();

    const small = buildBudgetReport({
      bookings: [doneAgo(2, { total_amount: 60_000 }), doneAgo(41, { total_amount: 20_000 })],
      now: NOW,
    });
    expect(small.vsLastMonth.deltaPct).toBe(200);
    expect(premiumHints(null, small).budgetDeltaPct).toBeNull();
  });
});

describe("de la foto al resumen del día", () => {
  it("una familia con una alerta, una propuesta por vencer y un servicio por calificar", () => {
    const s = snap({
      premium: true,
      active: [active({ booking_id: "live", alerts: 1 })],
      proposals: [
        {
          id: "p",
          status: "pending",
          proposed_by: "professional",
          expires_at: iso(2 * HOUR),
          peer_name: "Marta Ruiz",
        },
      ],
      bookings: [booking({ id: "done", completed_at: iso(-DAY) })],
      names: { "pro-1": "Laura Pérez" },
      hints: { alerts7d: 1 },
    });
    const items = buildFamilyBrief(s);
    expect(items.map((x) => x.id)).toEqual([
      "service_alert:live",
      "proposal_expiring",
      "unrated",
      "wellbeing_alerts",
    ]);
    expect(items[0].title).toBe("Alerta en el turno de Laura");
    expect(items[1].title).toBe("Responde antes de que venza: Marta");
    expect(items[2].title).toBe("Califica el servicio con Laura");
  });
});

describe("servicios terminados con cada profesional", () => {
  it("cuenta solo los terminados, por profesional", () => {
    expect(
      completedByProfessional([
        { status: "completed", professional_id: "a" },
        { status: "completed", professional_id: "a" },
        { status: "completed", professional_id: "b" },
        { status: "cancelled", professional_id: "a" },
        { status: "confirmed", professional_id: "c" },
        { status: "completed", professional_id: "" },
      ]),
    ).toEqual({ a: 2, b: 1 });
    expect(completedByProfessional([])).toEqual({});
  });
});
