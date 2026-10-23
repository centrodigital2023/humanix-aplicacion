import { describe, expect, it } from "vitest";
import {
  currentVerificationDocuments,
  missingProfessionalDocuments,
  REQUIRED_PROFESSIONAL_DOCUMENTS,
} from "../../supabase/functions/_shared/professionalDocumentRequirements";

describe("documentos profesionales sin recibo de servicios", () => {
  it("no exige recibo para completar documentos", () => {
    expect(REQUIRED_PROFESSIONAL_DOCUMENTS).toEqual(["cv", "id_document"]);
    expect(missingProfessionalDocuments([
      { doc_type: "cv", status: "pending" },
      { doc_type: "id_document", status: "approved" },
      { doc_type: "diploma", status: "approved" },
    ])).toEqual([]);
  });

  it("no envía recibos históricos rechazados a la evaluación ni los elimina", () => {
    const documents = [
      { doc_type: "utility_bill", status: "rejected" },
      { doc_type: "cv", status: "approved" },
    ];
    expect(currentVerificationDocuments(documents)).toEqual([documents[1]]);
    expect(documents).toHaveLength(2);
  });

  it("mantiene cédula, hoja de vida y credencial como obligatorios", () => {
    expect(missingProfessionalDocuments([])).toEqual(["cv", "id_document", "rethus_o_diploma"]);
    expect(missingProfessionalDocuments([
      { doc_type: "cv", status: "rejected" },
      { doc_type: "id_document", status: "approved" },
      { doc_type: "rethus", status: "approved" },
    ])).toEqual(["cv"]);
  });
});