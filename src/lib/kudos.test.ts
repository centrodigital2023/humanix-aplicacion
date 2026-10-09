import { describe, it, expect } from "vitest";
import {
  KUDOS_KINDS,
  KUDOS_MESSAGE_MAX,
  buildKudosCall,
  isKudosKind,
  kudosChips,
  kudosFormSchema,
  kudosKindsFor,
  kudosLabel,
  kudosRecipient,
  kudosRoleFor,
  kudosRowsFromMap,
  kudosShareText,
  publicProfileUrl,
} from "./kudos";

describe("listas de reconocimientos (espejo de public.kudos_allowed_kinds)", () => {
  it("familia / institución", () => {
    expect(KUDOS_KINDS.client.map((k) => k.id)).toEqual([
      "punctual",
      "caring",
      "patient",
      "peace_of_mind",
      "communicative",
      "professional",
    ]);
  });
  it("profesional", () => {
    expect(KUDOS_KINDS.professional.map((k) => k.id)).toEqual([
      "respectful",
      "clear_instructions",
      "welcoming",
      "well_prepared",
    ]);
  });
  it("ningún id se repite entre roles y todos tienen etiqueta, emoji y frase", () => {
    const ids = [...KUDOS_KINDS.client, ...KUDOS_KINDS.professional].map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const k of [...KUDOS_KINDS.client, ...KUDOS_KINDS.professional]) {
      expect(k.label.length).toBeGreaterThan(2);
      expect(k.emoji.length).toBeGreaterThan(0);
      expect(k.blurb.length).toBeGreaterThan(10);
    }
  });
  it("isKudosKind y kudosLabel", () => {
    expect(isKudosKind("client", "caring")).toBe(true);
    expect(isKudosKind("client", "respectful")).toBe(false);
    expect(isKudosKind("professional", "respectful")).toBe(true);
    expect(kudosLabel("caring")).toBe("Trato cariñoso");
    expect(kudosLabel("desconocido")).toBe("desconocido");
    expect(kudosKindsFor("professional")).toHaveLength(4);
  });
});

describe("quién da las gracias", () => {
  const b = { client_id: "c1", professional_id: "p1" };
  it("rol y destinatario", () => {
    expect(kudosRoleFor(b, "c1")).toBe("client");
    expect(kudosRoleFor(b, "p1")).toBe("professional");
    expect(kudosRoleFor(b, "otro")).toBeNull();
    expect(kudosRoleFor(b, null)).toBeNull();
    expect(kudosRecipient(b, "client")).toBe("p1");
    expect(kudosRecipient(b, "professional")).toBe("c1");
  });
});

describe("formulario de gracias", () => {
  const schema = kudosFormSchema("client");
  it("acepta de uno a tres reconocimientos de la lista", () => {
    expect(schema.safeParse({ kinds: ["caring"] }).success).toBe(true);
    expect(
      schema.safeParse({ kinds: ["caring", "punctual", "patient"], message: "Mil gracias" })
        .success,
    ).toBe(true);
  });
  it("rechaza cero, más de tres, repetidos y ajenos", () => {
    expect(schema.safeParse({ kinds: [] }).success).toBe(false);
    expect(
      schema.safeParse({ kinds: ["caring", "punctual", "patient", "peace_of_mind"] }).success,
    ).toBe(false);
    expect(schema.safeParse({ kinds: ["caring", "caring"] }).success).toBe(false);
    expect(schema.safeParse({ kinds: ["respectful"] }).success).toBe(false);
    expect(schema.safeParse({ kinds: ["inventado"] }).success).toBe(false);
  });
  it("el mensaje: sin contacto ni pagos y con máximo", () => {
    expect(schema.safeParse({ kinds: ["caring"], message: "Llámame al 3004445566" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ kinds: ["caring"], message: "Te pago por nequi 3004445566" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ kinds: ["caring"], message: "a".repeat(KUDOS_MESSAGE_MAX) }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ kinds: ["caring"], message: "a".repeat(KUDOS_MESSAGE_MAX + 1) }).success,
    ).toBe(false);
  });
  it("el formulario del profesional usa su propia lista", () => {
    const pro = kudosFormSchema("professional");
    expect(pro.safeParse({ kinds: ["respectful", "welcoming"] }).success).toBe(true);
    expect(pro.safeParse({ kinds: ["caring"] }).success).toBe(false);
  });
  it("arma la llamada al RPC (mensaje vacío → null)", () => {
    expect(buildKudosCall("b1", { kinds: ["caring"], message: "  " })).toEqual({
      p_booking_id: "b1",
      p_kinds: ["caring"],
      p_message: null,
    });
    expect(buildKudosCall("b1", { kinds: ["caring", "punctual"], message: " Gracias " })).toEqual({
      p_booking_id: "b1",
      p_kinds: ["caring", "punctual"],
      p_message: "Gracias",
    });
  });
});

describe("reconocimientos públicos", () => {
  it("ordena por personas distintas y solo muestra los de familias", () => {
    const chips = kudosChips([
      { kind: "punctual", givers: 2 },
      { kind: "caring", givers: 9 },
      { kind: "respectful", givers: 50 }, // lo da el profesional: no se muestra en su propio perfil
      { kind: "patient", givers: 0 },
    ]);
    expect(chips.map((c) => `${c.id}:${c.count}`)).toEqual(["caring:9", "punctual:2"]);
    expect(chips[0].label).toBe("Trato cariñoso");
  });
  it("respeta el límite y tolera nulos", () => {
    expect(kudosChips(null)).toEqual([]);
    const many = KUDOS_KINDS.client.map((k, i) => ({ kind: k.id, givers: i + 1 }));
    expect(kudosChips(many, 3)).toHaveLength(3);
  });
  it("convierte el mapa de estadísticas en filas", () => {
    expect(kudosRowsFromMap({ caring: 3, punctual: 1 })).toEqual([
      { kind: "caring", givers: 3 },
      { kind: "punctual", givers: 1 },
    ]);
    expect(kudosRowsFromMap(undefined)).toEqual([]);
  });
});

describe("compartir", () => {
  it("texto con reconocimientos y enlace", () => {
    const t = kudosShareText({
      kinds: ["caring", "punctual", "patient", "professional"],
      url: "https://humanix.lat/profesional/p1",
    });
    expect(t).toContain("«Trato cariñoso», «Puntualidad», «Paciencia»");
    expect(t).not.toContain("Muy profesional");
    expect(t).toContain("https://humanix.lat/profesional/p1");
  });
  it("sin reconocimientos", () => {
    expect(kudosShareText({ kinds: [], url: "https://x.co/p" })).toBe(
      "Las familias me dieron las gracias en Humanix 💛 Mira mi perfil verificado: https://x.co/p",
    );
  });
  it("enlace al perfil público", () => {
    expect(publicProfileUrl("abc", "https://humanix.lat/")).toBe(
      "https://humanix.lat/profesional/abc",
    );
    expect(publicProfileUrl("abc", "http://localhost:3000")).toBe(
      "http://localhost:3000/profesional/abc",
    );
  });
});
