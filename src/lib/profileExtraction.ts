// Normaliza lo que la IA extrae de una hoja de vida (PDF, Word, imagen o texto pegado) a datos que el panel del
// profesional puede rellenar. Pura y probada (`profileExtraction.test.ts`): nunca inventa campos ni números inválidos.

export interface ExtractedWorkExp {
  role: string;
  employer: string;
  city?: string;
  start?: string;
  end?: string;
  description?: string;
}

export interface ExtractedReference {
  ref_type: "work" | "family";
  full_name: string;
  phone: string;
  relation: string | null;
}

export interface ExtractedProfile {
  full_name?: string;
  specialty?: string;
  sub_specialties?: string[];
  years_experience?: number;
  rethus_number?: string;
  certifications?: string[];
  languages?: string[];
  service_cities?: string[];
  bio?: string;
  hourly_rate?: number;
  shift_rate?: number;
  monthly_rate?: number;
  work_experience: ExtractedWorkExp[];
  references: ExtractedReference[];
  document_evidence: DocumentEvidence[];
}

export interface DocumentEvidence {
  doc_type: "cv" | "id_document" | "rethus" | "diploma" | "work_experience";
  page_start: number;
  page_end: number;
  evidence: string;
}

/** Only visible original PDF pages count as supporting documents, never CV mentions. */
export function normalizeDocumentEvidence(input: unknown, pageCount: number): DocumentEvidence[] {
  if (!Array.isArray(input) || !Number.isInteger(pageCount) || pageCount < 1) return [];
  const allowed = new Set(["cv", "id_document", "rethus", "diploma", "work_experience"]);
  const seen = new Set<string>();
  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const d = value as Record<string, unknown>;
    if (typeof d.doc_type !== "string" || !allowed.has(d.doc_type) || seen.has(d.doc_type)) return [];
    const start = d.page_start;
    const end = d.page_end;
    const evidence = typeof d.evidence === "string" ? d.evidence.trim() : "";
    if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) ||
      !Number.isInteger(end) || start < 1 || end < start || end > pageCount || !evidence) return [];
    seen.add(d.doc_type);
    return [{ doc_type: d.doc_type as DocumentEvidence["doc_type"], page_start: start, page_end: end, evidence: evidence.slice(0, 500) }];
  });
}

const s = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

const list = (v: unknown, max = 20): string[] | undefined => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : null;
  if (!arr) return undefined;
  const out = [...new Set(arr.map((x) => s(x, 80)).filter((x): x is string => !!x))].slice(0, max);
  return out.length ? out : undefined;
};

const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= min && n <= max && String(v ?? "").trim() !== ""
    ? Math.round(n)
    : undefined;
};

/** Celular colombiano o internacional; devuelve el formato «+57 3001234567» o nulo si no sirve. */
export function normalizePhone(v: unknown): string | null {
  const raw = s(v, 40);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^3\d{9}$/.test(digits) || /^60\d{8}$/.test(digits)) return `+57 ${digits}`;
  if (/^57(3\d{9}|60\d{8})$/.test(digits)) return `+57 ${digits.slice(2)}`;
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function normalizeExtraction(input: unknown): ExtractedProfile {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const work = (Array.isArray(p.work_experience) ? p.work_experience : [])
    .map((w) => {
      const o = (w ?? {}) as Record<string, unknown>;
      const role = s(o.role, 100);
      const employer = s(o.employer, 120);
      if (!role && !employer) return null;
      const e: ExtractedWorkExp = { role: role ?? "Cargo", employer: employer ?? "Empleador" };
      const city = s(o.city, 60);
      const start = s(o.start, 20);
      const end = s(o.end, 20);
      const description = s(o.description, 500);
      if (city) e.city = city;
      if (start) e.start = start;
      if (end) e.end = end;
      if (description) e.description = description;
      return e;
    })
    .filter((x): x is ExtractedWorkExp => !!x)
    .slice(0, 15);

  const seen = new Set<string>();
  const refs = (Array.isArray(p.references) ? p.references : [])
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const full_name = s(o.full_name, 120);
      const phone = normalizePhone(o.phone);
      if (!full_name || full_name.length < 3 || !phone) return null;
      const key = phone.replace(/\D/g, "");
      if (seen.has(key)) return null;
      seen.add(key);
      const ref: ExtractedReference = {
        ref_type: /fam|pers/i.test(String(o.ref_type ?? "")) ? "family" : "work",
        full_name,
        phone,
        relation: s(o.relation, 60) ?? null,
      };
      return ref;
    })
    .filter((x): x is ExtractedReference => !!x)
    .slice(0, 10);

  const out: ExtractedProfile = { work_experience: work, references: refs, document_evidence: [] };
  const set = <K extends keyof ExtractedProfile>(k: K, v: ExtractedProfile[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("full_name", s(p.full_name, 120));
  set("specialty", s(p.specialty, 80));
  set("sub_specialties", list(p.sub_specialties));
  set("years_experience", num(p.years_experience, 0, 60));
  set("rethus_number", s(p.rethus_number, 30));
  set("certifications", list(p.certifications));
  set("languages", list(p.languages, 10));
  set("service_cities", list(p.service_cities));
  set("bio", s(p.bio, 800));
  set("hourly_rate", num(p.hourly_rate, 5_000, 500_000));
  set("shift_rate", num(p.shift_rate, 20_000, 2_000_000));
  set("monthly_rate", num(p.monthly_rate, 500_000, 30_000_000));
  return out;
}

/** Referencias nuevas: las que no estaban ya guardadas (mismo celular). */
export function newReferences(
  extracted: readonly ExtractedReference[],
  existing: readonly { phone: string }[],
): ExtractedReference[] {
  const have = new Set(existing.map((r) => r.phone.replace(/\D/g, "").slice(-10)));
  return extracted.filter((r) => !have.has(r.phone.replace(/\D/g, "").slice(-10)));
}

/** Tipo de archivo aceptado para extraer: lo que va al servidor tal cual o lo que se lee como texto aquí. */
export function fileKind(name: string, mime: string): "pdf" | "image" | "docx" | "text" | null {
  const n = name.toLowerCase();
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/^image\/(png|jpe?g|webp)$/.test(mime) || /\.(png|jpe?g|webp)$/.test(n)) return "image";
  if (n.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (mime.startsWith("text/") || /\.(txt|md|csv|rtf|json)$/.test(n)) return "text";
  return null;
}
