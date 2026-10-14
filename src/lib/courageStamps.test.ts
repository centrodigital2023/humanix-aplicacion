import { describe, expect, it } from "vitest";
import { PASSPORT_SIGNATURE, STAMPS, buildPassport, passportCertificate } from "./courageStamps";
import { DAY, HOUR, NOW, iso } from "./intel.fixture";

const done = (daysAgo: number) => ({ status: "completed", scheduled_at: iso(-daysAgo * DAY) });
const log = (daysAgo: number, event_type: string, over: object = {}) => ({
  event_type,
  created_at: iso(-daysAgo * DAY),
  ...over,
});
const earnedIds = (p: ReturnType<typeof buildPassport>) =>
  p.stamps.filter((s) => s.earned).map((s) => s.id);

describe("pasaporte de valentía: sellos", () => {
  it("los sellos tienen id único y texto para un niño o una niña", () => {
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(STAMPS.length);
    for (const s of STAMPS) expect(s.how.length).toBeGreaterThan(5);
  });

  it("sin nada todavía, el pasaporte está listo (no vacío ni en falta)", () => {
    const p = buildPassport({ bookings: [], now: NOW });
    expect(p.earned).toBe(0);
    expect(p.newest).toBeNull();
    expect(p.line).toBe("El pasaporte está listo para su primer sello.");
    expect(p.usesLogs).toBe(false);
  });

  it("los días con cuidado dan los sellos de 1, 3 y 7 días distintos", () => {
    expect(earnedIds(buildPassport({ bookings: [done(1)], now: NOW }))).toEqual(["first_day"]);
    expect(earnedIds(buildPassport({ bookings: [done(1), done(2), done(3)], now: NOW }))).toEqual([
      "first_day",
      "three_days",
    ]);
    const week = Array.from({ length: 7 }, (_, i) => done(i + 1));
    expect(earnedIds(buildPassport({ bookings: week, now: NOW }))).toEqual([
      "first_day",
      "three_days",
      "week",
    ]);
  });

  it("dos servicios el mismo día cuentan como un día", () => {
    const p = buildPassport({
      bookings: [done(1), { status: "completed", scheduled_at: iso(-DAY + 2 * HOUR) }, done(2)],
      now: NOW,
    });
    expect(earnedIds(p)).toEqual(["first_day"]);
  });

  it("cancelados y futuros no dan sellos", () => {
    const p = buildPassport({
      bookings: [
        { status: "cancelled", scheduled_at: iso(-DAY) },
        { status: "confirmed", scheduled_at: iso(DAY) },
        { status: "completed", scheduled_at: iso(2 * DAY) },
      ],
      now: NOW,
    });
    expect(p.earned).toBe(0);
  });

  it("los partes del turno dan los sellos de comida, juego, control, medicina y ánimo", () => {
    const p = buildPassport({
      bookings: [],
      logs: [
        log(1, "meal"),
        log(1, "activity"),
        log(2, "vital_signs"),
        log(2, "medication"),
        log(3, "note", { mood: "happy" }),
      ],
      now: NOW,
    });
    expect(earnedIds(p).sort()).toEqual(["brave_check", "calm", "meal", "medicine", "play"]);
    expect(p.usesLogs).toBe(true);
  });

  it("tres días contentos o tranquilos son tres días distintos", () => {
    const sameDay = buildPassport({
      bookings: [],
      logs: [
        log(1, "note", { mood: "calm" }),
        log(1, "note", { mood: "happy" }),
        log(2, "note", { mood: "calm" }),
      ],
      now: NOW,
    });
    expect(earnedIds(sameDay)).not.toContain("three_calm");
    const three = buildPassport({
      bookings: [],
      logs: [
        log(1, "note", { mood: "calm" }),
        log(2, "note", { mood: "happy" }),
        log(5, "note", { mood: "calm" }),
      ],
      now: NOW,
    });
    expect(earnedIds(three)).toContain("three_calm");
  });

  it("los ánimos difíciles no dan sello (ni lo quitan)", () => {
    const p = buildPassport({
      bookings: [],
      logs: [log(1, "note", { mood: "sad" }), log(2, "note", { mood: "pain" })],
      now: NOW,
    });
    expect(p.earned).toBe(0);
  });

  it("lo que genera el sistema (llegada, salida) no cuenta", () => {
    const p = buildPassport({
      bookings: [],
      logs: [log(1, "meal", { system_generated: true })],
      now: NOW,
    });
    expect(p.earned).toBe(0);
  });

  it("el más reciente es el último ganado y se marca como nuevo si es de estos días", () => {
    const p = buildPassport({
      bookings: [done(20)],
      logs: [log(10, "meal"), log(1, "activity")],
      now: NOW,
    });
    expect(p.newest?.id).toBe("play");
    expect(p.stamps.find((s) => s.id === "play")?.fresh).toBe(true);
    expect(p.stamps.find((s) => s.id === "meal")?.fresh).toBe(false);
  });

  it("la línea muestra el avance, nunca lo que falta", () => {
    const one = buildPassport({ bookings: [done(1)], now: NOW });
    expect(one.line).toBe(`1 de ${STAMPS.length} sellos ganado`);
    const many = buildPassport({ bookings: [done(1), done(2), done(3)], now: NOW });
    expect(many.line).toBe(`2 de ${STAMPS.length} sellos ganados`);
    expect(`${one.line} ${many.line}`).not.toMatch(/falt|perdi|fall/i);
  });
});

describe("pasaporte de valentía: certificado", () => {
  it("no hay certificado sin sellos", () => {
    expect(passportCertificate(buildPassport({ bookings: [], now: NOW }))).toBe("");
  });

  it("lista los sellos ganados y lleva la firma", () => {
    const text = passportCertificate(
      buildPassport({ bookings: [done(1), done(2), done(3)], logs: [log(1, "meal")], now: NOW }),
    );
    expect(text).toContain("Certificado de valentía");
    expect(text).toContain("3 sellos");
    expect(text).toContain("⭐ Buen provecho");
    expect(text.endsWith(PASSPORT_SIGNATURE)).toBe(true);
  });

  it("protege al menor: sin nombre, fechas, cifras ni datos de salud", () => {
    const text = passportCertificate(
      buildPassport({
        bookings: Array.from({ length: 8 }, (_, i) => done(i + 1)),
        logs: [log(1, "vital_signs", { description: "Temperatura 38.5" }), log(1, "medication")],
        now: NOW,
      }),
    );
    const body = text.replace(PASSPORT_SIGNATURE, "");
    expect(body).not.toMatch(
      /\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)|2026|38|temperatura|fiebre/i,
    );
    // El único número es la cantidad de sellos.
    expect(body.match(/\d+/g)).toEqual(["5"]);
  });
});
