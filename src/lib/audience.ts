// Perfiles del selector tripartito de la home (Familias / IPS-EPS / Profesionales).
// El perfil vive en la URL (?para=) para que sea compartible y SSR-consistente,
// y se recuerda en localStorage para la próxima visita.

export type Audience = "familias" | "instituciones" | "profesionales";

export const AUDIENCES: Audience[] = ["familias", "instituciones", "profesionales"];

export const AUDIENCE_STORAGE_KEY = "humanix-audience";

export function parseAudience(value: unknown): Audience | undefined {
  return typeof value === "string" && (AUDIENCES as string[]).includes(value)
    ? (value as Audience)
    : undefined;
}

export type AudienceCopy = {
  emoji: string;
  tab: string;
  tabShort: string;
  title: string;
  subtitle: string;
  cta: string;
  /** Rol que se envía a /auth cuando hace falta crear cuenta. */
  authRole: "family" | "institution" | "professional";
};

export const AUDIENCE_COPY: Record<Audience, AudienceCopy> = {
  familias: {
    emoji: "👨‍👩‍👧",
    tab: "Familias",
    tabShort: "Familias",
    title: "Cuidado real para quien más quieres",
    subtitle: "Personas verificadas con RETHUS, cerca de ti. Precio claro desde el primer momento.",
    cta: "Buscar cuidado gratis",
    authRole: "family",
  },
  instituciones: {
    emoji: "🏥",
    tab: "IPS / EPS",
    tabShort: "IPS / EPS",
    title: "Turnos cubiertos en menos de 2 horas",
    subtitle: "Candidatos verificados con FUID compliance completo. Sin intermediarios.",
    cta: "Publicar turno ahora",
    authRole: "institution",
  },
  profesionales: {
    emoji: "👩‍⚕️",
    tab: "Profesional",
    tabShort: "Profesional",
    title: "Tu carrera, en tus manos",
    subtitle: "Ofertas cerca de tu casa. Pago claro y a tiempo. Tu marca personal verificada.",
    cta: "Activar mi perfil",
    authRole: "professional",
  },
};

/** Guarda/lee pequeños borradores de formularios (autoguardado paso a paso). */
export function loadDraft<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveDraft<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible: el flujo sigue funcionando sin autoguardado */
  }
}

export function whatsappLink(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// ── Perfil elegido: una sola experiencia de punta a punta ──────────────────

const AUDIENCE_EVENT = "humanix-audience-change";

type Role = "family" | "institution" | "professional" | string;

/** Perfil según los roles de la cuenta (null si es staff/admin o no aplica). */
export function audienceFromRoles(roles: Role[]): Audience | null {
  if (roles.includes("institution")) return "instituciones";
  if (roles.includes("professional")) return "profesionales";
  if (roles.includes("family")) return "familias";
  return null;
}

export function readStoredAudience(): Audience | undefined {
  try {
    return parseAudience(localStorage.getItem(AUDIENCE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function storeAudience(a: Audience | null) {
  try {
    if (a) localStorage.setItem(AUDIENCE_STORAGE_KEY, a);
    else localStorage.removeItem(AUDIENCE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(AUDIENCE_EVENT));
}

export function onAudienceChange(cb: () => void) {
  window.addEventListener(AUDIENCE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(AUDIENCE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
