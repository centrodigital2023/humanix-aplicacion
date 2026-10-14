import { describe, expect, it } from "vitest";
import {
  MAX_CALM_MOMENTS,
  MOMENTS_SIGNATURE,
  buildCareMoments,
  momentsShareText,
} from "./careMoments";
import { DAY, NOW, iso } from "./intel.fixture";

const done = (daysAgo: number) => ({ status: "completed", scheduled_at: iso(-daysAgo * DAY) });
const days = (...ago: number[]) => ago.map(done);
const mood = (daysAgo: number, m: string, over: object = {}) => ({
  created_at: iso(-daysAgo * DAY),
  mood: m,
  ...over,
});

describe("momentos memorables: qué recuerdan", () => {
  it("sin servicios ni partes no hay recuerdos (nada de relleno)", () => {
    expect(buildCareMoments({ bookings: [], now: NOW })).toEqual([]);
    expect(momentsShareText([]).empty).toBe(true);
  });

  it("el primer día con cuidado es el primer recuerdo", () => {
    const m = buildCareMoments({ bookings: days(3, 5), now: NOW });
    expect(m.map((x) => x.kind)).toEqual(["first_day"]);
    expect(m[0].title).toBe("Empezó el acompañamiento");
    expect(m[0].body).toContain("9 oct 2026");
  });

  it("los hitos se fechan el día en que se alcanzó cada uno", () => {
    // 7 días: del 8 al 14 de octubre; el séptimo día es hoy (14 oct).
    const m = buildCareMoments({ bookings: days(0, 1, 2, 3, 4, 5, 6), now: NOW });
    const hito = m.find((x) => x.kind === "milestone");
    expect(hito?.title).toBe("7 días con cuidado");
    expect(hito?.body).toContain("14 oct 2026");
    expect(m.filter((x) => x.kind === "milestone")).toHaveLength(1);
  });

  it("no hay hitos antes de alcanzarlos", () => {
    const m = buildCareMoments({ bookings: days(0, 1, 2, 3, 4, 5), now: NOW });
    expect(m.some((x) => x.kind === "milestone")).toBe(false);
  });

  it("los días tranquilos o contentos se recuerdan; los difíciles, jamás", () => {
    const m = buildCareMoments({
      bookings: days(1),
      logs: [mood(1, "calm"), mood(2, "sad"), mood(3, "pain"), mood(4, "tired"), mood(5, "happy")],
      now: NOW,
    });
    const calm = m.filter((x) => x.kind === "calm_day");
    expect(calm).toHaveLength(2);
    expect(JSON.stringify(m)).not.toMatch(/sad|dolor|triste|cansad|agitad|pain/i);
  });

  it("de cada día cuenta el último ánimo: un día que terminó mal no es un buen recuerdo", () => {
    const m = buildCareMoments({
      bookings: days(1),
      logs: [
        mood(2, "calm", { created_at: iso(-2 * DAY - 3 * 3_600_000) }),
        mood(2, "sad", { created_at: iso(-2 * DAY) }),
      ],
      now: NOW,
    });
    expect(m.some((x) => x.kind === "calm_day")).toBe(false);
  });

  it("máximo de días tranquilos y los más recientes primero", () => {
    const logs = [1, 2, 3, 4, 5].map((d) => mood(d, "calm"));
    const m = buildCareMoments({ bookings: days(1), logs, now: NOW, limit: 20 });
    const calm = m.filter((x) => x.kind === "calm_day");
    expect(calm).toHaveLength(MAX_CALM_MOMENTS);
    expect(calm[0].at).toBeGreaterThan(calm[1].at);
  });

  it("los partes del sistema, los futuros y los ánimos desconocidos no cuentan", () => {
    const m = buildCareMoments({
      bookings: days(1),
      logs: [
        mood(2, "calm", { system_generated: true }),
        { created_at: iso(2 * DAY), mood: "calm" },
        mood(3, "eufórico"),
      ],
      now: NOW,
    });
    expect(m.some((x) => x.kind === "calm_day")).toBe(false);
  });

  it("ordena del más reciente al más antiguo y respeta el límite", () => {
    const m = buildCareMoments({
      bookings: days(0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
      logs: [mood(0, "calm")],
      now: NOW,
      limit: 2,
    });
    expect(m).toHaveLength(2);
    expect(m[0].at).toBeGreaterThanOrEqual(m[1].at);
    expect(buildCareMoments({ bookings: days(1), now: NOW, limit: 0 })).toEqual([]);
  });
});

describe("momentos memorables: tono sobrio", () => {
  it("sin hitos ni celebraciones: solo el comienzo y días de calma", () => {
    const m = buildCareMoments({
      bookings: days(0, 1, 2, 3, 4, 5, 6),
      now: NOW,
      tone: "sober",
    });
    expect(m.map((x) => x.kind)).toEqual(["first_day"]);
    const share = momentsShareText(m, { tone: "sober" }).text;
    expect(share).not.toMatch(/💛|¡/u);
    expect(share).toContain("Gracias por estar pendientes.");
  });
});

describe("momentos memorables: texto para compartir", () => {
  const moments = buildCareMoments({
    bookings: days(0, 1, 2, 3, 4, 5, 6),
    logs: [mood(1, "happy")],
    now: NOW,
  });

  it("lista los recuerdos y lleva firma discreta que se puede quitar", () => {
    const s = momentsShareText(moments);
    expect(s.empty).toBe(false);
    expect(s.text.startsWith("Algunos buenos momentos de este camino")).toBe(true);
    expect(s.text.endsWith(MOMENTS_SIGNATURE)).toBe(true);
    expect(momentsShareText(moments, { signature: false }).text).not.toContain("humanix.lat");
  });

  it("sin dinero, contacto, direcciones ni valores de salud", () => {
    const { text } = momentsShareText(moments);
    expect(text).not.toMatch(/\$|\bCOP\b|pago|pagar|whatsapp|@|calle|carrera|barrio/i);
    expect(text).not.toMatch(/\d{7,}/);
    expect(text).not.toMatch(/mmhg|presi[oó]n|ox[ií]geno|temperatura|aviso|alerta/i);
    expect(text.match(/https?:\/\/\S+/g)).toEqual(["https://humanix.lat"]);
  });

  it("es estable: mismos datos, mismo texto", () => {
    expect(momentsShareText(moments).text).toBe(momentsShareText(moments).text);
  });
});
