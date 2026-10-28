import { describe, expect, it } from "vitest";
import {
  institutionDocLabel,
  institutionDocPath,
  missingApprovedDocs,
} from "./institutionDocuments";

describe("institutionDocuments", () => {
  it("pide los tres obligatorios aprobados", () => {
    expect(missingApprovedDocs([])).toEqual(["camara_comercio", "rut", "cedula_representante"]);
    expect(
      missingApprovedDocs([
        { doc_type: "camara_comercio", status: "approved" },
        { doc_type: "rut", status: "pending" },
        { doc_type: "cedula_representante", status: "approved" },
      ]),
    ).toEqual(["rut"]);
  });

  it("lee la ruta del bucket y descarta las URL blob", () => {
    expect(institutionDocPath("u1/rut-1.pdf")).toBe("u1/rut-1.pdf");
    expect(
      institutionDocPath(
        "https://x.supabase.co/storage/v1/object/public/institution-docs/u1/a%20b.pdf",
      ),
    ).toBe("u1/a b.pdf");
    expect(institutionDocPath("blob:https://humanix.lat/abc")).toBeNull();
  });

  it("nombra los tipos viejos", () => {
    expect(institutionDocLabel("nit_certificate")).toBe("Certificado NIT");
    expect(institutionDocLabel("rut")).toBe("RUT");
  });
});
