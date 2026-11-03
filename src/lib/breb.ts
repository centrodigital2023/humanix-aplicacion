// Llaves Bre-B (sistema de pagos inmediatos del Banco de la República). Lógica pura y probada (`breb.test.ts`).
//
// Una llave es el «alias» con el que el profesional recibe su plata en segundos: su celular, su cédula, su correo o un código
// alfanumérico que crea en su banco (empieza con @). Aquí se detecta el tipo, se limpia lo que la persona escribe (espacios, +57,
// puntos) y se valida antes de guardarla. Nunca se muestra completa a terceros: `maskBrebKey`.

export type BrebKeyType = "phone" | "document" | "email" | "alias";

export const BREB_KEY_TYPES: ReadonlyArray<{
  type: BrebKeyType;
  label: string;
  hint: string;
  example: string;
}> = [
  {
    type: "phone",
    label: "Celular",
    hint: "El número con el que tienes Nequi, Daviplata o tu banco",
    example: "300 123 4567",
  },
  {
    type: "document",
    label: "Cédula",
    hint: "Tu número de documento, sin puntos",
    example: "1085123456",
  },
  {
    type: "email",
    label: "Correo",
    hint: "El correo que registraste como llave en tu banco",
    example: "tu@correo.com",
  },
  {
    type: "alias",
    label: "Código @",
    hint: "El código que creaste en tu banco, empieza con @",
    example: "@laura.enfermera",
  },
];

export type BrebKeyResult =
  | { ok: true; type: BrebKeyType; value: string }
  | { ok: false; error: "empty" | "phone" | "document" | "email" | "alias" };

export const BREB_KEY_ERROR: Record<Exclude<BrebKeyResult, { ok: true }>["error"], string> = {
  empty: "Escribe tu llave Bre-B.",
  phone: "El celular debe tener 10 dígitos y empezar por 3 (ej. 300 123 4567).",
  document: "La cédula debe tener entre 5 y 10 números, sin puntos.",
  email: "Ese correo no parece válido. Revísalo.",
  alias: "El código empieza con @ y lleva de 3 a 20 letras, números, punto o guion.",
};

/** Deja solo lo que importa: el celular sin +57 ni espacios, la cédula sin puntos, el correo en minúsculas. */
export function normalizeBrebKey(type: BrebKeyType, raw: string): string {
  const s = (raw ?? "").trim();
  switch (type) {
    case "phone": {
      const digits = s.replace(/\D/g, "");
      return digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
    }
    case "document":
      return s.replace(/\D/g, "");
    case "email":
      return s.toLowerCase();
    case "alias": {
      const v = s.toLowerCase().replace(/\s+/g, "");
      return v.startsWith("@") ? v : `@${v}`;
    }
  }
}

/** Adivina el tipo a partir de lo que la persona escribió (para no hacerla elegir si no quiere). */
export function guessBrebKeyType(raw: string): BrebKeyType | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (s.startsWith("@")) return "alias";
  if (s.includes("@")) return "email";
  const digits = s.replace(/\D/g, "");
  if (/^[\d\s+().-]+$/.test(s)) {
    const d = digits.length === 12 && digits.startsWith("57") ? digits.slice(2) : digits;
    if (d.length === 10 && d.startsWith("3")) return "phone";
    return "document";
  }
  return "alias";
}

export function validateBrebKey(type: BrebKeyType, raw: string): BrebKeyResult {
  if (!(raw ?? "").trim()) return { ok: false, error: "empty" };
  const value = normalizeBrebKey(type, raw);
  switch (type) {
    case "phone":
      return /^3\d{9}$/.test(value) ? { ok: true, type, value } : { ok: false, error: "phone" };
    case "document":
      return /^\d{5,10}$/.test(value)
        ? { ok: true, type, value }
        : { ok: false, error: "document" };
    case "email":
      return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value) && value.length <= 120
        ? { ok: true, type, value }
        : { ok: false, error: "email" };
    case "alias":
      return /^@[a-z0-9._-]{3,20}$/.test(value)
        ? { ok: true, type, value }
        : { ok: false, error: "alias" };
  }
}

/** «300 *** 4567», «•••• 3456», «la***@correo.com», «@lau***» */
export function maskBrebKey(type: BrebKeyType, value: string): string {
  switch (type) {
    case "phone":
      return value.length === 10 ? `${value.slice(0, 3)} *** ${value.slice(6)}` : "***";
    case "document":
      return `•••• ${value.slice(-4)}`;
    case "email": {
      const [user, domain] = value.split("@");
      return `${(user ?? "").slice(0, 2)}***@${domain ?? ""}`;
    }
    case "alias":
      return `${value.slice(0, 4)}***`;
  }
}

/** Cómo se lee en pantalla: «300 123 4567». */
export function formatBrebKey(type: BrebKeyType, value: string): string {
  if (type === "phone" && value.length === 10)
    return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
  return value;
}
