// «Pedir ayuda al círculo» — lógica pura, sin base de datos.
//
// Pedir ayuda es lo más difícil de cuidar: se pospone hasta el agotamiento y, cuando se hace, suena vago («cuando
// puedan…»). Esta pieza mira qué días de la semana NO tienen servicio programado y arma un mensaje concreto, con
// días reales y una petición clara, que la familia revisa y envía por su cuenta.
//
// Reglas:
//  - Solo días y petición. Sin nombres, sin datos de salud, sin dinero, sin contacto de profesionales.
//  - Nunca se envía solo (el botón solo prepara el mensaje). Pagos jamás por WhatsApp.
//  - Pedir ayuda no es un fallo: el tono es cálido y sin culpa (sobrio y sin emojis en la ruta de enfermedad).

import { BOGOTA_OFFSET_MS, DAY_MS, HOUR_MS, bogotaDayIndex, dayLabelEs, msOf } from "./intelShared";
import type { RouteTone } from "./careJourney";

export const HELP_ASKS = ["company", "errands", "rest"] as const;
export type HelpAsk = (typeof HELP_ASKS)[number];

export const HELP_ASK_LABEL: Record<HelpAsk, string> = {
  company: "Que alguien acompañe un rato",
  errands: "Que alguien haga una diligencia",
  rest: "Necesito descansar unas horas",
};

export const HELP_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";

/** Solo los servicios que ocupan el día: programados, confirmados, en curso o terminados. */
const COVERING = new Set(["pending", "confirmed", "in_progress", "completed"]);
const HORIZON_DAYS = 7;
const MAX_LISTED = 4;
const MAX_SPAN_DAYS = 3;

export interface HelpBooking {
  status: string;
  scheduled_at: string;
  duration_hours?: number | string | null;
}

/** Mediodía de Colombia del día `dayIndex` (mediodía, para etiquetar sin sorpresas de huso). */
function noonOf(dayIndex: number): number {
  return dayIndex * DAY_MS + 12 * HOUR_MS - BOGOTA_OFFSET_MS;
}

/** Días de los próximos 7 (contando hoy) sin ningún servicio. Devuelve índices de día de Colombia, ascendentes. */
export function uncoveredDays(bookings: readonly HelpBooking[], now: number): number[] {
  const today = bogotaDayIndex(now);
  const covered = new Set<number>();
  for (const b of bookings) {
    if (!COVERING.has(b.status)) continue;
    const start = msOf(b.scheduled_at);
    if (!Number.isFinite(start)) continue;
    const raw = Number(b.duration_hours);
    const hours = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const first = bogotaDayIndex(start);
    const last = hours > 0 ? bogotaDayIndex(start + hours * HOUR_MS) : first;
    for (let d = first; d <= Math.min(last, first + MAX_SPAN_DAYS - 1); d++) covered.add(d);
  }
  const out: number[] = [];
  for (let d = today; d < today + HORIZON_DAYS; d++) if (!covered.has(d)) out.push(d);
  return out;
}

export interface HelpRequest {
  ask: HelpAsk;
  /** Días sin servicio de la próxima semana (todos). */
  freeDays: number[];
  text: string;
}

export function buildHelpRequest(input: {
  bookings: readonly HelpBooking[];
  now: number;
  ask: HelpAsk;
  tone?: RouteTone;
  signature?: boolean;
}): HelpRequest {
  const { bookings, now, ask, tone = "warm", signature = true } = input;
  const warm = tone === "warm";
  const freeDays = uncoveredDays(bookings, now);
  const listed = freeDays.slice(0, MAX_LISTED).map((d) => dayLabelEs(noonOf(d)));

  const opener: Record<HelpAsk, string> = {
    company: warm ? "Hola, necesito una mano 💛" : "Hola, necesito una mano.",
    errands: warm ? "Hola, ¿me ayudan con algo? 💛" : "Hola, ¿me ayudan con algo?",
    rest: warm ? "Hola, necesito descansar unas horas 💛" : "Hola, necesito descansar unas horas.",
  };
  const request: Record<HelpAsk, string> = {
    company:
      "¿Alguien puede acompañar un rato? No hace falta hacer nada especial: con estar cerca ayuda.",
    errands:
      "¿Alguien puede encargarse de una diligencia (mercado, droguería o llevar a una cita)?",
    rest: "¿Alguien puede cubrirme unas horas para que yo pueda descansar?",
  };

  const lines = [opener[ask], ""];
  if (listed.length > 0)
    lines.push(`Esta semana no hay servicio programado: ${listed.join(", ")}.`);
  lines.push(request[ask]);
  lines.push("Respóndeme con el día y la hora que te queden bien, y yo confirmo.");
  lines.push("", warm ? "Gracias por estar. 💛" : "Gracias por estar.");
  if (signature) lines.push("", HELP_SIGNATURE);
  return { ask, freeDays, text: lines.join("\n") };
}
