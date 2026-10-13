// Directorio público de profesionales: filtros → parámetros de `public.public_professionals` (migración 20261013100000).
//
// La función del servidor decide qué viaja (publicados, activos y no bloqueados; sin teléfono; posición en cuadrícula de ~1 km; nombre
// completo, foto y RETHUS solo con sesión). Aquí solo se arman los parámetros y se describe la fila, para que ningún lector del
// directorio vuelva a depender de las vistas `public_*_safe` (security_invoker: devuelven cero filas a quien no es personal).

export const PUBLIC_PROS_DEFAULT_LIMIT = 60;
export const PUBLIC_PROS_MAX_LIMIT = 500;

export type AvailabilityStatus = "available" | "busy" | "unavailable";

/** Fila que devuelve `public.public_professionals()`. */
export interface PublicProfessional {
  user_id: string;
  /** Con sesión, el nombre completo; sin sesión, «Laura P.». */
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  sub_specialties: string[] | null;
  gender: string | null;
  years_experience: number | null;
  home_city: string | null;
  service_cities: string[] | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  monthly_rate: number | null;
  avg_rating: number | null;
  total_jobs: number | null;
  trust_score: number | null;
  verified: boolean;
  rethus_verified: boolean;
  rethus_number: string | null;
  ai_summary: string | null;
  ai_strengths: string[] | null;
  certifications: unknown;
  work_experience: unknown;
  languages: string[] | null;
  availability: unknown;
  bio: string | null;
  available: boolean;
  availability_status: AvailabilityStatus;
  reserved_until: string | null;
  active: boolean;
  published: boolean;
  /** Siempre en cuadrícula de ~1 km. */
  lat: number | null;
  lng: number | null;
  /** Tiene la aplicación abierta ahora. */
  live: boolean;
}

export interface PublicProfessionalFilters {
  /** Consulta por id (perfil, nombres de postulantes): no más de 500. */
  ids?: readonly string[] | null;
  specialty?: string | null;
  city?: string | null;
  /** Solo `true` filtra; `false` y vacío significan «sin restricción». */
  verified?: boolean | null;
  minRate?: number | null;
  maxRate?: number | null;
  minRating?: number | null;
  limit?: number | null;
}

const clean = (v: string | null | undefined, max = 80): string | undefined => {
  const t = (v ?? "").trim().slice(0, max);
  return t === "" ? undefined : t;
};

const positiveInt = (v: number | null | undefined): number | undefined =>
  v != null && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;

/** Filtros → parámetros nombrados de la función (lo vacío no se envía: la base usa sus valores por defecto). */
export function publicProfessionalsArgs(
  f: PublicProfessionalFilters = {},
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (f.ids != null) {
    const ids = [...new Set(f.ids.map((i) => i.trim()).filter(Boolean))].slice(
      0,
      PUBLIC_PROS_MAX_LIMIT,
    );
    args.p_ids = ids;
  }
  const specialty = clean(f.specialty);
  if (specialty) args.p_specialty = specialty;
  const city = clean(f.city);
  if (city) args.p_city = city;
  if (f.verified === true) args.p_verified = true;
  const minRate = positiveInt(f.minRate);
  if (minRate) args.p_min_rate = minRate;
  const maxRate = positiveInt(f.maxRate);
  if (maxRate) args.p_max_rate = maxRate;
  if (f.minRating != null && Number.isFinite(f.minRating) && f.minRating > 0) {
    args.p_min_rating = Math.min(5, f.minRating);
  }
  const limit = f.limit == null || !Number.isFinite(f.limit) ? PUBLIC_PROS_DEFAULT_LIMIT : f.limit;
  args.p_limit = Math.min(PUBLIC_PROS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
  return args;
}

/** ¿Pidieron buscar por id y no hay ninguno? Entonces no hace falta llamar a la base. */
export function isEmptyIdLookup(f: PublicProfessionalFilters): boolean {
  return f.ids != null && (publicProfessionalsArgs(f).p_ids as string[]).length === 0;
}

/** Ciudad para mostrar de un profesional: la base, si no la primera de servicio. */
export function proCity(
  p: Pick<PublicProfessional, "home_city" | "service_cities">,
): string | null {
  const home = (p.home_city ?? "").trim();
  if (home) return home;
  const first = (p.service_cities ?? []).map((c) => c.trim()).find(Boolean);
  return first ?? null;
}

/** Cuántos profesionales distintos hay entre varias listas (uno puede coincidir con más de un término de búsqueda). */
export function uniqueProfessionalCount(
  lists: ReadonlyArray<ReadonlyArray<{ user_id: string }>>,
): number {
  const seen = new Set<string>();
  for (const list of lists) for (const p of list) seen.add(p.user_id);
  return seen.size;
}
