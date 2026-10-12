// «Héroe del día» de los tres paneles (familia, profesional, institución) — lógica pura.
//
// Lo que comparten: cuánta calma tiene el día (10-100), el tono, un saludo cálido y una frase de acompañamiento. Cada panel
// arma su propia lista de pendientes con sus reglas; aquí solo se mide y se redacta, de forma que dos paneles con la misma
// carga muestren la misma calma. No decide nada ni contacta a nadie.
import { BOGOTA_OFFSET_MS, bogotaDayIndex } from "./intelShared";

export type HeroPriority = "critical" | "high" | "medium" | "low";
export type HeroTone = "calm" | "attention" | "urgent";
export type HeroRole = "family" | "professional" | "institution";
export type DayPart = "morning" | "afternoon" | "evening";

/**
 * Cuánta calma resta cada pendiente y cuántos de cada nivel cuentan. Pasado el tope, otro pendiente igual ya no cambia
 * la historia (seis alertas no son «el doble de graves» que tres): evita que una lista larga hunda la calma a cero por
 * volumen y deja el 0 para cuando de verdad hay varias urgencias.
 */
export const CALM_WEIGHT: Record<HeroPriority, { penalty: number; max: number }> = {
  critical: { penalty: 35, max: 2 },
  high: { penalty: 14, max: 3 },
  medium: { penalty: 5, max: 4 },
  low: { penalty: 1, max: 5 },
};

/**
 * Piso de la calma. Un 0 se lee como un fracaso y asusta a quien ya está preocupado; el índice no mide a la persona
 * sino cuánto hay por atender, así que con muchas urgencias queda en un valor bajo pero nunca en cero.
 */
export const CALM_FLOOR = 10;

/** Calma del día de 10 a 100 a partir de las prioridades de los pendientes. 100 = nada pide atención. */
export function calmScore(priorities: readonly HeroPriority[]): number {
  const counts: Record<HeroPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const p of priorities) if (p in counts) counts[p] += 1;
  let penalty = 0;
  for (const level of Object.keys(CALM_WEIGHT) as HeroPriority[]) {
    const w = CALM_WEIGHT[level];
    penalty += Math.min(counts[level], w.max) * w.penalty;
  }
  return Math.max(CALM_FLOOR, Math.min(100, 100 - penalty));
}

/** Urgente si hay algo crítico; atención si hay algo importante; en calma si solo quedan tareas suaves. */
export function heroTone(priorities: readonly HeroPriority[]): HeroTone {
  if (priorities.includes("critical")) return "urgent";
  if (priorities.includes("high")) return "attention";
  return "calm";
}

export const TONE_LABEL: Record<HeroTone, string> = {
  calm: "Todo en orden",
  attention: "Requiere atención",
  urgent: "Urgente",
};

/** Hora de Colombia (0-23) de un instante. */
export function bogotaHour(now: Date | number): number {
  const ms = typeof now === "number" ? now : now.getTime();
  return new Date(ms + BOGOTA_OFFSET_MS).getUTCHours();
}

/**
 * Momento del día en Colombia: de 6 a 11:59 es mañana, hasta las 18:59 tarde y de las 19 a las 5:59 noche. De madrugada
 * se saluda de noche (quien está en un turno nocturno no necesita un «buenos días» a las 3).
 */
export function dayPart(now: Date | number): DayPart {
  const h = bogotaHour(now);
  return h < 6 ? "evening" : h < 12 ? "morning" : h < 19 ? "afternoon" : "evening";
}

const GREETING: Record<DayPart, string> = {
  morning: "Buenos días",
  afternoon: "Buenas tardes",
  evening: "Buenas noches",
};

/** «Buenos días, Ana»: solo el primer nombre; sin nombre (o con un correo en su lugar) queda el saludo solo. */
export function warmGreeting(now: Date | number, name?: string | null): string {
  const base = GREETING[dayPart(now)];
  const raw = (name ?? "").trim();
  if (!raw || raw.includes("@")) return base;
  const first = raw.split(/\s+/)[0];
  return first ? `${base}, ${first}` : base;
}

/**
 * Frases de acompañamiento. No prometen nada ni hablan de salud: reconocen lo que la persona hace y la invitan al
 * siguiente paso. Varias por caso para que no se lea siempre lo mismo; la del día sale de la fecha, así no parpadea.
 */
const WARM: Record<HeroRole, Record<HeroTone, readonly string[]>> = {
  family: {
    calm: [
      "Lo importante está cubierto: puedes dedicarte a estar presente.",
      "Hoy no hay nada urgente. Gracias por cuidar con tanto cariño.",
      "Respira: tu familiar está acompañado y tu agenda, al día.",
    ],
    attention: [
      "Estamos contigo: te dejamos primero lo que más importa.",
      "Unas pocas decisiones, ordenadas de la más a la menos importante.",
      "No tienes que acordarte de todo: aquí está lo que toca hoy.",
    ],
    urgent: [
      "Vamos paso a paso: empieza por lo primero de la lista.",
      "Esto es lo que más importa ahora; el resto puede esperar.",
      "Tranquilidad: te mostramos qué hacer primero.",
    ],
  },
  professional: {
    calm: [
      "Tu día está en orden. Gracias por cuidar.",
      "Cuidar también es cuidarte: hoy llevas buen ritmo.",
      "Tu trabajo se nota en cada familia que te elige.",
    ],
    attention: [
      "Tienes oportunidades y pendientes: te ordenamos lo importante.",
      "Un par de respuestas a tiempo marcan la diferencia con las familias.",
      "Paso a paso: primero lo que vence antes.",
    ],
    urgent: [
      "Un paciente te necesita: empieza por lo primero de la lista.",
      "Lo urgente está arriba; lo demás puede esperar.",
      "Tu cuidado hace la diferencia. Esto va primero.",
    ],
  },
  institution: {
    calm: [
      "Operación estable: tu equipo está al día.",
      "Cobertura bajo control. Buen momento para planear la semana.",
      "Un equipo bien cuidado cuida mejor: todo marcha en orden.",
    ],
    attention: [
      "Tu cobertura necesita algunas decisiones hoy.",
      "Resolver esto temprano evita turnos sin cubrir mañana.",
      "Te dejamos primero lo que más pesa en la operación.",
    ],
    urgent: [
      "Hay turnos o alertas que no pueden esperar: empieza por aquí.",
      "Prioridad ahora: lo que afecta la atención de los pacientes.",
      "Lo urgente está arriba; el resto se organiza después.",
    ],
  },
};

/** La frase de acompañamiento del día: estable durante el día y distinta de un día a otro. */
export function warmLine(role: HeroRole, tone: HeroTone, now: Date | number): string {
  const lines = WARM[role][tone];
  const day = bogotaDayIndex(typeof now === "number" ? now : now.getTime());
  return lines[day % lines.length];
}

/** Texto para lectores de pantalla del anillo de calma. */
export function calmAriaLabel(calm: number, tone: HeroTone): string {
  return `Calma del día: ${calm} de 100. ${TONE_LABEL[tone]}.`;
}

export interface HeroStat {
  label: string;
  value: number | string;
}

/** Cantidades que se muestran como cifras: enteros no negativos; lo demás se descarta para no pintar «NaN». */
export function cleanStats(stats: readonly HeroStat[]): HeroStat[] {
  return stats.filter((s) =>
    typeof s.value === "number" ? Number.isFinite(s.value) && s.value >= 0 : s.value.trim() !== "",
  );
}

/**
 * Lo que se muestra de entrada: las primeras `max` acciones, más cualquier acción crítica aunque pase del límite (nunca
 * se esconde lo urgente, venga en el orden que venga). El resto queda detrás de «Ver N más», en su mismo orden.
 */
export function splitVisible<T extends { priority: HeroPriority }>(
  items: readonly T[],
  max = 4,
): { shown: T[]; hidden: T[] } {
  const shown: T[] = [];
  const hidden: T[] = [];
  items.forEach((item, index) => {
    if (index < max || item.priority === "critical") shown.push(item);
    else hidden.push(item);
  });
  return { shown, hidden };
}

const PRIORITY_ORDER: Record<HeroPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface Orderable {
  /** Identificador de la regla, con un sufijo opcional tras «:» para varios ítems de una misma regla. */
  id: string;
  priority: HeroPriority;
  /** Cuándo ocurre (o vence): lo que pasa antes va primero. Sin dato, al final de su grupo. */
  sortKey?: number;
}

/**
 * Orden del día de cualquier panel: primero la prioridad, luego lo que ocurre o vence antes, luego el lugar de la regla
 * en `ruleRank` (lo que se actúa ya antes de lo que solo invita) y por último el id, para que el resultado no dependa
 * del orden en que llegaron los datos. No modifica la lista original.
 */
export function orderBrief<T extends Orderable>(
  items: readonly T[],
  ruleRank: readonly string[],
): T[] {
  const rankOf = (id: string) => {
    const i = ruleRank.indexOf(id.split(":")[0]);
    return i === -1 ? ruleRank.length : i;
  };
  return [...items].sort(
    (a, b) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.sortKey ?? Number.POSITIVE_INFINITY) - (b.sortKey ?? Number.POSITIVE_INFINITY) ||
      rankOf(a.id) - rankOf(b.id) ||
      a.id.localeCompare(b.id),
  );
}
