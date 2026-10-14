// Ruta de cuidado — lógica pura, sin base de datos.
//
// Una familia no cuida «en general»: cuida a un adulto mayor, a un niño o una niña, a alguien que sale de una cirugía,
// a alguien que está enfermo o a alguien con una condición de largo plazo. Cada caso pide otro ritmo, otras preguntas
// para el médico y otro tono. Este módulo reconoce la ruta a partir de lo que la familia ya escribió en su agenda
// (`family_needs.care_type`, texto libre), calcula en qué etapa del episodio va y qué metas pequeñas de la semana ya
// se cumplieron según los partes del turno.
//
// Reglas de diseño (de la investigación en `docs/PANEL_FAMILIA_RUTAS_DE_CUIDADO.md`):
//  - NO diagnostica ni interpreta síntomas ni recomienda medicamentos o dosis. Solo reconoce, ordena y sugiere qué
//    comentar con el equipo médico. Las señales de alarma son texto fijo y siempre muestran el 123.
//  - En la ruta «enfermedad» el tono es sobrio: sin metas, sin celebraciones, sin rachas.
//  - Las metas nunca castigan: se muestra el avance («2 de 4»), jamás un fracaso.
//  - Los datos de un niño o niña son de una persona menor de edad (Ley 1581 de 2012): sin nombre ni cifras en lo que
//    la familia comparte (ver `weeklyLetter.ts`).

import { DAY_MS, bogotaYmd, msOf } from "./intelShared";

export const CARE_ROUTES = ["elder", "child", "postop", "illness", "chronic"] as const;
export type CareRoute = (typeof CARE_ROUTES)[number];

export type RouteTone = "warm" | "sober";

/** Lo que mide una meta: días distintos de la semana con este tipo de registro en el parte. */
export type GoalMetric = "meal" | "medication" | "activity" | "vitals" | "calm";

export interface RouteGoal {
  id: string;
  metric: GoalMetric;
  /** Días de la semana (de 7) que se buscan. */
  target: number;
  label: string;
  hint: string;
}

export interface RouteDef {
  id: CareRoute;
  label: string;
  /** Nombre del icono de lucide-react (el componente lo resuelve). */
  icon: "HeartHandshake" | "Baby" | "Stethoscope" | "HeartPulse" | "CalendarHeart";
  tagline: string;
  tone: RouteTone;
  goals: readonly RouteGoal[];
  /** Cosas que conviene mirar y comentar con el equipo médico (no son diagnósticos). */
  watch: readonly string[];
  /** Preguntas base para llevar a la cita. */
  visitQuestions: readonly string[];
  /** Señales para llamar al equipo médico el mismo día. Texto fijo: requiere revisión clínica antes de publicarse. */
  callSameDay: readonly string[];
}

/** Siempre visible junto a cualquier señal de alarma. */
export const EMERGENCY_LINE =
  "Si hay peligro para la vida (no respira bien, dolor fuerte de pecho, desmayo, sangrado que no para, convulsión), llama al 123 ya.";

export const ROUTE_DISCLAIMER =
  "Esta guía no diagnostica ni reemplaza la valoración médica: ordena lo que conviene observar y comentar con tu equipo de salud.";

export const ROUTES: Record<CareRoute, RouteDef> = {
  elder: {
    id: "elder",
    label: "Adulto mayor",
    icon: "HeartHandshake",
    tagline: "Que cada día tenga rutina, compañía y calma.",
    tone: "warm",
    goals: [
      {
        id: "elder_meals",
        metric: "meal",
        target: 5,
        label: "Comidas con calma",
        hint: "Comer a su ritmo y, si se puede, acompañado/a.",
      },
      {
        id: "elder_move",
        metric: "activity",
        target: 4,
        label: "Un rato de movimiento suave",
        hint: "Caminar por la casa o estirarse, según lo que indique su médico.",
      },
      {
        id: "elder_calm",
        metric: "calm",
        target: 4,
        label: "Días tranquilos o contentos",
        hint: "El ánimo que anota quien lo/la acompaña.",
      },
      {
        id: "elder_meds",
        metric: "medication",
        target: 5,
        label: "Medicamentos a su hora",
        hint: "Que cada toma quede registrada.",
      },
    ],
    watch: [
      "Cambios en el sueño, el apetito o el ánimo frente a lo habitual",
      "Caídas o casi caídas, aunque no haya golpe",
      "Confusión nueva o más marcada que de costumbre",
      "Pocos días con visitas o llamadas (la soledad también cuenta)",
    ],
    visitQuestions: [
      "¿Revisamos juntos todos los medicamentos, incluidos los de venta libre y los suplementos?",
      "¿Qué riesgos de caídas hay en la casa y cómo los reducimos?",
      "¿Qué cambios de ánimo, sueño o apetito son esperables y cuáles no?",
    ],
    callSameDay: [
      "Una caída con golpe en la cabeza o con dolor que no cede",
      "Confusión o somnolencia de aparición repentina",
      "Fiebre, o no ha comido ni bebido casi nada en el día",
    ],
  },
  child: {
    id: "child",
    label: "Niño o niña",
    icon: "Baby",
    tagline: "Rutinas tranquilas, juego y un adulto de confianza.",
    tone: "warm",
    goals: [
      {
        id: "child_meals",
        metric: "meal",
        target: 5,
        label: "Comidas sin afán",
        hint: "Horarios parecidos cada día ayudan a su ritmo.",
      },
      {
        id: "child_play",
        metric: "activity",
        target: 5,
        label: "Un rato de juego",
        hint: "Juego libre o una actividad que disfrute.",
      },
      {
        id: "child_calm",
        metric: "calm",
        target: 5,
        label: "Días tranquilos o contentos",
        hint: "El ánimo que anota quien lo/la acompaña.",
      },
    ],
    watch: [
      "Fiebre u otros síntomas: la plataforma no los interpreta, consulta al pediatra",
      "Cambios en la comida, el sueño o el ánimo",
      "Golpes o accidentes que queden anotados en el parte",
    ],
    visitQuestions: [
      "¿Qué señales de malestar o fiebre debemos vigilar y cuándo consultar sin esperar?",
      "¿Su crecimiento y sus hábitos van como se espera para su edad?",
      "¿Hay vacunas o controles pendientes?",
    ],
    callSameDay: [
      "Fiebre en un bebé pequeño, o fiebre que no cede o que viene con decaimiento",
      "Rechaza líquidos o casi no orina",
      "Llanto inconsolable, o está mucho más dormido/a o irritable de lo normal",
    ],
  },
  postop: {
    id: "postop",
    label: "Recuperación tras cirugía",
    icon: "Stethoscope",
    tagline: "Pasos pequeños cada día, y alguien atento a lo importante.",
    tone: "warm",
    goals: [
      {
        id: "postop_meds",
        metric: "medication",
        target: 7,
        label: "Medicación al día",
        hint: "Cada toma anotada, tal como la indicó el equipo de cirugía.",
      },
      {
        id: "postop_move",
        metric: "activity",
        target: 5,
        label: "Moverse un poco cada día",
        hint: "Solo lo que su equipo de cirugía haya permitido.",
      },
      {
        id: "postop_meals",
        metric: "meal",
        target: 6,
        label: "Comer e hidratarse",
        hint: "Comidas livianas y líquidos, según su indicación.",
      },
      {
        id: "postop_vitals",
        metric: "vitals",
        target: 4,
        label: "Controles registrados",
        hint: "Temperatura, pulso y presión cuando toque medirlos.",
      },
    ],
    watch: [
      "La herida: color, calor, secreción o apertura",
      "El dolor: si aumenta o ya no responde a lo indicado",
      "La temperatura y la respiración",
      "Una pierna hinchada, caliente o dolorosa",
    ],
    visitQuestions: [
      "¿Qué es normal y qué no en cada etapa de la recuperación?",
      "¿Cuándo puede empezar a moverse más, ducharse o retomar sus actividades?",
      "¿Cuándo se retiran puntos o vendajes y cuándo es el próximo control?",
    ],
    callSameDay: [
      "Fiebre, o escalofríos",
      "La herida se enrojece, se calienta, supura o se abre",
      "Dolor que aumenta o que no cede con lo indicado",
      "Una pierna hinchada, caliente o dolorosa",
    ],
  },
  illness: {
    id: "illness",
    label: "Enfermedad",
    icon: "HeartPulse",
    tagline: "Acompañar sin prisa, con la familia cerca.",
    tone: "sober",
    goals: [],
    watch: [
      "Lo que el equipo médico pidió vigilar, tal como lo explicó",
      "El dolor y el descanso",
      "El apetito y la energía a lo largo del día",
      "Cómo está quien cuida: también necesita pausas",
    ],
    visitQuestions: [
      "¿Qué señales deben llevarnos a llamar el mismo día?",
      "¿Qué esperamos en los próximos días y semanas?",
      "¿Cómo podemos aliviar mejor el dolor y las molestias?",
      "¿Qué apoyo hay para quien cuida?",
    ],
    callSameDay: [
      "Lo que el equipo médico dijo que no debía esperar",
      "Dolor que no se controla con lo indicado",
      "Fiebre, vómito persistente o no poder tomar líquidos",
    ],
  },
  chronic: {
    id: "chronic",
    label: "Condición crónica",
    icon: "CalendarHeart",
    tagline: "Hábitos amables que se sostienen con el tiempo.",
    tone: "warm",
    goals: [
      {
        id: "chronic_meds",
        metric: "medication",
        target: 6,
        label: "Medicación constante",
        hint: "Que las tomas queden registradas.",
      },
      {
        id: "chronic_vitals",
        metric: "vitals",
        target: 3,
        label: "Controles con calma",
        hint: "Las cifras que su médico pidió anotar (azúcar, tensión, respiración…).",
      },
      {
        id: "chronic_move",
        metric: "activity",
        target: 4,
        label: "Movimiento a su medida",
        hint: "Lo que su médico haya recomendado.",
      },
      {
        id: "chronic_calm",
        metric: "calm",
        target: 4,
        label: "Días tranquilos o contentos",
        hint: "El ánimo que anota quien lo/la acompaña.",
      },
    ],
    watch: [
      "Las cifras o síntomas que su médico pidió vigilar",
      "Cambios en la rutina de medicación (olvidos, rechazo, efectos molestos)",
      "El ánimo y el cansancio de la persona y de quien cuida",
    ],
    visitQuestions: [
      "¿Cómo van las metas del tratamiento y qué ajustamos?",
      "¿Qué cifras debemos anotar y con qué frecuencia?",
      "¿Qué hacemos en un día de descompensación y a quién llamamos?",
    ],
    callSameDay: [
      "Cifras fuera de los límites que su médico indicó",
      "Síntomas nuevos o que empeoran de un día para otro",
      "No puede tomar sus medicamentos (vómito, rechazo o se acabaron)",
    ],
  },
};

// ─── Reconocer la ruta a partir de la agenda ─────────────────────────────────

/** Minúsculas y sin tildes, para comparar texto escrito a mano. */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// El orden importa: lo que tiene un inicio y un final (cirugía) o una edad concreta (niñez) gana sobre lo general.
const ROUTE_PATTERNS: ReadonlyArray<readonly [CareRoute, RegExp]> = [
  [
    "postop",
    /postop|post-op|posoper|cirug|operacion|operad[oa]|cesarea|protesis|trasplante|amputacion|herida quirurgica/,
  ],
  ["child", /\bnin[oa]s?\b|pediatr|bebe|recien nacid|lactante|infantil|infancia|menor de edad/],
  [
    "chronic",
    /cronic|diabet|hipertens|presion alta|epoc|asma|insuficiencia (cardiaca|renal)|dialisis|parkinson|artrosis|artritis|alzheimer|demencia|epilepsia|glucosa/,
  ],
  [
    "illness",
    /cancer|oncolog|quimio|radioterapia|paliativ|terminal|infeccion|neumonia|covid|hospitaliz|enferm[oa]|enfermedad/,
  ],
  [
    "elder",
    /adultos? mayor|anciano|abuel[oa]|geriatr|tercera edad|vejez|persona mayor|adultos? mayores/,
  ],
];

/** Ruta que sugiere un texto libre, o `null` si no dice nada claro. */
export function routeFromText(text: string | null | undefined): CareRoute | null {
  if (!text) return null;
  const t = normalizeText(text);
  for (const [route, re] of ROUTE_PATTERNS) if (re.test(t)) return route;
  return null;
}

/** Rutas que sugieren los textos de la agenda, de la más frecuente a la menos (empate: orden de `CARE_ROUTES`). */
export function inferRoutes(careTypes: ReadonlyArray<string | null | undefined>): CareRoute[] {
  const counts = new Map<CareRoute, number>();
  for (const t of careTypes) {
    const r = routeFromText(t);
    if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || CARE_ROUTES.indexOf(a[0]) - CARE_ROUTES.indexOf(b[0]))
    .map(([r]) => r);
}

export function isCareRoute(v: unknown): v is CareRoute {
  return typeof v === "string" && (CARE_ROUTES as readonly string[]).includes(v);
}

/** La que la familia eligió, si es válida; si no, la más probable de la agenda; si no, ninguna. */
export function pickRoute(inferred: readonly CareRoute[], chosen?: unknown): CareRoute | null {
  if (isCareRoute(chosen)) return chosen;
  return inferred[0] ?? null;
}

// ─── Etapa del episodio de cuidado ───────────────────────────────────────────

/** Número de día calendario (hora de Colombia) de un instante: sirve para contar días entre dos fechas. */
export function bogotaDayIndex(t: number): number {
  const { y, m, d } = bogotaYmd(t);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export interface EpisodeBooking {
  status: string;
  scheduled_at: string;
}

/** Cuántos días sin servicio separan un episodio de otro. */
export const EPISODE_GAP_DAYS = 14;

/**
 * Cuántos días lleva el episodio de cuidado actual (el primer día es el 1), o `null` si no hay uno en curso: parte del
 * último día con servicio y retrocede mientras no haya más de 14 días de hueco. Cuentan los servicios terminados o en
 * curso; los futuros y los cancelados no.
 */
export function episodeDay(bookings: readonly EpisodeBooking[], now: number): number | null {
  const today = bogotaDayIndex(now);
  const days = [
    ...new Set(
      bookings
        .filter((b) => b.status === "completed" || b.status === "in_progress")
        .map((b) => msOf(b.scheduled_at))
        .filter((t) => Number.isFinite(t) && t <= now)
        .map(bogotaDayIndex),
    ),
  ].sort((a, b) => b - a);
  if (days.length === 0 || today - days[0] > EPISODE_GAP_DAYS) return null;
  let start = days[0];
  for (let i = 1; i < days.length; i++) {
    if (start - days[i] > EPISODE_GAP_DAYS) break;
    start = days[i];
  }
  return today - start + 1;
}

export interface JourneyStage {
  /** Posición (desde 0) en `total` etapas. */
  index: number;
  total: number;
  label: string;
  note: string;
}

const POSTOP_STAGES: ReadonlyArray<{ upTo: number; label: string; note: string }> = [
  { upTo: 3, label: "Primeros días", note: "Descanso, dolor controlado y atención a la herida." },
  { upTo: 14, label: "Primeras dos semanas", note: "Se va ganando movimiento, paso a paso." },
  {
    upTo: 42,
    label: "Recuperación",
    note: "Más autonomía, con controles y fisioterapia si la pidieron.",
  },
  { upTo: Infinity, label: "Seguimiento", note: "Ya es rutina; los controles marcan el ritmo." },
];

const GENERIC_STAGES: ReadonlyArray<{ upTo: number; label: string; note: string }> = [
  { upTo: 7, label: "Primera semana", note: "Conocerse y armar la rutina." },
  { upTo: 30, label: "Primer mes", note: "La rutina se afianza." },
  {
    upTo: Infinity,
    label: "Ya es parte del día a día",
    note: "Lo importante es sostenerlo con calma.",
  },
];

export const POSTOP_STAGE_NOTE =
  "Es una guía general: tu equipo de cirugía marca los tiempos reales.";

/** Etapa que corresponde a `day` (1 = primer día del episodio). */
export function journeyStage(route: CareRoute, day: number): JourneyStage {
  const stages = route === "postop" ? POSTOP_STAGES : GENERIC_STAGES;
  const d = Math.max(1, Math.floor(day));
  const i = stages.findIndex((s) => d <= s.upTo);
  const s = stages[i === -1 ? stages.length - 1 : i];
  return {
    index: i === -1 ? stages.length - 1 : i,
    total: stages.length,
    label: s.label,
    note: route === "postop" ? `${s.note} ${POSTOP_STAGE_NOTE}` : s.note,
  };
}

// ─── Metas pequeñas de la semana ─────────────────────────────────────────────

export interface JourneyLog {
  event_type: string;
  mood?: string | null;
  created_at: string;
  system_generated?: boolean | null;
}

export interface GoalProgress {
  id: string;
  label: string;
  hint: string;
  /** Días distintos de los últimos 7 que cumplen la meta. */
  days: number;
  target: number;
  met: boolean;
}

/** Días (hora de Colombia) de los últimos 7, contando hoy. */
export const GOAL_WINDOW_DAYS = 7;

function matches(metric: GoalMetric, log: JourneyLog): boolean {
  switch (metric) {
    case "meal":
      return log.event_type === "meal";
    case "medication":
      return log.event_type === "medication";
    case "activity":
      return log.event_type === "activity";
    case "vitals":
      return log.event_type === "vital_signs";
    case "calm":
      return log.mood === "happy" || log.mood === "calm";
  }
}

/**
 * Avance de las metas de la semana según los partes. Los registros que genera el sistema (llegada, salida) no cuentan:
 * una meta es algo que hizo una persona. Una ruta sin metas (enfermedad) devuelve una lista vacía.
 */
export function goalProgress(
  route: CareRoute,
  logs: readonly JourneyLog[],
  now: number,
): GoalProgress[] {
  const today = bogotaDayIndex(now);
  const recent = logs.filter((l) => {
    if (l.system_generated) return false;
    const t = msOf(l.created_at);
    if (!Number.isFinite(t) || t > now) return false;
    const age = today - bogotaDayIndex(t);
    return age >= 0 && age < GOAL_WINDOW_DAYS;
  });
  return ROUTES[route].goals.map((g) => {
    const days = new Set(
      recent.filter((l) => matches(g.metric, l)).map((l) => bogotaDayIndex(msOf(l.created_at))),
    ).size;
    return {
      id: g.id,
      label: g.label,
      hint: g.hint,
      days: Math.min(days, GOAL_WINDOW_DAYS),
      target: g.target,
      met: days >= g.target,
    };
  });
}

/** «2 de 4 días» (nunca «te faltan»: la meta anima, no regaña). */
export function goalLine(g: Pick<GoalProgress, "days" | "target">): string {
  return `${Math.min(g.days, g.target)} de ${g.target} días`;
}
