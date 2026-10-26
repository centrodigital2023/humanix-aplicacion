// Vocabulario compartido de «Cuidar en familia»: la ruta de cuidado de cada persona querida (adulto mayor, niño o niña,
// cirugía, enfermedad, condición crónica). Puro: sin red ni pantalla.
//
// Las listas cerradas, los topes de texto y los límites por plan de este archivo son la fuente para la migración de
// «Cuidar en familia» (aún pendiente): cuando exista, sus CHECK y sus límites deben decir lo mismo que aquí, con una
// prueba que lo compruebe. Si cambias algo aquí, cambia también la migración (y al revés).
//
// Ninguna regla de este módulo diagnostica ni receta: son anotaciones de la familia y avisos de cuándo conviene consultar.

// ── Quién es la persona cuidada ───────────────────────────────────────────────

export const FAM_KINDS = ["elder", "child", "surgery", "illness", "chronic"] as const;
export type FamKind = (typeof FAM_KINDS)[number];

export const FAM_ACCENTS = ["copper", "biosensor", "fuchsia", "trust", "ok"] as const;
export type FamAccent = (typeof FAM_ACCENTS)[number];

export interface KindMeta {
  label: string;
  /** Una frase para la tarjeta de bienvenida. */
  blurb: string;
  accent: FamAccent;
  /** Texto del campo de fecha de la ruta; `null` si ese tipo no usa fecha. */
  dateLabel: string | null;
  /** Texto del campo «¿qué fue?» (cirugía o enfermedad); `null` si no aplica. */
  eventLabel: string | null;
  /** Pregunta que se hace al crear la ruta de este tipo. */
  welcome: string;
}

export const KIND_META: Record<FamKind, KindMeta> = {
  elder: {
    label: "Adulto mayor",
    blurb: "Compañía, autonomía y tranquilidad en casa",
    accent: "copper",
    dateLabel: null,
    eventLabel: null,
    welcome: "¿A quién acompañas?",
  },
  child: {
    label: "Niño o niña",
    blurb: "Crecer sano, protegido y acompañado",
    accent: "biosensor",
    dateLabel: null,
    eventLabel: null,
    welcome: "¿A quién cuidas?",
  },
  surgery: {
    label: "Cirugía",
    blurb: "Antes y después: un paso a la vez hacia la recuperación",
    accent: "trust",
    dateLabel: "Fecha de la cirugía",
    eventLabel: "¿Qué cirugía?",
    welcome: "¿Quién se va a operar o se está recuperando?",
  },
  illness: {
    label: "Enfermedad",
    blurb: "Un episodio de enfermedad, cuidado día a día",
    accent: "fuchsia",
    dateLabel: "¿Desde cuándo está enfermo?",
    eventLabel: "¿Qué tiene?",
    welcome: "¿Quién está enfermo?",
  },
  chronic: {
    label: "Condición crónica",
    blurb: "Constancia amable: medicinas, números y rutina",
    accent: "ok",
    dateLabel: null,
    eventLabel: null,
    welcome: "¿Quién vive con una condición crónica?",
  },
};

/** Parentescos que se ofrecen como atajo (el campo es libre). */
export const RELATION_SUGGESTIONS = [
  "mamá",
  "papá",
  "abuela",
  "abuelo",
  "hijo",
  "hija",
  "esposo",
  "esposa",
  "hermano",
  "hermana",
  "tía",
  "tío",
] as const;

/** Etiquetas de condiciones que la familia puede marcar (ayudan a ordenar la ruta; no son un diagnóstico). */
export const CONDITION_SUGGESTIONS = [
  "Diabetes",
  "Hipertensión",
  "Corazón",
  "EPOC o asma",
  "Demencia o Alzheimer",
  "Párkinson",
  "Cáncer",
  "Riñón",
  "Movilidad reducida",
  "Oxígeno en casa",
] as const;

// ── El ritual de hoy ─────────────────────────────────────────────────────────

export const FAM_MOODS = [1, 2, 3, 4, 5] as const;
export type FamMood = (typeof FAM_MOODS)[number];

export const MOOD_LABEL: Record<FamMood, string> = {
  1: "Muy mal",
  2: "Mal",
  3: "Así así",
  4: "Bien",
  5: "Muy bien",
};

/** «Hoy hubo un buen día»: ánimo 4 o 5. */
export const GOOD_MOOD = 4;
/** «Un día difícil»: ánimo 1 o 2. */
export const LOW_MOOD = 2;

export const ITEM_KEYS = [
  "meds",
  "food",
  "water",
  "move",
  "sleep",
  "company",
  "play",
  "nofever",
  "wound",
  "pain_ok",
  "fluids",
  "rest",
  "measure",
  "diet",
] as const;
export type ItemKey = (typeof ITEM_KEYS)[number];

export const ITEM_LABEL: Record<ItemKey, string> = {
  meds: "Tomó sus medicinas",
  food: "Comió bien",
  water: "Tomó suficiente agua",
  move: "Se movió o caminó",
  sleep: "Descansó bien",
  company: "Tuvo compañía",
  play: "Estuvo con ganas de jugar",
  nofever: "Sin fiebre",
  wound: "Revisé la herida",
  pain_ok: "Dolor controlado",
  fluids: "Tomó líquidos",
  rest: "Pudo descansar",
  measure: "Se midió hoy",
  diet: "Comió según su plan",
};

/** Qué se pregunta en el ritual de cada tipo (en este orden). */
export const ITEMS_BY_KIND: Record<FamKind, readonly ItemKey[]> = {
  elder: ["meds", "food", "water", "move", "sleep", "company"],
  child: ["food", "sleep", "play", "nofever", "meds"],
  surgery: ["meds", "move", "wound", "pain_ok", "food"],
  illness: ["meds", "fluids", "rest", "nofever", "food"],
  chronic: ["meds", "measure", "diet", "move", "sleep"],
};

// ── Señales: lo que preocupa ─────────────────────────────────────────────────

export const SIGNAL_KEYS = [
  "breathing",
  "chest_pain",
  "stroke",
  "seizure",
  "unresponsive",
  "bleeding",
  "wound_infection",
  "leg_clot",
  "no_drink",
  "vomit_all",
  "confused",
  "fever",
  "fall",
  "pain",
  "no_appetite",
  "bad_sleep",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

/**
 * emergency: buscar atención médica ya · urgent: que lo vea un médico hoy · watch: anotar y comentar con su médico.
 * Es una guía para la familia, no un diagnóstico (la lógica está en `famCareSignals.ts`).
 */
export type SignalLevel = "emergency" | "urgent" | "watch";

export const SIGNAL_LABEL: Record<SignalKey, string> = {
  breathing: "Le cuesta respirar",
  chest_pain: "Dolor en el pecho",
  stroke: "Cara caída, brazo débil o habla enredada",
  seizure: "Convulsión",
  unresponsive: "Muy dormido o no responde como siempre",
  bleeding: "Sangrado que no para",
  wound_infection: "Herida roja, caliente o con secreción",
  leg_clot: "Pierna hinchada, caliente o con dolor",
  no_drink: "No puede beber ni recibir pecho",
  vomit_all: "Vomita todo lo que come o bebe",
  confused: "Confundido o diferente a lo normal",
  fever: "Fiebre",
  fall: "Se cayó",
  pain: "Dolor fuerte",
  no_appetite: "Casi no comió",
  bad_sleep: "No pudo dormir",
};

/** Qué señales se ofrecen a cada tipo (las más habituales primero). */
export const SIGNALS_BY_KIND: Record<FamKind, readonly SignalKey[]> = {
  elder: [
    "fall",
    "confused",
    "pain",
    "fever",
    "no_appetite",
    "bad_sleep",
    "breathing",
    "chest_pain",
    "stroke",
    "bleeding",
    "unresponsive",
  ],
  child: [
    "fever",
    "no_appetite",
    "vomit_all",
    "no_drink",
    "bad_sleep",
    "pain",
    "breathing",
    "seizure",
    "unresponsive",
    "bleeding",
  ],
  surgery: [
    "pain",
    "fever",
    "wound_infection",
    "leg_clot",
    "vomit_all",
    "no_appetite",
    "breathing",
    "chest_pain",
    "bleeding",
    "unresponsive",
    "confused",
    "fall",
  ],
  illness: [
    "fever",
    "no_appetite",
    "vomit_all",
    "pain",
    "bad_sleep",
    "confused",
    "breathing",
    "chest_pain",
    "seizure",
    "unresponsive",
  ],
  chronic: [
    "pain",
    "confused",
    "fall",
    "no_appetite",
    "bad_sleep",
    "fever",
    "breathing",
    "chest_pain",
    "stroke",
    "unresponsive",
    "bleeding",
  ],
};

/** Señales que la base de datos avisa al círculo en el momento (las demás quedan en el diario). */
export const NOTIFY_SIGNALS: readonly SignalKey[] = [
  "breathing",
  "chest_pain",
  "stroke",
  "seizure",
  "unresponsive",
  "bleeding",
  "wound_infection",
  "leg_clot",
  "no_drink",
  "vomit_all",
  "confused",
];

// ── Listas de preparación («cuatro pilares») ─────────────────────────────────

export const PREP_KEYS = [
  "rugs",
  "light",
  "bath",
  "shoes",
  "reach",
  "phone",
  "meds_list",
  "vision",
  "card",
  "phones",
  "thermo",
  "meds_safe",
  "signs",
  "eps",
  "docs",
  "fasting",
  "ride",
  "home",
  "followup",
  "fluids_ready",
  "device",
  "targets",
  "refill",
] as const;
export type PrepKey = (typeof PREP_KEYS)[number];

export interface PrepItem {
  key: PrepKey;
  label: string;
}

/**
 * Lista de preparación de cada tipo. Para adulto mayor está inspirada en «Check for Safety» de los CDC (casa segura para
 * evitar caídas); para cirugía, enfermedad y crónico, en los cuatro pilares del modelo de transición de cuidado de Coleman
 * (medicinas, carpeta, citas y señales de alarma). Son ayudas de organización, no indicaciones médicas.
 */
export const PREP_ITEMS: Record<FamKind, readonly PrepItem[]> = {
  elder: [
    { key: "rugs", label: "Sin tapetes sueltos ni cables en el paso" },
    { key: "light", label: "Buena luz en pasillos, baño y escaleras" },
    { key: "bath", label: "Baño seguro: tapete antideslizante y apoyos si hacen falta" },
    { key: "shoes", label: "Zapatos firmes y antideslizantes" },
    { key: "reach", label: "Lo que más usa, al alcance (sin subirse a sillas)" },
    { key: "phone", label: "Teléfono y números de emergencia a la mano" },
    { key: "meds_list", label: "Lista de medicinas al día" },
    { key: "vision", label: "Revisión de la vista y de los lentes al día" },
  ],
  child: [
    { key: "card", label: "Carné de vacunación a la mano" },
    { key: "phones", label: "Teléfonos de emergencia visibles" },
    { key: "thermo", label: "Termómetro en casa" },
    { key: "meds_safe", label: "Medicinas y químicos fuera de su alcance" },
    { key: "signs", label: "Conozco las señales de alarma" },
    { key: "eps", label: "Datos de la EPS y del pediatra a la mano" },
  ],
  surgery: [
    { key: "docs", label: "Documentos, órdenes y carné de la EPS listos" },
    {
      key: "fasting",
      label: "Entiendo las indicaciones de ayuno y de medicinas que dio su médico",
    },
    { key: "ride", label: "Acompañante y traslado confirmados" },
    { key: "home", label: "Cama y espacio en casa preparados" },
    { key: "meds_list", label: "Lista de medicinas al día" },
    { key: "followup", label: "Cita de control agendada" },
    { key: "signs", label: "Conozco las señales de alarma" },
  ],
  illness: [
    { key: "meds_list", label: "Medicinas organizadas y con su horario" },
    { key: "thermo", label: "Termómetro en casa" },
    { key: "fluids_ready", label: "Líquidos y comida suave a la mano" },
    { key: "docs", label: "Carpeta lista: documentos, órdenes y teléfonos del médico" },
    { key: "followup", label: "Cita de control agendada" },
    { key: "signs", label: "Conozco las señales de alarma" },
  ],
  chronic: [
    { key: "meds_list", label: "Lista de medicinas al día" },
    { key: "device", label: "Tensiómetro o glucómetro funcionando" },
    { key: "targets", label: "Metas del médico anotadas" },
    { key: "docs", label: "Carpeta lista: documentos, órdenes y teléfonos del médico" },
    { key: "followup", label: "Cita de control agendada" },
    { key: "refill", label: "Fórmula vigente: no se acaban las medicinas" },
    { key: "signs", label: "Sé cuándo consultar (lo pregunté al médico)" },
  ],
};

/** Los cuatro pilares se muestran en los tipos con tránsito o manejo continuo. */
export const PILLAR_KINDS: readonly FamKind[] = ["surgery", "illness", "chronic"];

// ── Próximos pasos, números, manos y recuerdos ───────────────────────────────

export const STEP_KINDS = ["appointment", "vaccine", "exam", "refill", "other"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_LABEL: Record<StepKind, string> = {
  appointment: "Cita médica",
  vaccine: "Vacuna",
  exam: "Examen",
  refill: "Renovar fórmula",
  other: "Otro pendiente",
};

export const MEASURE_KINDS = ["glucose", "bp", "weight", "temp", "spo2", "hr", "pain"] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];

export interface MeasureMeta {
  label: string;
  unit: string;
  /** Límites de lo que se acepta como lectura posible (no son metas de salud). */
  min: number;
  max: number;
  /** Segundo valor (solo presión: diastólica). */
  min2?: number;
  max2?: number;
  decimals: 0 | 1;
}

export const MEASURE_META: Record<MeasureKind, MeasureMeta> = {
  glucose: { label: "Glucosa", unit: "mg/dL", min: 20, max: 600, decimals: 0 },
  bp: {
    label: "Presión arterial",
    unit: "mmHg",
    min: 50,
    max: 260,
    min2: 30,
    max2: 160,
    decimals: 0,
  },
  weight: { label: "Peso", unit: "kg", min: 1, max: 300, decimals: 1 },
  temp: { label: "Temperatura", unit: "°C", min: 30, max: 43, decimals: 1 },
  spo2: { label: "Oxígeno en sangre", unit: "%", min: 50, max: 100, decimals: 0 },
  hr: { label: "Pulso", unit: "lpm", min: 20, max: 250, decimals: 0 },
  pain: { label: "Dolor", unit: "/10", min: 0, max: 10, decimals: 0 },
};

/** Qué números se ofrecen primero a cada tipo (todos se pueden registrar). */
export const MEASURES_BY_KIND: Record<FamKind, readonly MeasureKind[]> = {
  elder: ["bp", "glucose", "weight", "temp", "spo2", "hr", "pain"],
  child: ["temp", "weight", "spo2", "pain"],
  surgery: ["temp", "pain", "bp", "spo2", "hr", "weight"],
  illness: ["temp", "spo2", "hr", "bp", "pain", "weight"],
  chronic: ["glucose", "bp", "weight", "spo2", "hr", "temp", "pain"],
};

/** Metas que anota la familia por indicación del médico (clave → mínimo y máximo posibles). */
export const TARGET_KEYS = [
  "glucose_min",
  "glucose_max",
  "sys_min",
  "sys_max",
  "dia_min",
  "dia_max",
  "weight_min",
  "weight_max",
  "temp_max",
  "spo2_min",
  "hr_min",
  "hr_max",
] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export type Targets = Partial<Record<TargetKey, number>>;

export const TARGET_BOUNDS: Record<TargetKey, readonly [number, number]> = {
  glucose_min: [20, 600],
  glucose_max: [20, 600],
  sys_min: [50, 260],
  sys_max: [50, 260],
  dia_min: [30, 160],
  dia_max: [30, 160],
  weight_min: [1, 300],
  weight_max: [1, 300],
  temp_max: [30, 43],
  spo2_min: [50, 100],
  hr_min: [20, 250],
  hr_max: [20, 250],
};

export const ASK_STATUSES = ["open", "claimed", "done", "cancelled"] as const;
export type AskStatus = (typeof ASK_STATUSES)[number];

export const MOMENT_KINDS = ["memory", "first", "win"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const MOMENT_LABEL: Record<MomentKind, string> = {
  memory: "Recuerdo",
  first: "Primera vez",
  win: "Pequeña victoria",
};

// ── Topes y límites ──────────────────────────────────────────────────────────

/** Topes de texto y de tiempo (iguales para todos los planes; los espeja la base de datos). */
export const FAM_CAPS = {
  nameMax: 40,
  relationMax: 30,
  eventLabelMax: 60,
  conditionMax: 30,
  conditionsMax: 8,
  noteMax: 280,
  stepTitleMax: 80,
  askTitleMax: 100,
  momentMax: 500,
  measureNoteMax: 120,
  /** Cuántos días atrás se puede completar el registro de un día (olvidó anotar ayer). */
  checkinBackDays: 3,
  /** Un pedido de ayuda abierto no se agenda a más de estos días. */
  askAheadDays: 60,
  /** Se aceptan fechas de cirugía o de inicio entre hace estos años y dentro de un año. */
  eventYearsBack: 2,
} as const;

export interface FamLimits {
  /** Personas queridas activas (las archivadas no cuentan). */
  persons: number;
  /** Próximos pasos abiertos por persona. */
  openSteps: number;
  /** Pedidos de ayuda abiertos por persona. */
  openAsks: number;
  /** Recuerdos guardados por persona. */
  moments: number;
}

/** Límites que aplica la base de datos según el plan que lee de `mp_subscriptions` (Free vs plan de pago). */
export const FAM_LIMITS: Record<"free" | "essential", FamLimits> = {
  free: { persons: 1, openSteps: 6, openAsks: 3, moments: 60 },
  essential: { persons: 5, openSteps: 60, openAsks: 30, moments: 400 },
};

/** Cualquier plan de pago (Familiar, Premium Familiar y los demás) da los límites amplios. */
export function famLimitsFor(plan: string | null | undefined): FamLimits {
  return plan && plan !== "free" ? FAM_LIMITS.essential : FAM_LIMITS.free;
}
