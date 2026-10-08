import { describe, it, expect } from "vitest";
import {
  MAX_ROUNDS,
  MIN_WAGE_PER_HOUR,
  expiryFor,
  isExpired,
  lowNetWarning,
  marketCopy,
  marketPosition,
  midpointRate,
  netPerHour,
  offerErrorCopy,
  rateBand,
  respondOptions,
  roundLabel,
  roundToStep,
  suggestCounter,
  timeLeftLabel,
  validateOffer,
  type Negotiable,
} from "./negotiation";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 12, 15, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (n: number) => `$${n}`;

const pending = (o: Partial<Negotiable> = {}): Negotiable => ({
  status: "pending",
  proposed_by: "professional",
  round: 1,
  expires_at: iso(NOW + 10 * HOUR),
  ...o,
});

describe("rateBand y validateOffer", () => {
  it("acota entre 0,8× y 2× de la tarifa publicada", () => {
    expect(rateBand(20000)).toEqual({ min: 16000, max: 40000 });
    expect(rateBand(200000)).toEqual({ min: 160000, max: 250000 });
  });
  it("respeta el piso de plataforma y no se rompe sin tarifa", () => {
    expect(rateBand(9000)).toEqual({ min: 8000, max: 18000 });
    expect(rateBand(null)).toEqual({ min: 8000, max: 16000 });
    expect(rateBand(-5)).toEqual({ min: 8000, max: 16000 });
  });
  it("valida enteros dentro del rango", () => {
    expect(validateOffer(20000, 16000)).toEqual({ ok: true });
    expect(validateOffer(20000, 40000)).toEqual({ ok: true });
    expect(validateOffer(20000, 15999)).toMatchObject({ ok: false, reason: "below_band" });
    expect(validateOffer(20000, 40001)).toMatchObject({ ok: false, reason: "above_band" });
    for (const bad of [0, -1, 20000.5, "20000", null, undefined, NaN]) {
      expect(validateOffer(20000, bad)).toMatchObject({ ok: false, reason: "invalid" });
    }
  });
  it("explica el error con el rango", () => {
    const c = validateOffer(20000, 1000);
    if (c.ok) throw new Error("debía fallar");
    expect(offerErrorCopy(c, fmt)).toBe(
      "El valor por hora debe estar entre $16000 y $40000 para esta solicitud.",
    );
    const bad = validateOffer(20000, 0);
    if (bad.ok) throw new Error("debía fallar");
    expect(offerErrorCopy(bad, fmt)).toMatch(/válido/);
  });
});

describe("respondOptions", () => {
  it("quien recibe la oferta puede aceptar, rechazar o contraofertar", () => {
    const o = respondOptions(pending({ proposed_by: "professional" }), "family", NOW);
    expect(o).toMatchObject({ accept: true, reject: true, counter: true, withdraw: false });
    expect(o.isFinalRound).toBe(false);
  });
  it("quien hizo la oferta solo puede retirarla", () => {
    const o = respondOptions(pending({ proposed_by: "professional" }), "professional", NOW);
    expect(o).toMatchObject({ accept: false, reject: false, counter: false, withdraw: true });
  });
  it("la última ronda no admite contraoferta", () => {
    const o = respondOptions(
      pending({ round: MAX_ROUNDS, proposed_by: "family" }),
      "professional",
      NOW,
    );
    expect(o).toMatchObject({ accept: true, reject: true, counter: false, isFinalRound: true });
    expect(o.reason).toMatch(/Última oferta/);
  });
  it("una oferta vencida o cerrada no admite nada", () => {
    const expired = respondOptions(pending({ expires_at: iso(NOW - 1) }), "family", NOW);
    expect(expired).toMatchObject({
      accept: false,
      reject: false,
      counter: false,
      withdraw: false,
    });
    expect(expired.reason).toBe("La oferta venció.");
    const closed = respondOptions(pending({ status: "accepted" }), "family", NOW);
    expect(closed.accept).toBe(false);
    expect(closed.reason).toMatch(/ya no está activa/);
    expect(respondOptions(pending({ status: "countered" }), "family", NOW).accept).toBe(false);
  });
  it("sin fecha de vencimiento no expira", () => {
    expect(isExpired({ expires_at: null }, NOW)).toBe(false);
    expect(isExpired({ expires_at: iso(NOW) }, NOW)).toBe(true);
  });
});

describe("etiquetas de tiempo y ronda", () => {
  it("nombra cada ronda", () => {
    expect(roundLabel(0)).toBe("Oferta inicial");
    expect(roundLabel(1)).toBe("Oferta inicial");
    expect(roundLabel(2)).toBe("Contraoferta 1");
    expect(roundLabel(3)).toBe("Última oferta");
  });
  it("cuenta regresiva legible", () => {
    expect(timeLeftLabel(iso(NOW + 5 * HOUR + 20 * 60_000), NOW)).toBe("Vence en 5 h 20 min");
    expect(timeLeftLabel(iso(NOW + 2 * HOUR), NOW)).toBe("Vence en 2 h");
    expect(timeLeftLabel(iso(NOW + 45 * 60_000), NOW)).toBe("Vence en 45 min");
    expect(timeLeftLabel(iso(NOW + 30_000), NOW)).toBe("Vence en menos de 1 min");
    expect(timeLeftLabel(iso(NOW - 1), NOW)).toBe("Venció");
    expect(timeLeftLabel(null, NOW)).toBeNull();
  });
  it("la postulación vence a las 72 h y cada contraoferta a las 24 h", () => {
    const far = iso(NOW + 10 * 24 * HOUR);
    expect(expiryFor({ round: 1, startsAt: far, now: NOW })).toBe(iso(NOW + 72 * HOUR));
    expect(expiryFor({ round: 2, startsAt: far, now: NOW })).toBe(iso(NOW + 24 * HOUR));
  });
  it("nunca vence después de 1 h antes del turno, pero deja al menos 15 min para responder", () => {
    expect(expiryFor({ round: 2, startsAt: iso(NOW + 5 * HOUR), now: NOW })).toBe(
      iso(NOW + 4 * HOUR),
    );
    expect(expiryFor({ round: 1, startsAt: iso(NOW + 30 * 60_000), now: NOW })).toBe(
      iso(NOW + 15 * 60_000),
    );
    expect(expiryFor({ round: 1, startsAt: "no-es-fecha", now: NOW })).toBe(iso(NOW + 72 * HOUR));
  });
});

describe("sugerencias y mercado", () => {
  it("redondea y calcula el punto medio a pasos de 500", () => {
    expect(roundToStep(20240)).toBe(20000);
    expect(roundToStep(20260)).toBe(20500);
    expect(midpointRate(20001, 21000)).toBe(20500);
  });
  it("sugiere el punto medio y avisa cuando es la última contraoferta", () => {
    const s = suggestCounter({ theirOffer: 18000, myLastOffer: 25000, posted: 20000, round: 2 });
    expect(s.suggested).toBe(21500);
    expect(s.isLastCounter).toBe(true);
    expect(s.rationale).toMatch(/última contraoferta/);

    const first = suggestCounter({ theirOffer: 30000, myLastOffer: null, posted: 20000, round: 1 });
    expect(first.suggested).toBe(25000);
    expect(first.isLastCounter).toBe(false);
  });
  it("nunca sugiere fuera del rango permitido", () => {
    const s = suggestCounter({ theirOffer: 100000, myLastOffer: null, posted: 20000, round: 1 });
    expect(s.suggested).toBe(40000);
    const low = suggestCounter({ theirOffer: 1000, myLastOffer: 1000, posted: 20000, round: 1 });
    expect(low.suggested).toBe(16000);
  });
  it("compara contra el rango de mercado solo con muestra suficiente", () => {
    const stats = { n: 12, p25: 18000, median: 21000, p75: 25000 };
    expect(marketPosition(15000, stats)).toBe("below");
    expect(marketPosition(21000, stats)).toBe("within");
    expect(marketPosition(30000, stats)).toBe("above");
    expect(marketPosition(21000, { ...stats, n: 4 })).toBe("unknown");
    expect(marketPosition(21000, null)).toBe("unknown");
    expect(marketCopy("within", stats, fmt)).toBe(
      "Dentro del rango habitual en tu zona ($18000–$25000/h).",
    );
    expect(marketCopy("unknown", null, fmt)).toMatch(/Aún no hay suficientes/);
  });
});

describe("neto después de comisión", () => {
  it("descuenta la comisión por hora", () => {
    expect(netPerHour(20000, 12)).toBe(17600);
    expect(netPerHour(20000, 0)).toBe(20000);
  });
  it("advierte cuando el neto queda bajo el salario mínimo por hora", () => {
    expect(MIN_WAGE_PER_HOUR).toBe(7296);
    expect(lowNetWarning(20000, 12, fmt)).toBeNull();
    expect(lowNetWarning(8000, 12, fmt)).toBe(
      "Después de la comisión te quedarían $7040/h, menos que el salario mínimo por hora ($7296).",
    );
    expect(lowNetWarning(8000, 0, fmt)).toBeNull();
  });
});
