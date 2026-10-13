import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CARE_STEMS,
  CARE_TERMS,
  OFFER_ISSUE_MESSAGE,
  RUDE_STEMS,
  RUDE_TERMS,
  SALE_CONTEXT,
  SALE_TERMS,
  checkOfferText,
  normalizeForModeration,
  offerIssueFromError,
  offerTextIssue,
} from "./contentModeration";

const SQL = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261012180000_offer_moderation.sql"),
  "utf-8",
);

/** Las listas de la migración: «nombre constant text := '…';». */
function sqlList(name: string): string {
  const m = new RegExp(`${name} constant text := '([^']*)';`).exec(SQL);
  if (!m) throw new Error(`No se encontró ${name} en la migración`);
  return m[1];
}

describe("espejo de las listas de la base (public.hx_offer_text_issue)", () => {
  it.each([
    ["rude_terms", RUDE_TERMS.join("|")],
    ["rude_stems", RUDE_STEMS.join("|")],
    ["sale_terms", SALE_TERMS.join("|")],
    ["sale_context", SALE_CONTEXT],
    ["care_stems", CARE_STEMS.join("|")],
    ["care_terms", CARE_TERMS.join("|")],
  ])("%s coincide con la migración", (name: string, ts: string) => {
    expect(ts).toBe(sqlList(name));
  });
  it("los mensajes de rechazo son los mismos que dice la base", () => {
    expect(SQL).toContain(OFFER_ISSUE_MESSAGE.rude);
    expect(SQL).toContain(OFFER_ISSUE_MESSAGE.sale);
    expect(SQL).toContain(OFFER_ISSUE_MESSAGE.offtopic);
    expect(SQL).toContain(OFFER_ISSUE_MESSAGE.contact);
  });
  it("las listas están normalizadas (minúsculas, sin tildes) y sin duplicados", () => {
    for (const list of [RUDE_TERMS, RUDE_STEMS, SALE_TERMS, CARE_STEMS, CARE_TERMS]) {
      for (const w of list) expect(normalizeForModeration(w)).toBe(w);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("normalización", () => {
  it("tildes, ñ, mayúsculas y signos", () => {
    expect(normalizeForModeration("  ¡¡ÁÉÍÓÚ Ñandú!! ")).toBe("aeiou nandu");
    expect(normalizeForModeration("Acompañamiento 24/7")).toBe("acompanamiento 24 7");
    expect(normalizeForModeration(null)).toBe("");
  });
  it("letras repetidas tres o más veces se reducen a una; dos se respetan", () => {
    expect(normalizeForModeration("puuuuta")).toBe("puta");
    expect(normalizeForModeration("mierdaaaa")).toBe("mierda");
    expect(normalizeForModeration("calle casa llamada")).toBe("calle casa llamada");
  });
});

describe("lenguaje ofensivo", () => {
  it.each([
    "Eres una puta basura",
    "HIJUEPUTA el que lea esto",
    "hijueputaaaa",
    "malparido",
    "Esto es una mierda",
    "qué gonorrea de servicio",
    "Servicios eróticos a domicilio",
    "escort disponible",
    "Fotos desnuda",
  ])("%s → rude", (txt: string) => expect(offerTextIssue(txt)).toBe("rude"));
  it.each([
    "Necesito una computadora para mi mamá", // «computadora» contiene «puta» pero no es palabra completa
    "Acompañamiento en la disputa de la herencia",
    "Paciente de sexo masculino, 80 años",
    "Prefiero cuidadora de sexo femenino",
    "Aplicar una sonda para la próstata",
    "Cuidado de mi madre con demencia",
  ])("%s → sin problema", (txt: string) => expect(offerTextIssue(txt)).toBeNull());
});

describe("artículos y ventas", () => {
  it.each([
    "Vendo silla de ruedas casi nueva",
    "SE VENDE cama hospitalaria",
    "Se arrienda apartamento cerca a la clínica",
    "Alquiler de equipos médicos",
    "Compramos pañales usados",
    "Ofrezco productos de belleza a domicilio",
    "Distribuimos artículos de aseo al por mayor",
    "Gana dinero fácil desde casa",
    "Multinivel de suplementos",
    "Rifa de una nevera",
  ])("%s → sale", (txt: string) => expect(offerTextIssue(txt)).toBe("sale"));
  it.each([
    "El cuidador debe traer sus artículos de aseo personal",
    "Necesito que compre las medicinas en la farmacia", // «compre», no «compro»
    "Promoción de la salud en casa",
    "Aseo del paciente y cambio de pañal",
    "Pago por hora sin descuentos",
  ])("%s → sin problema", (txt: string) => expect(offerTextIssue(txt)).toBeNull());
});

describe("solo salud y cuidado (cuando se exige)", () => {
  it.each([
    "Enfermera para cuidado nocturno",
    "Acompañamiento de adulto mayor",
    "Auxiliar de enfermería con experiencia en UCI",
    "Terapia respiratoria y oxígeno domiciliario",
    "Curaciones y toma de signos vitales",
    "Postoperatorio de cadera",
    "Cuidadora para mi mamá con Alzheimer",
    "Persona mayor que necesita ayuda con la silla de ruedas",
    "Recién nacido, ayuda con la lactancia",
    "Fisioterapeuta a domicilio",
    "Turno en la EPS",
  ])("%s → pasa", (txt: string) => expect(offerTextIssue(txt, { requireCare: true })).toBeNull());
  it.each([
    "Se necesita plomero para arreglar un baño",
    "Busco diseñador gráfico",
    "Clases de guitarra los sábados",
    "Mecánico para mi carro",
    "Mesero para fin de semana",
  ])("%s → offtopic", (txt: string) =>
    expect(offerTextIssue(txt, { requireCare: true })).toBe("offtopic"),
  );
  it("sin exigirlo, un texto genérico pasa", () => {
    expect(offerTextIssue("Turno de 8 horas en Chapinero")).toBeNull();
    expect(offerTextIssue("Turno de 8 horas en Chapinero", { requireCare: true })).toBe("offtopic");
  });
  it("texto vacío no es ajeno a nada", () => {
    expect(offerTextIssue("", { requireCare: true })).toBeNull();
    expect(offerTextIssue("   ", { requireCare: true })).toBeNull();
    expect(offerTextIssue(null, { requireCare: true })).toBeNull();
  });
  it("lo ofensivo y lo de venta se rechaza antes que lo ajeno", () => {
    expect(offerTextIssue("Vendo cosas de mierda", { requireCare: true })).toBe("rude");
    expect(offerTextIssue("Vendo una silla", { requireCare: true })).toBe("sale");
  });
});

describe("revisión del conjunto de campos (como el disparador)", () => {
  it("la regla de salud mira todos los textos juntos", () => {
    expect(checkOfferText(["Adulto mayor", "turno de noche"], { requireCare: true })).toEqual({
      ok: true,
    });
    expect(checkOfferText(["Turno de noche", null], { requireCare: true })).toMatchObject({
      ok: false,
      issue: "offtopic",
    });
    expect(checkOfferText(["Turno de noche", "cuidado de mi papá"], { requireCare: true })).toEqual(
      { ok: true },
    );
  });
  it("contacto y datos de pago", () => {
    expect(
      checkOfferText(["Cuidado de adulto mayor", "llámame al 300 123 4567"], {
        requireCare: true,
        checkContact: true,
      }),
    ).toMatchObject({ ok: false, issue: "contact" });
    expect(checkOfferText(["Escríbeme a ana@correo.com"], { checkContact: true })).toMatchObject({
      ok: false,
      issue: "contact",
    });
    expect(checkOfferText(["Paga por Nequi 3001234567"], { checkContact: true })).toMatchObject({
      ok: false,
      issue: "contact",
    });
    // Sin pedir revisión de contacto (ofertas de instituciones) no se mira.
    expect(checkOfferText(["Llamar al 300 123 4567"], {})).toEqual({ ok: true });
  });
  it("el mensaje es el mismo que la base", () => {
    const r = checkOfferText(["Vendo zapatos"], {});
    expect(r).toEqual({ ok: false, issue: "sale", message: OFFER_ISSUE_MESSAGE.sale });
  });
});

describe("el motivo que viene en el error de la base", () => {
  it("por la pista", () => {
    expect(offerIssueFromError({ hint: "offer_rude" })).toBe("rude");
    expect(offerIssueFromError({ hint: "OFFER_SALE" })).toBe("sale");
    expect(offerIssueFromError({ hint: "offer_offtopic" })).toBe("offtopic");
    expect(offerIssueFromError({ hint: "offer_contact" })).toBe("contact");
  });
  it("por el mensaje, si la pista no llega", () => {
    expect(offerIssueFromError({ message: OFFER_ISSUE_MESSAGE.offtopic })).toBe("offtopic");
  });
  it("lo demás es null", () => {
    expect(offerIssueFromError({ hint: "sos_recent" })).toBeNull();
    expect(offerIssueFromError(null)).toBeNull();
    expect(offerIssueFromError({ message: "boom" })).toBeNull();
  });
});
