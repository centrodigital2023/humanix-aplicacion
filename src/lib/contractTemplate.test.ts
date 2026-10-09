import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONDITIONS,
  TEMPLATE_V1,
  acceptanceItems,
  canSignNow,
  contractBodyHash,
  contractStatusLabel,
  isSignableStatus,
  isSupportedTemplate,
  missingAcceptances,
  parseContractTerms,
  renderContract,
  sha256Hex,
  signatureCountdown,
  type ContractTerms,
} from "./contractTemplate";

const NOW = Date.parse("2026-10-09T15:00:00Z");

function terms(over: Partial<ContractTerms> = {}): ContractTerms {
  return {
    template: TEMPLATE_V1,
    version: 2,
    contract_no: "HX-2026-000123",
    parties: {
      institution: {
        user_id: "i1",
        name: "Clínica Santa Fe",
        type: "Clínica",
        nit: "900123456-7",
        legal_representative: "Ana María Duarte",
        city: "Bogotá",
        verified: true,
      },
      professional: {
        user_id: "p1",
        name: "Laura Gómez Pérez",
        specialty: "Auxiliar de enfermería",
        rethus_number: "12345-RTH",
        rethus_verified: true,
      },
    },
    object: {
      title: "Auxiliar de enfermería UCI adultos – noches",
      description: "Noches en UCI adultos.",
      specialty: "Auxiliar de enfermería",
      service_area: "UCI adultos",
      city: "Bogotá",
      address: "Cra 7 # 1-1",
      modality: "shift",
      requirements: ["RETHUS vigente", "Experiencia UCI 1 año"],
    },
    shifts: [
      {
        no: 1,
        starts_at: "2026-10-10T23:00:00Z",
        ends_at: "2026-10-11T11:00:00Z",
        hours: 12,
        amount: 200_000,
      },
      {
        no: 2,
        starts_at: "2026-10-11T23:00:00Z",
        ends_at: "2026-10-12T11:00:00Z",
        hours: 12,
        amount: 200_000,
      },
    ],
    economics: {
      agreed_amount: 200_000,
      posted_amount: 180_000,
      modality: "shift",
      currency: "COP",
      total_amount: 400_000,
      commission_pct: 0,
      professional_net: 400_000,
      payment_channel: "platform_web_only",
    },
    conditions: { ...DEFAULT_CONDITIONS, tolerance_minutes: 10, extra: "Traer carné y documento." },
    legal: {
      signature_deadline: "2026-10-10T12:00:00Z",
      governing_law: "CO",
      esign_agreement: true,
      data_protection: "ley_1581_2012",
      dispute: "conciliacion_pqrs",
    },
    required_clauses: ["contract", "credentials", "confidentiality", "esign"],
    generated_at: "2026-10-09T14:00:00Z",
    ...over,
  };
}

describe("renderContract", () => {
  const c = renderContract(terms());

  it("incluye partes, turnos, valor y condiciones acordadas", () => {
    expect(c.text).toContain("CONTRATO DE PRESTACIÓN DE SERVICIOS DE SALUD POR TURNOS");
    expect(c.text).toContain("N.° HX-2026-000123 · versión 2");
    expect(c.text).toContain(
      "Clínica Santa Fe, identificada con NIT 900123456-7, representada por Ana María Duarte",
    );
    expect(c.text).toContain(
      "Laura Gómez Pérez, Auxiliar de enfermería, con registro RETHUS 12345-RTH",
    );
    expect(c.text).toContain("Turno 1:");
    expect(c.text).toContain("Turno 2:");
    expect(c.text).toContain("Lugar de ejecución: UCI adultos, Cra 7 # 1-1, Bogotá.");
    expect(c.text).toContain("hasta 10 minutos");
    expect(c.text).toContain("Condiciones adicionales acordadas: Traer carné y documento.");
    expect(c.text).toMatch(/Valor total del contrato: \$\s?400\.000/);
    expect(c.text).toContain("la oferta publicada era de");
  });

  it("deja claro que los pagos son solo en la página web", () => {
    expect(c.text).toContain("únicamente desde la página web de Humanix");
    expect(c.text).toContain("Ninguna de las partes solicitará ni realizará pagos por WhatsApp");
  });

  it("explica la comisión según el plan", () => {
    expect(c.text).toContain("no aplica comisión");
    const free = renderContract(
      terms({
        economics: { ...terms().economics, commission_pct: 12, professional_net: 352_000 },
      }),
    );
    expect(free.text).toContain("comisión del 12 %");
    expect(free.text).toMatch(/valor neto estimado es \$\s?352\.000/);
  });

  it("numera las diez cláusulas y cita el marco legal", () => {
    expect(c.clauses.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(c.text).toContain("Ley 527 de 1999");
    expect(c.text).toContain("Decreto 2364 de 2012");
    expect(c.text).toContain("Ley 1581 de 2012");
    expect(c.text).toContain("Resolución 3100 de 2019");
    expect(c.footer).toContain("asesor jurídico");
  });

  it("describe la cancelación según lo acordado", () => {
    expect(c.text).toContain("menos de 12 horas");
    expect(c.text).toContain("reconoce a EL PROFESIONAL el 50 % del valor del turno");
    const none = renderContract(
      terms({ conditions: { ...DEFAULT_CONDITIONS, cancellation_notice_hours: 0 } }),
    );
    expect(none.text).toContain("No se pacta aviso mínimo");
    const zero = renderContract(
      terms({ conditions: { ...DEFAULT_CONDITIONS, institution_late_cancel_pct: 0 } }),
    );
    expect(zero.text).toContain("no hay compensación económica");
  });

  it("adapta bioseguridad y registro de llegada", () => {
    const t = renderContract(
      terms({
        conditions: { ...DEFAULT_CONDITIONS, biosafety_provided: false, checkin_required: false },
      }),
    );
    expect(t.text).toContain(
      "EL PROFESIONAL aportará sus propios elementos de protección personal",
    );
    expect(t.text).toContain("No se exige registro de llegada");
  });

  it("es determinista: mismos términos → mismo texto", () => {
    expect(renderContract(terms()).text).toBe(renderContract(terms()).text);
    expect(renderContract(terms()).text).not.toContain("\r");
  });

  it("cualquier cambio en los términos cambia el texto", () => {
    const base = renderContract(terms()).text;
    expect(renderContract(terms({ version: 3 })).text).not.toBe(base);
    expect(
      renderContract(terms({ conditions: { ...DEFAULT_CONDITIONS, tolerance_minutes: 11 } })).text,
    ).not.toBe(base);
  });

  it("rechaza plantillas desconocidas", () => {
    expect(() => renderContract(terms({ template: "humanix-shift-v99" }))).toThrow(/desconocida/);
    expect(isSupportedTemplate(TEMPLATE_V1)).toBe(true);
    expect(isSupportedTemplate("otra")).toBe(false);
  });

  it("sin dirección ni NIT usa un texto neutro", () => {
    const t = terms();
    const bare = renderContract(
      terms({
        object: { ...t.object, address: null, service_area: null, city: null },
        parties: {
          ...t.parties,
          institution: { ...t.parties.institution, nit: null, legal_representative: null },
        },
      }),
    );
    expect(bare.text).toContain("el indicado por LA INSTITUCIÓN");
    expect(bare.text).not.toContain("identificada con NIT");
    expect(bare.text).not.toContain("representada por");
  });
});

describe("huellas", () => {
  it("sha256 de un valor conocido", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("la huella del texto cambia con cualquier cambio y es estable", async () => {
    const a = await contractBodyHash(terms());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await contractBodyHash(terms())).toBe(a);
    expect(await contractBodyHash(terms({ version: 3 }))).not.toBe(a);
  });
});

describe("parseContractTerms", () => {
  it("acepta términos completos y conserva los valores", () => {
    const parsed = parseContractTerms(JSON.parse(JSON.stringify(terms())));
    expect(parsed).not.toBeNull();
    expect(parsed?.parties.professional.rethus_number).toBe("12345-RTH");
    expect(parsed?.shifts).toHaveLength(2);
    expect(renderContract(parsed!).text).toBe(renderContract(terms()).text);
  });

  it("rechaza lo que no tiene la forma mínima", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { template: TEMPLATE_V1 }]) {
      expect(parseContractTerms(bad)).toBeNull();
    }
    const t = JSON.parse(JSON.stringify(terms()));
    t.economics.modality = "day";
    expect(parseContractTerms(t)).toBeNull();
    const u = JSON.parse(JSON.stringify(terms()));
    u.shifts = [{ no: 1, starts_at: "x" }];
    expect(parseContractTerms(u)).toBeNull();
  });

  it("rellena condiciones ausentes con los valores por defecto", () => {
    const t = JSON.parse(JSON.stringify(terms()));
    delete t.conditions;
    const parsed = parseContractTerms(t);
    expect(parsed?.conditions).toEqual(DEFAULT_CONDITIONS);
  });
});

describe("aceptaciones explícitas", () => {
  it("son las cuatro declaraciones que exige el servidor, con texto propio de cada parte", () => {
    const pro = acceptanceItems("professional");
    const inst = acceptanceItems("institution");
    expect(pro.map((a) => a.id)).toEqual(["contract", "credentials", "confidentiality", "esign"]);
    expect(inst.map((a) => a.id)).toEqual(pro.map((a) => a.id));
    expect(pro[1].label).toContain("RETHUS");
    expect(inst[1].label).toContain("NIT");
    expect(pro[3].label).toContain("Decreto 2364");
  });

  it("detecta las declaraciones que faltan", () => {
    const required = ["contract", "credentials", "confidentiality", "esign"];
    expect(missingAcceptances(required, ["contract", "esign"])).toEqual([
      "credentials",
      "confidentiality",
    ]);
    expect(missingAcceptances(required, required)).toEqual([]);
    expect(missingAcceptances([], [])).toEqual([]);
  });
});

describe("estado y plazo de firma", () => {
  it("etiqueta los estados", () => {
    expect(contractStatusLabel("active")).toBe("Vigente");
    expect(contractStatusLabel("partially_signed")).toBe("Falta una firma");
    expect(contractStatusLabel("raro")).toBe("raro");
    expect(isSignableStatus("pending_signature")).toBe(true);
    expect(isSignableStatus("active")).toBe(false);
  });

  it("decide si se puede firmar ahora", () => {
    const base = {
      status: "pending_signature",
      deadline: "2026-10-10T12:00:00Z",
      iSigned: false,
      now: NOW,
    };
    expect(canSignNow(base)).toEqual({ ok: true, reason: null });
    expect(canSignNow({ ...base, iSigned: true }).reason).toContain("Ya firmaste");
    expect(canSignNow({ ...base, status: "declined" }).reason).toContain("Rechazado");
    expect(canSignNow({ ...base, deadline: "2026-10-09T14:00:00Z" }).reason).toContain("venció");
    expect(canSignNow({ ...base, deadline: null }).ok).toBe(true);
  });

  it("cuenta regresiva legible", () => {
    expect(signatureCountdown("2026-10-09T15:20:00Z", NOW)).toBe("Quedan 20 min para firmar");
    expect(signatureCountdown("2026-10-09T20:00:00Z", NOW)).toBe("Quedan 5 h para firmar");
    expect(signatureCountdown("2026-10-13T15:00:00Z", NOW)).toBe("Quedan 4 días para firmar");
    expect(signatureCountdown("2026-10-09T14:00:00Z", NOW)).toBe("El plazo para firmar venció");
    expect(signatureCountdown(null, NOW)).toBeNull();
  });
});
