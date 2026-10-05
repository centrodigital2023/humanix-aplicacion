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
    title: "Cuidado en casa, con confianza",
    subtitle: "Personas verificadas, cerca de ti.",
    cta: "Buscar cuidado",
    authRole: "family",
  },
  instituciones: {
    emoji: "🏥",
    tab: "IPS / EPS",
    tabShort: "IPS / EPS",
    title: "Turnos cubiertos, sin estrés",
    subtitle: "Candidatos verificados en minutos.",
    cta: "Publicar turno",
    authRole: "institution",
  },
  profesionales: {
    emoji: "👩‍⚕️",
    tab: "Profesional",
    tabShort: "Profesional",
    title: "Trabaja cerca de casa",
    subtitle: "Ofertas para ti. Pago claro.",
    cta: "Activar",
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
