// Centro de cobertura de la institución: qué turnos están en riesgo y qué hacer ahora.
//
// Todo es determinista y explicable (ninguna "IA" opaca): cada alerta dice por qué aparece y cada acción
// sugerida cita el dato que la motiva. El servidor decide los permisos; esto solo clasifica y prioriza lo
// que la institución ya puede leer (sus ofertas, turnos, postulaciones y contratos).

import { offerBand, MODALITY_BOUNDS, type OfferModality } from "./institutionNegotiation";
import { roundToStep } from "./negotiation";
import { formatCOP } from "./pricing";

const HOUR = 3_600_000;
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);

export type CoverageRisk = "covered" | "critical" | "high" | "watch" | "ok";

export const RISK_LABEL: Record<CoverageRisk, string> = {
  covered: "Cubierto",
  critical: "Crítico",
  high: "En riesgo",
  watch: "Vigilar",
  ok: "En orden",
};

export interface CoverageShiftInput {
  offerId: string;
  title: string;
  serviceArea: string | null;
  specialty: string | null;
  city: string;
  modality: OfferModality;
  amount: number;
  isUrgent: boolean;
  shiftId: string;
  startsAt: string;
  endsAt: string;
  positions: number;
  filled: number;
  /** Postulaciones vigentes que cubren este turno. */
  applicants: number;
  /** De ellas, las que esperan respuesta de la institución. */
  awaitingResponse: number;
  /** Desde cuándo espera la más antigua de esas postulaciones. */
  oldestWaitingAt: string | null;
}

export interface CoverageShift extends CoverageShiftInput {
  open: number;
  hoursToStart: number;
  risk: CoverageRisk;
  reasons: string[];
}

const hoursLabel = (h: number) => {
  if (h < 1) return "menos de 1 h";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
};

/** Clasifica un turno. Devuelve null cuando ya terminó (no hay nada que hacer). */
export function assessShift(input: CoverageShiftInput, now = Date.now()): CoverageShift | null {
  const start = ms(input.startsAt);
  const end = ms(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) return null;

  const open = Math.max(0, input.positions - input.filled);
  const hoursToStart = (start - now) / HOUR;
  const base = { ...input, open, hoursToStart: Math.round(hoursToStart * 100) / 100 };
  if (open === 0) return { ...base, risk: "covered", reasons: ["Todos los cupos están cubiertos"] };

  const reasons: string[] = [];
  const waitingHours = input.oldestWaitingAt ? (now - ms(input.oldestWaitingAt)) / HOUR : 0;
  const noCandidates = input.applicants === 0;
  const cupos = `${open} ${open === 1 ? "cupo" : "cupos"}`;

  if (hoursToStart <= 0) {
    reasons.push(`El turno ya empezó y faltan ${cupos}`);
    return { ...base, risk: "critical", reasons };
  }
  if (hoursToStart <= 12) {
    reasons.push(`Empieza en ${hoursLabel(hoursToStart)} y faltan ${cupos}`);
    return { ...base, risk: "critical", reasons };
  }
  if (hoursToStart <= 24 && noCandidates) {
    reasons.push(`Empieza en ${hoursLabel(hoursToStart)} y no tiene postulantes`);
    return { ...base, risk: "critical", reasons };
  }
  if (hoursToStart <= 24 && input.awaitingResponse > 0) {
    reasons.push(`Empieza en ${hoursLabel(hoursToStart)} y hay postulantes esperando tu respuesta`);
    return { ...base, risk: "high", reasons };
  }
  if (hoursToStart <= 48 && noCandidates) {
    reasons.push(`Empieza en ${hoursLabel(hoursToStart)} sin postulantes`);
    return { ...base, risk: "high", reasons };
  }
  if (hoursToStart <= 48 && waitingHours > 12) {
    reasons.push(`Una postulación lleva ${hoursLabel(waitingHours)} sin respuesta`);
    return { ...base, risk: "high", reasons };
  }
  if (hoursToStart <= 96 && noCandidates) {
    reasons.push(`Empieza en ${hoursLabel(hoursToStart)} y aún no tiene postulantes`);
    return { ...base, risk: "watch", reasons };
  }
  if (waitingHours > 24) {
    reasons.push(`Una postulación lleva ${hoursLabel(waitingHours)} sin respuesta`);
    return { ...base, risk: "watch", reasons };
  }
  return { ...base, risk: "ok", reasons: ["Sin alertas por ahora"] };
}

export function assessShifts(inputs: CoverageShiftInput[], now = Date.now()): CoverageShift[] {
  return inputs
    .flatMap((i) => {
      const s = assessShift(i, now);
      return s ? [s] : [];
    })
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || ms(a.startsAt) - ms(b.startsAt));
}

const RISK_ORDER: Record<CoverageRisk, number> = {
  critical: 0,
  high: 1,
  watch: 2,
  ok: 3,
  covered: 4,
};

export interface CoverageSummary {
  totalPositions: number;
  filledPositions: number;
  openPositions: number;
  /** null cuando todavía no hay cupos (no se inventa un 0 %). */
  coveragePct: number | null;
  byRisk: Record<CoverageRisk, number>;
  shiftsWithoutCandidates: number;
  nextUncovered: CoverageShift | null;
}

export function summarizeCoverage(shifts: CoverageShift[]): CoverageSummary {
  const byRisk: Record<CoverageRisk, number> = {
    covered: 0,
    critical: 0,
    high: 0,
    watch: 0,
    ok: 0,
  };
  let total = 0;
  let filled = 0;
  let noCandidates = 0;
  let next: CoverageShift | null = null;
  for (const s of shifts) {
    byRisk[s.risk] += 1;
    total += s.positions;
    filled += Math.min(s.filled, s.positions);
    if (s.open > 0 && s.applicants === 0) noCandidates += 1;
    if (s.open > 0 && (!next || ms(s.startsAt) < ms(next.startsAt))) next = s;
  }
  return {
    totalPositions: total,
    filledPositions: filled,
    openPositions: total - filled,
    coveragePct: total > 0 ? Math.round((filled / total) * 100) : null,
    byRisk,
    shiftsWithoutCandidates: noCandidates,
    nextUncovered: next,
  };
}

export function coverageHeadline(s: CoverageSummary): string {
  if (s.totalPositions === 0) return "Aún no tienes turnos publicados";
  if (s.openPositions === 0) return "Todos tus turnos están cubiertos";
  return `Cubres ${s.filledPositions} de ${s.totalPositions} cupos (${s.coveragePct ?? 0} %)`;
}

// ─── Respuesta a postulaciones ───────────────────────────────────────────────

export type SlaLevel = "fresh" | "watch" | "late" | "overdue";

export interface ApplicationSla {
  hoursWaiting: number;
  level: SlaLevel;
  label: string;
}

/** Cuánto lleva esperando una postulación. Pasadas 24 h los profesionales suelen irse a otra oferta. */
export function applicationSla(createdAt: string, now = Date.now()): ApplicationSla {
  const hours = Math.max(0, (now - ms(createdAt)) / HOUR);
  const rounded = Math.round(hours * 10) / 10;
  if (!Number.isFinite(hours)) return { hoursWaiting: 0, level: "fresh", label: "Recién llegó" };
  if (hours < 4) return { hoursWaiting: rounded, level: "fresh", label: "Recién llegó" };
  if (hours < 12)
    return { hoursWaiting: rounded, level: "watch", label: `Espera hace ${Math.floor(hours)} h` };
  if (hours < 24)
    return {
      hoursWaiting: rounded,
      level: "late",
      label: `Espera hace ${Math.floor(hours)} h: responde pronto`,
    };
  return { hoursWaiting: rounded, level: "overdue", label: "Lleva más de un día sin respuesta" };
}

/** Mediana en horas; null con menos de 3 muestras para no presentar un promedio sin base. */
export function medianHours(samples: number[], minSample = 3): number | null {
  const clean = samples.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (clean.length < minSample) return null;
  const mid = Math.floor(clean.length / 2);
  const value = clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  return Math.round(value * 10) / 10;
}

// ─── Qué hacer ahora ─────────────────────────────────────────────────────────

/** Sugerencia de ajuste: +12 % redondeado a $500, sin salir de los límites de la modalidad. */
export function suggestRaise(amount: number, modality: OfferModality, pct = 12): number | null {
  const { cap } = MODALITY_BOUNDS[modality];
  const next = Math.min(cap, roundToStep(amount * (1 + pct / 100)));
  // Que el nuevo valor siga siendo coherente con la banda de negociación del valor actual.
  const band = offerBand(amount, modality);
  const bounded = Math.min(next, band.max);
  return bounded > amount ? bounded : null;
}

export type ActionKind =
  | "publish_first"
  | "respond_applications"
  | "mark_urgent"
  | "raise_rate"
  | "invite_favorites"
  | "sign_contracts"
  | "widen_supply"
  | "all_covered";

export type ActionSeverity = "critical" | "high" | "medium" | "info";

export interface CoverageAction {
  id: string;
  kind: ActionKind;
  severity: ActionSeverity;
  title: string;
  detail: string;
  offerId?: string;
  count?: number;
  suggestedAmount?: number;
}

export interface CoverageContext {
  shifts: CoverageShift[];
  /** Postulaciones que esperan a la institución. */
  waitingApplications: Array<{ id: string; createdAt: string; offerTitle: string }>;
  unsignedContracts: Array<{ id: string; firstShiftAt: string | null }>;
  favoritesCount: number;
  /** null = muestra menor a 5 personas (no se publica la cifra). */
  supplyProfessionals: number | null;
  now?: number;
}

const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 0, high: 1, medium: 2, info: 3 };
const MAX_ACTIONS = 6;

export function nextBestActions(ctx: CoverageContext): CoverageAction[] {
  const now = ctx.now ?? Date.now();
  const actions: CoverageAction[] = [];
  const uncovered = ctx.shifts.filter((s) => s.open > 0);

  if (ctx.shifts.length === 0) {
    actions.push({
      id: "publish_first",
      kind: "publish_first",
      severity: "info",
      title: "Publica tu primer turno",
      detail:
        "Tarda un par de minutos: indicas el servicio, el horario y el valor, y los profesionales verificados cercanos lo ven al instante.",
    });
    return actions;
  }

  const waiting = ctx.waitingApplications;
  if (waiting.length > 0) {
    const oldest = Math.max(...waiting.map((w) => (now - ms(w.createdAt)) / HOUR));
    actions.push({
      id: "respond_applications",
      kind: "respond_applications",
      severity: oldest >= 24 ? "critical" : oldest >= 12 ? "high" : "medium",
      title: `Responde a ${waiting.length} ${waiting.length === 1 ? "postulación" : "postulaciones"}`,
      detail: `La más antigua lleva ${hoursLabel(Math.max(0, oldest))} esperando. Pasadas 24 h muchos profesionales aceptan otra oferta.`,
      count: waiting.length,
    });
  }

  // Turnos en riesgo sin postulantes: urgente, valor y favoritos (máx. 3 turnos para no saturar).
  const risky = uncovered
    .filter((s) => (s.risk === "critical" || s.risk === "high") && s.applicants === 0)
    .slice(0, 3);
  for (const s of risky) {
    const when = `Empieza en ${hoursLabel(Math.max(0, s.hoursToStart))} y no tiene postulantes.`;
    if (!s.isUrgent) {
      actions.push({
        id: `urgent:${s.shiftId}`,
        kind: "mark_urgent",
        severity: s.risk === "critical" ? "critical" : "high",
        title: `Marca «${s.title}» como urgente`,
        detail: `${when} Los turnos urgentes llegan primero a los profesionales con alertas activas.`,
        offerId: s.offerId,
      });
    }
    const raise = suggestRaise(s.amount, s.modality);
    if (raise != null) {
      actions.push({
        id: `raise:${s.shiftId}`,
        kind: "raise_rate",
        severity: s.risk === "critical" ? "critical" : "high",
        title: `Sube el valor de «${s.title}» a ${formatCOP(raise)}`,
        detail: `${when} Un valor más atractivo (+12 %) suele acelerar la cobertura.`,
        offerId: s.offerId,
        suggestedAmount: raise,
      });
    }
    if (ctx.favoritesCount > 0) {
      actions.push({
        id: `favorites:${s.shiftId}`,
        kind: "invite_favorites",
        severity: "high",
        title: `Invita a tu equipo de confianza a «${s.title}»`,
        detail: `Tienes ${ctx.favoritesCount} ${ctx.favoritesCount === 1 ? "profesional" : "profesionales"} en tu equipo que ya conocen cómo trabajas.`,
        offerId: s.offerId,
        count: ctx.favoritesCount,
      });
    }
  }

  const soonUnsigned = ctx.unsignedContracts.filter(
    (c) => c.firstShiftAt && (ms(c.firstShiftAt) - now) / HOUR <= 48,
  );
  if (ctx.unsignedContracts.length > 0) {
    actions.push({
      id: "sign_contracts",
      kind: "sign_contracts",
      severity: soonUnsigned.length > 0 ? "high" : "medium",
      title: `Faltan firmas en ${ctx.unsignedContracts.length} ${ctx.unsignedContracts.length === 1 ? "contrato" : "contratos"}`,
      detail:
        soonUnsigned.length > 0
          ? "Hay turnos que empiezan en menos de 48 h sin contrato firmado por ambas partes."
          : "Un contrato firmado protege a ambas partes y deja evidencia verificable.",
      count: ctx.unsignedContracts.length,
    });
  }

  if (uncovered.length > 0 && ctx.supplyProfessionals === null) {
    actions.push({
      id: "widen_supply",
      kind: "widen_supply",
      severity: "info",
      title: "Hay pocos profesionales disponibles para ese perfil",
      detail:
        "Con menos de 5 personas disponibles no publicamos la cifra. Amplía el perfil pedido, el horario o el valor para llegar a más candidatos.",
    });
  }

  if (uncovered.length === 0) {
    actions.push({
      id: "all_covered",
      kind: "all_covered",
      severity: "info",
      title: "Todos tus turnos están cubiertos",
      detail: "Buen trabajo. Agradece al equipo y programa los próximos turnos con tiempo.",
    });
  }

  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => SEVERITY_ORDER[x.a.severity] - SEVERITY_ORDER[y.a.severity] || x.i - y.i)
    .map(({ a }) => a)
    .slice(0, MAX_ACTIONS);
}

// ─── Primeros pasos (lo primero que ve una institución nueva) ─────────────────

export interface FirstRunInput {
  profileComplete: boolean;
  verified: boolean;
  offersPublished: number;
  applicationsReceived: number;
  contractsSigned: number;
}

export interface FirstRunStep {
  id: "profile" | "verify" | "publish" | "applicants" | "contract";
  title: string;
  hint: string;
  done: boolean;
}

export function firstRunSteps(input: FirstRunInput): {
  steps: FirstRunStep[];
  next: FirstRunStep | null;
  doneCount: number;
} {
  const steps: FirstRunStep[] = [
    {
      id: "profile",
      title: "Completa el perfil de tu institución",
      hint: "NIT, ciudad y datos de contacto.",
      done: input.profileComplete,
    },
    {
      id: "verify",
      title: "Verifica tu institución",
      hint: "Con el NIT y los documentos, el equipo de Humanix te da el sello de verificada.",
      done: input.verified,
    },
    {
      id: "publish",
      title: "Publica tu primer turno",
      hint: "Servicio, horario y valor. Es gratis.",
      done: input.offersPublished > 0,
    },
    {
      id: "applicants",
      title: "Recibe tus primeras postulaciones",
      hint: "Revisa su verificación RETHUS y su calificación.",
      done: input.applicationsReceived > 0,
    },
    {
      id: "contract",
      title: "Firma tu primer contrato",
      hint: "Queda la evidencia verificable de lo acordado.",
      done: input.contractsSigned > 0,
    },
  ];
  return {
    steps,
    next: steps.find((s) => !s.done) ?? null,
    doneCount: steps.filter((s) => s.done).length,
  };
}
