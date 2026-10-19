// «¿Me ven en el mapa?» para la familia. Lógica pura y probada (`familyMapStatus.test.ts`).
// Regla de la base (`map_open_demand`): la familia aparece en el mapa de los profesionales mientras tenga ofertas u horas abiertas, no se
// haya ocultado y haya alguna ubicación (la de su perfil o la de su oferta), siempre aproximada (~1 km). Sin ubicación no hay punto: antes
// la tarjeta decía «te ven en el mapa» y no era cierto.

export type FamilyMapState = "visible" | "no_location" | "waiting" | "hidden";

export interface FamilyMapInput {
  visible: boolean;
  openOffers: number;
  openHours: number;
  /** Ubicación guardada en el perfil o en alguna oferta abierta. */
  hasLocation: boolean;
}

export interface FamilyMapStatus {
  state: FamilyMapState;
  headline: string;
  detail: string;
  /** Mostrar el botón «Usar mi ubicación». */
  askLocation: boolean;
}

export function familyMapStatus(i: FamilyMapInput): FamilyMapStatus {
  const open = [
    i.openOffers > 0 ? `${i.openOffers} ${i.openOffers === 1 ? "oferta" : "ofertas"}` : null,
    i.openHours > 0 ? `${i.openHours} ${i.openHours === 1 ? "hora abierta" : "horas abiertas"}` : null,
  ]
    .filter(Boolean)
    .join(" y ");
  const hasOpen = i.openOffers + i.openHours > 0;

  if (!i.visible) {
    return {
      state: "hidden",
      headline: "No apareces en el mapa de los profesionales",
      detail:
        "Tus ofertas siguen avisando a los profesionales cercanos, pero tu zona no se muestra en el mapa.",
      askLocation: false,
    };
  }
  if (!hasOpen) {
    return {
      state: "waiting",
      headline: "Aparecerás en el mapa cuando publiques",
      detail: i.hasLocation
        ? "Una oferta u horas abiertas en tu agenda te hacen visible en una zona aproximada (~1 km), sin tu dirección."
        : "Una oferta u horas abiertas te hacen visible. Guarda tu zona para que los profesionales cercanos te encuentren.",
      askLocation: !i.hasLocation,
    };
  }
  if (!i.hasLocation) {
    return {
      state: "no_location",
      headline: "Los profesionales aún no te ven en el mapa",
      detail: `Tienes ${open}, pero falta tu zona. Usa tu ubicación: solo se muestra una zona aproximada (~1 km), nunca tu dirección ni tu teléfono.`,
      askLocation: true,
    };
  }
  return {
    state: "visible",
    headline: "Los profesionales cercanos te ven en el mapa",
    detail: `Por tus ${open}. Ven una zona aproximada (~1 km): nunca tu dirección ni tu teléfono.`,
    askLocation: false,
  };
}
