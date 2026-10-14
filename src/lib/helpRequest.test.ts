import { describe, expect, it } from "vitest";
import { HELP_ASKS, HELP_SIGNATURE, buildHelpRequest, uncoveredDays } from "./helpRequest";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

// NOW = miércoles 14 oct 2026, 10:00 en Colombia.
const at = (daysFromNow: number, status = "confirmed", hours = 6) => ({
  status,
  scheduled_at: iso(daysFromNow * DAY),
  duration_hours: hours,
});

describe("pedir ayuda: días sin servicio", () => {
  it("sin servicios, los 7 días de la semana están libres, empezando hoy", () => {
    expect(uncoveredDays([], NOW)).toHaveLength(7);
  });

  it("un servicio cubre su día; cancelado o rechazado no", () => {
    const free = (b: ReturnType<typeof at>[]) => uncoveredDays(b, NOW).length;
    expect(free([at(1)])).toBe(6);
    expect(free([at(1, "cancelled")])).toBe(7);
    expect(free([at(1, "rejected")])).toBe(7);
    expect(free([at(1, "pending")])).toBe(6);
  });

  it("varios servicios el mismo día cubren un solo día", () => {
    expect(uncoveredDays([at(1), at(1, "confirmed", 2)], NOW)).toHaveLength(6);
  });

  it("un turno de noche que cruza la medianoche cubre los dos días", () => {
    // 20:00 de mañana (hora de Colombia) durante 10 h → hasta las 06:00 de pasado mañana.
    const night = { status: "confirmed", scheduled_at: iso(DAY + 10 * HOUR), duration_hours: 10 };
    expect(uncoveredDays([night], NOW)).toHaveLength(5);
  });

  it("servicios pasados o de más de una semana no cuentan", () => {
    expect(uncoveredDays([at(-2), at(9)], NOW)).toHaveLength(7);
  });

  it("fecha dañada o duración rara no rompe", () => {
    const bad = [
      { status: "confirmed", scheduled_at: "no es fecha" },
      { status: "confirmed", scheduled_at: iso(DAY), duration_hours: -4 },
      { status: "confirmed", scheduled_at: iso(2 * DAY), duration_hours: 9999 },
    ];
    expect(() => uncoveredDays(bad, NOW)).not.toThrow();
    // El turno de 9999 horas se acota a 3 días.
    expect(uncoveredDays(bad, NOW)).toHaveLength(7 - 1 - 3);
  });

  it("la duración puede llegar como texto (así la entrega la base de datos)", () => {
    const night = { status: "confirmed", scheduled_at: iso(DAY + 10 * HOUR), duration_hours: "10" };
    expect(uncoveredDays([night], NOW)).toHaveLength(5);
    expect(uncoveredDays([{ ...night, duration_hours: null }], NOW)).toHaveLength(6);
  });

  it("los días salen ascendentes", () => {
    const d = uncoveredDays([at(2)], NOW);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});

describe("pedir ayuda: el mensaje", () => {
  it.each(HELP_ASKS)("«%s» lleva una petición clara y un cierre", (ask) => {
    const r = buildHelpRequest({ bookings: [], now: NOW, ask });
    expect(r.text).toContain("Respóndeme con el día y la hora");
    expect(r.text.endsWith(HELP_SIGNATURE)).toBe(true);
    expect(r.text).toMatch(/\?/);
  });

  it("nombra los días reales sin servicio, máximo cuatro", () => {
    const r = buildHelpRequest({ bookings: [at(1)], now: NOW, ask: "company" });
    expect(r.freeDays).toHaveLength(6);
    const line = r.text.split("\n").find((l) => l.startsWith("Esta semana"))!;
    expect(line).toBe(
      "Esta semana no hay servicio programado: mié 14 oct, vie 16 oct, sáb 17 oct, dom 18 oct.",
    );
  });

  it("si todos los días están cubiertos, no inventa días libres", () => {
    const all = [0, 1, 2, 3, 4, 5, 6].map((d) => at(d));
    const r = buildHelpRequest({ bookings: all, now: NOW, ask: "rest" });
    expect(r.freeDays).toEqual([]);
    expect(r.text).not.toContain("Esta semana no hay servicio");
    expect(r.text).toContain("descansar");
  });

  it("en el tono sobrio no hay emojis", () => {
    const r = buildHelpRequest({ bookings: [], now: NOW, ask: "errands", tone: "sober" });
    expect(r.text).not.toMatch(/💛|¡/u);
    expect(r.text).toContain("Gracias por estar.");
  });

  it("la firma se puede quitar", () => {
    const r = buildHelpRequest({ bookings: [], now: NOW, ask: "company", signature: false });
    expect(r.text).not.toContain("humanix.lat");
  });

  it("sin nombres, dinero, contacto ni datos de salud, y un solo enlace (la firma)", () => {
    for (const ask of HELP_ASKS) {
      const { text } = buildHelpRequest({ bookings: [at(1)], now: NOW, ask });
      expect(text).not.toMatch(/\$|\bCOP\b|pago|pagar|precio|tarifa|whatsapp|@/i);
      expect(text).not.toMatch(/\d{7,}/);
      expect(text).not.toMatch(/aviso|alerta|diagn|medicament|dosis|presi[oó]n/i);
      expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://humanix.lat"]);
    }
  });

  it("culpa cero: nunca regaña ni presiona", () => {
    const { text } = buildHelpRequest({ bookings: [], now: NOW, ask: "company" });
    expect(text).not.toMatch(/urgente|siempre|nunca|obligaci|deber[ií]an|por favor ya/i);
  });

  it("es estable", () => {
    const a = buildHelpRequest({ bookings: [at(1)], now: NOW, ask: "rest" }).text;
    expect(a).toBe(buildHelpRequest({ bookings: [at(1)], now: NOW, ask: "rest" }).text);
  });
});
