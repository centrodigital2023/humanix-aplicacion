// «Momentos memorables» — lógica pura, sin base de datos.
//
// Una familia que cuida está agotada y casi todo lo que ve en una app son tareas y alertas. Esta pieza hace lo
// contrario: junta los buenos momentos que ya constan (el primer día de cuidado, los hitos de «días con cuidado», los
// días tranquilos) en una línea de recuerdos que se puede compartir con el círculo familiar.
//
// Reglas:
//  - Solo recuerdos buenos y verificables: nunca se listan días difíciles, avisos ni signos vitales.
//  - Solo cuenta lo que consta (servicios terminados y partes escritos por una persona); no inventa.
//  - En el tono sobrio (ruta «enfermedad») no hay hitos ni celebraciones: solo el comienzo del acompañamiento.
//  - Sin nombres de personas (ni de menores) ni dinero ni contacto; la firma es discreta y opcional.

import { isCareMood, type CareMood } from "./careLog";
import { careDaySet, CARE_DAY_MILESTONES, type CareDaysBooking } from "./careDays";
import type { RouteTone } from "./careJourney";
import {
  BOGOTA_OFFSET_MS,
  DAY_MS,
  HOUR_MS,
  bogotaDayIndex,
  dateEs,
  msOf,
  plural,
} from "./intelShared";

export type MomentKind = "first_day" | "milestone" | "calm_day";

export interface CareMoment {
  id: string;
  kind: MomentKind;
  /** Mediodía (hora de Colombia) del día del recuerdo, en ms. */
  at: number;
  title: string;
  body: string;
}

export interface MomentLog {
  created_at: string;
  mood?: string | null;
  system_generated?: boolean | null;
}

export const MOMENTS_SIGNATURE = "Enviado desde mi panel de Humanix · https://humanix.lat";
/** Cuántos días tranquilos se recuerdan como máximo. */
export const MAX_CALM_MOMENTS = 2;
const POSITIVE: ReadonlySet<CareMood> = new Set<CareMood>(["happy", "calm"]);

/** Mediodía de Colombia del día calendario `dayIndex`. */
function noonOf(dayIndex: number): number {
  return dayIndex * DAY_MS + 12 * HOUR_MS - BOGOTA_OFFSET_MS;
}

export function buildCareMoments(input: {
  bookings: readonly CareDaysBooking[];
  logs?: readonly MomentLog[];
  now: number;
  tone?: RouteTone;
  /** Máximo de recuerdos devueltos (los más recientes). */
  limit?: number;
}): CareMoment[] {
  const { bookings, logs = [], now, tone = "warm", limit = 6 } = input;
  const days = [...careDaySet(bookings, logs, now)].sort((a, b) => a - b);
  if (days.length === 0) return [];

  const moments: CareMoment[] = [];
  const first = days[0];
  moments.push({
    id: `first-${first}`,
    kind: "first_day",
    at: noonOf(first),
    title: "Empezó el acompañamiento",
    body: `El ${dateEs(noonOf(first))} fue el primer día con cuidado.`,
  });

  if (tone === "warm") {
    for (const m of CARE_DAY_MILESTONES) {
      if (days.length < m) break;
      const at = noonOf(days[m - 1]);
      moments.push({
        id: `milestone-${m}`,
        kind: "milestone",
        at,
        title: `${plural(m, "día", "días")} con cuidado`,
        body: `El ${dateEs(at)} llegaron a ${m} días. Cada uno cuenta.`,
      });
    }
  }

  // Último ánimo anotado por una persona en cada día; solo los días tranquilos o contentos.
  const lastByDay = new Map<number, { t: number; mood: CareMood }>();
  for (const l of logs) {
    if (l.system_generated || !isCareMood(l.mood)) continue;
    const t = msOf(l.created_at);
    if (!Number.isFinite(t) || t > now) continue;
    const day = bogotaDayIndex(t);
    const prev = lastByDay.get(day);
    if (!prev || t > prev.t) lastByDay.set(day, { t, mood: l.mood });
  }
  const calm = [...lastByDay.entries()]
    .filter(([, v]) => POSITIVE.has(v.mood))
    .map(([d]) => d)
    .sort((a, b) => b - a)
    .slice(0, MAX_CALM_MOMENTS);
  for (const d of calm) {
    moments.push({
      id: `calm-${d}`,
      kind: "calm_day",
      at: noonOf(d),
      title: "Un día tranquilo",
      body: `El ${dateEs(noonOf(d))} el ánimo anotado fue tranquilo o contento.`,
    });
  }

  return moments
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

export interface MomentsShare {
  empty: boolean;
  text: string;
}

/** Texto para compartir con el círculo: solo recuerdos, sin nombres ni datos de salud. */
export function momentsShareText(
  moments: readonly CareMoment[],
  options: { tone?: RouteTone; signature?: boolean } = {},
): MomentsShare {
  const { tone = "warm", signature = true } = options;
  if (moments.length === 0) return { empty: true, text: "" };
  const lines = [
    tone === "warm"
      ? "Algunos buenos momentos de este camino 💛"
      : "Algunos momentos de este camino",
    "",
    ...moments.map((m) => `• ${dateEs(m.at)} — ${m.title}`),
    "",
    tone === "warm" ? "Gracias por cuidar juntos." : "Gracias por estar pendientes.",
  ];
  if (signature) lines.push("", MOMENTS_SIGNATURE);
  return { empty: false, text: lines.join("\n") };
}
