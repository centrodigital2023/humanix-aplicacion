// Rituales que unen — lógica pura, sin base de datos.
//
// Un ritual es una acción pequeña, de pocos minutos, que acerca a la persona cuidada con su familia. Cada ruta tiene
// los suyos y cambian solos cada día (hora de Colombia), así que la tarjeta trae algo nuevo sin pedir nada a la familia.
//
// De dónde sale cada ruta (ver `docs/PANEL_FAMILIA_RUTAS_DE_CUIDADO.md`, sección «Rituales que unen»):
//  - Adulto mayor: preguntas de reminiscencia (recordar con alguien). Hay ensayos que muestran menos síntomas
//    depresivos en personas mayores justo después de la intervención; la evidencia es corta en el tiempo.
//  - Niño o niña: juego, cuentos y rutinas tranquilas con un adulto de confianza.
//  - Posoperatorio: pasos pequeños y confort, siempre dentro de lo que permitió el equipo de cirugía.
//  - Crónicos: hábitos amables y el plan «cuando… entonces…» (intenciones de implementación), que en ensayos con
//    pacientes mejoró la adherencia a la medicación.
//  - Enfermedad: presencia y calma. Tono sobrio: sin celebraciones ni conteos que suenen a logro.
//
// Reglas firmes:
//  - Ningún ritual es clínico: no hay medicamentos, dosis ni ejercicios prescritos. Cuando algo depende del médico, el
//    texto lo dice («lo que su médico haya permitido»).
//  - Sin rachas: el contador solo suma y un día sin ritual no resta ni se menciona.
//  - La invitación al círculo no lleva nombres, datos de salud ni pagos; solo se prepara (la familia la envía).

import type { CareRoute, RouteTone } from "./careJourney";
import { bogotaDayIndex } from "./intelShared";

export const RITUALS_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";

export interface Ritual {
  id: string;
  title: string;
  /** Qué hacer, en una o dos frases. */
  body: string;
  /** Minutos aproximados: es una invitación, no un deber. */
  minutes: number;
  /** Cómo puede sumarse alguien del círculo a distancia. */
  remote: string;
}

export const RITUALS: Record<CareRoute, readonly Ritual[]> = {
  elder: [
    {
      id: "elder_song",
      title: "La canción de su juventud",
      body: "Pregúntale qué canción bailaba de joven y pónganla juntos. Deja que cuente dónde la escuchaba.",
      minutes: 15,
      remote: "Pon la canción en una videollamada y escúchenla a la vez.",
    },
    {
      id: "elder_photo",
      title: "Una foto con historia",
      body: "Elijan una foto vieja y pídele que cuente quién aparece y qué pasaba ese día.",
      minutes: 15,
      remote: "Envía una foto antigua al grupo y pregúntale por ella en una llamada.",
    },
    {
      id: "elder_recipe",
      title: "La receta de la casa",
      body: "Pregúntale por una comida que siempre preparaba: los ingredientes, el secreto, a quién le gustaba.",
      minutes: 20,
      remote: "Llama para que te dicte la receta y escríbela con sus palabras.",
    },
    {
      id: "elder_town",
      title: "El lugar donde creció",
      body: "Pídele que describa la calle o la vereda donde creció: los olores, los vecinos, el camino a la escuela.",
      minutes: 15,
      remote: "Busquen juntos el lugar en un mapa durante una videollamada.",
    },
    {
      id: "elder_advice",
      title: "El consejo que nunca falla",
      body: "Pregúntale cuál es el mejor consejo que le dieron y quién se lo dio. Anótalo para la familia.",
      minutes: 10,
      remote: "Llama y pídele un consejo para algo que estés viviendo.",
    },
    {
      id: "elder_window",
      title: "Un rato en la ventana",
      body: "Siéntense un rato junto a la ventana o al sol de la mañana y conversen de lo que se ve pasar.",
      minutes: 15,
      remote: "Cuéntale por mensaje de voz qué se ve hoy desde tu ventana.",
    },
    {
      id: "elder_proud",
      title: "De lo que más se enorgullece",
      body: "Pregúntale de qué se siente orgulloso u orgullosa en la vida. Escuchar sin prisa ya es el regalo.",
      minutes: 15,
      remote: "Envía un mensaje de voz contándole algo que le aprendiste.",
    },
  ],
  child: [
    {
      id: "child_story",
      title: "Un cuento inventado",
      body: "Inventen un cuento entre los dos: cada quien dice una frase y la historia va saliendo sola.",
      minutes: 15,
      remote: "Un familiar empieza el cuento por videollamada y el niño o la niña lo termina.",
    },
    {
      id: "child_drawing",
      title: "Dibujar el día",
      body: "Pídele que dibuje lo mejor de su día y que te lo explique con calma.",
      minutes: 15,
      remote: "Que muestre el dibujo en una videollamada a alguien que lo extraña.",
    },
    {
      id: "child_music",
      title: "Baile de una canción",
      body: "Elijan una canción y muévanse como quieran, a su ritmo y con lo que su cuerpo pueda hoy.",
      minutes: 5,
      remote: "Bailen la misma canción a la vez en una videollamada.",
    },
    {
      id: "child_hunt",
      title: "Busca y encuentra",
      body: "Escondan un juguete en la casa y den pistas de «frío» y «caliente» hasta encontrarlo.",
      minutes: 10,
      remote: "Alguien del círculo da las pistas por llamada.",
    },
    {
      id: "child_three_good",
      title: "Tres cosas buenas",
      body: "Antes de dormir, que cuente tres cosas buenas que pasaron hoy, por pequeñas que sean.",
      minutes: 5,
      remote: "Que un familiar cuente también sus tres cosas buenas por mensaje de voz.",
    },
    {
      id: "child_build",
      title: "Construir algo juntos",
      body: "Con bloques, cajas o cojines, armen una casa, un barco o lo que imagine.",
      minutes: 20,
      remote: "Que le muestre la construcción a alguien por videollamada.",
    },
    {
      id: "child_breathe",
      title: "Soplar velas imaginarias",
      body: "Jueguen a oler una flor y soplar una vela, despacio, cinco veces. Ayuda a bajar el ritmo.",
      minutes: 3,
      remote: "Un familiar lo hace a la vez por videollamada.",
    },
  ],
  postop: [
    {
      id: "postop_small_step",
      title: "Un paso pequeño",
      body: "Elijan juntos un paso pequeño para hoy, dentro de lo que permitió el equipo de cirugía, y celébrenlo.",
      minutes: 10,
      remote: "Llama para preguntar cuál fue el paso de hoy.",
    },
    {
      id: "postop_comfort",
      title: "El rincón cómodo",
      body: "Arreglen juntos el lugar donde descansa: luz, almohadas, agua y el teléfono a la mano.",
      minutes: 10,
      remote: "Envía una lista de películas o música para el rincón.",
    },
    {
      id: "postop_window",
      title: "Aire y luz",
      body: "Abran la ventana un rato o descansen donde entre luz natural, si se puede.",
      minutes: 10,
      remote: "Comparte una foto de un lugar al que irán cuando se recupere.",
    },
    {
      id: "postop_playlist",
      title: "La lista de la recuperación",
      body: "Armen una lista de canciones que den ánimo y pónganla en el momento más pesado del día.",
      minutes: 10,
      remote: "Que cada persona del círculo agregue una canción.",
    },
    {
      id: "postop_progress",
      title: "Mirar lo que ya se avanzó",
      body: "Recuerden juntos cómo estaba el primer día y qué ya puede hacer hoy. Lo pequeño también cuenta.",
      minutes: 10,
      remote: "Escribe un mensaje con algo que notaste que mejoró.",
    },
    {
      id: "postop_plan",
      title: "Un plan para cuando se pueda",
      body: "Hablen de algo que les ilusione hacer cuando el equipo de cirugía lo autorice.",
      minutes: 10,
      remote: "Propón tú el plan en el grupo de la familia.",
    },
    {
      id: "postop_questions",
      title: "Las dudas de la semana",
      body: "Anoten juntos las dudas que han ido saliendo para llevarlas al próximo control.",
      minutes: 10,
      remote: "Pregunta si quieres que acompañes al control.",
    },
  ],
  illness: [
    {
      id: "illness_read",
      title: "Leer en voz alta",
      body: "Léele algo que le guste: una noticia, un poema, unas páginas de un libro. Sin prisa.",
      minutes: 15,
      remote: "Grábale un audio leyendo algo que le guste.",
    },
    {
      id: "illness_music",
      title: "Su música",
      body: "Pongan la música que le trae calma y acompáñale un rato en silencio.",
      minutes: 15,
      remote: "Envía una canción que les recuerde un buen momento juntos.",
    },
    {
      id: "illness_hands",
      title: "Un rato de compañía",
      body: "Siéntate a su lado un rato, sin tener que decir nada. Estar ya es suficiente.",
      minutes: 10,
      remote: "Una llamada corta solo para decirle que piensas en él o ella.",
    },
    {
      id: "illness_wish",
      title: "Qué le haría bien hoy",
      body: "Pregúntale qué le haría bien hoy: algo de comer, una visita, silencio, una ventana abierta.",
      minutes: 5,
      remote: "Pregunta a quien cuida qué pequeña cosa puedes llevar o hacer.",
    },
    {
      id: "illness_memory",
      title: "Un buen recuerdo",
      body: "Si tiene ganas, recuerden juntos un viaje o una fiesta familiar. Si no, también está bien.",
      minutes: 10,
      remote: "Envía una foto de un buen momento compartido.",
    },
    {
      id: "illness_carer_pause",
      title: "Una pausa para quien cuida",
      body: "Quien cuida también necesita aire: diez minutos para sí, mientras alguien más acompaña.",
      minutes: 10,
      remote: "Ofrécete a acompañar un rato para que quien cuida descanse.",
    },
    {
      id: "illness_letter",
      title: "Palabras que quedan",
      body: "Escriban o graben juntos un mensaje para alguien querido, si lo desea.",
      minutes: 15,
      remote: "Envíale un mensaje de lo que significa para ti.",
    },
  ],
  chronic: [
    {
      id: "chronic_walk",
      title: "Caminar conversando",
      body: "Den juntos el paseo que su médico haya recomendado y aprovechen para conversar.",
      minutes: 15,
      remote: "Caminen «juntos» a la vez, cada quien donde esté, en una llamada.",
    },
    {
      id: "chronic_plate",
      title: "Un plato colorido",
      body: "Preparen juntos una comida dentro de lo que indicó su médico o nutricionista, con muchos colores.",
      minutes: 30,
      remote: "Compartan en el grupo una receta que encaje con su plan.",
    },
    {
      id: "chronic_ifthen",
      title: "Revisar el plan «cuando… entonces…»",
      body: "Repasen juntos los planes de la semana: ¿cuál funcionó mejor? ¿cuál conviene cambiar?",
      minutes: 5,
      remote: "Pregunta cuál plan les está funcionando mejor.",
    },
    {
      id: "chronic_win",
      title: "La pequeña victoria",
      body: "Cada quien dice algo que hizo bien esta semana por su salud, por pequeño que sea.",
      minutes: 5,
      remote: "Cuenta tú también tu pequeña victoria de la semana.",
    },
    {
      id: "chronic_garden",
      title: "Algo que crezca",
      body: "Siembren o rieguen una planta juntos. Cuidarla también es un hábito que se ve crecer.",
      minutes: 10,
      remote: "Pide una foto de la planta cada semana.",
    },
    {
      id: "chronic_stretch",
      title: "Estirarse con música",
      body: "Una canción para estirarse con suavidad, solo con los movimientos que su médico haya permitido.",
      minutes: 5,
      remote: "Estírense a la vez en una videollamada.",
    },
    {
      id: "chronic_prepare",
      title: "Preparar la semana",
      body: "Revisen juntos las citas, los controles y lo que haya que reponer en la casa esta semana.",
      minutes: 10,
      remote: "Ofrécete para una diligencia o un acompañamiento a una cita.",
    },
  ],
};

/** Desfase por ruta: dos familias en rutas distintas no ven «el mismo número» de ritual el mismo día. */
const ROUTE_OFFSET: Record<CareRoute, number> = {
  elder: 0,
  child: 2,
  postop: 4,
  illness: 1,
  chronic: 3,
};

/** El ritual del día (hora de Colombia) para la ruta. Determinista: el mismo día, el mismo ritual. */
export function ritualOfDay(route: CareRoute, now: number): Ritual {
  const list = RITUALS[route];
  const day = bogotaDayIndex(now) + ROUTE_OFFSET[route];
  return list[((day % list.length) + list.length) % list.length];
}

/** El ritual de mañana, para dar una pista amable («mañana: …»). */
export function nextRitual(route: CareRoute, now: number): Ritual {
  return ritualOfDay(route, now + 86_400_000);
}

// ─── Lo que la familia ya compartió (solo en este navegador) ─────────────────

/** Tope de días guardados: algo más de un año. */
export const RITUAL_HISTORY_MAX = 400;

/** Días (índice de día de Colombia) con ritual, válidos, únicos y ordenados; ignora lo que no sea un entero. */
export function sanitizeRitualDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const days = raw.filter((d): d is number => Number.isInteger(d) && d > 0);
  return [...new Set(days)].sort((a, b) => a - b).slice(-RITUAL_HISTORY_MAX);
}

/** Marca o desmarca el ritual de hoy. Solo se puede tocar el día de hoy: el pasado no se edita. */
export function toggleRitualToday(days: readonly number[], now: number): number[] {
  const today = bogotaDayIndex(now);
  const clean = sanitizeRitualDays(days);
  return clean.includes(today)
    ? clean.filter((d) => d !== today)
    : sanitizeRitualDays([...clean, today]);
}

export interface RitualSummary {
  doneToday: boolean;
  /** Días con ritual compartido, de siempre (no se reinicia). */
  total: number;
  line: string;
}

/**
 * Resumen que solo suma. En tono sobrio (enfermedad) no se habla de cantidades como un logro: se agradece el momento.
 * Nunca usa lenguaje de racha («seguidos», «perder», «romper»).
 */
export function ritualSummary(
  days: readonly number[],
  now: number,
  tone: RouteTone,
): RitualSummary {
  const clean = sanitizeRitualDays(days).filter((d) => d <= bogotaDayIndex(now));
  const doneToday = clean.includes(bogotaDayIndex(now));
  const total = clean.length;
  let line: string;
  if (tone === "sober") {
    line = doneToday
      ? "Gracias por este momento juntos."
      : "Cuando quieras, este momento está aquí. No hay prisa.";
  } else if (total === 0) {
    line = "Cuando lo hagan, márcalo: aquí se van guardando sus rituales.";
  } else if (doneToday) {
    line =
      total === 1
        ? "¡Primer ritual compartido! Ya empezó su colección."
        : `¡Hecho! Ya son ${total} rituales compartidos.`;
  } else {
    line =
      total === 1
        ? "Llevan 1 ritual compartido. El de hoy los espera."
        : `Llevan ${total} rituales compartidos. El de hoy los espera.`;
  }
  return { doneToday, total, line };
}

/** Mensaje para invitar al círculo a sumarse al ritual de hoy. Sin nombres, salud ni pagos. */
export function ritualInvite(ritual: Ritual, tone: RouteTone): string {
  const opener =
    tone === "sober"
      ? "Hoy en casa queremos compartir un momento tranquilo:"
      : "Hoy en casa tenemos un ritual y nos encantaría que te sumes:";
  return [
    opener,
    `«${ritual.title}». ${ritual.body}`,
    `Desde donde estés: ${ritual.remote.charAt(0).toLowerCase()}${ritual.remote.slice(1)}`,
    "",
    RITUALS_SIGNATURE,
  ].join("\n");
}

// ─── Plan «cuando… entonces…» (intenciones de implementación) ────────────────

export const IF_THEN_ROUTES: readonly CareRoute[] = ["elder", "postop", "chronic"];

export function hasIfThen(route: CareRoute | null): route is CareRoute {
  return route !== null && IF_THEN_ROUTES.includes(route);
}

export interface Cue {
  id: string;
  /** Empieza la frase: «Después del desayuno». */
  text: string;
}

export const CUES: readonly Cue[] = [
  { id: "wake", text: "Al levantarnos" },
  { id: "breakfast", text: "Después del desayuno" },
  { id: "lunch", text: "Después del almuerzo" },
  { id: "tinto", text: "A la hora del tinto" },
  { id: "dinner", text: "Después de la comida" },
  { id: "bedtime", text: "Antes de dormir" },
];

export interface ThenAction {
  id: string;
  /** Completa la frase: «revisamos que la toma quede anotada». */
  text: string;
  routes: readonly CareRoute[];
}

// Nada clínico: se organiza y se registra lo que el equipo de salud ya indicó.
export const ACTIONS: readonly ThenAction[] = [
  {
    id: "meds_logged",
    text: "revisamos que la toma de medicamentos quede anotada",
    routes: ["elder", "postop", "chronic"],
  },
  {
    id: "numbers",
    text: "anotamos las cifras que pidió su médico",
    routes: ["postop", "chronic"],
  },
  {
    id: "walk",
    text: "damos el paseo corto que su médico permitió",
    routes: ["elder", "postop", "chronic"],
  },
  {
    id: "fluids",
    text: "ofrecemos líquidos, como lo haya indicado su médico",
    routes: ["elder", "postop", "chronic"],
  },
  {
    id: "call",
    text: "hacemos una llamada a alguien querido",
    routes: ["elder", "chronic"],
  },
  {
    id: "wound_look",
    text: "miramos la herida como lo explicó el equipo de cirugía",
    routes: ["postop"],
  },
  {
    id: "questions",
    text: "anotamos las dudas para el próximo control",
    routes: ["postop", "chronic"],
  },
];

export const MAX_PLANS = 3;

export interface IfThenPlan {
  cue: string;
  action: string;
}

export function actionsFor(route: CareRoute): ThenAction[] {
  return ACTIONS.filter((a) => a.routes.includes(route));
}

/** Planes válidos para la ruta: ids conocidos, acción permitida, sin repetidos, como mucho `MAX_PLANS`. */
export function sanitizePlans(route: CareRoute, raw: unknown): IfThenPlan[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(actionsFor(route).map((a) => a.id));
  const cues = new Set(CUES.map((c) => c.id));
  const seen = new Set<string>();
  const out: IfThenPlan[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const { cue, action } = p as Record<string, unknown>;
    if (typeof cue !== "string" || typeof action !== "string") continue;
    if (!cues.has(cue) || !allowed.has(action)) continue;
    const key = `${cue}|${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cue, action });
    if (out.length === MAX_PLANS) break;
  }
  return out;
}

/** Agrega un plan (si cabe y no está repetido). Devuelve la lista nueva. */
export function addPlan(
  route: CareRoute,
  plans: readonly IfThenPlan[],
  plan: IfThenPlan,
): IfThenPlan[] {
  return sanitizePlans(route, [...plans, plan]);
}

export function removePlan(plans: readonly IfThenPlan[], index: number): IfThenPlan[] {
  return plans.filter((_, i) => i !== index);
}

/** «Después del desayuno, revisamos que la toma de medicamentos quede anotada.» o `null` si no es válido. */
export function planSentence(plan: IfThenPlan): string | null {
  const cue = CUES.find((c) => c.id === plan.cue);
  const action = ACTIONS.find((a) => a.id === plan.action);
  if (!cue || !action) return null;
  return `${cue.text}, ${action.text}.`;
}

/** Texto para compartir los planes con quien acompaña (profesional o familiar). Vacío si no hay planes. */
export function plansShareText(route: CareRoute, plans: readonly IfThenPlan[]): string {
  const lines = sanitizePlans(route, plans)
    .map(planSentence)
    .filter((s): s is string => s !== null);
  if (lines.length === 0) return "";
  return [
    "Nuestro plan de la semana en casa:",
    ...lines.map((l) => `• ${l}`),
    "",
    RITUALS_SIGNATURE,
  ].join("\n");
}
