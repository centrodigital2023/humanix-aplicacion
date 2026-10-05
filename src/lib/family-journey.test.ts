import { describe, expect, it } from "vitest";
import {
  PENDING_TTL_MS,
  journeyIndex,
  journeySentence,
  parsePendingBooking,
  whenToDate,
} from "./family-journey";

const base = {
  proId: "p1",
  proName: "Ana María Rojas",
  hourlyRate: 25000,
  when: "now",
  hours: 4,
  address: "Calle 100",
  coords: null,
  savedAt: 1_000,
};

describe("parsePendingBooking", () => {
  it("devuelve el pedido guardado dentro de las 24 horas", () => {
    const p = parsePendingBooking(JSON.stringify(base), 1_000 + 60_000);
    expect(p?.proName).toBe("Ana María Rojas");
    expect(p?.hours).toBe(4);
  });

  it("descarta pedidos vencidos", () => {
    expect(parsePendingBooking(JSON.stringify(base), 1_000 + PENDING_TTL_MS + 1)).toBeNull();
  });

  it("descarta datos dañados o incompletos", () => {
    expect(parsePendingBooking("{no json", 2_000)).toBeNull();
    expect(parsePendingBooking(JSON.stringify({ proName: "x", savedAt: 1 }), 2)).toBeNull();
    expect(parsePendingBooking(null)).toBeNull();
  });

  it("corrige valores fuera de rango", () => {
    const p = parsePendingBooking(
      JSON.stringify({ ...base, when: "ayer", hours: -3, hourlyRate: "x" }),
      2_000,
    );
    expect(p?.when).toBe("now");
    expect(p?.hours).toBe(4);
    expect(p?.hourlyRate).toBeNull();
  });
});

describe("journey", () => {
  it("ubica cada estado en su paso", () => {
    expect(journeyIndex("pending")).toBe(0);
    expect(journeyIndex("in_route")).toBe(2);
    expect(journeyIndex("completed")).toBe(4);
    expect(journeyIndex("cancelled")).toBe(-1);
    expect(journeyIndex("desconocido")).toBe(0);
  });

  it("usa el primer nombre en la frase", () => {
    expect(journeySentence("in_route", "Ana María Rojas")).toBe("Ana va en camino");
  });
});

describe("whenToDate", () => {
  it("'Ya' es dentro de la próxima hora en punto", () => {
    const d = whenToDate("now", new Date(2026, 9, 5, 10, 35));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(0);
  });

  it("'Mañana' es a las 8 a. m. del día siguiente", () => {
    const d = whenToDate("tomorrow", new Date(2026, 9, 5, 22, 0));
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(8);
  });

  it("'Esta tarde' nunca es antes de las 2 p. m.", () => {
    expect(whenToDate("afternoon", new Date(2026, 9, 5, 8, 0)).getHours()).toBe(14);
  });
});
