// Home de cada perfil: tarjeta "radar" del profesional cercano, contadores en vivo y destino tras el registro.
// Funciones puras para probarlas sin base de datos.

import { searchProfessionalDetails, type PublicProfessional } from "@/lib/publicProfessionals";

export type RadarPro = {
  id: string;
  /** «Nixon J.»: nombre y la inicial del último apellido. */
  name: string;
  specialty: string;
  city: string;
  available: boolean;
  live: boolean;
  hourlyRate: number | null;
  shiftRate: number | null;
  avatarUrl: string | null;
};

/** «Nixon Estiven Paz Jojoa» → «Nixon J.»; «Laura P.» (sin sesión) se deja igual. */
export function shortProName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

/**
 * El profesional que se muestra en la tarjeta en vivo: solo filas válidas del directorio (`searchProfessionalDetails`) y
 * verificadas (con documentos pendientes no se contrata directo); primero disponibles, luego con la app abierta y mejor
 * calificados. null si no hay ninguno que mostrar.
 */
export function pickRadarPro(rows: readonly PublicProfessional[]): RadarPro | null {
  const score = (p: PublicProfessional) =>
    (p.availability_status === "available" ? 500 : 0) +
    (p.live ? 100 : 0) +
    (p.avg_rating ?? 0) * 10;

  let best: { row: PublicProfessional; city: string; name: string } | null = null;
  for (const row of rows) {
    const details = searchProfessionalDetails(row);
    if (!details || !row.user_id || !(row.verified || row.rethus_verified)) continue;
    if (!best || score(row) > score(best.row))
      best = { row, city: details.city, name: details.name };
  }
  if (!best) return null;
  const { row } = best;
  return {
    id: row.user_id,
    name: shortProName(best.name),
    specialty: (row.specialty ?? "").trim() || "Cuidado en casa",
    city: best.city,
    available: row.availability_status === "available",
    live: Boolean(row.live),
    hourlyRate: row.hourly_rate && row.hourly_rate > 0 ? row.hourly_rate : null,
    shiftRate: row.shift_rate && row.shift_rate > 0 ? row.shift_rate : null,
    avatarUrl: row.avatar_url,
  };
}

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

/** «$ 10.000 / hora», «$ 140.000 / turno» o null si el profesional no publicó precio. */
export function radarPrice(p: Pick<RadarPro, "hourlyRate" | "shiftRate">): string | null {
  if (p.hourlyRate) return `${COP(p.hourlyRate)} / hora`;
  if (p.shiftRate) return `${COP(p.shiftRate)} / turno`;
  return null;
}

type SignupRole = "family" | "institution" | "professional" | null | undefined;

/**
 * Panel al que va una cuenta apenas inicia sesión o termina el registro, sin pasar por `/dashboard` (que recarga la página
 * para decidir). Los roles de la base mandan; si aún no existen (registro recién hecho), vale el rol elegido al registrarse.
 */
export function dashboardPathForRoles(roles: readonly string[], signupRole?: SignupRole): string {
  if (roles.includes("superadmin")) return "/superadmin";
  if (roles.includes("hr_staff")) return "/talento-humano";
  if (roles.includes("evaluator")) return "/evaluador";
  if (roles.includes("institution")) return "/dashboard/institucion";
  if (roles.includes("family")) return "/dashboard/familia";
  if (roles.includes("professional")) return "/dashboard/profesional";
  if (roles.length > 0) return "/dashboard";
  if (signupRole === "institution") return "/dashboard/institucion";
  if (signupRole === "professional") return "/dashboard/profesional";
  if (signupRole === "family") return "/dashboard/familia";
  return "/dashboard";
}
