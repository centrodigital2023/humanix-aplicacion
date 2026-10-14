// «Casa lista» — lógica pura, sin base de datos.
//
// Cuando alguien vuelve a casa (tras una cirugía, una enfermedad, o cuando un adulto mayor o un niño necesita más
// cuidado) la familia suele descubrir lo que falta a las 10 de la noche. Esta lista ordena lo PRÁCTICO por ruta:
// la casa, lo que conviene tener a la mano, los papeles y las personas.
//
// Reglas:
//  - Solo organización y logística. Nada clínico: ni medicamentos, ni dosis, ni cuidados médicos. Para eso están las
//    instrucciones de alta y el equipo de salud.
//  - Se muestra avance («7 de 12»), nunca pendientes en rojo ni plazos.
//  - La lista es una guía general, no sustituye las indicaciones del equipo médico (requiere revisión clínica
//    antes de publicarse).

import { CARE_ROUTES, type CareRoute } from "./careJourney";

export type HomeGroup = "house" | "supplies" | "papers" | "people";

export const HOME_GROUP_LABEL: Record<HomeGroup, string> = {
  house: "La casa",
  supplies: "A la mano",
  papers: "Papeles",
  people: "Las personas",
};

export interface HomeItem {
  id: string;
  group: HomeGroup;
  label: string;
}

const it = (id: string, group: HomeGroup, label: string): HomeItem => ({ id, group, label });

export const HOME_ITEMS: Record<CareRoute, readonly HomeItem[]> = {
  elder: [
    it("elder-paths", "house", "Caminos despejados: sin tapetes sueltos ni cables en el piso"),
    it("elder-light", "house", "Luz de noche entre la cama y el baño"),
    it("elder-bath", "house", "Apoyo firme en la ducha y el baño"),
    it("elder-daily", "supplies", "Lo que usa a diario, a la altura de la mano"),
    it("elder-glasses", "supplies", "Gafas, audífonos y bastón siempre en el mismo lugar"),
    it("elder-phones", "papers", "Teléfonos importantes en un papel grande, a la vista"),
    it("elder-docs", "papers", "Copia de documentos, fórmulas e informes en una carpeta"),
    it("elder-back", "people", "Quién visita o llama cada día, hablado en familia"),
    it("elder-backup", "people", "Un plan B si la persona que cuida no puede ir"),
  ],
  child: [
    it("child-safe", "house", "Objetos peligrosos y productos de limpieza fuera del alcance"),
    it("child-rest", "house", "Un rincón tranquilo para descansar y jugar con calma"),
    it("child-comfort", "supplies", "Su objeto de consuelo y sus cosas favoritas cerca"),
    it("child-routine", "supplies", "Horarios de comida y sueño escritos para quien lo cuide"),
    it("child-phones", "papers", "Teléfonos del pediatra, el colegio y la familia a la vista"),
    it("child-docs", "papers", "Carné de vacunación y documentos en una carpeta"),
    it("child-adult", "people", "Quién lo cuida cuando el cuidador principal descansa"),
    it("child-school", "people", "Aviso al colegio o jardín y cómo se mantendrán en contacto"),
  ],
  postop: [
    it("postop-bed", "house", "Cama o sillón a una altura cómoda para sentarse y levantarse"),
    it("postop-path", "house", "Camino libre hasta el baño, con buena luz"),
    it("postop-daily", "supplies", "Lo de uso diario al alcance, sin tener que estirarse"),
    it("postop-food", "supplies", "Comida lista o fácil de preparar para los primeros días"),
    it("postop-discharge", "papers", "Las instrucciones de alta por escrito, en un lugar visible"),
    it("postop-phones", "papers", "Teléfono del equipo médico y de la clínica a la vista"),
    it("postop-appt", "papers", "Cita de control agendada y quién la acompaña"),
    it("postop-ride", "people", "Quién lleva y recoge en los controles"),
    it("postop-night", "people", "Quién acompaña las primeras noches"),
  ],
  illness: [
    it("ill-rest", "house", "Un espacio tranquilo y cómodo para descansar"),
    it("ill-air", "house", "Ropa de cama limpia y un cuarto fácil de ventilar"),
    it("ill-daily", "supplies", "Agua, pañuelos y lo de uso diario al alcance"),
    it("ill-food", "supplies", "Comidas sencillas que le gusten, listas o fáciles de hacer"),
    it("ill-phones", "papers", "Teléfonos del equipo médico a la vista"),
    it("ill-docs", "papers", "Órdenes e informes en una sola carpeta"),
    it("ill-news", "people", "Quién avisa a la familia, para no repetir la misma noticia"),
    it("ill-help", "people", "Quién puede ayudar con diligencias, mercado y turnos"),
  ],
  chronic: [
    it("chr-spot", "house", "Un lugar fijo para lo del día a día"),
    it("chr-clear", "house", "Espacios y caminos despejados"),
    it("chr-notebook", "supplies", "Un cuaderno para los registros que pida el equipo médico"),
    it("chr-organizer", "supplies", "Un organizador para tener todo en orden"),
    it("chr-appts", "papers", "Controles agendados en un calendario que todos vean"),
    it("chr-docs", "papers", "Informes y fórmulas recientes en una carpeta"),
    it("chr-phones", "papers", "Teléfonos del equipo médico a la vista"),
    it("chr-team", "people", "Quién conoce la rutina y puede reemplazar al cuidador principal"),
    it("chr-rest", "people", "Un día de descanso para quien cuida, acordado en familia"),
  ],
};

export const HOME_READY_DISCLAIMER =
  "Es una guía de organización. Para todo lo médico, sigue las indicaciones de tu equipo de salud.";

export interface HomeProgress {
  done: number;
  total: number;
  pct: number;
  complete: boolean;
  line: string;
}

/** Deja solo ids que existen en la ruta, sin repetidos; tolera cualquier cosa guardada en el navegador. */
export function sanitizeDone(route: CareRoute, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set(HOME_ITEMS[route].map((i) => i.id));
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && valid.has(x)))];
}

export function homeProgress(route: CareRoute, doneIds: readonly string[]): HomeProgress {
  const total = HOME_ITEMS[route].length;
  const done = sanitizeDone(route, doneIds).length;
  const complete = done === total;
  const line = complete
    ? "La casa está lista. Se nota el cariño."
    : done === 0
      ? "Marca lo que ya tienes: no hace falta hacerlo todo hoy."
      : `${done} de ${total}. Vas bien: lo que falta se puede repartir.`;
  return { done, total, pct: Math.round((done / total) * 100), complete, line };
}

/** Alterna un id; ignora los que no son de la ruta. */
export function toggleDone(route: CareRoute, doneIds: readonly string[], id: string): string[] {
  const current = sanitizeDone(route, doneIds);
  if (!HOME_ITEMS[route].some((i) => i.id === id)) return current;
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

/** Lo que falta, agrupado en el orden de la lista (para repartirlo con el círculo). */
export function pendingItems(route: CareRoute, doneIds: readonly string[]): HomeItem[] {
  const done = new Set(sanitizeDone(route, doneIds));
  return HOME_ITEMS[route].filter((i) => !done.has(i.id));
}

export const HOME_ROUTES: readonly CareRoute[] = CARE_ROUTES;
