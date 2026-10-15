import { describe, expect, it } from "vitest";
import {
  OPEN_BOOKING_STATUSES,
  STALE_AFTER_MS,
  blockersLine,
  deletionBlockers,
  isDeleteConfirmation,
} from "./accountDeletion";

const NOW = Date.parse("2026-10-15T15:00:00Z");
const HOUR = 3_600_000;
const b = (status: string, offsetH: number | null) => ({
  status,
  scheduled_at: offsetH === null ? null : new Date(NOW + offsetH * HOUR).toISOString(),
});

describe("qué impide eliminar la cuenta", () => {
  it("sin servicios abiertos nada lo impide", () => {
    expect(deletionBlockers([], NOW)).toEqual({ inProgress: 0, upcoming: 0, blocked: false });
    expect(deletionBlockers([b("completed", -5), b("cancelled", 24)], NOW).blocked).toBe(false);
  });

  it("un servicio en camino o en curso lo impide, sea cual sea su fecha", () => {
    expect(deletionBlockers([b("in_progress", -30)], NOW)).toEqual({
      inProgress: 1,
      upcoming: 0,
      blocked: true,
    });
    expect(deletionBlockers([b("in_route", 1)], NOW).inProgress).toBe(1);
  });

  it("un servicio pendiente o confirmado de hoy en adelante lo impide", () => {
    expect(deletionBlockers([b("pending", 48), b("confirmed", -2)], NOW)).toEqual({
      inProgress: 0,
      upcoming: 2,
      blocked: true,
    });
  });

  it("uno pendiente olvidado hace días no bloquea para siempre", () => {
    expect(deletionBlockers([b("pending", -STALE_AFTER_MS / HOUR - 1)], NOW).blocked).toBe(false);
    expect(deletionBlockers([b("confirmed", -STALE_AFTER_MS / HOUR)], NOW).blocked).toBe(true);
  });

  it("sin fecha legible, mejor preguntar: cuenta como programado", () => {
    expect(deletionBlockers([b("confirmed", null)], NOW).upcoming).toBe(1);
    expect(deletionBlockers([{ status: "pending", scheduled_at: "mañana" }], NOW).upcoming).toBe(1);
  });

  it("los estados abiertos son los de la máquina de estados de los servicios", () => {
    expect([...OPEN_BOOKING_STATUSES]).toEqual(["pending", "confirmed", "in_route", "in_progress"]);
  });
});

describe("confirmación escrita", () => {
  it("acepta «eliminar» sin importar mayúsculas, tildes ni espacios", () => {
    for (const t of ["ELIMINAR", "eliminar", "  Eliminar ", "ELÍMINAR"])
      expect(isDeleteConfirmation(t)).toBe(true);
  });

  it("no acepta otra cosa", () => {
    for (const t of ["", "elimina", "eliminar ya", "borrar", "ELIMINAR."])
      expect(isDeleteConfirmation(t)).toBe(false);
  });
});

describe("mensaje sereno", () => {
  it("nada que decir si no hay bloqueo", () => {
    expect(blockersLine({ inProgress: 0, upcoming: 0, blocked: false })).toBeNull();
  });

  it("nombra lo que falta con singular y plural, y dice qué hacer", () => {
    expect(blockersLine({ inProgress: 1, upcoming: 0, blocked: true })).toBe(
      "Tienes un servicio en curso. Termínalo o cancélalo desde tu agenda y luego vuelve aquí: así nadie se queda esperando.",
    );
    expect(blockersLine({ inProgress: 2, upcoming: 3, blocked: true })).toMatch(
      /^Tienes 2 servicios en curso y 3 servicios programados\. Termínalos o cancélalos/,
    );
    expect(blockersLine({ inProgress: 0, upcoming: 1, blocked: true })).toMatch(
      /^Tienes un servicio programado\./,
    );
  });

  it("nunca suena a amenaza ni a culpa", () => {
    const t = blockersLine({ inProgress: 1, upcoming: 1, blocked: true })!;
    expect(t).not.toMatch(/no puedes|prohib|peligro|irreversible|debes/i);
  });
});
