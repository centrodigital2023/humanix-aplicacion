export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface VitalReading {
  type: string;
  value: number;
  recorded_at: string;
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: string;
  direction: "increase" | "decrease" | "neutral";
}

export interface RiskRecommendation {
  priority: "high" | "medium" | "low";
  action: string;
  rationale: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  recommendations: RiskRecommendation[];
  summary: string;
  trend: "improving" | "stable" | "worsening";
}

type Severity = 0 | 1 | 2 | 3;
const POINTS: Record<Severity, number> = { 0: 0, 1: 8, 2: 15, 3: 25 };

interface Rule {
  type: string;
  name: string;
  unit: string;
  evaluate: (v: number) => { severity: Severity; direction: "increase" | "decrease" | "neutral" };
  action: string;
}

const RULES: Rule[] = [
  {
    type: "heart_rate",
    name: "Frecuencia cardíaca",
    unit: "lpm",
    evaluate: (v) =>
      v > 130 || v < 40
        ? { severity: 3, direction: v > 130 ? "increase" : "decrease" }
        : v > 110 || v < 50
          ? { severity: 2, direction: v > 110 ? "increase" : "decrease" }
          : v > 100 || v < 60
            ? { severity: 1, direction: v > 100 ? "increase" : "decrease" }
            : { severity: 0, direction: "neutral" },
    action: "Monitorear la frecuencia cardíaca cada 4 horas",
  },
  {
    type: "spo2",
    name: "Saturación de oxígeno",
    unit: "%",
    evaluate: (v) =>
      v < 90
        ? { severity: 3, direction: "decrease" }
        : v < 92
          ? { severity: 2, direction: "decrease" }
          : v < 95
            ? { severity: 1, direction: "decrease" }
            : { severity: 0, direction: "neutral" },
    action: "Vigilar la saturación de oxígeno y avisar al médico tratante",
  },
  {
    type: "temperature",
    name: "Temperatura",
    unit: "°C",
    evaluate: (v) =>
      v >= 39.5 || v < 35
        ? { severity: 3, direction: v >= 39.5 ? "increase" : "decrease" }
        : v >= 38.5
          ? { severity: 2, direction: "increase" }
          : v >= 37.8 || v < 35.5
            ? { severity: 1, direction: v >= 37.8 ? "increase" : "decrease" }
            : { severity: 0, direction: "neutral" },
    action: "Controlar la temperatura y evaluar signos de infección",
  },
  {
    type: "blood_pressure_sys",
    name: "Presión sistólica",
    unit: "mmHg",
    evaluate: (v) =>
      v >= 180 || v < 80
        ? { severity: 3, direction: v >= 180 ? "increase" : "decrease" }
        : v >= 160 || v < 90
          ? { severity: 2, direction: v >= 160 ? "increase" : "decrease" }
          : v >= 140
            ? { severity: 1, direction: "increase" }
            : { severity: 0, direction: "neutral" },
    action: "Registrar la presión arterial y revisar la medicación con el médico",
  },
  {
    type: "blood_pressure_dia",
    name: "Presión diastólica",
    unit: "mmHg",
    evaluate: (v) =>
      v >= 120
        ? { severity: 3, direction: "increase" }
        : v >= 100
          ? { severity: 2, direction: "increase" }
          : v >= 90
            ? { severity: 1, direction: "increase" }
            : { severity: 0, direction: "neutral" },
    action: "Registrar la presión arterial y revisar la medicación con el médico",
  },
  {
    type: "respiration_rate",
    name: "Frecuencia respiratoria",
    unit: "rpm",
    evaluate: (v) =>
      v > 28 || v < 8
        ? { severity: 3, direction: v > 28 ? "increase" : "decrease" }
        : v > 24 || v < 10
          ? { severity: 2, direction: v > 24 ? "increase" : "decrease" }
          : v > 20 || v < 12
            ? { severity: 1, direction: v > 20 ? "increase" : "decrease" }
            : { severity: 0, direction: "neutral" },
    action: "Observar el patrón respiratorio y consultar si persiste",
  },
  {
    type: "glucose",
    name: "Glucosa",
    unit: "mg/dL",
    evaluate: (v) =>
      v > 300 || v < 54
        ? { severity: 3, direction: v > 300 ? "increase" : "decrease" }
        : v > 250 || v < 70
          ? { severity: 2, direction: v > 250 ? "increase" : "decrease" }
          : v > 180
            ? { severity: 1, direction: "increase" }
            : { severity: 0, direction: "neutral" },
    action: "Controlar la glucosa y seguir el plan indicado por el médico",
  },
];

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function trendForScores(
  current: number,
  previous: number | null | undefined,
): "improving" | "stable" | "worsening" {
  if (previous == null) return "stable";
  if (current - previous >= 5) return "worsening";
  if (previous - current >= 5) return "improving";
  return "stable";
}

const LEVEL_TEXT: Record<RiskLevel, string> = {
  low: "bajo",
  medium: "moderado",
  high: "alto",
  critical: "crítico",
};

/**
 * Calcula el riesgo a partir de mediciones reales. Devuelve null si no hay
 * ninguna medición evaluable (nunca inventa datos).
 */
export function computeRisk(
  readings: VitalReading[],
  previousScore?: number | null,
): RiskResult | null {
  const latest = new Map<string, VitalReading>();
  for (const r of readings) {
    if (!Number.isFinite(r.value)) continue;
    const prev = latest.get(r.type);
    if (!prev || r.recorded_at > prev.recorded_at) latest.set(r.type, r);
  }

  const factors: RiskFactor[] = [];
  const recommendations = new Map<string, RiskRecommendation>();
  let evaluated = 0;
  let total = 0;

  for (const rule of RULES) {
    const r = latest.get(rule.type);
    if (!r) continue;
    evaluated++;
    const { severity, direction } = rule.evaluate(r.value);
    const weight = POINTS[severity];
    total += weight;
    factors.push({
      name: rule.name,
      weight,
      value: `${r.value} ${rule.unit}`,
      direction,
    });
    if (severity > 0 && !recommendations.has(rule.action)) {
      recommendations.set(rule.action, {
        priority: severity === 3 ? "high" : severity === 2 ? "medium" : "low",
        action: rule.action,
        rationale: `${rule.name}: ${r.value} ${rule.unit}`,
      });
    }
  }

  const fall = latest.get("fall_detected");
  if (fall && fall.value > 0) {
    evaluated++;
    total += 30;
    factors.push({ name: "Caída detectada", weight: 30, value: "Sí", direction: "increase" });
    recommendations.set("fall", {
      priority: "high",
      action: "Verificar el estado del paciente tras la caída detectada",
      rationale: "Evento de caída registrado",
    });
  }

  if (evaluated === 0) return null;

  const score = Math.min(100, total);
  const level = levelForScore(score);
  const abnormal = factors.filter((f) => f.weight > 0);
  const summary = abnormal.length
    ? `Riesgo ${LEVEL_TEXT[level]} (${score}/100). Alteraciones: ${abnormal
        .map((f) => `${f.name.toLowerCase()} ${f.value}`)
        .join(", ")}.`
    : `Riesgo ${LEVEL_TEXT[level]} (${score}/100). Las mediciones recientes están dentro de rangos normales.`;

  const order = { high: 0, medium: 1, low: 2 } as const;
  return {
    score,
    level,
    factors: factors.sort((a, b) => b.weight - a.weight),
    recommendations: [...recommendations.values()].sort(
      (a, b) => order[a.priority] - order[b.priority],
    ),
    summary,
    trend: trendForScores(score, previousScore),
  };
}
