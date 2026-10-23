// Browser-safe rules shared by the professional panel and its document validator.
export const REQUIRED_PROFESSIONAL_DOCUMENTS = ["cv", "id_document"] as const;

export function missingProfessionalDocuments(
  documents: readonly { doc_type: string; status: string }[],
): string[] {
  const has = (type: string) =>
    documents.some((document) => document.doc_type === type && document.status !== "rejected");
  const missing: string[] = REQUIRED_PROFESSIONAL_DOCUMENTS.filter((type) => !has(type));
  if (!has("rethus") && !has("diploma")) missing.push("rethus_o_diploma");
  return missing;
}

export function currentVerificationDocuments<T extends { doc_type: string }>(
  documents: readonly T[],
): T[] {
  return documents.filter((document) => document.doc_type !== "utility_bill");
}