import { describe, expect, it } from "vitest";
import { buildBriefing, greetingFor, type CompassSignals } from "./careCompass";
import type { ActiveService } from "./careLoop";

const now = new Date("2026-10-10T14:00:00Z"); // 9:00 Bogotá
const svc = (o: Partial<ActiveService>): ActiveService => ({
  booking_id: "b",
  side: "client",
  status: "confirmed",
  scheduled_at: now.toISOString(),
  duration_hours: 4,
  counterpart_id: "c",
  counterpart_name: "Ana",
  owner_name: null,
  started_at: null,
  events: 0,
  alerts: 0,
  last_mood: null,
  last_vitals: null,
  ...o,
});
const base: CompassSignals = {
  role: "family",
  now,
  services: [],
  unreadNotifications: 0,
  pendingProposals: 0,
  pendingApplications: 0,
};

describe("careCompass", () => {
  it("saluda según la hora de Bogotá", () => {
    expect(greetingFor(now, "María José")).toBe("Buenos días, María");
    expect(greetingFor(new Date("2026-10-11T01:00:00Z"))).toBe("Buenas noches");
  });

  it("día tranquilo propone una acción amable", () => {
    const b = buildBriefing(base);
    expect(b.tone).toBe("calm");
    expect(b.calm).toBe(100);
    expect(b.actions[0].id).toBe("idle");
  });

  it("las alertas van primero y marcan urgencia", () => {
    const b = buildBriefing({
      ...base,
      pendingProposals: 2,
      services: [svc({ started_at: now.toISOString(), alerts: 2 })],
    });
    expect(b.tone).toBe("urgent");
    expect(b.actions[0].id).toBe("alerts");
    expect(b.actions.map((a) => a.id)).toContain("proposals");
  });

  it("institución ve turnos por cubrir y candidatos", () => {
    const b = buildBriefing({ ...base, role: "institution", openOffers: 3, pendingApplications: 1 });
    expect(b.actions.map((a) => a.id)).toEqual(["applications", "coverage"]);
    expect(b.stats[1]).toEqual({ label: "Por cubrir", value: 3 });
    expect(b.tone).toBe("attention");
  });

  it("detecta servicios que empiezan en menos de 3 horas", () => {
    const b = buildBriefing({
      ...base,
      role: "professional",
      services: [svc({ scheduled_at: new Date(now.getTime() + 3_600_000).toISOString() })],
    });
    expect(b.actions[0].id).toBe("soon");
  });
});
