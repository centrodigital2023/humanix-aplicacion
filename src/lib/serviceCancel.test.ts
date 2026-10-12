import { describe, it, expect } from "vitest";
import {
  CANCEL_DETAIL_MAX,
  CANCEL_REASONS,
  buildCancelPatch,
  buildCancelReason,
  cancelConsequence,
  cancelFormSchema,
  cancelReasonLabel,
  inferCancelParty,
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

describe("quién canceló, según el motivo guiado", () => {
  it("reconoce cada motivo de la lista, solo o con detalle, sin importar mayúsculas ni espacios", () => {
    for (const party of ["client", "professional"] as const) {
      for (const r of CANCEL_REASONS[party].filter((x) => x.id !== "other")) {
        expect(inferCancelParty(r.label)).toBe(party);
        expect(inferCancelParty(`${r.label}: mi mamá se puso mal`)).toBe(party);
        expect(inferCancelParty(`  ${r.label.toUpperCase()}  `)).toBe(party);
      }
    }
  });

  it("lo que guarda el formulario se lee de vuelta con la parte correcta", () => {
    for (const party of ["client", "professional"] as const) {
      for (const r of CANCEL_REASONS[party].filter((x) => x.id !== "other")) {
        const values = { reason: r.id, detail: "Detalle" };
        expect(inferCancelParty(buildCancelReason(party, values))).toBe(party);
        expect(inferCancelParty(buildCancelReason(party, { reason: r.id }))).toBe(party);
      }
    }
  });

  it("«Otro motivo» guarda solo el detalle: no se adivina quién fue", () => {
    for (const party of ["client", "professional"] as const) {
      expect(
        inferCancelParty(buildCancelReason(party, { reason: "other", detail: "Me salió algo" })),
      ).toBe("unknown");
    }
  });

  it("una etiqueta que está en las dos listas («Otro motivo») no dice quién fue", () => {
    expect(inferCancelParty("Otro motivo")).toBe("unknown");
    expect(inferCancelParty("otro motivo: algo pasó")).toBe("unknown");
  });

  it("sin motivo, o con texto que no es de la lista, es desconocido", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "Cancelado por el sistema",
      "cambió el horario del turno",
    ]) {
      expect(inferCancelParty(bad)).toBe("unknown");
    }
  });

  it("solo cuenta la etiqueta completa al principio, no una parte suelta", () => {
    expect(inferCancelParty("Ya no necesito el servicio, gracias")).toBe("unknown");
    expect(inferCancelParty("Se canceló: Cambió el horario")).toBe("unknown");
  });
});
