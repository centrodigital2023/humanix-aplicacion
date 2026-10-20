// Señales: qué le dice «Cuidar en familia» a la familia cuando algo preocupa. Puro.
//
// NO DIAGNOSTICA. La familia marca lo que observa; aquí se traduce a una guía de a quién acudir y con qué prisa, con las
// pocas señales que las guías clínicas tratan como urgentes en casa:
//  · señales generales de peligro del niño (AIEPI/IMCI de la OMS): no puede beber ni tomar pecho, vomita todo, convulsiones,
//    muy dormido o inconsciente → atención de inmediato;
//  · bebé de menos de 3 meses con fiebre de 38 °C o más: grupo de alto riesgo (guía NICE NG143);
//  · después de una cirugía (NHS): pierna hinchada, caliente o dolorosa; herida con enrojecimiento, calor o secreción;
//    fiebre; dificultad para respirar o dolor en el pecho;
//  · derrame cerebral (cara caída, brazo débil, habla enredada): cada minuto cuenta.
// Todo lo demás se anota y se comenta con el médico. Cada guía recuerda que no es un diagnóstico y que, ante la duda,
// se consulta. Tampoco avisa a nadie por sí sola: el aviso a la familia lo da la base de datos (ver la migración).
import {
  GOOD_MOOD,
  ITEMS_BY_KIND,
  LOW_MOOD,
  SIGNAL_KEYS,
  SIGNAL_LABEL,
  type FamKind,
  type SignalKey,
  type SignalLevel,
} from "./famCareTypes";
import {
  addDays,
  dayIndex,
  daysBetween,
  isDayKey,
  keyFromIndex,
  type DayKey,
  type DaySummary,
} from "./famCareDays";
import { bogotaYmd, plural } from "./intelShared";

export const NOT_A_DIAGNOSIS =
  "Esto es una guía para la familia, no un diagnóstico. Ante la duda, consulta.";

export const LEVEL_LABEL: Record<SignalLevel, string> = {
  emergency: "Busca ayuda ya",
  urgent: "Que lo vea un médico hoy",
  watch: "Para vigilar",
};

const RANK: Record<SignalLevel, number> = { emergency: 0, urgent: 1, watch: 2 };

export const EMERGENCY_LINE =
  "ve a urgencias o llama a la línea de emergencias de tu ciudad (en la mayoría es el 123)";

// ── Edad ─────────────────────────────────────────────────────────────────────

/** Meses cumplidos entre una fecha de nacimiento (AAAA-MM-DD) y hoy en Colombia; `null` si falta o es imposible. */
export function ageMonths(birthDate: string | null | undefined, now: number): number | null {
  if (!birthDate || !isDayKey(birthDate)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const { y, m, d } = bogotaYmd(now);
  const months = (y - by) * 12 + (m - bm) - (d < bd ? 1 : 0);
  return months >= 0 ? months : null;
}

/** «78 años», «8 meses», «2 años y 3 meses»; vacío si no se conoce. */
export function ageLabelEs(birthDate: string | null | undefined, now: number): string {
  const months = ageMonths(birthDate, now);
  if (months === null) return "";
  if (months < 1) return "recién nacido";
  if (months < 24) return plural(months, "mes", "meses");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years >= 10 || rest === 0) return plural(years, "año", "años");
  return `${plural(years, "año", "años")} y ${plural(rest, "mes", "meses")}`;
}

// ── Una señal ────────────────────────────────────────────────────────────────

export interface SignalContext {
  kind: FamKind;
  /** Meses de edad si se conoce la fecha de nacimiento. */
  ageMonths: number | null;
}

export interface Flag {
  key: SignalKey;
  level: SignalLevel;
  title: string;
  guidance: string;
}

const BASE_LEVEL: Record<SignalKey, SignalLevel> = {
  breathing: "emergency",
  chest_pain: "emergency",
  stroke: "emergency",
  seizure: "emergency",
  unresponsive: "emergency",
  bleeding: "emergency",
  wound_infection: "urgent",
  leg_clot: "urgent",
  no_drink: "urgent",
  vomit_all: "urgent",
  confused: "urgent",
  fever: "watch",
  fall: "watch",
  pain: "watch",
  no_appetite: "watch",
  bad_sleep: "watch",
};

/** Bebé de menos de 3 meses: la fiebre es de alto riesgo. */
const INFANT_MONTHS = 3;

export function levelOf(key: SignalKey, ctx: SignalContext): SignalLevel {
  if (key === "fever") {
    if (ctx.kind === "child" && ctx.ageMonths !== null && ctx.ageMonths < INFANT_MONTHS)
      return "emergency";
    if (ctx.kind === "surgery") return "urgent";
  }
  return BASE_LEVEL[key];
}

function guidanceFor(key: SignalKey, level: SignalLevel, ctx: SignalContext): string {
  switch (key) {
    case "stroke":
      return `Puede ser un derrame cerebral y cada minuto cuenta: llama ya a la línea de emergencias de tu ciudad (en la mayoría es el 123). No esperes a que mejore.`;
    case "bleeding":
      return `Presiona la zona con un paño limpio y busca atención médica ya: ${EMERGENCY_LINE}.`;
    case "seizure":
      return `Si no es una convulsión conocida y manejada con su plan médico, busca atención médica ya: ${EMERGENCY_LINE}. Acuéstale de lado y no le metas nada en la boca.`;
    case "leg_clot":
      return `Una pierna hinchada, caliente o con dolor después de una cirugía puede ser un coágulo: busca atención médica hoy mismo. Si además le cuesta respirar o tiene dolor en el pecho, es una emergencia: ${EMERGENCY_LINE}.`;
    case "wound_infection":
      return "Pueden ser signos de infección de la herida: llama hoy a su médico o a tu EPS. Si hay fiebre alta o empeora, ve a urgencias.";
    case "no_drink":
    case "vomit_all":
      return ctx.kind === "child"
        ? "Es una señal de peligro en un niño o una niña: llévalo hoy mismo a urgencias."
        : "Si no retiene líquidos, conviene que lo vea un médico hoy: llama a tu EPS o ve a urgencias.";
    case "confused":
      return "Un cambio brusco en cómo piensa, habla o reconoce a las personas necesita valoración médica hoy.";
    case "fever":
      if (level === "emergency")
        return "Un bebé de menos de 3 meses con fiebre debe ser visto por un médico de inmediato: ve a urgencias ahora.";
      if (level === "urgent")
        return "La fiebre después de una cirugía debe comentarse hoy con su médico o su EPS.";
      return ctx.kind === "child" && ctx.ageMonths === null
        ? "Controla la temperatura y que tome líquidos; si se ve decaído o tienes dudas, consulta. Si es menor de 3 meses, ve a urgencias de inmediato."
        : "Controla la temperatura y que tome líquidos; si se ve decaído, la fiebre no cede o tienes dudas, consulta.";
    case "fall":
      return "Una caída merece atención: si se golpeó la cabeza, no puede levantarse o tiene mucho dolor, consulta de inmediato.";
    case "pain":
      return ctx.kind === "surgery"
        ? "Si el dolor no cede con lo que indicó su cirujano, llama a su médico o a tu EPS."
        : "Si el dolor no cede con lo que indicó su médico, consulta.";
    case "no_appetite":
      return "Un par de días comiendo poco conviene comentarlo con su médico.";
    case "bad_sleep":
      return "Anótalo: si se repite varios días, coméntalo con su médico.";
    default:
      return level === "emergency"
        ? `Busca atención médica ya: ${EMERGENCY_LINE}.`
        : "Anótalo y coméntalo con su médico.";
  }
}

export function flagFor(key: SignalKey, ctx: SignalContext): Flag {
  const level = levelOf(key, ctx);
  return { key, level, title: SIGNAL_LABEL[key], guidance: guidanceFor(key, level, ctx) };
}

/** Las señales, de la más grave a la más leve (a igual nivel, en el orden del vocabulario). */
export function flagsOf(keys: readonly SignalKey[], ctx: SignalContext): Flag[] {
  const wanted = new Set(keys);
  return SIGNAL_KEYS.filter((k) => wanted.has(k))
    .map((k) => flagFor(k, ctx))
    .sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** Qué señales cuentan como bandera (urgente o emergencia) para esta persona. */
export function urgentSignalsFor(ctx: SignalContext): Set<SignalKey> {
  return new Set(SIGNAL_KEYS.filter((k) => levelOf(k, ctx) !== "watch"));
}

export function worstLevel(levels: readonly SignalLevel[]): SignalLevel | null {
  let best: SignalLevel | null = null;
  for (const l of levels) if (best === null || RANK[l] < RANK[best]) best = l;
  return best;
}

// ── Patrones de varios días ──────────────────────────────────────────────────

export type PatternId = "low_mood" | "appetite" | "sleep" | "meds_gap" | "fall_combo";

export interface Pattern {
  id: PatternId;
  level: Exclude<SignalLevel, "emergency">;
  title: string;
  detail: string;
}

/** Cuántos días seguidos con ánimo bajo se avisan. */
export const LOW_MOOD_RUN = 3;

const lastDay = (today: DayKey, i: number) => keyFromIndex(dayIndex(today) - i);

export function detectPatterns(input: {
  kind: FamKind;
  summaries: ReadonlyMap<DayKey, DaySummary>;
  today: DayKey;
}): Pattern[] {
  const { kind, summaries, today } = input;
  const out: Pattern[] = [];
  const at = (i: number) => summaries.get(lastDay(today, i));

  // Ánimo bajo tres días seguidos (contando desde hoy, o desde ayer si hoy aún no se anota).
  const start = at(0) ? 0 : 1;
  const run = [0, 1, 2].map((k) => at(start + k));
  if (run.every((d) => d && d.mood !== null && d.mood <= LOW_MOOD)) {
    out.push({
      id: "low_mood",
      level: "watch",
      title: "Tres días con el ánimo bajo",
      detail:
        "Conviene conversar con la persona sobre cómo se siente y comentarlo con su médico si sigue así.",
    });
  }

  // Comió poco en 2 de los últimos 3 días.
  const poorFood = [0, 1, 2].filter((i) => at(i)?.signals.includes("no_appetite")).length;
  if (poorFood >= 2) {
    out.push({
      id: "appetite",
      level: "watch",
      title: "Varios días comiendo poco",
      detail: "Comió poco en dos de los últimos tres días. Conviene comentarlo con su médico.",
    });
  }

  // No pudo dormir en 3 de los últimos 5 días.
  const poorSleep = [0, 1, 2, 3, 4].filter((i) => at(i)?.signals.includes("bad_sleep")).length;
  if (poorSleep >= 3) {
    out.push({
      id: "sleep",
      level: "watch",
      title: "Varias noches sin dormir bien",
      detail: "Durmió mal en tres de los últimos cinco días. Si sigue, coméntalo con su médico.",
    });
  }

  // Caída con dolor o confusión (hoy, o ayer si hoy aún no se anota).
  const recent = at(0) ?? at(1);
  if (
    recent?.signals.includes("fall") &&
    (recent.signals.includes("pain") || recent.signals.includes("confused"))
  ) {
    out.push({
      id: "fall_combo",
      level: "urgent",
      title: "Una caída con dolor o confusión",
      detail:
        "Después de una caída, el dolor o la confusión necesitan que lo revise un médico hoy.",
    });
  }

  // Medicinas sin marcar: de las últimas 3 anotaciones, 2 sin la medicina (hace falta un mínimo de datos).
  if (ITEMS_BY_KIND[kind].includes("meds") && kind !== "child") {
    const recentDays = [0, 1, 2, 3, 4]
      .map((i) => at(i))
      .filter((d): d is DaySummary => Boolean(d))
      .slice(0, 3);
    if (
      recentDays.length === 3 &&
      recentDays.filter((d) => !d.items.includes("meds")).length >= 2
    ) {
      out.push({
        id: "meds_gap",
        level: "watch",
        title: "La medicina quedó sin marcar",
        detail:
          "En 2 de los últimos 3 días no quedó marcado que tomara sus medicinas. Puede que sí las tomara y no se anotara: revisa que las tomas estén al día.",
      });
    }
  }
  return out;
}

// ── Silencio ─────────────────────────────────────────────────────────────────

export interface Silence {
  /** Días completos sin ninguna anotación (sin contar hoy, que todavía se puede anotar). */
  days: number;
  title: string;
  detail: string;
}

/** Cuántos días completos sin anotación se avisan, según la situación. */
export function silenceThreshold(kind: FamKind, routeDay: number | null): number {
  if (kind === "illness") return 1;
  if (kind === "surgery" && routeDay !== null && routeDay >= 0 && routeDay <= 7) return 1;
  return 2;
}

export function silenceOf(input: {
  kind: FamKind;
  lit: ReadonlySet<DayKey>;
  today: DayKey;
  /** Día de la ruta (días desde la cirugía o el inicio) si se conoce. */
  routeDay?: number | null;
}): Silence | null {
  const { kind, lit, today } = input;
  if (lit.has(today)) return null;
  const past = [...lit].filter((k) => isDayKey(k) && dayIndex(k) < dayIndex(today)).sort();
  if (!past.length) return null; // todavía no se ha anotado nada: lo cubre la bienvenida
  const last = past[past.length - 1];
  const days = daysBetween(last, today) - 1;
  if (days < silenceThreshold(kind, input.routeDay ?? null)) return null;
  return {
    days,
    title: `Sin registro hace ${plural(days, "día", "días")}`,
    detail:
      "Una llamada o una visita hoy ayuda a saber cómo está. Puedes pedir una mano al círculo.",
  };
}

// ── Estado de la persona ─────────────────────────────────────────────────────

export type StatusLevel = "emergency" | "urgent" | "attention" | "calm";

export interface RecipientStatus {
  level: StatusLevel;
  /** Señales vigentes: las del último día con anotación si fue hoy o ayer. */
  flags: Flag[];
  patterns: Pattern[];
  silence: Silence | null;
  /** Último día con anotación entre hoy y ayer (de ahí salen las señales vigentes). */
  flagDay: DayKey | null;
}

export function recipientStatus(input: {
  kind: FamKind;
  ageMonths: number | null;
  summaries: ReadonlyMap<DayKey, DaySummary>;
  today: DayKey;
  routeDay?: number | null;
}): RecipientStatus {
  const { kind, summaries, today } = input;
  const ctx: SignalContext = { kind, ageMonths: input.ageMonths };
  const todayS = summaries.get(today);
  const yestKey = addDays(today, -1);
  const yestS = summaries.get(yestKey);
  const flagDay = todayS ? today : yestS ? yestKey : null;
  const flagSource = todayS ?? yestS ?? null;
  const flags = flagSource ? flagsOf(flagSource.signals, ctx) : [];
  const patterns = detectPatterns({ kind, summaries, today });
  const silence = silenceOf({
    kind,
    lit: new Set(summaries.keys()),
    today,
    routeDay: input.routeDay ?? null,
  });

  const levels: SignalLevel[] = [...flags.map((f) => f.level), ...patterns.map((p) => p.level)];
  const worst = worstLevel(levels);
  const level: StatusLevel =
    worst === "emergency"
      ? "emergency"
      : worst === "urgent"
        ? "urgent"
        : worst === "watch" || silence
          ? "attention"
          : "calm";
  return { level, flags, patterns, silence, flagDay };
}

/** ¿El día fue bueno? (ánimo de 4 o 5 y ninguna señal de urgencia). Para el tono de las frases. */
export function isGoodDay(day: DaySummary | undefined, urgent: ReadonlySet<SignalKey>): boolean {
  return Boolean(
    day && day.mood !== null && day.mood >= GOOD_MOOD && !day.signals.some((k) => urgent.has(k)),
  );
}
