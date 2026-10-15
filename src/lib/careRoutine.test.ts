import { describe, expect, it } from "vitest";
import { detectRoutine, routineLabel } from "./careRoutine";

// Martes 9 a. m. Bogotá = 14:00 UTC
const tue = (d: string) => `${d}T14:00:00Z`;
const now = Date.parse("2026-10-15T14:00:00Z"); // jueves

describe("detectRoutine", () => {
  it("no propone nada con menos de 3 repeticiones", () => {
    const b = [tue("2026-09-29"), tue("2026-10-06")].map((s) => ({
      status: "completed",
      scheduled_at: s,
      professional_id: "p1",
    }));
    expect(detectRoutine(b, now)).toBeNull();
  });

  it("detecta la rutina y calcula el próximo martes", () => {
    const b = [tue("2026-09-22"), tue("2026-09-29"), tue("2026-10-06")].map((s) => ({
      status: "completed",
      scheduled_at: s,
      professional_id: "p1",
      duration_hours: 4,
    }));
    const r = detectRoutine(b, now)!;
    expect(r.times).toBe(3);
    expect(r.nextAt).toBe("2026-10-20T14:00:00.000Z");
    expect(r.durationHours).toBe(4);
    expect(r.hasUpcoming).toBe(false);
    expect(routineLabel(r)).toBe("los martes a las 9 a. m.");
  });

  it("marca si ya hay un servicio reservado", () => {
    const b = [tue("2026-09-22"), tue("2026-09-29"), tue("2026-10-06")].map((s) => ({
      status: "completed",
      scheduled_at: s,
      professional_id: "p1",
    }));
    b.push({ status: "confirmed", scheduled_at: tue("2026-10-20"), professional_id: "p1" });
    expect(detectRoutine(b, now)!.hasUpcoming).toBe(true);
  });

  it("ignora cancelados", () => {
    const b = [tue("2026-09-22"), tue("2026-09-29"), tue("2026-10-06")].map((s) => ({
      status: "cancelled",
      scheduled_at: s,
      professional_id: "p1",
    }));
    expect(detectRoutine(b, now)).toBeNull();
  });
});
