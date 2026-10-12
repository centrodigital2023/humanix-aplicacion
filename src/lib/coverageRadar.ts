// Radar de cobertura (plan de pago) — lógica pura.
//
// La familia marca en su agenda las horas que necesita (`family_needs`). Este radar mira los próximos días y dice, sin
// adornos, qué horas siguen SIN profesional, con qué urgencia, si la tarifa publicada ayuda o estorba frente al rango
// de la ciudad y a quién de su equipo de confianza conviene avisar primero. Todo es explicable: cada recomendación
// nombra la regla que la produjo. No contacta a nadie por su cuenta.

import { sortTeam, type TrustedMember } from "./careLoop";
import { marketPosition, roundToStep, type MarketPosition, type MarketStats } from "./negotiation";
import {
  groupNeedsIntoShifts,
  hoursBetween,
  urgencyOf,
  type NeedBlock,
  type Urgency,
} from "./opportunities";
import { DAY_MS, HOUR_MS, msOf, numOrNull, pctOf, plural } from "./intelShared";
import { formatCOP } from "./pricing";

export interface RadarNeed {
  id: string;
  starts_at: string;
  ends_at: string;
  hourly_rate: number | string | null;
  /** open · matched · cancelled · expired */
  status: string;
  care_type?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface RadarProposal {
  id: string;
  family_need_id: string | null;
  status: string;
  /** «family» o «professional»: solo cuentan las que llegan de un profesional. */
  proposed_by: string;
  expires_at: string | null;
}

/** Días hacia adelante que mira el radar. */
export const RADAR_HORIZON_DAYS = 14;
/** Ventana del porcentaje de cobertura. */
export const COVERAGE_WINDOW_DAYS = 7;
/** Horas abierto sin propuestas para empezar a preocuparse. */
export const QUIET_HOURS = 12;

export type GapLevel = "critical" | "high" | "medium" | "low";

export interface Gap {
  key: string;
  needIds: string[];
  startsAt: string;
  endsAt: string;
  hours: number;
  urgency: Urgency;
  level: GapLevel;
  /** Ya empezó y sigue sin profesional. */
  startedAlready: boolean;
  rate: number | null;
  position: MarketPosition;
  /** Tarifa sugerida (mediana de la ciudad) si la publicada está por debajo del rango. */
  suggestedRate: number | null;
  /** Horas que lleva publicada sin cubrirse (null si no se sabe). */
  openForHours: number | null;
  /** Propuestas de profesionales vigentes para este turno. */
  proposalsPending: number;
  reasons: string[];
}

export type AdviceKind =
  | "team"
  | "search"
  | "rate"
  | "proposals"
  | "build_team"
  | "calendar"
  | "ok";
export type AdviceSeverity = "alert" | "warn" | "info" | "good";

export interface Advice {
  id: string;
  kind: AdviceKind;
  severity: AdviceSeverity;
  title: string;
  detail: string;
}

export interface CoverageRadar {
  gaps: Gap[];
  nextGap: Gap | null;
  risk: GapLevel | "none";
  summary: {
    windowDays: number;
    neededHours: number;
    coveredHours: number;
    openHours: number;
    coveragePct: number | null;
  };
  team: {
    size: number;
    available: TrustedMember[];
    headline: string;
  };
  advice: Advice[];
}

const LEVEL_ORDER: Record<GapLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function levelOf(startsAt: string, now: number): GapLevel {
  const hoursToStart = (msOf(startsAt) - now) / HOUR_MS;
  if (hoursToStart <= 6) return "critical";
  if (hoursToStart <= 24) return "high";
  if (hoursToStart <= 72) return "medium";
  return "low";
}

const rateOf = (v: number | string | null): number | null => {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
};

/** Horas de la necesidad que caen dentro de la ventana [from, to]. */
function overlapHours(startsAt: string, endsAt: string, from: number, to: number): number {
  const s = Math.max(msOf(startsAt), from);
  const e = Math.min(msOf(endsAt), to);
  return e > s ? (e - s) / HOUR_MS : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildCoverageRadar(args: {
  needs: RadarNeed[];
  proposals?: RadarProposal[];
  team?: TrustedMember[];
  market?: MarketStats | null;
  now?: number;
  horizonDays?: number;
}): CoverageRadar {
  const now = args.now ?? Date.now();
  const horizon = now + (args.horizonDays ?? RADAR_HORIZON_DAYS) * DAY_MS;
  const proposals = args.proposals ?? [];

  // Solo lo que sigue vigente: no terminó, empieza dentro del horizonte y tiene un horario válido.
  const needs = args.needs.filter(
    (n) =>
      hoursBetween(n.starts_at, n.ends_at) > 0 &&
      msOf(n.ends_at) > now &&
      msOf(n.starts_at) <= horizon,
  );
  const createdAt = new Map(needs.map((n) => [n.id, msOf(n.created_at)]));

  // ── Horas sin cubrir, agrupadas en turnos ──────────────────────────────────
  const blocks: NeedBlock[] = needs.map((n) => ({
    id: n.id,
    family_user_id: "yo",
    display_name: null,
    city: null,
    care_type: n.care_type ?? null,
    starts_at: n.starts_at,
    ends_at: n.ends_at,
    hourly_rate: rateOf(n.hourly_rate),
    notes_public: null,
    status: n.status,
  }));

  const gaps: Gap[] = groupNeedsIntoShifts(blocks).map((shift) => {
    const rate = shift.rate_avg;
    const position = rate === null ? "unknown" : marketPosition(rate, args.market);
    const suggestedRate =
      position === "below" && args.market?.median ? roundToStep(args.market.median) : null;
    const created = shift.need_ids
      .map((id) => createdAt.get(id) ?? NaN)
      .filter((t) => Number.isFinite(t));
    const openForHours = created.length
      ? Math.max(0, Math.round((now - Math.min(...created)) / HOUR_MS))
      : null;
    const ids = new Set(shift.need_ids);
    const proposalsPending = proposals.filter(
      (p) =>
        p.family_need_id !== null &&
        ids.has(p.family_need_id) &&
        p.status === "pending" &&
        p.proposed_by !== "family" &&
        (p.expires_at === null || msOf(p.expires_at) > now),
    ).length;
    const level = levelOf(shift.starts_at, now);

    const reasons: string[] = [];
    if (position === "below" && suggestedRate && args.market?.p25 && args.market?.p75 && rate) {
      reasons.push(
        `Tu tarifa (${formatCOP(rate)}/h) está por debajo del rango de tu ciudad (${formatCOP(args.market.p25)}–${formatCOP(args.market.p75)}/h): con ${formatCOP(suggestedRate)}/h suele llegar una propuesta antes.`,
      );
    }
    if (proposalsPending > 0) {
      reasons.push(
        `Tienes ${plural(proposalsPending, "propuesta vigente", "propuestas vigentes")} para este turno: revísala${proposalsPending === 1 ? "" : "s"} en tu agenda.`,
      );
    } else if (openForHours !== null && openForHours >= QUIET_HOURS) {
      reasons.push(`Lleva ${openForHours} h publicado sin propuestas.`);
    }

    return {
      key: shift.key,
      needIds: shift.need_ids,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      hours: shift.hours,
      urgency: urgencyOf(shift.starts_at, now),
      level,
      startedAlready: msOf(shift.starts_at) < now,
      rate,
      position,
      suggestedRate,
      openForHours,
      proposalsPending,
      reasons,
    };
  });
  gaps.sort((a, b) => msOf(a.startsAt) - msOf(b.startsAt) || a.key.localeCompare(b.key));

  // ── Cobertura de los próximos 7 días ───────────────────────────────────────
  const windowEnd = now + COVERAGE_WINDOW_DAYS * DAY_MS;
  let open = 0;
  let matched = 0;
  for (const n of needs) {
    const h = overlapHours(n.starts_at, n.ends_at, now, windowEnd);
    if (n.status === "open") open += h;
    else if (n.status === "matched") matched += h;
  }
  const needed = open + matched;

  // ── Equipo de confianza ────────────────────────────────────────────────────
  const team = sortTeam(args.team ?? []);
  const available = team.filter((m) => m.available);
  const teamHeadline =
    team.length === 0
      ? "Aún no tienes equipo de confianza."
      : available.length === 0
        ? `Nadie de tu equipo (${team.length}) aparece disponible ahora.`
        : `${available.length} de ${team.length} de tu equipo ${available.length === 1 ? "está disponible" : "están disponibles"}.`;

  const risk: CoverageRadar["risk"] = gaps.length
    ? gaps.reduce<GapLevel>(
        (worst, g) => (LEVEL_ORDER[g.level] < LEVEL_ORDER[worst] ? g.level : worst),
        "low",
      )
    : "none";

  return {
    gaps,
    nextGap: gaps[0] ?? null,
    risk,
    summary: {
      windowDays: COVERAGE_WINDOW_DAYS,
      neededHours: round2(needed),
      coveredHours: round2(matched),
      openHours: round2(open),
      coveragePct: pctOf(matched, needed),
    },
    team: { size: team.length, available, headline: teamHeadline },
    advice: buildAdvice({ gaps, needsExist: needs.length > 0, needed, team, available }),
  };
}

function buildAdvice(args: {
  gaps: Gap[];
  needsExist: boolean;
  needed: number;
  team: TrustedMember[];
  available: TrustedMember[];
}): Advice[] {
  const { gaps, team, available } = args;
  const out: Advice[] = [];
  const soon = gaps.filter((g) => g.level === "critical" || g.level === "high");

  if (soon.length) {
    if (available.length) {
      const names = available.slice(0, 3).map((m) => m.display_name);
      out.push({
        id: "notify_team",
        kind: "team",
        severity: "alert",
        title: `Avisa ya a tu equipo: ${names.join(", ")}`,
        detail: `${plural(soon.length, "turno sin cubrir", "turnos sin cubrir")} en menos de 24 horas. Quien ya te conoce suele responder más rápido.`,
      });
    } else {
      out.push({
        id: "publish_urgent",
        kind: "search",
        severity: "alert",
        title: "Pide ayuda hoy: tu equipo no está disponible",
        detail: `${plural(soon.length, "turno sin cubrir", "turnos sin cubrir")} en menos de 24 horas. Ajusta la tarifa o el horario y busca profesionales cercanos.`,
      });
    }
  }

  const cheap = gaps.filter((g) => g.suggestedRate !== null);
  if (cheap.length) {
    const rates = cheap.map((g) => g.suggestedRate as number);
    const suggested = Math.max(...rates);
    out.push({
      id: "raise_rate",
      kind: "rate",
      severity: "warn",
      title: `Sube la tarifa a ~${formatCOP(suggested)}/h en ${plural(cheap.length, "turno", "turnos")}`,
      detail:
        "Está por debajo de lo que paga la mayoría de familias de tu ciudad; con la mediana llegan propuestas antes.",
    });
  }

  const withProposals = gaps.filter((g) => g.proposalsPending > 0);
  if (withProposals.length) {
    const total = withProposals.reduce((n, g) => n + g.proposalsPending, 0);
    out.push({
      id: "review_proposals",
      kind: "proposals",
      severity: "warn",
      title: `Tienes ${plural(total, "propuesta esperando", "propuestas esperando")} respuesta`,
      detail: "Responde antes de que venzan: cada una cubre uno de tus turnos pendientes.",
    });
  }

  if (gaps.length && team.length === 0) {
    out.push({
      id: "build_team",
      kind: "build_team",
      severity: "info",
      title: "Arma tu equipo de confianza",
      detail:
        "Cuando termine un servicio que te dio tranquilidad, guarda a esa persona como favorita: será tu plan B si alguien cancela.",
    });
  }

  if (!args.needsExist) {
    out.push({
      id: "no_needs",
      kind: "calendar",
      severity: "info",
      title: "Marca en tu agenda las horas que necesitas",
      detail:
        "Con tu calendario al día te avisamos qué horas quedan sin cubrir y a quién conviene llamar primero.",
    });
  } else if (!gaps.length && args.needed > 0) {
    out.push({
      id: "all_covered",
      kind: "ok",
      severity: "good",
      title: `Todo cubierto los próximos ${COVERAGE_WINDOW_DAYS} días`,
      detail: "Cada hora que marcaste en tu agenda ya tiene profesional asignado.",
    });
  }

  const order: Record<AdviceSeverity, number> = { alert: 0, warn: 1, info: 2, good: 3 };
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => order[a.x.severity] - order[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
