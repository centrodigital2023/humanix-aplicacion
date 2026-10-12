// Comparador inteligente de postulaciones y propuestas (plan de pago) — lógica pura.
//
// Ordena a quienes se ofrecen a cuidar con un puntaje de 0 a 100 que se puede desarmar: cada punto sale de un factor
// con nombre, un máximo y una nota. No usa IA ni datos ocultos: solo lo que el perfil público ya muestra (verificación,
// confianza, calificaciones, experiencia, distancia), lo que ya pasó con esta familia y qué pide frente a lo que la
// familia publicó y frente al rango de su ciudad. Es un apoyo para decidir, nunca decide ni acepta por la familia.

import { formatKm } from "./geo";
import {
  marketPosition,
  midpointRate,
  roundToStep,
  type MarketPosition,
  type MarketStats,
} from "./negotiation";
import { formatCOP } from "./pricing";
import { numOrNull, plural } from "./familyIntelShared";

export interface Applicant {
  /** Id de la postulación o de la propuesta. */
  id: string;
  source: "application" | "proposal";
  professionalId: string;
  name: string | null;
  /** Tarifa que pide (por hora si `hourly`; si no, el monto que propone para la oferta). */
  offeredRate: number | null;
  /** Lo que la familia publicó, en la misma unidad que `offeredRate`. */
  postedRate: number | null;
  /** Solo una tarifa por hora se compara con el rango de la ciudad. */
  hourly: boolean;
  createdAt: string | null;
  // Perfil público del profesional
  /** 0 o nulo = sin calificaciones. */
  avgRating: number | null;
  totalJobs: number | null;
  /** 0–100. */
  trustScore: number | null;
  rethusVerified: boolean | null;
  verified: boolean | null;
  yearsExperience: number | null;
  available: boolean | null;
  km: number | null;
  // Historia con esta familia
  inTeam: boolean;
  servicesTogether: number;
}

export type FactorKey =
  | "trust"
  | "experience"
  | "price"
  | "distance"
  | "familiarity"
  | "availability";

export interface Factor {
  key: FactorKey;
  label: string;
  points: number;
  max: number;
  note: string;
}

export type RankLabel =
  | "Muy buena opción"
  | "Buena opción"
  | "Para considerar"
  | "Revisa con cuidado"
  | "Pocos datos";

export interface Counter {
  suggested: number;
  rationale: string;
}

export interface RankedApplicant {
  applicant: Applicant;
  rank: number;
  score: number;
  label: RankLabel;
  /** La mejor opción de la lista (solo si hay con quién compararla y alcanza un mínimo). */
  isTop: boolean;
  /** Fracción (0–1) de los datos del perfil que se conocen. */
  completeness: number;
  factors: Factor[];
  pros: string[];
  cautions: string[];
  counter: Counter | null;
}

// ─── Pesos (suman 100) ──────────────────────────────────────────────────────────
export const WEIGHTS = {
  trust: 30,
  experience: 25,
  price: 20,
  distance: 10,
  familiarity: 10,
  availability: 5,
} as const;

/** Mínimo de datos del perfil para dar una etiqueta de calidad. */
export const MIN_COMPLETENESS = 0.4;
/** Puntaje mínimo para llamarla «mejor opción». */
export const TOP_MIN_SCORE = 65;

/** Cuántos «servicios virtuales» de calificación media pesan al promediar (evita que 1 reseña perfecta gane a 40 buenas). */
const PRIOR_WEIGHT = 3;
const PRIOR_MEAN = 4.2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function labelFor(score: number, completeness: number): RankLabel {
  if (completeness < MIN_COMPLETENESS) return "Pocos datos";
  if (score >= 80) return "Muy buena opción";
  if (score >= 65) return "Buena opción";
  if (score >= 50) return "Para considerar";
  return "Revisa con cuidado";
}

/** Calificación suavizada: con pocos servicios se acerca a la media; con muchos, a la propia. */
export function smoothedRating(avg: number | null, jobs: number | null): number | null {
  const a = numOrNull(avg);
  if (a === null || a <= 0) return null;
  const n = Math.max(0, numOrNull(jobs) ?? 0);
  return (a * n + PRIOR_MEAN * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);
}

// ─── Factores ──────────────────────────────────────────────────────────────────

function trustFactor(a: Applicant): Factor {
  const max = WEIGHTS.trust;
  let points = 0;
  const notes: string[] = [];
  if (a.rethusVerified === true) {
    points += 14;
    notes.push("RETHUS verificado");
  } else if (a.rethusVerified === false) notes.push("sin RETHUS");
  if (a.verified === true) {
    points += 4;
    notes.push("identidad verificada");
  }
  const t = numOrNull(a.trustScore);
  if (t !== null) {
    points += round1((clamp(t, 0, 100) / 100) * 12);
    notes.push(`confianza ${Math.round(clamp(t, 0, 100))}/100`);
  }
  return {
    key: "trust",
    label: "Verificación y confianza",
    points: round1(Math.min(max, points)),
    max,
    note: notes.length ? notes.join(" · ") : "sin datos de verificación",
  };
}

function experienceFactor(a: Applicant): Factor {
  const max = WEIGHTS.experience;
  const jobs = Math.max(0, numOrNull(a.totalJobs) ?? 0);
  const smooth = smoothedRating(a.avgRating, a.totalJobs) ?? PRIOR_MEAN;
  const rating = round1(clamp((smooth - 3) / 2, 0, 1) * 15);
  const years = clamp(numOrNull(a.yearsExperience) ?? 0, 0, 10);
  const exp = round1((years / 10) * 7 + (Math.min(jobs, 20) / 20) * 3);
  const rated = numOrNull(a.avgRating) !== null && (numOrNull(a.avgRating) ?? 0) > 0;
  const notes = [
    rated
      ? `calificación ${(numOrNull(a.avgRating) as number).toFixed(1)} con ${plural(jobs, "servicio", "servicios")}`
      : "sin calificaciones",
  ];
  if (numOrNull(a.yearsExperience) !== null)
    notes.push(`${plural(years, "año", "años")} de experiencia`);
  return {
    key: "experience",
    label: "Valoración y experiencia",
    points: round1(Math.min(max, rating + exp)),
    max,
    note: notes.join(" · "),
  };
}

interface PriceView {
  factor: Factor;
  position: MarketPosition;
  /** Cuánto por encima del techo del rango (fracción), si lo está. */
  overMarket: number | null;
  /** Oferta ÷ lo publicado, si se conocen ambos. */
  ratio: number | null;
}

function priceFactor(a: Applicant, market: MarketStats | null | undefined): PriceView {
  const max = WEIGHTS.price;
  const rate = numOrNull(a.offeredRate);
  const posted = numOrNull(a.postedRate);
  const hasRate = rate !== null && rate > 0;

  let position: MarketPosition = "unknown";
  let overMarket: number | null = null;
  let marketScore = 14; // sin referencia: neutral, ni premia ni castiga
  const notes: string[] = [];

  if (hasRate && a.hourly) {
    position = marketPosition(rate, market);
    if (position === "within") {
      marketScore = 20;
      notes.push("dentro del rango de tu ciudad");
    } else if (position === "below") {
      marketScore = 17;
      notes.push("por debajo del rango de tu ciudad");
    } else if (position === "above" && market?.p75) {
      overMarket = rate / market.p75 - 1;
      marketScore = Math.max(0, 20 - 40 * overMarket);
      notes.push(`${Math.round(overMarket * 100)} % sobre el techo del rango`);
    } else {
      notes.push("sin referencia de mercado");
    }
  } else if (hasRate) {
    notes.push("tarifa por turno o mes: sin referencia por hora");
  } else {
    notes.push("sin tarifa indicada");
  }

  let ratio: number | null = null;
  let budget = 1;
  if (hasRate && posted !== null && posted > 0) {
    ratio = rate / posted;
    if (ratio > 1) {
      budget = Math.max(0.3, 1 - (ratio - 1) * 1.5);
      notes.push(`pide ${Math.round((ratio - 1) * 100)} % más de lo que publicaste`);
    } else if (ratio < 1) {
      notes.push(`pide ${Math.round((1 - ratio) * 100)} % menos de lo que publicaste`);
    } else {
      notes.push("pide lo que publicaste");
    }
  }

  return {
    factor: {
      key: "price",
      label: "Precio",
      points: round1(Math.min(max, marketScore * budget)),
      max,
      note: notes.join(" · "),
    },
    position,
    overMarket,
    ratio,
  };
}

function distanceFactor(a: Applicant): Factor {
  const max = WEIGHTS.distance;
  const km = numOrNull(a.km);
  if (km === null || km < 0)
    return { key: "distance", label: "Cercanía", points: 5, max, note: "distancia desconocida" };
  const points = km <= 2 ? 10 : km <= 5 ? 8 : km <= 10 ? 6 : km <= 20 ? 3 : 1;
  return { key: "distance", label: "Cercanía", points, max, note: `a ${formatKm(km)}` };
}

function familiarityFactor(a: Applicant): Factor {
  const max = WEIGHTS.familiarity;
  const together = Math.max(0, Math.floor(numOrNull(a.servicesTogether) ?? 0));
  const points = (a.inTeam ? 6 : 0) + Math.min(4, together * 2);
  const notes: string[] = [];
  if (a.inTeam) notes.push("en tu equipo de confianza");
  if (together > 0) notes.push(`te atendió ${together} ${together === 1 ? "vez" : "veces"}`);
  return {
    key: "familiarity",
    label: "Ya te conoce",
    points,
    max,
    note: notes.length ? notes.join(" · ") : "aún no han trabajado juntos",
  };
}

function availabilityFactor(a: Applicant): Factor {
  const max = WEIGHTS.availability;
  if (a.available === true)
    return {
      key: "availability",
      label: "Disponibilidad",
      points: 5,
      max,
      note: "disponible ahora",
    };
  if (a.available === false)
    return {
      key: "availability",
      label: "Disponibilidad",
      points: 0,
      max,
      note: "no aparece disponible",
    };
  return { key: "availability", label: "Disponibilidad", points: 2, max, note: "sin dato" };
}

// ─── Lo que se dice a la familia ───────────────────────────────────────────────

function proseOf(a: Applicant, price: PriceView): { pros: string[]; cautions: string[] } {
  const pros: string[] = [];
  const cautions: string[] = [];
  const jobs = Math.max(0, numOrNull(a.totalJobs) ?? 0);
  const rating = numOrNull(a.avgRating) ?? 0;
  const trust = numOrNull(a.trustScore);
  const years = numOrNull(a.yearsExperience);
  const km = numOrNull(a.km);

  if (a.rethusVerified === true) pros.push("Verificación RETHUS vigente");
  if (trust !== null && trust >= 75)
    pros.push(`Puntaje de confianza alto (${Math.round(trust)}/100)`);
  if (rating >= 4.5 && jobs >= 3)
    pros.push(`Calificación ${rating.toFixed(1)} con ${plural(jobs, "servicio", "servicios")}`);
  if (years !== null && years >= 5)
    pros.push(`${plural(Math.round(years), "año", "años")} de experiencia`);
  if (a.inTeam) pros.push("Está en tu equipo de confianza");
  if (a.servicesTogether >= 1)
    pros.push(`Ya te atendió ${a.servicesTogether} ${a.servicesTogether === 1 ? "vez" : "veces"}`);
  if (km !== null && km >= 0 && km <= 5) pros.push(`Vive cerca (${formatKm(km)})`);
  if (price.position === "within") pros.push("Tarifa dentro del rango de tu ciudad");
  else if (price.position === "below") pros.push("Tarifa por debajo del rango de tu ciudad");
  if (price.ratio !== null && price.ratio <= 1) pros.push("Pide lo que publicaste o menos");
  if (a.available === true) pros.push("Disponible ahora");

  if (a.rethusVerified === false) cautions.push("Sin verificación RETHUS");
  if (a.verified === false) cautions.push("Identidad sin verificar");
  if (rating <= 0 && jobs === 0) cautions.push("Aún no tiene calificaciones en Humanix");
  else if (rating > 0 && rating < 4 && jobs >= 3)
    cautions.push(
      `Calificación baja (${rating.toFixed(1)} con ${plural(jobs, "servicio", "servicios")})`,
    );
  if (price.overMarket !== null && price.overMarket > 0)
    cautions.push(
      `Pide ${Math.round(price.overMarket * 100)} % sobre el techo del rango de tu ciudad`,
    );
  if (price.ratio !== null && price.ratio > 1.15)
    cautions.push(`Pide ${Math.round((price.ratio - 1) * 100)} % más de lo que publicaste`);
  if (km !== null && km > 20) cautions.push(`Está lejos (${formatKm(km)})`);
  if (a.available === false) cautions.push("No aparece disponible ahora");
  return { pros, cautions };
}

function counterFor(
  a: Applicant,
  price: PriceView,
  market: MarketStats | null | undefined,
): Counter | null {
  const rate = numOrNull(a.offeredRate);
  const posted = numOrNull(a.postedRate);
  if (rate === null || rate <= 0) return null;

  if (a.hourly && price.position === "above" && market?.median && market.p75) {
    const suggested = roundToStep((market.median + market.p75) / 2);
    if (suggested < rate)
      return {
        suggested,
        rationale: `Punto medio entre la mediana (${formatCOP(market.median)}) y el techo del rango (${formatCOP(market.p75)}) de tu ciudad.`,
      };
  }
  if (posted !== null && posted > 0 && rate / posted > 1.1) {
    const suggested = midpointRate(rate, posted);
    if (suggested < rate)
      return {
        suggested,
        rationale: `Punto medio entre lo que publicaste (${formatCOP(posted)}) y lo que pide (${formatCOP(rate)}).`,
      };
  }
  return null;
}

function completenessOf(a: Applicant): number {
  const known = [
    (numOrNull(a.avgRating) ?? 0) > 0,
    numOrNull(a.totalJobs) !== null,
    numOrNull(a.trustScore) !== null,
    a.rethusVerified !== null,
    a.verified !== null,
    numOrNull(a.yearsExperience) !== null,
    numOrNull(a.km) !== null,
    a.available !== null,
  ];
  return known.filter(Boolean).length / known.length;
}

// ─── Ordenar ───────────────────────────────────────────────────────────────────

export function rankApplicants(
  applicants: Applicant[],
  ctx: { market?: MarketStats | null } = {},
): RankedApplicant[] {
  const scored = applicants.map((a) => {
    const price = priceFactor(a, ctx.market);
    const factors = [
      trustFactor(a),
      experienceFactor(a),
      price.factor,
      distanceFactor(a),
      familiarityFactor(a),
      availabilityFactor(a),
    ];
    const total = factors.reduce((n, f) => n + f.points, 0);
    const score = Math.round(clamp(total, 0, 100));
    const completeness = completenessOf(a);
    const { pros, cautions } = proseOf(a, price);
    return {
      applicant: a,
      score,
      completeness,
      label: labelFor(score, completeness),
      factors,
      pros,
      cautions,
      counter: counterFor(a, price, ctx.market),
    };
  });

  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const rx = numOrNull(x.applicant.offeredRate);
    const ry = numOrNull(y.applicant.offeredRate);
    if (rx !== ry) return (rx ?? Infinity) - (ry ?? Infinity);
    const cx = x.applicant.createdAt ?? "";
    const cy = y.applicant.createdAt ?? "";
    if (cx !== cy) return cx.localeCompare(cy);
    return x.applicant.id.localeCompare(y.applicant.id);
  });

  return scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    isTop:
      i === 0 &&
      scored.length >= 2 &&
      s.score >= TOP_MIN_SCORE &&
      s.completeness >= MIN_COMPLETENESS,
  }));
}

/** Una frase para el encabezado del comparador. */
export function rankingHeadline(ranked: RankedApplicant[]): string {
  if (ranked.length === 0)
    return "Cuando lleguen postulaciones o propuestas, las comparamos por ti.";
  if (ranked.length === 1)
    return `Una persona se ofreció: ${ranked[0].label.toLowerCase()} (${ranked[0].score}/100).`;
  const top = ranked.find((r) => r.isTop);
  if (top) {
    const name = top.applicant.name ?? "una de las personas";
    return `Entre ${ranked.length} opciones, ${name} destaca (${top.score}/100).`;
  }
  return `Comparamos ${ranked.length} opciones: ninguna destaca con claridad todavía.`;
}
