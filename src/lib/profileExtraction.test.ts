import { describe, expect, it } from "vitest";
import { fileKind, newReferences, normalizeDocumentEvidence, normalizeExtraction, normalizePhone } from "./profileExtraction";

describe("normalizeExtraction", () => {
  it("separa referencias laborales y familiares con celular válido", () => {
    const r = normalizeExtraction({
      references: [
        { ref_type: "work", full_name: "Carlos Ruiz", phone: "300 123 4567", relation: "Jefe" },
        { ref_type: "personal", full_name: "Ana Pérez", phone: "+57 311-222-3333" },
        { ref_type: "work", full_name: "Sin Tel", phone: "123" },
        { ref_type: "work", full_name: "Duplicado", phone: "3001234567" },
      ],
    });
    expect(r.references).toEqual([
      { ref_type: "work", full_name: "Carlos Ruiz", phone: "+57 3001234567", relation: "Jefe" },
      { ref_type: "family", full_name: "Ana Pérez", phone: "+57 3112223333", relation: null },
    ]);
  });
  it("no inventa años ni tarifas fuera de rango", () => {
    const r = normalizeExtraction({ years_experience: 99, hourly_rate: 10, specialty: "Enfermería" });
    expect(r.years_experience).toBeUndefined();
    expect(r.hourly_rate).toBeUndefined();
    expect(r.specialty).toBe("Enfermería");
  });
  it("experiencia sin cargo ni empleador se descarta", () => {
    const r = normalizeExtraction({ work_experience: [{}, { role: "Auxiliar", employer: "Clínica" }] });
    expect(r.work_experience).toEqual([{ role: "Auxiliar", employer: "Clínica" }]);
  });
});

describe("utilidades", () => {
  it("solo registra páginas PDF reales dentro de límites y nunca recibos", () => {
    expect(normalizeDocumentEvidence([
      { doc_type: "diploma", page_start: 2, page_end: 2, evidence: "Título original visible" },
      { doc_type: "id_document", page_start: 0, page_end: 3, evidence: "Cédula" },
      { doc_type: "rethus", page_start: 1, page_end: 7, evidence: "Registro" },
      { doc_type: "utility_bill", page_start: 1, page_end: 1, evidence: "Recibo" },
    ], 3)).toEqual([{ doc_type: "diploma", page_start: 2, page_end: 2, evidence: "Título original visible" }]);
  });
  it("texto y simples menciones no cumplen soportes", () => {
    expect(normalizeExtraction({ specialty: "Enfermería", rethus_number: "123", certifications: ["Diploma"] }).document_evidence).toEqual([]);
    expect(normalizeDocumentEvidence([{ doc_type: "diploma", evidence: "Mencionado en CV" }], 3)).toEqual([]);
  });
  it("normalizePhone", () => {
    expect(normalizePhone("573001234567")).toBe("+57 3001234567");
    expect(normalizePhone("abc")).toBeNull();
  });
  it("newReferences no repite celulares guardados", () => {
    const ex = normalizeExtraction({
      references: [{ full_name: "Carlos Ruiz", phone: "3001234567" }],
    }).references;
    expect(newReferences(ex, [{ phone: "+57 300 123 4567" }])).toEqual([]);
  });
  it("fileKind", () => {
    expect(fileKind("cv.pdf", "")).toBe("pdf");
    expect(fileKind("cv.docx", "")).toBe("docx");
    expect(fileKind("foto.jpg", "image/jpeg")).toBe("image");
    expect(fileKind("notas.txt", "text/plain")).toBe("text");
    expect(fileKind("cv.doc", "application/msword")).toBeNull();
  });
});
