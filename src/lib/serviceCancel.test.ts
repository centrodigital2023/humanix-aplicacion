import { describe, it, expect } from "vitest";
import {
  CANCEL_DETAIL_MAX,
  CANCEL_REASONS,
  buildCancelPatch,
  buildCancelReason,
  cancelConsequence,
  cancelFormSchema,
  cancelReasonLabel,
} from "./serviceCancel";

describe("motivos", () => {
  it("cada rol tiene su lista, con «Otro motivo» al final y ids únicos", () => {
    for (const party of ["client", "professional"] as const) {
      const list = CANCEL_REASONS[party];
      expect(list[list.length - 1].id).toBe("other");
      expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
    }
  });
  it("etiqueta de un motivo", () => {
    expect(cancelReasonLabel("professional", "health_issue")).toBe("Tengo un problema de salud");
    expect(cancelReasonLabel("client", "no_existe")).toBe("no_existe");
  });
});

describe("formulario de cancelación", () => {
  const client = cancelFormSchema("client");
  const pro = cancelFormSchema("professional");
  it("acepta un motivo de la lista, con o sin detalle", () => {
    expect(client.safeParse({ reason: "schedule_change" }).success).toBe(true);
    expect(
      pro.safeParse({ reason: "health_issue", detail: "Gripa fuerte desde ayer" }).success,
    ).toBe(true);
  });
  it("exige elegir un motivo válido de su rol", () => {
    expect(client.safeParse({ reason: "" }).success).toBe(false);
    expect(client.safeParse({ reason: "health_issue" }).success).toBe(false);
    expect(pro.safeParse({ reason: "no_longer_needed" }).success).toBe(false);
  });
  it("«Otro motivo» exige contar qué pasó", () => {
    expect(client.safeParse({ reason: "other" }).success).toBe(false);
    expect(client.safeParse({ reason: "other", detail: "   " }).success).toBe(false);
    expect(client.safeParse({ reason: "other", detail: "Cambio de ciudad" }).success).toBe(true);
  });
  it("el detalle no lleva contacto ni datos de pago y tiene máximo", () => {
    expect(
      client.safeParse({ reason: "schedule_change", detail: "Escríbeme al 3004445566" }).success,
    ).toBe(false);
    expect(
      client.safeParse({ reason: "schedule_change", detail: "Te pago por nequi 3004445566" })
        .success,
    ).toBe(false);
    expect(
      client.safeParse({ reason: "schedule_change", detail: "a".repeat(CANCEL_DETAIL_MAX) })
        .success,
    ).toBe(true);
    expect(
      client.safeParse({ reason: "schedule_change", detail: "a".repeat(CANCEL_DETAIL_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe("texto guardado", () => {
  it("motivo solo, con detalle y «otro»", () => {
    expect(buildCancelReason("client", { reason: "schedule_change" })).toBe("Cambió el horario");
    expect(
      buildCancelReason("client", { reason: "schedule_change", detail: " Viajo el lunes " }),
    ).toBe("Cambió el horario: Viajo el lunes");
    expect(buildCancelReason("professional", { reason: "other", detail: "Mudanza urgente" })).toBe(
      "Mudanza urgente",
    );
  });
  it("cambios de la reserva", () => {
    const patch = buildCancelPatch(
      "client",
      { reason: "no_longer_needed" },
      new Date("2026-10-09T15:00:00Z"),
    );
    expect(patch).toEqual({
      status: "cancelled",
      cancelled_at: "2026-10-09T15:00:00.000Z",
      cancel_reason: "Ya no necesito el servicio",
    });
  });
});

describe("consecuencia visible antes de confirmar", () => {
  it("profesional: reserva directa u oferta (plan B)", () => {
    expect(cancelConsequence("professional", "direct")).toContain(
      "equipo de confianza están libres",
    );
    expect(cancelConsequence("professional")).toContain("equipo de confianza están libres");
    expect(cancelConsequence("professional", "offer")).toContain("plan B");
  });
  it("cliente", () => {
    expect(cancelConsequence("client")).toBe(
      "Se avisa de inmediato al profesional y se libera su horario.",
    );
    expect(cancelConsequence("client", "offer")).toBe(
      "Se avisa de inmediato al profesional y se libera su horario.",
    );
  });
});
