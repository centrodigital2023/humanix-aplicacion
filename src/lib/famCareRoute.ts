// La ruta de cuidado de cada persona: en qué momento va, qué conviene hoy y cuánto lleva preparado. Puro.
//
// Las fases son una forma de ordenar el acompañamiento, no un protocolo clínico: cada cirugía y cada enfermedad es
// distinta y manda lo que indique el equipo médico (lo repiten los textos). Los «cuatro pilares» (medicinas, carpeta,
// citas y señales de alarma) siguen el modelo de transición de cuidado de Coleman, que en un ensayo con 750 adultos
// mayores redujo los reingresos al hospital; esta pantalla solo da la estructura, no el acompañamiento de un coach.
import {
  ITEMS_BY_KIND,
  KIND_META,
  PILLAR_KINDS,
  PREP_ITEMS,
  type FamKind,
  type PrepItem,
} from "./famCareTypes";
import {
  dayIndex,
  dayKeyOf,
  daysBetween,
  isDayKey,
  keyFromIndex,
  type DayKey,
  type DaySummary,
} from "./famCareDays";
import { plural } from "./intelShared";

export interface RouteRecipient {
  kind: FamKind;
  event_on: string | null;
  event_label: string | null;
  prep_done: readonly string[] | null;
  created_at: string;
}

/** Días desde la cirugía o el inicio de la enfermedad (negativo si todavía no llega); `null` si no aplica o no hay fecha. */
export function routeDay(
  r: Pick<RouteRecipient, "kind" | "event_on">,
  today: DayKey,
): number | null {
  if (r.kind !== "surgery" && r.kind !== "illness") return null;
  if (!r.event_on || !isDayKey(r.event_on)) return null;
  const d = daysBetween(r.event_on, today);
  // Una enfermedad no empieza en el futuro: si la fecha aún no llega, no hay día de ruta.
  if (r.kind === "illness" && d < 0) return null;
  return d;
}

export interface Phase {
  id: string;
  label: string;
  detail: string;
}

export function routePhase(kind: FamKind, day: number | null): Phase | null {
  if (day === null) return null;
  if (kind === "surgery") {
    if (day < 0)
      return {
        id: "pre",
        label: `Faltan ${plural(-day, "día", "días")} para la cirugía`,
        detail: "Prepárate con calma: la lista de preparación y el acompañante son lo primero.",
      };
    if (day === 0)
      return {
        id: "day0",
        label: "Día de la cirugía",
        detail: "Hoy lo más importante es acompañar y seguir las indicaciones del equipo médico.",
      };
    if (day <= 3)
      return {
        id: "first",
        label: `Primeros días · día ${day}`,
        detail: "Descanso, medicinas a tiempo y atención a las señales de alarma.",
      };
    if (day <= 14)
      return {
        id: "early",
        label: `Recuperación temprana · día ${day}`,
        detail: "Movimiento suave, dentro de lo que indique su cirujano.",
      };
    if (day <= 42)
      return {
        id: "recovery",
        label: `Recuperación · día ${day}`,
        detail: "Cada día un poco más: celebra las pequeñas victorias.",
      };
    return {
      id: "back",
      label: `Retomando la rutina · día ${day}`,
      detail: "Sigue los controles que le haya indicado su médico.",
    };
  }
  if (kind === "illness") {
    if (day <= 2)
      return {
        id: "start",
        label: `Primeros días · día ${day + 1}`,
        detail: "Descanso, líquidos y atención a las señales de alarma.",
      };
    if (day <= 7)
      return {
        id: "mid",
        label: `Día ${day + 1} del episodio`,
        detail: "Si no mejora o empeora, consulta.",
      };
    return {
      id: "long",
      label: `Día ${day + 1} del episodio`,
      detail: "Si todavía no mejora, comenta con su médico cómo seguir.",
    };
  }
  return null;
}

/** Línea corta bajo el nombre de la persona. */
export function journeyLine(r: RouteRecipient, litDays: number, today: DayKey): string {
  const phase = routePhase(r.kind, routeDay(r, today));
  if (phase) return phase.label;
  return litDays === 0 ? "Empieza hoy" : plural(litDays, "día de cuidado", "días de cuidado");
}

// ── Consejo del día ──────────────────────────────────────────────────────────

const TIPS: Record<FamKind, readonly string[]> = {
  elder: [
    "Una llamada o una visita de diez minutos vale más que cualquier regalo.",
    "Pídele que te cuente un recuerdo: conversar sobre la vida suele ser un buen rato juntos.",
    "Revisa que tenga agua cerca y que beba durante el día.",
    "Un rato al aire libre, si puede, suele hacer bien al ánimo.",
    "Pregúntale cómo durmió: dormir mal varios días merece comentarlo con su médico.",
    "Revisa el paso por la casa: un tapete suelto o poca luz son las causas más fáciles de arreglar.",
  ],
  child: [
    "Un rato de juego con tu atención completa fortalece el vínculo.",
    "Lavarse las manos antes de comer ayuda a evitar muchas infecciones.",
    "Dormir a horas regulares ayuda a su crecimiento y a su ánimo.",
    "Revisa que el carné de vacunación esté al día; si tienes dudas, pregunta en tu EPS.",
    "Hablar con calma de lo que siente le enseña a ponerle nombre a sus emociones.",
  ],
  chronic: [
    "La constancia vale más que la perfección: un día difícil no borra los demás.",
    "Anotar hoy su número ayuda: con varios días juntos, el médico decide mejor.",
    "Si las medicinas se acaban pronto, renueva la fórmula antes de quedarte sin ellas.",
    "Una caminata corta, si su médico lo permite, también cuenta.",
    "Celebra lo que salió bien esta semana, aunque sea pequeño.",
  ],
  illness: [
    "Que tome líquidos en sorbos pequeños durante el día.",
    "Anota la temperatura a la misma hora para ver cómo va.",
    "Hoy no hace falta que haga nada más que descansar.",
    "Si algo te preocupa, anótalo: sirve para contárselo al médico.",
  ],
  surgery: [
    "Anota la hora de cada medicina para no olvidar ninguna.",
    "Revisa la herida cada día: enrojecimiento, calor o secreción se consultan.",
    "Moverse un poco, como indique su cirujano, ayuda a recuperarse.",
    "Pregunta al equipo médico cualquier duda: es mejor preguntar que adivinar.",
    "Celebra cada paso, por pequeño que sea.",
  ],
};

const PHASE_TIPS: Record<string, readonly string[]> = {
  pre: [
    "Confirma con quién irán al hospital y cómo regresarán a casa.",
    "Pregunta al equipo médico qué medicinas debe suspender o seguir antes de la cirugía.",
    "Prepara en casa un lugar cómodo y despejado para la recuperación.",
  ],
  day0: [
    "Lleva los documentos, las órdenes y el carné de la EPS.",
    "Después de la cirugía, pregunta qué señales de alarma vigilar en casa.",
  ],
  first: [
    "Anota la hora de cada medicina para no olvidar ninguna.",
    "Vigila la herida cada día: enrojecimiento, calor o secreción se consultan.",
    "Que descanse, y que se mueva solo como indique su cirujano.",
  ],
};

/** Un consejo para hoy: cambia cada día, pero para un mismo día y una misma persona es siempre el mismo. */
export function tipOf(kind: FamKind, phaseId: string | null, today: DayKey): string {
  const list = (phaseId && PHASE_TIPS[phaseId]) || TIPS[kind];
  const i = ((dayIndex(today) % list.length) + list.length) % list.length;
  return list[i];
}

// ── Lista de preparación y cuatro pilares ───────────────────────────────────

export interface PrepProgress {
  done: number;
  total: number;
  /** 0–100 */
  pct: number;
  items: Array<PrepItem & { done: boolean }>;
}

export function prepProgress(
  kind: FamKind,
  doneKeys: readonly string[] | null | undefined,
): PrepProgress {
  const done = new Set(doneKeys ?? []);
  const items = PREP_ITEMS[kind].map((it) => ({ ...it, done: done.has(it.key) }));
  const n = items.filter((i) => i.done).length;
  return {
    done: n,
    total: items.length,
    pct: items.length ? Math.round((n / items.length) * 100) : 0,
    items,
  };
}

export type PillarId = "meds" | "folder" | "followup" | "signs";

export interface Pillar {
  id: PillarId;
  label: string;
  hint: string;
  ok: boolean;
}

export interface PillarStep {
  due_on: string;
  done_at: string | null;
}

/** Cuántos días hacia adelante cuenta una cita como «agendada». */
export const FOLLOWUP_DAYS = 30;

/** Los cuatro pilares de la transición de cuidado; `null` para los tipos que no los usan. */
export function pillarsOf(input: {
  kind: FamKind;
  prepDone: readonly string[] | null | undefined;
  summaries: ReadonlyMap<DayKey, DaySummary>;
  steps: readonly PillarStep[];
  today: DayKey;
}): Pillar[] | null {
  if (!PILLAR_KINDS.includes(input.kind)) return null;
  const prep = new Set<string>(input.prepDone ?? []);
  const t = dayIndex(input.today);

  // Medicinas: la lista está lista, o en las últimas tomas anotadas casi siempre quedó marcada.
  const hasMedsItem = ITEMS_BY_KIND[input.kind].includes("meds");
  const lastDays: DaySummary[] = [];
  for (let i = 0; i < 5 && lastDays.length < 3; i++) {
    const d = input.summaries.get(keyFromIndex(t - i));
    if (d) lastDays.push(d);
  }
  const medsRoutine =
    hasMedsItem &&
    lastDays.length >= 2 &&
    lastDays.filter((d) => d.items.includes("meds")).length >= 2;

  const followup = input.steps.some((s) => {
    if (s.done_at || !isDayKey(s.due_on)) return false;
    const d = dayIndex(s.due_on) - t;
    return d >= 0 && d <= FOLLOWUP_DAYS;
  });

  return [
    {
      id: "meds",
      label: "Medicinas",
      hint: "La lista y el horario, y que se tomen",
      ok: prep.has("meds_list") || medsRoutine,
    },
    {
      id: "folder",
      label: "Carpeta",
      hint: "Documentos, órdenes y teléfonos del médico",
      ok: prep.has("docs"),
    },
    {
      id: "followup",
      label: "Citas",
      hint: "El próximo control, agendado",
      ok: followup || prep.has("followup"),
    },
    { id: "signs", label: "Señales", hint: "Cuándo consultar sin esperar", ok: prep.has("signs") },
  ];
}

/** Fecha de la ruta para mostrarla: «Cirugía de cadera · hace 5 días». */
export function eventLine(
  r: Pick<RouteRecipient, "kind" | "event_on" | "event_label">,
  now: number,
): string | null {
  if (!r.event_on || !isDayKey(r.event_on)) return null;
  const label = (r.event_label ?? "").trim() || KIND_META[r.kind].label;
  const d = daysBetween(r.event_on, dayKeyOf(now));
  const when =
    d === 0
      ? "hoy"
      : d > 0
        ? `hace ${plural(d, "día", "días")}`
        : `en ${plural(-d, "día", "días")}`;
  return `${label} · ${when}`;
}
