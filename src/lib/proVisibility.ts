// «¿Me ven en el mapa?» para el profesional. Espeja la regla de las funciones seguras de la base (`map_professionals`,
// `public_professionals`; migraciones 20261012210000 y 20261013100000): aparece quien tiene el perfil PUBLICADO, la cuenta activa y no
// bloqueada; con ubicación guardada sale como punto en el mapa (siempre aproximada, ~1 km); sin ella igual cuenta y sale en el buscador.
// «Disponible» no lo oculta: lo marca (verde) o lo deja como «no disponible». Aquí solo se explica; la base es la que decide.

export type VisibilityStatus = "visible" | "hidden" | "blocked";
export type VisibilityStepKey = "active" | "published" | "location" | "available" | "offer";
export type VisibilityAction = "show" | "profile" | "availability" | "offer";

export interface ProVisibilityInput {
  /** `professional_profiles.published`: el perfil se muestra a las familias. */
  published: boolean;
  /** `professional_profiles.active` (nulo = activo): la cuenta no fue ocultada. */
  active: boolean | null;
  /** El equipo de Humanix puso la cuenta en revisión. */
  blocked: boolean;
  /** Guardó su zona (`lat` y `lng`). */
  hasLocation: boolean;
  /** `professional_profiles.available`: el interruptor «Disponible». */
  available: boolean;
  /** Tiene al menos una oferta de servicio visible ahora. */
  hasVisibleServiceOffer: boolean;
}

export interface VisibilityStep {
  key: VisibilityStepKey;
  label: string;
  done: boolean;
  /** Qué hacer para completarlo (null si ya está). */
  hint: string | null;
  action: VisibilityAction | null;
}

export interface ProVisibility {
  status: VisibilityStatus;
  /** Aparece como punto en el mapa. */
  onMap: boolean;
  /** Aparece en el buscador y se cuenta en los totales. */
  searchable: boolean;
  headline: string;
  detail: string;
  steps: VisibilityStep[];
}

export function proVisibility(i: ProVisibilityInput): ProVisibility {
  const active = i.active !== false;
  const searchable = i.published && active && !i.blocked;
  const onMap = searchable && i.hasLocation;

  const steps: VisibilityStep[] = [];
  if (!active) {
    steps.push({
      key: "active",
      label: "Perfil visible",
      done: false,
      hint: "Tu perfil está oculto del mapa y del buscador. Vuelve a mostrarlo cuando quieras recibir propuestas.",
      action: "show",
    });
  }
  steps.push(
    {
      key: "published",
      label: "Perfil publicado",
      done: i.published,
      hint: i.published ? null : "Publica tu perfil para aparecer en el mapa y en el buscador.",
      action: i.published ? null : "profile",
    },
    {
      key: "location",
      label: "Zona guardada",
      done: i.hasLocation,
      hint: i.hasLocation
        ? null
        : "Guarda tu zona para aparecer como punto en el mapa (siempre aproximada, ~1 km; nunca tu dirección).",
      action: i.hasLocation ? null : "profile",
    },
    {
      key: "available",
      label: "Disponible para nuevos servicios",
      done: i.available,
      hint: i.available
        ? null
        : "Actívalo para recibir propuestas. Si lo apagas, sigues visible pero marcado como no disponible.",
      action: i.available ? null : "availability",
    },
    {
      key: "offer",
      label: "Oferta de servicio publicada",
      done: i.hasVisibleServiceOffer,
      hint: i.hasVisibleServiceOffer
        ? null
        : "Publica tu oferta para que las familias y las EPS/IPS te encuentren con tu Trust Score.",
      action: i.hasVisibleServiceOffer ? null : "offer",
    },
  );

  if (i.blocked) {
    return {
      status: "blocked",
      onMap: false,
      searchable: false,
      headline: "Tu cuenta está en revisión",
      detail:
        "Por ahora no apareces en el mapa ni en el buscador. Si crees que fue un error, escríbenos por PQRS.",
      steps,
    };
  }
  if (!onMap) {
    return {
      status: "hidden",
      onMap: false,
      searchable,
      headline: "Todavía no apareces como punto en el mapa",
      detail: !searchable
        ? "Completa los pasos de abajo para que familias e instituciones te encuentren."
        : "Ya sales en el buscador; guarda tu zona para aparecer también como punto en el mapa.",
      steps,
    };
  }
  return {
    status: "visible",
    onMap: true,
    searchable: true,
    headline: i.available
      ? "Te ven en el mapa: disponible"
      : "Estás en el mapa, marcado como no disponible",
    detail: i.available
      ? "Familias e instituciones cercanas te ven con tu zona aproximada y pueden proponerte servicios."
      : "Familias e instituciones te ven, pero saben que ahora no estás disponible.",
    steps,
  };
}

/** Cuántos pasos están completos, para mostrar «3 de 4». */
export function visibilityProgress(v: ProVisibility): { done: number; total: number } {
  return { done: v.steps.filter((s) => s.done).length, total: v.steps.length };
}
