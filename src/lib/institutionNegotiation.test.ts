import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODALITY_BOUNDS,
  amountErrorCopy,
  applicationActions,
  applicationExpiry,
  applicationRoundLabel,
  contractTotal,
  describeAmount,
  isOfferModality,
  offerBand,
  perShiftTotal,
  professionalNet,
  suggestApplicationCounter,
  validateOfferAmount,
  validatePublishedAmount,
  type ApplicationState,
} from "./institutionNegotiation";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const fmt = (n: number) => `$${n.toLocaleString("es-CO")}`;
const future = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();

describe("offerBand frente a PostgreSQL", () => {
  // La misma tabla la verifica la suite de PostgreSQL (supabase/e2e/institution_hub/scenario.sql, 14.5–14.6):
  // si cambias la banda en un lado, esta prueba o aquella fallan.
  type Golden = { modality: string; posted: number; min: number; max: number };
  const csv: string = readFileSync(
    path.join(process.cwd(), "supabase/e2e/institution_hub/band_golden.csv"),
    "utf8",
  );
  const golden: Golden[] = csv
    .trim()
    .split("\n")
    .map((line: string): Golden => {
      const [modality, posted, min, max] = line.split(",");
      return { modality, posted: Number(posted), min: Number(min), max: Number(max) };
    });

  it("la tabla de referencia cubre las cuatro modalidades", () => {
    expect(golden.length).toBeGreaterThan(100);
    expect(new Set(golden.map((g) => g.modality))).toEqual(
      new Set(["hour", "shift", "month", "package"]),
    );
  });

  it("devuelve el mismo mínimo y máximo que offer_band_min/max en cada caso", () => {
    const diffs = golden.flatMap((g) => {
      const band = offerBand(g.posted, g.modality as never);
      return band.min === g.min && band.max === g.max ? [] : [`${g.modality},${g.posted}`];
    });
    expect(diffs).toEqual([]);
  });
});

describe("offerBand (espejo de offer_band_min/max)", () => {
  it("0,8× a 2× del valor publicado en pasos de $500", () => {
    expect(offerBand(180_000, "shift")).toEqual({ min: 144_000, max: 360_000 });
    expect(offerBand(20_000, "hour")).toEqual({ min: 16_000, max: 40_000 });
    expect(offerBand(12_345, "hour")).toEqual({ min: 10_000, max: 24_500 });
  });

  it("respeta el piso y el techo de cada modalidad", () => {
    expect(offerBand(9_000, "hour")).toEqual({ min: 8_000, max: 18_000 });
    expect(offerBand(200_000, "hour")).toEqual({ min: 160_000, max: 250_000 });
    expect(offerBand(2_000_000, "shift")).toEqual({ min: 1_600_000, max: 3_000_000 });
    expect(offerBand(10_000_000, "month")).toEqual({ min: 8_000_000, max: 20_000_000 });
    expect(offerBand(40_000_000, "package").max).toBe(50_000_000);
  });

  it("nunca devuelve un máximo menor que el mínimo", () => {
    const { min, max } = offerBand(300_000, "hour");
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it("un valor publicado inválido cae al piso de la modalidad", () => {
    for (const m of ["hour", "shift", "month", "package"] as const) {
      expect(offerBand(0, m).min).toBe(MODALITY_BOUNDS[m].floor);
      expect(offerBand(null, m).min).toBe(MODALITY_BOUNDS[m].floor);
      expect(offerBand(Number.NaN, m).min).toBe(MODALITY_BOUNDS[m].floor);
    }
  });
});

describe("validateOfferAmount / validatePublishedAmount", () => {
  it("acepta los extremos y rechaza lo que queda fuera", () => {
    expect(validateOfferAmount(180_000, "shift", 144_000)).toEqual({ ok: true });
    expect(validateOfferAmount(180_000, "shift", 360_000)).toEqual({ ok: true });
    expect(validateOfferAmount(180_000, "shift", 143_500)).toMatchObject({
      ok: false,
      reason: "below_band",
    });
    expect(validateOfferAmount(180_000, "shift", 360_500)).toMatchObject({
      ok: false,
      reason: "above_band",
    });
  });

  it("rechaza valores no enteros o no numéricos", () => {
    for (const bad of [0, -5, 150_000.5, "200000", null, undefined, Number.NaN]) {
      expect(validateOfferAmount(180_000, "shift", bad)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("valida el valor publicado contra los límites de la modalidad", () => {
    expect(validatePublishedAmount("hour", 20_000)).toEqual({ ok: true });
    expect(validatePublishedAmount("hour", 500)).toMatchObject({ ok: false, reason: "below_band" });
    expect(validatePublishedAmount("hour", 300_000)).toMatchObject({
      ok: false,
      reason: "above_band",
    });
    expect(validatePublishedAmount("shift", 180_000)).toEqual({ ok: true });
    expect(validatePublishedAmount("month", 2_500_000)).toEqual({ ok: true });
    expect(validatePublishedAmount("package", 1.5)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("explica el rango en español", () => {
    const check = validateOfferAmount(180_000, "shift", 100_000);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(amountErrorCopy(check, fmt)).toContain("entre $144.000 y $360.000");
    }
    const invalid = validateOfferAmount(180_000, "shift", "x");
    if (!invalid.ok) expect(amountErrorCopy(invalid, fmt)).toContain("válido");
  });

  it("describe el valor según la modalidad", () => {
    expect(describeAmount(180_000, "shift", fmt)).toBe("$180.000 por turno");
    expect(describeAmount(20_000, "hour", fmt)).toBe("$20.000 por hora");
  });

  it("reconoce las modalidades válidas", () => {
    expect(isOfferModality("shift")).toBe(true);
    expect(isOfferModality("day")).toBe(false);
    expect(isOfferModality(undefined)).toBe(false);
  });
});

describe("applicationActions", () => {
  const base: ApplicationState = {
    status: "pending",
    awaiting: "institution",
    round_no: 1,
    expires_at: future(48),
  };
  const paid = { canNegotiate: true, now: NOW };
  const free = { canNegotiate: false, now: NOW };

  it("la institución responde a una postulación nueva: acepta, rechaza o contraoferta", () => {
    const a = applicationActions(base, "institution", paid);
    expect(a).toMatchObject({ accept: true, decline: true, counter: true, counterKind: "counter" });
    expect(a.waitingForOther).toBe(false);
  });

  it("el profesional Free no puede cambiar su propuesta: se le explica el plan", () => {
    const a = applicationActions(base, "professional", free);
    expect(a.counter).toBe(false);
    expect(a.needsPlanToNegotiate).toBe(true);
    expect(a.accept).toBe(false);
    expect(a.decline).toBe(true);
    expect(a.waitingForOther).toBe(true);
  });

  it("el profesional con plan de pago cambia su propuesta sin gastar ronda (revise)", () => {
    const a = applicationActions(base, "professional", paid);
    expect(a).toMatchObject({ counter: true, counterKind: "revise", needsPlanToNegotiate: false });
  });

  it("cuando la institución contraoferta, el profesional Free solo puede aceptar o rechazar", () => {
    const state = { ...base, awaiting: "professional" as const, round_no: 2 };
    const a = applicationActions(state, "professional", free);
    expect(a).toMatchObject({
      accept: true,
      decline: true,
      counter: false,
      needsPlanToNegotiate: true,
    });
    const b = applicationActions(state, "professional", paid);
    expect(b).toMatchObject({ accept: true, counter: true, counterKind: "counter" });
  });

  it("la institución espera cuando le toca al profesional (y puede rechazar)", () => {
    const state = { ...base, awaiting: "professional" as const, round_no: 2 };
    const a = applicationActions(state, "institution", paid);
    expect(a).toMatchObject({
      accept: false,
      counter: false,
      decline: true,
      waitingForOther: true,
    });
  });

  it("ronda 3 = última oferta: sin más contraofertas para nadie", () => {
    const state = { ...base, round_no: 3 };
    expect(applicationActions(state, "institution", paid)).toMatchObject({
      accept: true,
      counter: false,
      isFinalRound: true,
    });
    expect(
      applicationActions({ ...state, awaiting: "professional" }, "professional", paid),
    ).toMatchObject({
      accept: true,
      counter: false,
      isFinalRound: true,
    });
    // En la ronda final el plan Free ya no importa: no hay nada que negociar.
    expect(applicationActions(state, "professional", free).needsPlanToNegotiate).toBe(false);
  });

  it("vencida o cerrada: ninguna acción", () => {
    const expired = applicationActions({ ...base, expires_at: future(-1) }, "institution", paid);
    expect(expired).toMatchObject({ accept: false, decline: false, counter: false });
    expect(expired.reason).toContain("venció");
    for (const status of ["accepted", "rejected", "withdrawn"] as const) {
      const a = applicationActions({ ...base, status }, "institution", paid);
      expect(a.accept || a.decline || a.counter).toBe(false);
      expect(a.reason).toBeTruthy();
    }
  });

  it("sin fecha de vencimiento no vence", () => {
    const a = applicationActions({ ...base, expires_at: null }, "institution", paid);
    expect(a.accept).toBe(true);
  });
});

describe("applicationExpiry (espejo del servidor)", () => {
  it("72 h para la postulación y 24 h para cada contraoferta", () => {
    expect(
      applicationExpiry({ kind: "apply", round: 1, firstShiftStart: future(500), now: NOW }),
    ).toBe(future(72));
    expect(
      applicationExpiry({ kind: "counter", round: 2, firstShiftStart: future(500), now: NOW }),
    ).toBe(future(24));
  });

  it("cambiar la propia propuesta conserva 72 h solo en la ronda inicial", () => {
    expect(
      applicationExpiry({ kind: "revise", round: 1, firstShiftStart: future(500), now: NOW }),
    ).toBe(future(72));
    expect(
      applicationExpiry({ kind: "revise", round: 2, firstShiftStart: future(500), now: NOW }),
    ).toBe(future(24));
  });

  it("nunca después de 1 h antes del turno, con un mínimo de 15 minutos", () => {
    expect(
      applicationExpiry({ kind: "apply", round: 1, firstShiftStart: future(10), now: NOW }),
    ).toBe(future(9));
    expect(
      applicationExpiry({ kind: "apply", round: 1, firstShiftStart: future(1.1), now: NOW }),
    ).toBe(new Date(NOW + 15 * 60_000).toISOString());
  });

  it("sin turnos definidos usa solo el tiempo de la ronda", () => {
    expect(applicationExpiry({ kind: "apply", round: 1, firstShiftStart: null, now: NOW })).toBe(
      future(72),
    );
  });
});

describe("textos, sugerencias y totales", () => {
  it("nombra las rondas", () => {
    expect(applicationRoundLabel(1)).toBe("Postulación inicial");
    expect(applicationRoundLabel(2)).toBe("Contraoferta 1");
    expect(applicationRoundLabel(3)).toBe("Última oferta");
  });

  it("sugiere el punto medio dentro del rango y avisa cuando es la última contraoferta", () => {
    const s = suggestApplicationCounter({
      theirOffer: 200_000,
      myLastOffer: null,
      posted: 180_000,
      modality: "shift",
      round: 1,
    });
    expect(s.suggested).toBe(190_000);
    expect(s.isLastCounter).toBe(false);
    const last = suggestApplicationCounter({
      theirOffer: 200_000,
      myLastOffer: 190_000,
      posted: 180_000,
      modality: "shift",
      round: 2,
    });
    expect(last.suggested).toBe(195_000);
    expect(last.isLastCounter).toBe(true);
    expect(last.rationale).toContain("última");
  });

  it("la sugerencia respeta el piso de la banda", () => {
    const s = suggestApplicationCounter({
      theirOffer: 8_000,
      myLastOffer: 8_000,
      posted: 8_000,
      modality: "hour",
      round: 1,
    });
    expect(s.suggested).toBe(8_000);
  });

  it("calcula el valor de cada reserva como lo hace el servidor", () => {
    expect(perShiftTotal("hour", 20_000, 6, 2)).toBe(120_000);
    expect(perShiftTotal("hour", 20_000, 5.5, 1)).toBe(110_000);
    expect(perShiftTotal("shift", 200_000, 12, 3)).toBe(200_000);
    expect(perShiftTotal("month", 3_000_000, 12, 3)).toBe(1_000_000);
    expect(perShiftTotal("package", 100_000, 8, 0)).toBe(100_000);
  });

  it("suma el total del contrato", () => {
    expect(contractTotal("shift", 200_000, [{ hours: 12 }, { hours: 12 }])).toBe(400_000);
    expect(contractTotal("hour", 20_000, [{ hours: 6 }, { hours: 8 }])).toBe(280_000);
    expect(contractTotal("month", 3_000_000, [{ hours: 8 }, { hours: 8 }, { hours: 8 }])).toBe(
      3_000_000,
    );
    expect(contractTotal("month", 3_000_000, [])).toBe(3_000_000);
    expect(contractTotal("shift", 200_000, [])).toBe(0);
  });

  it("muestra lo que queda después de la comisión (12 % Free, 0 % de pago)", () => {
    expect(professionalNet(150_000, 12)).toEqual({
      total: 150_000,
      commission: 18_000,
      net: 132_000,
    });
    expect(professionalNet(150_000, 0)).toEqual({ total: 150_000, commission: 0, net: 150_000 });
  });
});
