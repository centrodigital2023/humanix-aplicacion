// Personal de la institución — reglas puras (usuario, contraseña, módulos, textos y esquemas Zod).
//
// Una EPS/IPS agrega a su personal con usuario y contraseña y decide a qué módulos entra cada persona. La base de datos
// (`institution_members`, migración 20261013120000) vuelve a validar todo; esto es la MISMA regla en el navegador (formulario) y
// en el servidor (`institutionMembers.server.ts`), para dar mensajes claros antes de llegar a ella. Una sola validación: los
// esquemas de aquí los usan el formulario (react-hook-form + Zod) y el servidor.
//
// Cómo entra el personal: Supabase Auth exige un correo, así que cada usuario se traduce a un correo SINTÉTICO y no entregable
// (`usuario@staff.humanix.lat`). La persona solo ve «usuario» y «contraseña»; el servidor crea la cuenta ya confirmada.
import { z } from "zod";

/** Tope de personas por institución (también lo impone la base de datos). */
export const MAX_STAFF_PER_INSTITUTION = 10;

/** Dominio sintético de los correos del personal (sin buzón: no se envía nada a esas direcciones). */
export const STAFF_EMAIL_DOMAIN = "staff.humanix.lat";

// ─── Módulos ───────────────────────────────────────────────────────────────────

export const STAFF_MODULE_KEYS = ["ofertas", "talento", "pacientes", "monitoreo"] as const;
export type StaffModuleKey = (typeof STAFF_MODULE_KEYS)[number];

export interface StaffModule {
  key: StaffModuleKey;
  label: string;
  description: string;
}

/** Módulos que se pueden dar hoy (los mismos que acepta la base de datos: `hx_staff_modules()`). */
export const STAFF_MODULES: readonly StaffModule[] = [
  {
    key: "ofertas",
    label: "Ofertas y postulaciones",
    description:
      "Publicar turnos, ver y responder postulaciones (aceptar, rechazar o contraofertar) e invitar al equipo de confianza.",
  },
  {
    key: "talento",
    label: "Red de profesionales",
    description:
      "Ver los profesionales cercanos, sus contadores en vivo y las ofertas de servicio que publican (solo lectura).",
  },
  {
    key: "pacientes",
    label: "Pacientes y casos",
    description:
      "Registrar pacientes (con la autorización de la persona o su acudiente), abrir y cerrar casos, escribir notas firmadas, tareas, relevos y exportar la historia. Son datos sensibles (Ley 1581): da este acceso solo a quien lo necesita.",
  },
  {
    key: "monitoreo",
    label: "Monitoreo clínico",
    description:
      "Registrar signos vitales, ver el NEWS2, atender las alertas y emparejar dispositivos. Para editar los datos de las personas, dale también «Pacientes y casos».",
  },
];

/** Lo que el personal NO puede hacer, y por qué (se muestra tal cual al dueño para que decida con claridad). */
export const RESERVED_FOR_OWNER: readonly { label: string; reason: string }[] = [
  {
    label: "Firmar contratos",
    reason: "La firma la hace siempre el representante legal con la cuenta de la institución.",
  },
  {
    label: "Pagos y billetera",
    reason: "Los pagos se hacen solo en el pago web, con la cuenta de la institución.",
  },
  {
    label: "Perfil, datos legales y equipo",
    reason:
      "Editar el perfil de la institución y administrar al equipo es solo de la cuenta de la institución.",
  },
];

const MODULE_SET = new Set<string>(STAFF_MODULE_KEYS);

export function isStaffModule(value: unknown): value is StaffModuleKey {
  return typeof value === "string" && MODULE_SET.has(value);
}

/** Módulos válidos, sin repetir y en el orden del catálogo (descarta lo que no existe). */
export function normalizeModules(modules: readonly unknown[] | null | undefined): StaffModuleKey[] {
  const wanted = new Set((modules ?? []).filter(isStaffModule));
  return STAFF_MODULE_KEYS.filter((k) => wanted.has(k));
}

export function hasModule(
  modules: readonly unknown[] | null | undefined,
  key: StaffModuleKey,
): boolean {
  return normalizeModules(modules).includes(key);
}

export function moduleLabel(key: string): string {
  return STAFF_MODULES.find((m) => m.key === key)?.label ?? key;
}

/** «Ofertas y postulaciones · Red de profesionales» (o «Sin módulos»). */
export function summarizeModules(modules: readonly unknown[] | null | undefined): string {
  const list = normalizeModules(modules);
  return list.length ? list.map(moduleLabel).join(" · ") : "Sin módulos";
}

// ─── Usuario ───────────────────────────────────────────────────────────────────

/** Igual a la restricción de la base de datos (`institution_members.username`). */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/;

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrador",
  "administrator",
  "superadmin",
  "soporte",
  "support",
  "humanix",
  "staff",
  "root",
  "sistema",
  "system",
  "ayuda",
  "info",
  "contacto",
  "ventas",
  "null",
  "undefined",
  "anonimo",
]);

/** Espacios fuera y minúsculas: el usuario no distingue mayúsculas. */
export function normalizeUsername(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

/** Mensaje de error del usuario (ya normalizado) o `null` si es válido. */
export function usernameError(username: string): string | null {
  if (!username) return "Escribe un usuario.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Usa de 3 a 30 caracteres: letras minúsculas sin tildes, números, punto, guion o guion bajo, y empieza con letra o número.";
  }
  if (/[._-]$/.test(username)) return "El usuario no puede terminar en punto, guion o guion bajo.";
  if (/[._-]{2}/.test(username)) return "No uses dos signos seguidos (punto, guion o guion bajo).";
  if (RESERVED_USERNAMES.has(username)) return "Ese usuario está reservado. Elige otro.";
  return null;
}

/** Correo sintético con el que la cuenta existe en Supabase Auth. */
export function staffEmail(username: string): string {
  return `${normalizeUsername(username)}@${STAFF_EMAIL_DOMAIN}`;
}

export function isStaffEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

// ─── Contraseña ────────────────────────────────────────────────────────────────

export const PASSWORD_MIN = 10;
/** bcrypt solo usa los primeros 72 bytes: más largo se rechaza en vez de truncarse en silencio. */
export const PASSWORD_MAX_BYTES = 72;

const COMMON_PASSWORDS = [
  "1234567890",
  "123456789",
  "0123456789",
  "password",
  "contrasena",
  "contraseña",
  "qwertyuiop",
  "qwerty123",
  "abc1234567",
  "humanix",
  "colombia",
  "bogota",
  "medellin",
];

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Mensaje de error de la contraseña o `null` si cumple la política. */
export function passwordError(password: string, username = ""): string | null {
  const pw = String(password ?? "");
  if (pw.length < PASSWORD_MIN)
    return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (utf8Bytes(pw) > PASSWORD_MAX_BYTES)
    return `La contraseña es demasiado larga (máximo ${PASSWORD_MAX_BYTES} bytes).`;
  if (/\s/.test(pw)) return "La contraseña no puede llevar espacios.";
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return "Combina letras y números.";
  if (new Set(pw).size < 5) return "La contraseña es demasiado repetitiva. Mezcla más caracteres.";
  const lower = pw.toLowerCase();
  const user = normalizeUsername(username);
  if (user.length >= 3 && lower.includes(user))
    return "La contraseña no puede contener el usuario.";
  if (COMMON_PASSWORDS.some((c) => lower.includes(c)))
    return "Esa contraseña es demasiado común. Elige otra.";
  return null;
}

const PASSWORD_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PASSWORD_DIGITS = "23456789";
const PASSWORD_ALPHABET = PASSWORD_LETTERS + PASSWORD_DIGITS;

/** Número entero aleatorio en [0, max) sin sesgo (criptográfico por defecto; inyectable para pruebas). */
export type RandomInt = (max: number) => number;

export const secureRandomInt: RandomInt = (max) => {
  if (max <= 0 || max > 0x10000) throw new Error("max fuera de rango");
  const limit = Math.floor(0x10000 / max) * max;
  const buf = new Uint16Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
};

/** Contraseña aleatoria legible (sin caracteres ambiguos) que siempre cumple la política. */
export function generatePassword(
  length = 14,
  rand: RandomInt = secureRandomInt,
  username = "",
): string {
  const size = Math.max(PASSWORD_MIN, Math.min(length, 32));
  for (let attempt = 0; attempt < 50; attempt++) {
    const chars = Array.from(
      { length: size },
      () => PASSWORD_ALPHABET[rand(PASSWORD_ALPHABET.length)],
    );
    // Garantiza un número y una letra, en dos posiciones distintas al azar.
    const digitAt = rand(size);
    let letterAt = rand(size - 1);
    if (letterAt >= digitAt) letterAt += 1;
    chars[digitAt] = PASSWORD_DIGITS[rand(PASSWORD_DIGITS.length)];
    chars[letterAt] = PASSWORD_LETTERS[rand(PASSWORD_LETTERS.length)];
    const pw = chars.join("");
    if (!passwordError(pw, username)) return pw;
  }
  throw new Error("No se pudo generar una contraseña segura");
}

// ─── Esquemas (formulario y servidor) ──────────────────────────────────────────

/** Sin caracteres de control (\p{Cc}) ni signos de etiqueta HTML. */
const NO_CONTROL = /^[^\p{Cc}<>]*$/u;

const displayName = z
  .string({ error: "Escribe el nombre de la persona." })
  .trim()
  .min(2, "El nombre debe tener al menos 2 letras.")
  .max(80, "El nombre es demasiado largo (máximo 80).")
  .regex(NO_CONTROL, "El nombre tiene caracteres no permitidos.");

const jobTitle = z
  .string()
  .trim()
  .max(80, "El cargo es demasiado largo (máximo 80).")
  .regex(NO_CONTROL, "El cargo tiene caracteres no permitidos.");

const modulesField = z
  .array(z.enum(STAFF_MODULE_KEYS, { error: "Ese módulo no existe." }), {
    error: "Elige al menos un módulo.",
  })
  .min(1, "Elige al menos un módulo.")
  .max(STAFF_MODULE_KEYS.length);

/** Lo que se puede editar de una persona ya creada (y la base de lo que se pide al crearla). */
export const memberProfileSchema = z.object({
  displayName,
  jobTitle: jobTitle.optional(),
  modules: modulesField,
});
export type MemberProfileInput = z.infer<typeof memberProfileSchema>;

export const createMemberSchema = memberProfileSchema
  .extend({
    username: z.string({ error: "Escribe un usuario." }),
    password: z.string({ error: "Escribe una contraseña." }),
  })
  .superRefine((v, ctx) => {
    const u = usernameError(normalizeUsername(v.username));
    if (u) ctx.addIssue({ code: "custom", path: ["username"], message: u });
    const p = passwordError(v.password, v.username);
    if (p) ctx.addIssue({ code: "custom", path: ["password"], message: p });
  });
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const MEMBER_STATUSES = ["active", "suspended"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const updateMemberSchema = z
  .object({
    memberId: z.string().uuid("Persona no válida."),
    displayName: displayName.optional(),
    jobTitle: jobTitle.nullable().optional(),
    modules: modulesField.optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.jobTitle !== undefined ||
      v.modules !== undefined ||
      v.status !== undefined,
    { message: "No hay nada que cambiar." },
  );
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** La contraseña nueva se valida contra el usuario en el servidor (que lo conoce); aquí solo la forma. */
export const resetPasswordSchema = z.object({
  memberId: z.string().uuid("Persona no válida."),
  password: z.string({ error: "Escribe una contraseña." }),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const removeMemberSchema = z.object({ memberId: z.string().uuid("Persona no válida.") });
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

// ─── Textos ────────────────────────────────────────────────────────────────────

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Activa",
  suspended: "Suspendida",
};

const ACTION_LABEL: Record<string, string> = {
  offer_published: "Publicó un turno",
  offer_updated: "Actualizó una oferta",
  application_accepted: "Aceptó una postulación",
  application_rejected: "Rechazó una postulación",
  application_countered: "Envió una contraoferta",
  application_withdrawn: "Retiró una postulación",
  application_pending: "Reabrió una postulación",
};

/** Texto del registro de actividad (`institution_member_actions.action`). */
export function describeMemberAction(action: string): string {
  return ACTION_LABEL[action] ?? "Realizó una acción";
}

/** Dos iniciales para el avatar de la persona. */
export function memberInitials(name: string): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Cuántas personas más puede agregar la institución. */
export function remainingStaffSlots(count: number): number {
  return Math.max(0, MAX_STAFF_PER_INSTITUTION - Math.max(0, Math.floor(count || 0)));
}
