// Trust Score y cercanía: lo que la pantalla muestra y explica. El cálculo con autoridad vive en la base
// (`hx_trust_calc` y `get_trust_score`, migración 20261012190000_offer_alerts_and_plans.sql); aquí está su espejo puro para
// explicarlo («¿cómo se calcula?», «qué hacer para subirlo») y para probar que ambos dicen lo mismo.
//
// Familias e instituciones (0–100):  30 de base
//   + estrellas (0–35, solo desde 3 calificaciones)  + servicios completados (0–15, tope 10)
//   + identidad (0–15)  + antigüedad (0–5, tope 12 meses)  − alertas de fraude sin resolver (tope 50).
// Profesionales: el de la validación con IA (nulo mientras no se haya validado); la base no lo calcula.

export type TrustKind = "professional" | "family" | "institution";
export type TrustLevel = "excellent" | "high" | "medium" | "building" | "unrated";
export type FraudSeverity = "low" | "medium" | "high" | "critical";

export const TRUST_BASE = 30;
export const TRUST_MIN_RATINGS = 3;
export const TRUST_SERVICES_CAP = 10;
export const TRUST_SENIORITY_MONTHS_CAP = 12;
export const TRUST_CAPS = {
  ratings: 35,
  services: 15,
  identity: 15,
  seniority: 5,
  adjustments: 50,
} as const;
export const TRUST_LEVEL_MIN = { excellent: 85, high: 70, medium: 50 } as const;
export const FRAUD_PENALTY: Record<FraudSeverity, number> = {
  low: 3,
  medium: 8,
  high: 20,
  critical: 35,
};
export const FAMILY_IDENTITY_POINTS = { habeas: 5, idNumber: 5, idDocument: 5 } as const;
export const INSTITUTION_IDENTITY_POINTS = { verified: 9, nit: 3, chamber: 3 } as const;

export function trustLevel(score: number | null | undefined): TrustLevel {
  if (score == null || !Number.isFinite(score)) return "unrated";
  if (score >= TRUST_LEVEL_MIN.excellent) return "excellent";
  if (score >= TRUST_LEVEL_MIN.high) return "high";
  if (score >= TRUST_LEVEL_MIN.medium) return "medium";
  return "building";
}

export const TRUST_LEVEL_LABEL: Record<TrustLevel, string> = {
  excellent: "Excelente",
  high: "Alto",
  medium: "Medio",
  building: "En construcción",
  unrated: "Sin validar",
};

export type TrustTone = "ok" | "trust" | "warn" | "muted";

/** Color semántico (tokens del tema) según el nivel: nunca un hex suelto. */
export function trustTone(level: TrustLevel): TrustTone {
  switch (level) {
    case "excellent":
      return "ok";
    case "high":
      return "trust";
    case "medium":
      return "warn";
    default:
      return "muted";
  }
}

export interface TrustSummary {
  score: number | null;
  level: TrustLevel;
  /** Hay calificaciones o servicios suficientes para que el número diga algo. */
  enough: boolean;
  verified?: boolean;
}

/** Lo que dice la insignia: «82 · Alto», «Nuevo · 30» o «Sin validar». */
export function trustBadgeText(t: TrustSummary): string {
  if (t.score == null) return TRUST_LEVEL_LABEL.unrated;
  if (!t.enough) return `Nuevo · ${t.score}`;
  return `${t.score} · ${TRUST_LEVEL_LABEL[t.level]}`;
}

/** Fila de una lista del servidor → resumen (los nombres de columna cambian según la lista). */
export function trustFromColumns(
  score: number | null | undefined,
  level: string | null | undefined,
  enough: boolean | null | undefined,
  verified?: boolean | null,
): TrustSummary {
  const s = score == null ? null : Number(score);
  const known: TrustLevel[] = ["excellent", "high", "medium", "building", "unrated"];
  const lv = known.includes(level as TrustLevel) ? (level as TrustLevel) : trustLevel(s);
  return { score: s, level: s == null ? "unrated" : lv, enough: !!enough, verified: !!verified };
}

// ─── Espejo del cálculo de la base (familias e instituciones) ────────────────

export interface PartyTrustInput {
  kind: "family" | "institution";
  ratingsCount: number;
  /** Promedio de estrellas (1–5) con dos decimales, como lo entrega la base. */
  starsAvg: number | null;
  completedServices: number;
  identity: {
    // Familia
    habeasData?: boolean;
    idNumber?: boolean;
    idDocument?: boolean;
    // Institución
    verified?: boolean;
    nit?: boolean;
    chamber?: boolean;
  };
  /** Días desde que se creó el perfil (nulo si no hay perfil). */
  accountAgeDays: number | null;
  /** Alertas de fraude sin resolver. */
  flags: FraudSeverity[];
}

export interface TrustComponents {
  base: number;
  ratings: number;
  services: number;
  identity: number;
  seniority: number;
  /** Negativo: lo que restan las alertas sin resolver. */
  adjustments: number;
}

export interface PartyTrust {
  score: number;
  level: TrustLevel;
  enough: boolean;
  verified: boolean;
  starsAvg: number | null;
  components: TrustComponents;
}

/** Redondeo «a mitades hacia arriba» con enteros, para no depender del error de los decimales binarios. */
function roundDiv(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

export function computePartyTrust(i: PartyTrustInput): PartyTrust {
  const hundredths = i.starsAvg == null ? 0 : Math.round(i.starsAvg * 100);
  const ratings =
    i.ratingsCount >= TRUST_MIN_RATINGS && i.starsAvg != null
      ? roundDiv(Math.max(hundredths - 100, 0) * TRUST_CAPS.ratings, 400)
      : 0;
  const services = roundDiv(Math.min(Math.max(i.completedServices, 0), TRUST_SERVICES_CAP) * 3, 2);

  let identity = 0;
  let verified = false;
  if (i.kind === "family") {
    const p = FAMILY_IDENTITY_POINTS;
    identity =
      (i.identity.habeasData ? p.habeas : 0) +
      (i.identity.idNumber ? p.idNumber : 0) +
      (i.identity.idDocument ? p.idDocument : 0);
    verified = !!i.identity.idNumber && !!i.identity.idDocument;
  } else {
    const p = INSTITUTION_IDENTITY_POINTS;
    identity =
      (i.identity.verified ? p.verified : 0) +
      (i.identity.nit ? p.nit : 0) +
      (i.identity.chamber ? p.chamber : 0);
    verified = !!i.identity.verified;
  }

  const months =
    i.accountAgeDays == null
      ? 0
      : Math.min(Math.max(i.accountAgeDays / 30, 0), TRUST_SENIORITY_MONTHS_CAP);
  const seniority = Math.round((months / TRUST_SENIORITY_MONTHS_CAP) * TRUST_CAPS.seniority);

  const flags = Math.min(
    i.flags.reduce((sum, f) => sum + (FRAUD_PENALTY[f] ?? FRAUD_PENALTY.critical), 0),
    TRUST_CAPS.adjustments,
  );

  const raw = TRUST_BASE + ratings + services + identity + seniority - flags;
  const score = Math.max(0, Math.min(100, raw));
  return {
    score,
    level: trustLevel(score),
    enough: i.ratingsCount >= TRUST_MIN_RATINGS || i.completedServices >= TRUST_MIN_RATINGS,
    verified,
    starsAvg: i.ratingsCount >= TRUST_MIN_RATINGS ? i.starsAvg : null,
    components: {
      base: TRUST_BASE,
      ratings,
      services,
      identity,
      seniority,
      adjustments: flags > 0 ? -flags : 0,
    },
  };
}

// ─── Explicación en pantalla ─────────────────────────────────────────────────

export interface TrustLine {
  key: keyof TrustComponents;
  label: string;
  value: number;
  max: number | null;
  hint: string;
}

/** El desglose que ve la propia cuenta: de dónde sale cada punto. Los ajustes solo aparecen si restan. */
export function trustLines(c: TrustComponents, kind: "family" | "institution"): TrustLine[] {
  const lines: TrustLine[] = [
    {
      key: "base",
      label: "Punto de partida",
      value: c.base,
      max: TRUST_BASE,
      hint: "Todas las cuentas empiezan aquí.",
    },
    {
      key: "ratings",
      label: "Calificaciones",
      value: c.ratings,
      max: TRUST_CAPS.ratings,
      hint: `Cuentan desde ${TRUST_MIN_RATINGS} calificaciones de profesionales.`,
    },
    {
      key: "services",
      label: "Servicios completados",
      value: c.services,
      max: TRUST_CAPS.services,
      hint: `Suma hasta ${TRUST_SERVICES_CAP} servicios.`,
    },
    {
      key: "identity",
      label: kind === "family" ? "Identidad entregada" : "Institución verificada",
      value: c.identity,
      max: TRUST_CAPS.identity,
      hint:
        kind === "family"
          ? "Documento, número de identificación y aceptación del tratamiento de datos."
          : "Verificación de Humanix, NIT y cámara de comercio.",
    },
    {
      key: "seniority",
      label: "Antigüedad",
      value: c.seniority,
      max: TRUST_CAPS.seniority,
      hint: "Sube con los meses, hasta 12.",
    },
  ];
  if (c.adjustments < 0) {
    lines.push({
      key: "adjustments",
      label: "Ajustes por revisiones",
      value: c.adjustments,
      max: null,
      hint: "Hay alertas de seguridad sin resolver. Escríbenos por PQRS para revisarlas.",
    });
  }
  return lines;
}

/** Qué hacer para subir el puntaje, de lo que más suma a lo que menos (solo lo que de verdad falta). */
export function trustTips(c: TrustComponents, kind: "family" | "institution"): string[] {
  const tips: Array<{ gain: number; text: string }> = [];
  if (c.identity < TRUST_CAPS.identity) {
    tips.push({
      gain: TRUST_CAPS.identity - c.identity,
      text:
        kind === "family"
          ? "Completa tu identidad (documento y aceptación de datos) en tu perfil."
          : "Completa NIT, cámara de comercio y la verificación de tu institución.",
    });
  }
  if (c.ratings < TRUST_CAPS.ratings) {
    tips.push({
      gain: TRUST_CAPS.ratings - c.ratings,
      text: "Pide a quienes te atienden que te califiquen: cuentan desde 3 calificaciones.",
    });
  }
  if (c.services < TRUST_CAPS.services) {
    tips.push({
      gain: TRUST_CAPS.services - c.services,
      text: "Cada servicio completado suma hasta llegar a 10.",
    });
  }
  if (c.seniority < TRUST_CAPS.seniority) {
    tips.push({
      gain: TRUST_CAPS.seniority - c.seniority,
      text: "La antigüedad suma sola con los meses.",
    });
  }
  return tips.sort((a, b) => b.gain - a.gain).map((t) => t.text);
}

// ─── Cercanía por rangos ─────────────────────────────────────────────────────

/** La base nunca entrega kilómetros exactos: solo el tope del rango (2, 5, 10, 20, 50) o 100 = «más de 50». */
export function distanceBand(km: number | null | undefined): number | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km <= 2) return 2;
  if (km <= 5) return 5;
  if (km <= 10) return 10;
  if (km <= 20) return 20;
  if (km <= 50) return 50;
  return 100;
}

export function distanceBandLabel(band: number | null | undefined): string {
  switch (band) {
    case 2:
      return "A menos de 2 km";
    case 5:
      return "A 2–5 km";
    case 10:
      return "A 5–10 km";
    case 20:
      return "A 10–20 km";
    case 50:
      return "A 20–50 km";
    case 100:
      return "A más de 50 km";
    default:
      return "Distancia no disponible";
  }
}

/** Para ordenar «más cerca primero»: lo que no tiene distancia va al final. */
export function distanceBandRank(band: number | null | undefined): number {
  return band == null ? 1000 : band;
}
