// Documentos institucionales de la EPS/IPS. La institución los sube al bucket privado «institution-docs» y solo el
// superadmin los aprueba o rechaza. Con cámara de comercio y RUT aprobados, la base marca institution_profiles.verified
// (hx_inst_docs_complete en supabase/migrations/20261028160000_institution_docs_two_required.sql).

export const INSTITUTION_DOCS_BUCKET = "institution-docs";

export type InstitutionDocType =
  "camara_comercio" | "rut" | "habilitacion_reps" | "poliza" | "otro";

export type InstitutionDocStatus = "pending" | "approved" | "rejected";

export type InstitutionDocument = {
  id: string;
  user_id: string;
  doc_type: string;
  file_name: string | null;
  file_url: string;
  status: InstitutionDocStatus;
  reviewer_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export const INSTITUTION_DOC_TYPES: {
  value: InstitutionDocType;
  label: string;
  hint: string;
  required: boolean;
}[] = [
  {
    value: "camara_comercio",
    label: "Cámara de comercio",
    hint: "Certificado de existencia y representación legal, de menos de 30 días.",
    required: true,
  },
  { value: "rut", label: "RUT", hint: "Registro Único Tributario con el NIT.", required: true },

  {
    value: "habilitacion_reps",
    label: "Habilitación REPS",
    hint: "Si eres IPS: constancia de habilitación ante la Secretaría de Salud.",
    required: false,
  },
  {
    value: "poliza",
    label: "Póliza de responsabilidad civil",
    hint: "Opcional.",
    required: false,
  },
  { value: "otro", label: "Otro documento", hint: "Cualquier soporte adicional.", required: false },
];

export const REQUIRED_INSTITUTION_DOCS = INSTITUTION_DOC_TYPES.filter((t) => t.required).map(
  (t) => t.value,
);

// Tipos que ya no se piden pero pueden existir en filas viejas.
const LEGACY_LABELS: Record<string, string> = {
  nit_certificate: "Certificado NIT",
  cedula_representante: "Cédula del representante legal",
};

export function institutionDocLabel(type: string): string {
  return (
    INSTITUTION_DOC_TYPES.find((t) => t.value === type)?.label ??
    LEGACY_LABELS[type] ??
    type.replace(/_/g, " ")
  );
}

export const INSTITUTION_DOC_STATUS_LABEL: Record<InstitutionDocStatus, string> = {
  pending: "En revisión",
  approved: "Aprobado",
  rejected: "Rechazado",
};

/** Obligatorios que todavía no tienen un documento aprobado. */
export function missingApprovedDocs(docs: Pick<InstitutionDocument, "doc_type" | "status">[]) {
  return REQUIRED_INSTITUTION_DOCS.filter(
    (t) => !docs.some((d) => d.doc_type === t && d.status === "approved"),
  );
}

/** Ruta dentro del bucket. Acepta la ruta guardada o una URL completa de storage. */
export function institutionDocPath(stored: string): string | null {
  if (!stored || stored.startsWith("blob:")) return null;
  if (!stored.includes("://")) return stored;
  try {
    const url = new URL(stored);
    const marker = `/${INSTITUTION_DOCS_BUCKET}/`;
    const idx = url.pathname.indexOf(marker);
    return idx >= 0 ? decodeURIComponent(url.pathname.slice(idx + marker.length)) : null;
  } catch {
    return null;
  }
}
