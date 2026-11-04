import { describe, expect, it } from "vitest";
import { sha256Hex } from "./contractTemplate";
import {
  SERVICE_CONTRACT_VERSION,
  acceptanceStillValid,
  bogotaDateTime,
  partyState,
  pesos,
  renderServiceContract,
  type ContractAcceptance,
} from "./serviceContract";

const booking = {
  id: "abcdef12-0000-0000-0000-000000000000",
  scheduled_at: "2026-11-05T19:30:00Z",
  duration_hours: 4,
  total_amount: 120000,
  payment_method: "DIGITAL_BREB",
  platform_fee_pct: 15,
  service_address: "Calle 18 # 25-30, Pasto",
};

function acc(over: Partial<ContractAcceptance> = {}): ContractAcceptance {
  return {
    party: "client",
    user_id: "u1",
    terms_version: SERVICE_CONTRACT_VERSION,
    text_sha256: "a".repeat(64),
    accepted_at: "2026-11-04T18:00:00Z",
    key_terms: {
      scheduled_at: "2026-11-05T19:30:00+00:00",
      duration_hours: 4,
      total_amount: 120000,
      payment_method: "DIGITAL_BREB",
    },
    ...over,
  };
}

describe("formatos", () => {
  it("pesos con punto de miles", () => {
    expect(pesos(120000)).toBe("$120.000");
    expect(pesos(1234567)).toBe("$1.234.567");
    expect(pesos(0)).toBe("$0");
  });
  it("fecha en hora de Colombia, sin depender del navegador", () => {
    expect(bogotaDateTime("2026-11-05T19:30:00Z")).toBe("5 de noviembre de 2026, 2:30 p. m.");
    expect(bogotaDateTime("2026-11-05T05:00:00Z")).toBe("5 de noviembre de 2026, 12:00 a. m.");
    expect(bogotaDateTime("nada")).toBe("fecha por confirmar");
  });
});

describe("renderServiceContract", () => {
  it("es determinista: mismo texto y misma huella", async () => {
    const a = renderServiceContract(booking);
    const b = renderServiceContract({ ...booking });
    expect(a.text).toBe(b.text);
    expect(await sha256Hex(a.text)).toBe(await sha256Hex(b.text));
  });

  it("refleja el pago retenido de Bre-B, la comisión y la devolución del 100 %", () => {
    const c = renderServiceContract(booking);
    expect(c.text).toContain("$120.000");
    expect(c.text).toContain("24 horas");
    expect(c.text).toContain("15\u00a0%");
    expect(c.text).toContain("100\u00a0%");
    expect(c.text).toContain("Calle 18 # 25-30, Pasto");
    expect(c.text).not.toContain("en efectivo, en mano");
  });

  it("en efectivo explica el pago en mano y la billetera", () => {
    const c = renderServiceContract({ ...booking, payment_method: "CASH" });
    expect(c.text).toContain("efectivo");
    expect(c.text).toContain("billetera Humanix");
    expect(c.text).not.toContain("devuelve el 100\u00a0%");
  });

  it("cita el marco legal colombiano", () => {
    const t = renderServiceContract(booking).text;
    for (const law of [
      "Ley 1480 de 2011",
      "Ley 1581 de 2012",
      "Ley 527 de 1999",
      "Código Sustantivo del Trabajo",
      "Código Civil",
      "123",
    ])
      expect(t).toContain(law);
  });

  it("el cambio de valor cambia el texto", () => {
    expect(renderServiceContract(booking).text).not.toBe(
      renderServiceContract({ ...booking, total_amount: 130000 }).text,
    );
  });
});

describe("aceptaciones", () => {
  it("vale mientras no cambien fecha, duración, valor ni forma de pago", () => {
    expect(acceptanceStillValid(acc(), booking)).toBe(true);
    expect(acceptanceStillValid(acc(), { ...booking, total_amount: 1 })).toBe(false);
    expect(acceptanceStillValid(acc(), { ...booking, scheduled_at: "2026-11-06T19:30:00Z" })).toBe(
      false,
    );
    expect(acceptanceStillValid(acc(), { ...booking, payment_method: "CASH" })).toBe(false);
    expect(acceptanceStillValid(acc({ terms_version: "viejo" }), booking)).toBe(false);
  });

  it("estado por parte", () => {
    expect(partyState([], "client", booking).state).toBe("pending");
    expect(partyState([acc()], "client", booking).state).toBe("accepted");
    expect(partyState([acc()], "professional", booking).state).toBe("pending");
    expect(partyState([acc()], "client", { ...booking, total_amount: 99999 }).state).toBe(
      "outdated",
    );
  });
});
