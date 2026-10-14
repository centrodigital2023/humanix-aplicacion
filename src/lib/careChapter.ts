// «Inicio y cierre» — lógica pura, sin base de datos.
//
// Una experiencia memorable cuida el comienzo y el final, no solo el medio. Esta pieza reconoce en qué punto del
// episodio de cuidado está la familia:
//  - «start»: el primer día está por llegar o ya empezó (primeros 3 días): una bienvenida corta.
//  - «closing»: el episodio parece haber terminado (más de 14 días sin servicio): se ofrece, con delicadeza,
//    guardar el recuerdo de ese capítulo y agradecer al equipo.
//  - «ongoing» / «none»: no hay nada que mostrar.
//
// Reglas (decisiones deliberadas):
//  - Que no haya servicios NO prueba que la persona se recuperó ni que esté bien. Por eso el cierre nunca afirma
//    recuperación, y solo existe en las rutas «posoperatorio» y «niño o niña». En «adulto mayor», «enfermedad» y
//    «crónicos» nunca hay cierre: un hueco de servicios puede significar cosas muy distintas y un mensaje de
//    «capítulo cerrado» sería hiriente.
//  - El cierre es opcional, neutro y en condicional («si este capítulo ya terminó»).
//  - Lo compartido lleva solo hechos del cuidado (días, servicios, horas). Sin nombres de la persona cuidada (jamás de
//    un menor), sin datos de salud, sin dinero, sin pedir reseñas ni calificaciones.

import { careDaySet } from "./careDays";
import { EPISODE_GAP_DAYS, bogotaDayIndex, type CareRoute } from "./careJourney";
import { dateEs, hoursEs, joinEs, msOf, plural } from "./intelShared";

export type ChapterPhase = "none" | "start" | "ongoing" | "closing";

/** Rutas en las que tiene sentido ofrecer un cierre. */
export const CLOSABLE_ROUTES: readonly CareRoute[] = ["postop", "child"];
/** Cuántos días de cuidado hacen falta para que un episodio merezca un cierre. */
export const MIN_CLOSING_CARE_DAYS = 3;
/** Cuántos días después del último servicio se sigue ofreciendo el cierre. */
export const CLOSING_WINDOW_DAYS = 30;
/** Días desde el primer día en los que se muestra la bienvenida. */
export const START_WINDOW_DAYS = 3;

export const CHAPTER_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";

export interface ChapterBooking {
  status: string;
  scheduled_at: string;
  completed_at?: string | null;
  duration_hours?: number | string | null;
  professional_name?: string | null;
}

const DONE = new Set(["completed", "in_progress"]);
const UPCOMING = new Set(["pending", "confirmed"]);

export interface ChapterState {
  phase: ChapterPhase;
  /** Primer día del episodio (índice de día de Colombia), si hay uno. */
  startDay: number | null;
  /** Último día con servicio del episodio. */
  endDay: number | null;
  /** Días con cuidado dentro del episodio. */
  careDays: number;
  /** Días desde el último servicio hasta hoy. */
  daysSince: number | null;
}

/** El episodio más reciente: se retrocede desde el último día con servicio mientras el hueco sea de 14 días o menos. */
function latestEpisode(
  bookings: readonly ChapterBooking[],
  now: number,
): { days: number[]; startDay: number; endDay: number } | null {
  const days = [...careDaySet(bookings, [], now)].sort((a, b) => b - a);
  if (days.length === 0) return null;
  const inEpisode = [days[0]];
  for (let i = 1; i < days.length; i++) {
    if (inEpisode[inEpisode.length - 1] - days[i] > EPISODE_GAP_DAYS) break;
    inEpisode.push(days[i]);
  }
  return { days: inEpisode, startDay: inEpisode[inEpisode.length - 1], endDay: inEpisode[0] };
}

export function chapterState(input: {
  route: CareRoute | null;
  bookings: readonly ChapterBooking[];
  now: number;
}): ChapterState {
  const { route, bookings, now } = input;
  const today = bogotaDayIndex(now);
  const ep = latestEpisode(bookings, now);
  const upcoming = bookings.some((b) => {
    const t = msOf(b.scheduled_at);
    return UPCOMING.has(b.status) && Number.isFinite(t) && t > now;
  });

  if (!ep) {
    return {
      phase: upcoming ? "start" : "none",
      startDay: null,
      endDay: null,
      careDays: 0,
      daysSince: null,
    };
  }
  const daysSince = today - ep.endDay;
  const base = { startDay: ep.startDay, endDay: ep.endDay, careDays: ep.days.length, daysSince };

  if (daysSince <= EPISODE_GAP_DAYS) {
    const day = today - ep.startDay + 1;
    return { phase: day <= START_WINDOW_DAYS ? "start" : "ongoing", ...base };
  }
  // Pasó el hueco: el episodio terminó. Solo se ofrece cierre si procede.
  const closable =
    route !== null &&
    CLOSABLE_ROUTES.includes(route) &&
    !upcoming &&
    ep.days.length >= MIN_CLOSING_CARE_DAYS &&
    daysSince <= EPISODE_GAP_DAYS + CLOSING_WINDOW_DAYS;
  return { phase: closable ? "closing" : "none", ...base };
}

/** Bienvenida breve para el comienzo (texto fijo por ruta; es logística y ánimo, no consejo clínico). */
export const WELCOME_LINES: Record<CareRoute, string> = {
  elder:
    "Empieza un acompañamiento nuevo. Lo más importante es que se sienta tranquilo y en confianza.",
  child:
    "Empieza el cuidado. Un horario conocido y sus cosas favoritas cerca lo ayudan a sentirse seguro.",
  postop:
    "Empieza la recuperación en casa. Ir paso a paso y pedir ayuda a tiempo ya es cuidar bien.",
  illness: "Empieza un acompañamiento. No tienen que resolverlo todo hoy.",
  chronic: "Empieza un acompañamiento de largo aliento. Una rutina tranquila es lo que más ayuda.",
};

export interface ChapterSummary {
  careDays: number;
  services: number;
  hours: number;
  /** Primer y último día del episodio, ya escritos («9 oct 2026»). */
  from: string;
  to: string;
  /** Nombres de pila del equipo (hasta 3, sin repetir). */
  team: string[];
}

function toHours(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : 0;
}

function firstName(full: string | null | undefined): string | null {
  const f = (full ?? "").trim().split(/\s+/)[0];
  return f ? f : null;
}

const noon = (day: number) => day * 86_400_000 + 17 * 3_600_000; // 12:00 en Colombia (UTC-5)

/** Resumen de hechos del episodio más reciente; `null` si no hay. */
export function chapterSummary(input: {
  bookings: readonly ChapterBooking[];
  now: number;
}): ChapterSummary | null {
  const { bookings, now } = input;
  const ep = latestEpisode(bookings, now);
  if (!ep) return null;
  let services = 0;
  let hours = 0;
  const team: string[] = [];
  for (const b of bookings) {
    if (!DONE.has(b.status)) continue;
    const t = msOf(b.scheduled_at);
    if (!Number.isFinite(t) || t > now) continue;
    const d = bogotaDayIndex(t);
    if (d < ep.startDay || d > ep.endDay) continue;
    services += 1;
    hours += toHours(b.duration_hours);
    const n = firstName(b.professional_name);
    if (n && !team.includes(n)) team.push(n);
  }
  return {
    careDays: ep.days.length,
    services,
    hours,
    from: dateEs(noon(ep.startDay)),
    to: dateEs(noon(ep.endDay)),
    team: team.slice(0, 3),
  };
}

/** Mensaje para guardar y compartir el recuerdo del capítulo. Solo hechos; en condicional. */
export function buildChapterNote(
  summary: ChapterSummary,
  options: { includeTeam?: boolean; signature?: boolean } = {},
): string {
  const { includeTeam = false, signature = true } = options;
  const lines = [
    "Si este capítulo ya terminó, quiero dejar constancia de lo que juntos hicimos.",
    "",
    `Entre el ${summary.from} y el ${summary.to} hubo ${plural(summary.careDays, "día", "días")} con cuidado: ${plural(summary.services, "servicio", "servicios")}${summary.hours > 0 ? ` (${hoursEs(summary.hours)} ${summary.hours === 1 ? "hora" : "horas"} en total)` : ""}.`,
  ];
  if (includeTeam && summary.team.length > 0) lines.push(`Los acompañó ${joinEs(summary.team)}.`);
  lines.push("", "Gracias a quienes estuvieron cerca. 💛");
  if (signature) lines.push("", CHAPTER_SIGNATURE);
  return lines.join("\n");
}
