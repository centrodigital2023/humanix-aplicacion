// Lógica pura para la verificación ReTHUS (compartida con la función verify-rethus).

export const RETHUS_MAX_ATTEMPTS = 3;
export const RETHUS_WINDOW_MS = 24 * 60 * 60 * 1000;

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
  const tokens = normalizeName(profileName).split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0 || off.size === 0) return false;
  const hits = tokens.filter((t) => off.has(t)).length;
  return hits >= Math.min(2, tokens.length);
}

/** Cuántas consultas quedan en la ventana de 24 h. */
export function remainingAttempts(attemptDates: (string | Date)[], now: Date = new Date()): number {
  const since = now.getTime() - RETHUS_WINDOW_MS;
  const used = attemptDates.filter((d) => new Date(d).getTime() > since).length;
  return Math.max(0, RETHUS_MAX_ATTEMPTS - used);
}

/** Documento colombiano: solo dígitos, 5 a 12. */
export function isValidDocumentNumber(doc: string): boolean {
  return /^\d{5,12}$/.test(doc);
}
