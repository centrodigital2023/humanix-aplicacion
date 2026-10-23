import { describe, expect, it } from "vitest";
import { prepareProfileImport } from "./profileImport";

describe("importación de perfil", () => {
  it("admite texto pegado sin inventar documentos", async () => {
    expect(await prepareProfileImport("  Soy auxiliar de enfermería  ")).toEqual({ text: "Soy auxiliar de enfermería", file: undefined });
  });
  it("rechaza archivos vacíos y formatos no interpretables", async () => {
    await expect(prepareProfileImport("", new File([], "cv.pdf"))).rejects.toThrow("vacío");
    await expect(prepareProfileImport("", new File(["x"], "cv.doc"))).rejects.toThrow(".docx");
  });
  it("no corta silenciosamente información extensa", async () => {
    await expect(prepareProfileImport("x".repeat(60_001))).rejects.toThrow("60.000");
  });
});