// Pasaporte de valentía (ruta niño o niña) — lógica pura, sin base de datos.
//
// Inspirado en los programas de hospitales pediátricos donde cada paso del tratamiento se convierte en una cuenta de
// colores que el niño o la niña guarda (p. ej. «Beads of Courage»): el recorrido se vuelve algo que se puede ver,
// contar y recordar con orgullo. Aquí cada sello sale de lo que ya consta: días con servicio y partes del turno.
//
// Reglas firmes:
//  - Datos de una persona menor de edad (Ley 1581 de 2012, art. 7): el certificado no lleva nombre, fechas exactas,
//    cifras ni datos de salud. Solo los títulos de los sellos.
//  - Sin fracaso: un sello que aún no llega se muestra «por descubrir», nunca «te falta».
//  - Nada se interpreta clínicamente: «se dejó medir» solo dice que hubo un control, no qué salió.

import { bogotaDayIndex, msOf } from "./intelShared";

export const PASSPORT_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";

export type StampIcon =
  | "Sunrise"
  | "Star"
  | "Rocket"
  | "Utensils"
  | "Puzzle"
  | "Smile"
  | "Rainbow"
  | "Shield"
  | "Pill";

export interface StampDef {
  id: string;
  title: string;
  /** Cómo se gana, en lenguaje para el niño o la niña. */
  how: string;
  icon: StampIcon;
}

export const STAMPS: readonly StampDef[] = [
  {
    id: "first_day",
    title: "Primer día acompañado",
    how: "El primer día con alguien que te cuida.",
    icon: "Sunrise",
  },
  {
    id: "three_days",
    title: "Tres días valientes",
    how: "Tres días distintos con cuidado.",
    icon: "Star",
  },
  {
    id: "week",
    title: "Una semana de valentía",
    how: "Siete días distintos con cuidado.",
    icon: "Rocket",
  },
  { id: "meal", title: "Buen provecho", how: "Una comida anotada en el parte.", icon: "Utensils" },
  {
    id: "play",
    title: "Hora de jugar",
    how: "Un rato de juego anotado en el parte.",
    icon: "Puzzle",
  },
  {
    id: "calm",
    title: "Día tranquilo",
    how: "Un día que se anotó tranquilo o contento.",
    icon: "Smile",
  },
  {
    id: "three_calm",
    title: "Tres días contentos",
    how: "Tres días tranquilos o contentos.",
    icon: "Rainbow",
  },
  {
    id: "brave_check",
    title: "Control con valentía",
    how: "Se dejó medir en un control.",
    icon: "Shield",
  },
  {
    id: "medicine",
    title: "Medicina con valentía",
    how: "Una toma de medicina anotada.",
    icon: "Pill",
  },
];

export interface PassportBooking {
  status: string;
  scheduled_at: string;
}

export interface PassportLog {
  event_type: string;
  mood?: string | null;
  created_at: string;
  system_generated?: boolean | null;
}

export interface Stamp extends StampDef {
  earned: boolean;
  /** Instante en que se ganó (para ordenar y mostrar «nuevo»), o `null`. */
  at: number | null;
  /** Ganado en los últimos 3 días: la tarjeta lo destaca. */
  fresh: boolean;
}

export interface Passport {
  stamps: Stamp[];
  earned: number;
  total: number;
  /** El sello ganado más recientemente, o `null`. */
  newest: Stamp | null;
  /** «4 de 9 sellos» (nunca «te faltan»). */
  line: string;
  /** Si hay partes del turno: sin ellos solo cuentan los días. */
  usesLogs: boolean;
}

const FRESH_DAYS = 3;

/** Instante del n-ésimo día distinto (1 = el primero) en una lista de instantes, o `null`. */
function nthDistinctDay(times: readonly number[], n: number): number | null {
  const firstByDay = new Map<number, number>();
  for (const t of [...times].sort((a, b) => a - b)) {
    const d = bogotaDayIndex(t);
    if (!firstByDay.has(d)) firstByDay.set(d, t);
  }
  const ordered = [...firstByDay.values()].sort((a, b) => a - b);
  return ordered[n - 1] ?? null;
}

export function buildPassport(input: {
  bookings: readonly PassportBooking[];
  logs?: readonly PassportLog[] | null;
  now: number;
}): Passport {
  const { now } = input;
  const usesLogs = Array.isArray(input.logs);
  const careTimes = input.bookings
    .filter((b) => b.status === "completed" || b.status === "in_progress")
    .map((b) => msOf(b.scheduled_at))
    .filter((t) => Number.isFinite(t) && t <= now);

  const logs = (input.logs ?? []).filter((l) => {
    if (l.system_generated) return false;
    const t = msOf(l.created_at);
    return Number.isFinite(t) && t <= now;
  });
  const firstOf = (pred: (l: PassportLog) => boolean): number | null => {
    const ts = logs
      .filter(pred)
      .map((l) => msOf(l.created_at))
      .sort((a, b) => a - b);
    return ts[0] ?? null;
  };
  const calmTimes = logs
    .filter((l) => l.mood === "happy" || l.mood === "calm")
    .map((l) => msOf(l.created_at));

  const earnedAt: Record<string, number | null> = {
    first_day: nthDistinctDay(careTimes, 1),
    three_days: nthDistinctDay(careTimes, 3),
    week: nthDistinctDay(careTimes, 7),
    meal: firstOf((l) => l.event_type === "meal"),
    play: firstOf((l) => l.event_type === "activity"),
    calm: nthDistinctDay(calmTimes, 1),
    three_calm: nthDistinctDay(calmTimes, 3),
    brave_check: firstOf((l) => l.event_type === "vital_signs"),
    medicine: firstOf((l) => l.event_type === "medication"),
  };

  const today = bogotaDayIndex(now);
  const stamps: Stamp[] = STAMPS.map((s) => {
    const at = earnedAt[s.id] ?? null;
    return {
      ...s,
      earned: at !== null,
      at,
      fresh: at !== null && today - bogotaDayIndex(at) < FRESH_DAYS,
    };
  });
  const earnedList = stamps.filter((s) => s.earned);
  const newest = earnedList.reduce<Stamp | null>(
    (best, s) => (best === null || (s.at ?? 0) > (best.at ?? 0) ? s : best),
    null,
  );
  const earned = earnedList.length;
  return {
    stamps,
    earned,
    total: stamps.length,
    newest,
    line:
      earned === 0
        ? "El pasaporte está listo para su primer sello."
        : `${earned} de ${stamps.length} sellos ${earned === 1 ? "ganado" : "ganados"}`,
    usesLogs,
  };
}

/**
 * Certificado para imprimir o compartir. Sin nombre, sin fechas, sin cifras ni salud: solo los sellos ganados.
 * Vacío si todavía no hay sellos (no se celebra lo que no ha pasado).
 */
export function passportCertificate(passport: Pick<Passport, "stamps" | "earned">): string {
  const won = passport.stamps.filter((s) => s.earned);
  if (won.length === 0) return "";
  return [
    "🌟 Certificado de valentía 🌟",
    "",
    `Este pasaporte reúne ${won.length} ${won.length === 1 ? "sello" : "sellos"} de un recorrido muy valiente:`,
    ...won.map((s) => `⭐ ${s.title}`),
    "",
    "Cada sello es un paso dado con valor y con alguien al lado.",
    "",
    PASSPORT_SIGNATURE,
  ].join("\n");
}
