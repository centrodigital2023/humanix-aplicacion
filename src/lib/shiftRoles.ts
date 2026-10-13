// «¿A quién necesitas?» al publicar un turno (flujo guiado de IPS / EPS / familias): los perfiles de siempre más Médico y «Otro», donde la
// persona escribe el perfil con sus palabras. Lo que se escribe pasa por la misma moderación que el resto de las ofertas (sin groserías,
// sin venta de artículos, sin teléfonos ni enlaces); el servidor vuelve a revisar al guardar (`hx_offer_guard`).
//
//  • Instituciones: ofensivo y venta, nada más (son IPS/EPS: también existen perfiles como «Camillero» o «Conductor de ambulancia»).
//  • Familias: además debe sonar a salud o cuidado (igual que sus ofertas).

import { checkOfferText } from "./contentModeration";

export type ShiftRoleKey = "medico" | "jefe" | "aux" | "cuidador" | "terapia" | "otro";
export type ShiftRoleTint = "sky" | "emerald" | "rose" | "violet" | "amber";

export interface ShiftRole {
  key: ShiftRoleKey;
  emoji: string;
  label: string;
  tint: ShiftRoleTint;
  /** Lo que se guarda como especialidad pedida (`specialty_required`); en «Otro» lo escribe la persona. */
  specialty: string;
  /** Otras formas en que los profesionales escriben esta especialidad (la búsqueda del directorio no distingue tildes ni «a/o» finales). */
  aliases: string[];
  /** Pago sugerido (COP) por turno de 12 h o por hora, que la persona puede cambiar. */
  suggested: number;
  /** El perfil lo escribe la persona. */
  free: boolean;
}

export const OTHER_ROLE_KEY: ShiftRoleKey = "otro";
export const OTHER_ROLE_MIN = 3;
export const OTHER_ROLE_MAX = 60;

export const SHIFT_ROLES: readonly ShiftRole[] = [
  {
    key: "medico",
    emoji: "🧑‍⚕️",
    label: "Médico",
    tint: "amber",
    specialty: "Médico",
    aliases: ["Medic", "Médic"],
    suggested: 450_000,
    free: false,
  },
  {
    key: "jefe",
    emoji: "🩺",
    label: "Enfermería jefe",
    tint: "sky",
    specialty: "Enfermería",
    aliases: ["Enfermeria"],
    suggested: 220_000,
    free: false,
  },
  {
    key: "aux",
    emoji: "💉",
    label: "Auxiliar",
    tint: "emerald",
    specialty: "Auxiliar",
    aliases: [],
    suggested: 140_000,
    free: false,
  },
  {
    key: "cuidador",
    emoji: "🤝",
    label: "Cuidador",
    tint: "rose",
    specialty: "Cuidador",
    aliases: [],
    suggested: 110_000,
    free: false,
  },
  {
    key: "terapia",
    emoji: "🦾",
    label: "Terapeuta",
    tint: "violet",
    specialty: "Terapia",
    aliases: ["Terapeuta"],
    suggested: 180_000,
    free: false,
  },
  {
    key: "otro",
    emoji: "✍️",
    label: "Otro",
    tint: "sky",
    specialty: "",
    aliases: [],
    suggested: 150_000,
    free: true,
  },
];

export function roleByKey(key: string | null | undefined): ShiftRole {
  return SHIFT_ROLES.find((r) => r.key === key) ?? SHIFT_ROLES[2];
}

/** Espacios repetidos, y sin espacios ni signos sueltos en los bordes. */
export function cleanOtherRole(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OTHER_ROLE_MAX * 2);
}

export type OtherRoleCheck = { ok: true; text: string } | { ok: false; message: string };

export function validateOtherRole(
  text: string | null | undefined,
  opts: { family: boolean },
): OtherRoleCheck {
  const t = cleanOtherRole(text);
  if (t.length < OTHER_ROLE_MIN) {
    return {
      ok: false,
      message: "Escribe a quién necesitas (por ejemplo: Psicólogo, Nutricionista, Camillero).",
    };
  }
  if (t.length > OTHER_ROLE_MAX) {
    return { ok: false, message: `Máximo ${OTHER_ROLE_MAX} caracteres.` };
  }
  if (!/[a-záéíóúñ]/i.test(t)) {
    return { ok: false, message: "Escribe el perfil con letras (por ejemplo: Psicólogo)." };
  }
  const check = checkOfferText([t], { requireCare: opts.family, checkContact: true });
  if (!check.ok) return { ok: false, message: check.message };
  return { ok: true, text: t };
}

/** Texto de la especialidad pedida para guardar la oferta («Otro» usa lo que escribió la persona). */
export function roleSpecialty(role: ShiftRole, otherText: string | null | undefined): string {
  return role.free ? cleanOtherRole(otherText) : role.specialty;
}

/** Nombre del perfil para el título y los avisos. */
export function roleLabel(role: ShiftRole, otherText: string | null | undefined): string {
  return role.free ? cleanOtherRole(otherText) || role.label : role.label;
}

/** Términos con los que se buscan candidatos (sin repetir, sin vacíos). */
export function roleSearchTerms(role: ShiftRole, otherText: string | null | undefined): string[] {
  const terms = [roleSpecialty(role, otherText), ...role.aliases]
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(terms)];
}

export function shiftOfferTitle(label: string, scheduleLabel: string): string {
  return `${label} · ${scheduleLabel}`.slice(0, 120);
}
