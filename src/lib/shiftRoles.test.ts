import { describe, expect, it } from "vitest";
import {
  OTHER_ROLE_MAX,
  SHIFT_ROLES,
  cleanOtherRole,
  roleByKey,
  roleLabel,
  roleSearchTerms,
  roleSpecialty,
  shiftOfferTitle,
  validateOtherRole,
} from "./shiftRoles";
import { OFFER_ISSUE_MESSAGE } from "./contentModeration";

describe("¿A quién necesitas?", () => {
  it("trae Médico, Enfermería jefe, Auxiliar, Cuidador, Terapeuta y «Otro» (libre), con claves únicas", () => {
    expect(SHIFT_ROLES.map((r) => r.label)).toEqual([
      "Médico",
      "Enfermería jefe",
      "Auxiliar",
      "Cuidador",
      "Terapeuta",
      "Otro",
    ]);
    expect(new Set(SHIFT_ROLES.map((r) => r.key)).size).toBe(SHIFT_ROLES.length);
    expect(SHIFT_ROLES.filter((r) => r.free).map((r) => r.key)).toEqual(["otro"]);
    for (const r of SHIFT_ROLES) expect(r.suggested).toBeGreaterThan(0);
    // Un médico cuesta más que un auxiliar: el valor sugerido no puede parecer un error.
    expect(roleByKey("medico").suggested).toBeGreaterThan(roleByKey("jefe").suggested);
  });

  it("una clave desconocida cae en Auxiliar (el valor de siempre)", () => {
    expect(roleByKey("nada").key).toBe("aux");
    expect(roleByKey(null).key).toBe("aux");
  });

  it("la especialidad y el nombre salen del perfil, o de lo que escribe la persona en «Otro»", () => {
    expect(roleSpecialty(roleByKey("medico"), "ignorado")).toBe("Médico");
    expect(roleLabel(roleByKey("jefe"), "ignorado")).toBe("Enfermería jefe");
    const otro = roleByKey("otro");
    expect(roleSpecialty(otro, "  Psicólogo   clínico ")).toBe("Psicólogo clínico");
    expect(roleLabel(otro, "Psicólogo clínico")).toBe("Psicólogo clínico");
    expect(roleLabel(otro, "")).toBe("Otro");
  });

  it("términos de búsqueda: sin repetir y con las variantes de tildes", () => {
    expect(roleSearchTerms(roleByKey("medico"), "")).toEqual(["Médico", "Medic", "Médic"]);
    expect(roleSearchTerms(roleByKey("jefe"), "")).toEqual(["Enfermería", "Enfermeria"]);
    expect(roleSearchTerms(roleByKey("aux"), "")).toEqual(["Auxiliar"]);
    expect(roleSearchTerms(roleByKey("otro"), " Camillero ")).toEqual(["Camillero"]);
    expect(roleSearchTerms(roleByKey("otro"), "")).toEqual([]);
  });

  it("título del turno", () => {
    expect(shiftOfferTitle("Médico", "Noche")).toBe("Médico · Noche");
    expect(shiftOfferTitle("x".repeat(200), "Día").length).toBe(120);
  });
});

describe("«Otro»: lo que escribe la persona", () => {
  it("limpia espacios", () => {
    expect(cleanOtherRole("  Trabajador   social ")).toBe("Trabajador social");
    expect(cleanOtherRole(null)).toBe("");
  });

  it("muy corto, muy largo o sin letras", () => {
    expect(validateOtherRole("", { family: false })).toMatchObject({ ok: false });
    expect(validateOtherRole("ab", { family: false })).toMatchObject({ ok: false });
    const long = validateOtherRole("a".repeat(OTHER_ROLE_MAX + 1), { family: false });
    expect(long).toEqual({ ok: false, message: `Máximo ${OTHER_ROLE_MAX} caracteres.` });
    expect(validateOtherRole("12345", { family: false })).toMatchObject({ ok: false });
  });

  it("una institución puede pedir perfiles de apoyo (no tienen que sonar a «cuidado»)", () => {
    for (const t of [
      "Camillero",
      "Conductor de ambulancia",
      "Psicólogo",
      "Trabajador social",
      "Auxiliar de farmacia",
    ]) {
      expect(validateOtherRole(t, { family: false })).toEqual({ ok: true, text: t });
    }
  });

  it("una familia debe pedir algo de salud o cuidado", () => {
    expect(validateOtherRole("Nutricionista", { family: true })).toEqual({
      ok: true,
      text: "Nutricionista",
    });
    expect(validateOtherRole("Fisioterapeuta respiratorio", { family: true }).ok).toBe(true);
    expect(validateOtherRole("Profesor de guitarra", { family: true })).toEqual({
      ok: false,
      message: OFFER_ISSUE_MESSAGE.offtopic,
    });
  });

  it("nadie puede colar groserías, ventas ni datos de contacto", () => {
    expect(validateOtherRole("Enfermero pendejo", { family: false })).toEqual({
      ok: false,
      message: OFFER_ISSUE_MESSAGE.rude,
    });
    expect(validateOtherRole("Vendo ropa usada", { family: false })).toEqual({
      ok: false,
      message: OFFER_ISSUE_MESSAGE.sale,
    });
    expect(validateOtherRole("Psicólogo 3001234567", { family: false })).toEqual({
      ok: false,
      message: OFFER_ISSUE_MESSAGE.contact,
    });
    expect(validateOtherRole("Psicólogo juan@correo.com", { family: false })).toEqual({
      ok: false,
      message: OFFER_ISSUE_MESSAGE.contact,
    });
  });
});
