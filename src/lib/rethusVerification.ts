// Lógica pura para la verificación ReTHUS (usada por src/lib/rethus.functions.ts).

/** Estados que consumen el intento único del profesional. Un "error" del proveedor no lo consume. */
export const RETHUS_FINAL_STATUSES = ["verified", "not_found", "name_mismatch"] as const;
export type RethusFinalStatus = (typeof RETHUS_FINAL_STATUSES)[number];

/** Límite de re-verificaciones por administrador (control de costo del proveedor). */
export const RETHUS_ADMIN_MAX_PER_WINDOW = 20;
export const RETHUS_ADMIN_WINDOW_MS = 60 * 60 * 1000;

/** Normaliza un nombre: sin tildes, mayúsculas, espacios simples. */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Coinciden si al menos 2 palabras (de 3+ letras) del nombre del perfil
 * aparecen en el nombre oficial, o todas si el perfil tiene menos de 2.
 */
export function namesMatch(profileName: string, officialName: string): boolean {
  const off = new Set(normalizeName(officialName).split(" ").filter(Boolean));
  const tokens = normalizeName(profileName)
    .split(" ")
    .filter((t) => t.length >= 3);
  if (tokens.length === 0 || off.size === 0) return false;
  const hits = tokens.filter((t) => off.has(t)).length;
  return hits >= Math.min(2, tokens.length);
}

/** Documento colombiano: solo dígitos, 5 a 12. */
export function isValidDocumentNumber(doc: string): boolean {
  return /^\d{5,12}$/.test(doc);
}

/** ¿Ya existe un intento que consume la verificación única (no re-verificación de admin)? */
export function hasConsumedSingleAttempt(
  rows: { status: string; reverified?: boolean | null }[],
): boolean {
  return rows.some(
    (r) => !r.reverified && (RETHUS_FINAL_STATUSES as readonly string[]).includes(r.status),
  );
}

export type RethusPrereqs = { hasConsent: boolean; hasActivePlan: boolean; hasDocument: boolean };
export type MissingPrereq = "consent_required" | "plan_required" | "document_required";

/** Primera condición que falta para disparar la verificación automática, o null si están las tres. */
export function missingPrerequisite(p: RethusPrereqs): MissingPrereq | null {
  if (!p.hasConsent) return "consent_required";
  if (!p.hasActivePlan) return "plan_required";
  if (!p.hasDocument) return "document_required";
  return null;
}

/** Plan vigente según mp_subscriptions (escrito solo por el webhook de pagos). */
export function isActiveSubscription(
  sub: { status: string | null; current_period_end: string | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!sub) return false;
  if (!["active", "approved"].includes(String(sub.status))) return false;
  return !sub.current_period_end || new Date(sub.current_period_end).getTime() > now.getTime();
}

/** Re-verificaciones que le quedan al admin en la ventana. */
export function adminRemaining(attemptDates: (string | Date)[], now: Date = new Date()): number {
  const since = now.getTime() - RETHUS_ADMIN_WINDOW_MS;
  const used = attemptDates.filter((d) => new Date(d).getTime() > since).length;
  return Math.max(0, RETHUS_ADMIN_MAX_PER_WINDOW - used);
}
