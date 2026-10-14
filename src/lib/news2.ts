// NEWS2 — National Early Warning Score 2 (Royal College of Physicians, 2017): puntaje de alerta temprana ante el deterioro agudo de
// una persona adulta, a partir de 7 parámetros (frecuencia respiratoria, saturación, aire u oxígeno, presión sistólica, pulso,
// conciencia y temperatura). Es el que usan los hospitales y las salas virtuales del NHS.
//
// Qué es y qué NO es:
//   · Es un apoyo para decidir cuándo mirar a alguien con más atención. No es un diagnóstico ni reemplaza el criterio clínico.
//   · Mide deterioro agudo; NO predice reingresos (un estudio de 2025 en salas virtuales halló un AUC de ~0,55 para eso).
//   · Es para personas de 16 años o más y que no estén embarazadas (en menores se usa una escala pediátrica; en embarazo, MEOWS).
//   · La escala 2 de SpO₂ (meta 88–92 %) solo la puede indicar un médico, por ejemplo en falla respiratoria hipercápnica.
//
// La base de datos calcula lo mismo en `public.hx_news2(...)` (migración 20261014100000): ahí se decide qué alertas se abren aunque
// nadie tenga la pantalla abierta. Este archivo es su espejo para la pantalla y las pruebas; ambas se comparan con los mismos vectores.

export type Avpu = "A" | "C" | "V" | "P" | "U";
export type Spo2Scale = 1 | 2;
export type News2Key = "rr" | "spo2" | "o2" | "sbp" | "hr" | "avpu" | "temp";
export type News2Band = "low" | "low_medium" | "medium" | "high";
/** Vocabulario de la pantalla (semáforo): verde, amarillo, naranja, rojo. */
export type Triage = "verde" | "amarillo" | "naranja" | "rojo";

export interface News2Input {
  /** Respiraciones por minuto. */
  rr?: number | null;
  /** Saturación de oxígeno en %. */
  spo2?: number | null;
  /** ¿Recibe oxígeno suplementario? `null` = no se sabe (se trata como aire). */
  onO2?: boolean | null;
  /** Presión arterial sistólica, mmHg. */
  sbp?: number | null;
  /** Pulso, latidos por minuto. */
  hr?: number | null;
  /** Conciencia: A alerta · C confusión nueva · V responde a la voz · P al dolor · U no responde. */
  avpu?: Avpu | null;
  /** Temperatura en °C. */
  tempC?: number | null;
  /** 2 solo si un médico la indicó para esa persona. */
  spo2Scale?: Spo2Scale;
}

export interface News2Part {
  key: News2Key;
  /** Puntos de este parámetro (0 a 3; el oxígeno suma 0 o 2). */
  score: number;
  /** ¿Se midió? Lo que no se midió suma 0 pero queda marcado como dato faltante. */
  measured: boolean;
  value: number | string | boolean | null;
}

export interface News2Result {
  /** Total, de 0 a 20. */
  score: number;
  /** Mayor puntaje de un solo parámetro (un 3 aislado ya pide revisión urgente). */
  maxSingle: number;
  /** Cuántos de los 7 parámetros se midieron. */
  measured: number;
  /** Faltaron parámetros: el total puede subestimar el riesgo. */
  partial: boolean;
  parts: News2Part[];
  band: News2Band;
  triage: Triage;
}

export const NEWS2_PARAM_COUNT = 7;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int = (v: number) => Math.round(v);
const oneDecimal = (v: number) => Math.round(v * 10) / 10;

export function scoreRr(rrRaw: number): number {
  const rr = int(rrRaw);
  if (rr <= 8) return 3;
  if (rr <= 11) return 1;
  if (rr <= 20) return 0;
  if (rr <= 24) return 2;
  return 3;
}

/** Saturación con la escala 1 (la de siempre) o la escala 2 (meta 88–92 %, solo por indicación médica). */
export function scoreSpo2(spo2Raw: number, scale: Spo2Scale, onO2: boolean): number {
  const s = int(spo2Raw);
  if (scale === 2) {
    if (s <= 83) return 3;
    if (s <= 85) return 2;
    if (s <= 87) return 1;
    if (s <= 92) return 0;
    if (!onO2) return 0; // 93 % o más respirando aire
    if (s <= 94) return 1;
    if (s <= 96) return 2;
    return 3;
  }
  if (s <= 91) return 3;
  if (s <= 93) return 2;
  if (s <= 95) return 1;
  return 0;
}

export function scoreSbp(sbpRaw: number): number {
  const sbp = int(sbpRaw);
  if (sbp <= 90) return 3;
  if (sbp <= 100) return 2;
  if (sbp <= 110) return 1;
  if (sbp <= 219) return 0;
  return 3;
}

export function scoreHr(hrRaw: number): number {
  const hr = int(hrRaw);
  if (hr <= 40) return 3;
  if (hr <= 50) return 1;
  if (hr <= 90) return 0;
  if (hr <= 110) return 1;
  if (hr <= 130) return 2;
  return 3;
}

export function scoreTemp(tempRaw: number): number {
  const t = oneDecimal(tempRaw);
  if (t <= 35.0) return 3;
  if (t <= 36.0) return 1;
  if (t <= 38.0) return 0;
  if (t <= 39.0) return 1;
  return 2;
}

export const scoreAvpu = (avpu: Avpu): number => (avpu === "A" ? 0 : 3);

/** Banda de riesgo clínico (tabla de la guía NEWS2). */
export function news2Band(score: number, maxSingle: number): News2Band {
  if (score >= 7) return "high";
  if (score >= 5) return "medium";
  if (maxSingle >= 3) return "low_medium"; // un solo parámetro con 3 puntos
  return "low";
}

export const TRIAGE_OF_BAND: Record<News2Band, Triage> = {
  low: "verde",
  low_medium: "amarillo",
  medium: "naranja",
  high: "rojo",
};

/** Calcula el NEWS2. Lo que no viene (o no es un número) no se puntúa y queda como no medido. */
export function news2(input: News2Input): News2Result {
  const scale: Spo2Scale = input.spo2Scale === 2 ? 2 : 1;
  const onO2 = input.onO2 === true;
  const parts: News2Part[] = [];

  const push = (
    key: News2Key,
    measured: boolean,
    value: News2Part["value"],
    score: number,
  ): void => {
    parts.push({ key, measured, value: measured ? value : null, score: measured ? score : 0 });
  };

  const rr = finite(input.rr) ? input.rr : null;
  push("rr", rr !== null, rr, rr !== null ? scoreRr(rr) : 0);

  const spo2 = finite(input.spo2) ? input.spo2 : null;
  push("spo2", spo2 !== null, spo2, spo2 !== null ? scoreSpo2(spo2, scale, onO2) : 0);

  const o2Known = typeof input.onO2 === "boolean";
  push("o2", o2Known, o2Known ? onO2 : null, onO2 ? 2 : 0);

  const sbp = finite(input.sbp) ? input.sbp : null;
  push("sbp", sbp !== null, sbp, sbp !== null ? scoreSbp(sbp) : 0);

  const hr = finite(input.hr) ? input.hr : null;
  push("hr", hr !== null, hr, hr !== null ? scoreHr(hr) : 0);

  const avpu = input.avpu && "ACVPU".includes(input.avpu) ? input.avpu : null;
  push("avpu", avpu !== null, avpu, avpu !== null ? scoreAvpu(avpu) : 0);

  const temp = finite(input.tempC) ? input.tempC : null;
  push("temp", temp !== null, temp, temp !== null ? scoreTemp(temp) : 0);

  const score = parts.reduce((sum, p) => sum + p.score, 0);
  const maxSingle = parts.reduce((m, p) => Math.max(m, p.score), 0);
  const measured = parts.filter((p) => p.measured).length;
  const band = news2Band(score, maxSingle);
  return {
    score,
    maxSingle,
    measured,
    partial: measured < NEWS2_PARAM_COUNT,
    parts,
    band,
    triage: TRIAGE_OF_BAND[band],
  };
}

/**
 * NEWS2 es para personas de 16 años o más. Sin fecha de nacimiento se asume adulta (la pantalla lo avisa);
 * en menores no se calcula: se usa la escala pediátrica del protocolo de la institución.
 */
export function news2Applicable(ageYears: number | null | undefined): boolean {
  return !finite(ageYears) || ageYears >= 16;
}

/**
 * Cada cuántos minutos, como máximo, debería repetirse el control según el puntaje (frecuencia mínima de la guía NEWS2):
 * 0 → 12 h · 1 a 4 → 4–6 h · un 3 aislado o 5–6 → 1 h · 7 o más → monitoreo continuo (aquí: un hueco de más de 15 min ya es un hueco).
 */
export function obsIntervalMinutes(score: number, maxSingle: number): number {
  if (score >= 7) return 15;
  if (score >= 5) return 60;
  if (maxSingle >= 3) return 60;
  if (score >= 1) return 360;
  return 720;
}

export interface BandInfo {
  label: string;
  /** Qué pide la guía para esa banda (parafraseado, en español). */
  guidance: string;
  /** Frecuencia mínima de controles, en texto. */
  frequency: string;
}

export const BAND_INFO: Record<News2Band, BandInfo> = {
  low: {
    label: "Estable",
    guidance: "Riesgo bajo. Continúa los controles según la frecuencia indicada.",
    frequency: "cada 4–6 h (cada 12 h si el puntaje es 0)",
  },
  low_medium: {
    label: "Atención",
    guidance:
      "Un parámetro suma 3 puntos: pide revisión clínica urgente por una persona con competencia para valorar.",
    frequency: "al menos cada hora",
  },
  medium: {
    label: "Urgente",
    guidance:
      "Riesgo medio. Respuesta urgente: revisión clínica por profesional con competencias en enfermedad aguda.",
    frequency: "al menos cada hora",
  },
  high: {
    label: "Crítico",
    guidance:
      "Riesgo alto. Respuesta de emergencia: valoración inmediata y considerar traslado o cuidado crítico.",
    frequency: "monitoreo continuo",
  },
};

export const TRIAGE_LABEL: Record<Triage, string> = {
  verde: "Estable",
  amarillo: "Atención",
  naranja: "Urgente",
  rojo: "Crítico",
};

export const NEWS2_DISCLAIMER =
  "Apoyo a la decisión clínica (NEWS2). No es un diagnóstico ni reemplaza el criterio del profesional. No aplica a menores de 16 años ni en embarazo.";

const PART_LABEL: Record<News2Key, string> = {
  rr: "Frecuencia respiratoria",
  spo2: "Saturación (SpO₂)",
  o2: "Oxígeno suplementario",
  sbp: "Presión sistólica",
  hr: "Pulso",
  avpu: "Conciencia",
  temp: "Temperatura",
};

const PART_UNIT: Partial<Record<News2Key, string>> = {
  rr: "/min",
  spo2: "%",
  sbp: "mmHg",
  hr: "/min",
  temp: "°C",
};

export const news2PartLabel = (key: News2Key): string => PART_LABEL[key];

/** Frases cortas para explicar de dónde sale el puntaje: «Pulso 118/min → 2 puntos». */
export function explainNews2(result: News2Result): string[] {
  return result.parts.map((p) => {
    const label = PART_LABEL[p.key];
    if (!p.measured) return `${label}: sin dato`;
    if (p.key === "o2") return `${label}: ${p.value ? "sí" : "no, respira aire"} → ${p.score} pts`;
    if (p.key === "avpu") {
      const names: Record<string, string> = {
        A: "alerta",
        C: "confusión nueva",
        V: "responde a la voz",
        P: "responde al dolor",
        U: "no responde",
      };
      return `${label}: ${names[String(p.value)] ?? p.value} → ${p.score} pts`;
    }
    return `${label}: ${p.value}${PART_UNIT[p.key] ? ` ${PART_UNIT[p.key]}` : ""} → ${p.score} pts`;
  });
}
