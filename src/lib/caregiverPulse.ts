// «¿Y tú, cómo estás?» — el clima semanal de quien cuida. Lógica pura, sin base de datos.
//
// Quien cuida casi nunca se pregunta cómo está. Una vez por semana, un toque: despejado, nublado, lluvioso o tormenta.
// La metáfora del clima es deliberada: dice cómo va la semana sin pedir un puntaje ni nombrar síntomas.
//
// Evidencia (ver `docs/PANEL_FAMILIA_RUTAS_DE_CUIDADO.md`): las intervenciones digitales para cuidadores reducen la
// carga y el estrés a corto plazo con efecto moderado; el efecto a largo plazo no está claro. Por eso esto no promete
// resultados: invita a pausar y a pedir ayuda al círculo.
//
// Reglas firmes:
//  - No es una escala clínica ni un tamizaje: no diagnostica, no puntúa, no compara con otras personas.
//  - Se guarda solo en este navegador: nadie más lo ve (ni el círculo, ni el profesional, ni Humanix).
//  - Nunca regaña. Ante tormenta, recuerda el 123 si hay peligro y sugiere buscar ayuda profesional, sin asumir nada.

import { bogotaDayIndex } from "./intelShared";

export const WEATHERS = ["sunny", "cloudy", "rainy", "stormy"] as const;
export type Weather = (typeof WEATHERS)[number];

export interface WeatherMeta {
  label: string;
  /** Icono de lucide-react (el componente lo resuelve). */
  icon: "Sun" | "CloudSun" | "CloudRain" | "CloudLightning";
  /** Respuesta amable al marcarlo. */
  reply: string;
}

export const WEATHER_META: Record<Weather, WeatherMeta> = {
  sunny: {
    label: "Despejado",
    icon: "Sun",
    reply: "Qué bueno. Guarda algo de esta semana para los días nublados.",
  },
  cloudy: {
    label: "Nublado",
    icon: "CloudSun",
    reply: "Semana a medias. Un rato solo para ti también es parte del cuidado.",
  },
  rainy: {
    label: "Lluvioso",
    icon: "CloudRain",
    reply:
      "Cuidar cansa, y está bien decirlo. ¿Qué podría hacer alguien del círculo por ti esta semana?",
  },
  stormy: {
    label: "Tormenta",
    icon: "CloudLightning",
    reply: "Gracias por decirlo. No tienes que poder con todo: pedir un relevo también es cuidar.",
  },
};

/** Siempre visible junto a «tormenta». */
export const STORM_SUPPORT =
  "Si sientes que ya no puedes más, busca hoy a alguien de confianza o a un profesional de salud. Si hay peligro, llama al 123.";

export const PULSE_PRIVACY = "Solo se guarda en este navegador. Nadie más lo ve.";

/** Semanas que se guardan y se dibujan. */
export const PULSE_WEEKS = 8;

export interface PulseEntry {
  /** Semana (lunes a domingo, hora de Colombia) como número entero. */
  week: number;
  weather: Weather;
}

/** Semana de lunes a domingo (hora de Colombia). El 1 de enero de 1970 fue jueves: +3 alinea el corte al lunes. */
export function bogotaWeekIndex(t: number): number {
  return Math.floor((bogotaDayIndex(t) + 3) / 7);
}

export function isWeather(v: unknown): v is Weather {
  return typeof v === "string" && (WEATHERS as readonly string[]).includes(v);
}

/** Entradas válidas, una por semana (gana la última), ordenadas y solo las últimas `PULSE_WEEKS`. */
export function sanitizePulse(raw: unknown): PulseEntry[] {
  if (!Array.isArray(raw)) return [];
  const byWeek = new Map<number, Weather>();
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { week, weather } = e as Record<string, unknown>;
    if (!Number.isInteger(week) || (week as number) <= 0 || !isWeather(weather)) continue;
    byWeek.set(week as number, weather);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-PULSE_WEEKS)
    .map(([week, weather]) => ({ week, weather }));
}

/** Guarda (o cambia) el clima de esta semana. */
export function recordPulse(
  entries: readonly PulseEntry[],
  now: number,
  weather: Weather,
): PulseEntry[] {
  const week = bogotaWeekIndex(now);
  return sanitizePulse([...entries.filter((e) => e.week !== week), { week, weather }]);
}

const HARD: ReadonlySet<Weather> = new Set(["rainy", "stormy"]);

export interface PulseSummary {
  thisWeek: Weather | null;
  /** Las últimas `PULSE_WEEKS` semanas, de la más antigua a esta; `null` donde no se marcó. */
  strip: Array<Weather | null>;
  /** Tormenta esta semana, o dos semanas difíciles seguidas: proponer un relevo del círculo. */
  suggestHelp: boolean;
  /** Mostrar el apoyo de crisis (solo con tormenta esta semana). */
  showSupport: boolean;
  line: string;
}

export function pulseSummary(entries: readonly PulseEntry[], now: number): PulseSummary {
  const clean = sanitizePulse(entries);
  const week = bogotaWeekIndex(now);
  const byWeek = new Map(clean.map((e) => [e.week, e.weather]));
  const strip = Array.from(
    { length: PULSE_WEEKS },
    (_, i) => byWeek.get(week - (PULSE_WEEKS - 1 - i)) ?? null,
  );
  const thisWeek = byWeek.get(week) ?? null;
  const lastWeek = byWeek.get(week - 1) ?? null;
  const suggestHelp =
    thisWeek === "stormy" ||
    (thisWeek !== null && lastWeek !== null && HARD.has(thisWeek) && HARD.has(lastWeek));
  const line =
    thisWeek === null
      ? "Un toque y listo: ¿cómo va tu semana?"
      : suggestHelp && thisWeek !== "stormy"
        ? "Van dos semanas pesadas. Mereces un relevo: el círculo puede ayudar."
        : WEATHER_META[thisWeek].reply;
  return { thisWeek, strip, suggestHelp, showSupport: thisWeek === "stormy", line };
}
