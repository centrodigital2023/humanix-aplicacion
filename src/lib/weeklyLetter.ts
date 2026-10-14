// «Carta de la semana» — lógica pura, sin base de datos.
//
// Un texto corto y cálido que la familia puede mandar al círculo (hermanos, tíos, amigos) para que nadie tenga que
// repetir la misma noticia veinte veces. Es el gesto que se comparte solo: sirve a quien lo manda, a quien lo recibe y,
// con una firma discreta, presenta Humanix a quien aún no lo conoce.
//
// Lo que dice y lo que NO dice:
//  - Solo HECHOS que ya están en los partes del turno (cuántos servicios, comidas, medicamentos, actividades, cómo estuvo
//    el ánimo, cuántos avisos). Nada de interpretar síntomas ni de «todo bien»: la ausencia de un registro no prueba que no
//    pasara.
//  - Sin cifras de signos vitales, sin direcciones, sin teléfonos, sin correos, sin dinero ni datos de pago.
//  - Sin nombre de la persona cuidada por defecto, y NUNCA en la ruta «niño o niña» (dato de un menor de edad:
//    Ley 1581 de 2012). Los nombres de los profesionales solo aparecen si la familia lo pide.
//  - Es dato de salud (sensible): la pantalla avisa antes de compartir y la familia decide con quién.
//  - Compartir por WhatsApp solo prepara el mensaje; nunca se manda solo y nunca habla de pagos.

import { isCareMood, type CareMood } from "./careLog";
import type { CareRoute } from "./careJourney";
import { ROUTES, bogotaDayIndex } from "./careJourney";
import { hoursEs, msOf, num, plural } from "./intelShared";

export interface LetterBooking {
  id: string;
  status: string;
  scheduled_at: string;
  duration_hours: number | string | null;
  professional_name?: string | null;
}

export interface LetterLog {
  booking_id: string;
  event_type: string;
  mood?: string | null;
  is_alert: boolean;
  created_at: string;
  system_generated?: boolean | null;
}

export interface LetterOptions {
  /** Nombre de la persona cuidada. Solo se usa si `includeName` y la ruta no es «niño o niña». */
  personName?: string | null;
  includeName?: boolean;
  /** Nombres de pila de quienes acompañaron (apagado por defecto). */
  includeTeam?: boolean;
  /** Firma discreta con el enlace de Humanix (encendida por defecto). */
  signature?: boolean;
}

export interface WeeklyLetter {
  /** No hubo servicios ni partes en la semana: no hay nada honesto que contar. */
  empty: boolean;
  title: string;
  lines: string[];
  /** Texto listo para copiar o compartir. Vacío si `empty`. */
  text: string;
  facts: {
    services: number;
    hours: number;
    meals: number;
    medications: number;
    activities: number;
    alerts: number;
    calmDays: number;
    hardDays: number;
  };
  /** El nombre de la persona entró en el texto. */
  usedName: boolean;
}

export const LETTER_WINDOW_DAYS = 7;

export const LETTER_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";

/** Se muestra antes de compartir. */
export const LETTER_SHARE_NOTICE =
  "Esta carta cuenta cómo estuvo la semana: es información de salud (dato sensible, Ley 1581 de 2012). Compártela solo con quien tú decidas.";

const POSITIVE: ReadonlySet<CareMood> = new Set<CareMood>(["happy", "calm"]);

const firstName = (full: string): string => full.trim().split(/\s+/)[0] ?? "";

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

export function buildWeeklyLetter(input: {
  route: CareRoute | null;
  bookings: readonly LetterBooking[];
  logs: readonly LetterLog[];
  now: number;
  options?: LetterOptions;
}): WeeklyLetter {
  const { route, bookings, logs, now, options = {} } = input;
  const sober = route !== null && ROUTES[route].tone === "sober";
  const today = bogotaDayIndex(now);
  const inWindow = (iso: string): boolean => {
    const t = msOf(iso);
    if (!Number.isFinite(t) || t > now) return false;
    const age = today - bogotaDayIndex(t);
    return age >= 0 && age < LETTER_WINDOW_DAYS;
  };

  const services = bookings.filter(
    (b) => (b.status === "completed" || b.status === "in_progress") && inWindow(b.scheduled_at),
  );
  const week = logs.filter((l) => !l.system_generated && inWindow(l.created_at));

  const count = (type: string) => week.filter((l) => l.event_type === type).length;
  const meals = count("meal");
  const medications = count("medication");
  const activities = count("activity");
  const alerts = week.filter((l) => l.is_alert).length;
  const hours = services.reduce((s, b) => s + Math.max(0, num(b.duration_hours)), 0);

  // Ánimo: el último de cada día.
  const lastByDay = new Map<number, { t: number; mood: CareMood }>();
  for (const l of week) {
    if (!isCareMood(l.mood)) continue;
    const t = msOf(l.created_at);
    const day = bogotaDayIndex(t);
    const prev = lastByDay.get(day);
    if (!prev || t > prev.t) lastByDay.set(day, { t, mood: l.mood });
  }
  const moods = [...lastByDay.values()].map((v) => v.mood);
  const calmDays = moods.filter((m) => POSITIVE.has(m)).length;
  const hardDays = moods.length - calmDays;

  const facts = {
    services: services.length,
    hours,
    meals,
    medications,
    activities,
    alerts,
    calmDays,
    hardDays,
  };

  const empty = services.length === 0 && week.length === 0;
  const usedName =
    !!options.includeName &&
    route !== "child" &&
    !!options.personName &&
    firstName(options.personName) !== "";
  const title = usedName
    ? `Carta de la semana de ${firstName(options.personName as string)}`
    : "Carta de la semana";

  if (empty) {
    return { empty: true, title, lines: [], text: "", facts, usedName };
  }

  const lines: string[] = [
    sober ? "Les cuento cómo fue esta semana." : "Les cuento cómo estuvo la semana.",
  ];

  if (services.length > 0) {
    lines.push(
      `Hubo ${plural(services.length, "servicio de cuidado", "servicios de cuidado")}${
        hours > 0 ? ` (${hoursEs(hours)} ${hours === 1 ? "hora" : "horas"} en total)` : ""
      }.`,
    );
  }

  const done: string[] = [];
  if (meals > 0) done.push(plural(meals, "comida registrada", "comidas registradas"));
  if (medications > 0)
    done.push(
      plural(medications, "toma de medicamento registrada", "tomas de medicamentos registradas"),
    );
  if (activities > 0)
    done.push(plural(activities, "momento de actividad", "momentos de actividad"));
  if (done.length > 0) lines.push(`Quedaron anotadas: ${done.join(", ")}.`);

  if (moods.length >= 2) {
    if (calmDays * 3 >= moods.length * 2)
      lines.push("El ánimo anotado fue, sobre todo, tranquilo o contento.");
    else if (calmDays * 3 <= moods.length)
      lines.push(
        "Hubo varios días más difíciles (cansancio, tristeza o molestias). Vale la pena acompañar.",
      );
    else lines.push("El ánimo anotado fue variado, con días mejores y otros más difíciles.");
  }

  if (alerts > 0) {
    lines.push(
      `Hubo ${plural(alerts, "aviso", "avisos")} en los partes. Conviene comentarlo${alerts === 1 ? "" : "s"} con el médico.`,
    );
  }

  if (options.includeTeam) {
    const names = [
      ...new Set(services.map((b) => firstName(b.professional_name ?? "")).filter((n) => n !== "")),
    ].slice(0, 3);
    if (names.length > 0) lines.push(`Los acompañó ${joinNames(names)}.`);
  }

  lines.push(sober ? "Gracias por estar pendientes." : "Gracias por cuidar juntos. 💛");
  if (options.signature !== false) lines.push(LETTER_SIGNATURE);

  return { empty: false, title, lines, text: [title, "", ...lines].join("\n"), facts, usedName };
}
