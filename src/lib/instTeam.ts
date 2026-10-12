// Equipo de la institución: quién cumple, quién se retrasa y de quién se depende — lógica pura.
//
// Con los servicios de la propia institución arma una ficha por profesional (servicios, horas, puntualidad,
// cancelaciones), mide qué tanto se concentra el cuidado en una sola persona, qué parte de su equipo de confianza lleva
// tiempo sin trabajar con ella y a quién valdría la pena sumar. Es una guía para decidir con evidencia, no un ranking de
// personas: cada etiqueta sale de reglas simples y visibles, nunca se juzga con pocos datos y una cancelación de motivo
// desconocido no se le atribuye a nadie. No contacta a nadie ni cambia el equipo.

import {
  cancelledBy,
  contractedHours,
  dueInPeriod,
  isCompleted,
  isUnstarted,
  lateMinutes,
  PUNCTUAL_GRACE_MIN,
  type InstBooking,
  type InstProFact,
} from "./instData";
import { DAY_MS, joinEs, msOf, pctOf, plural, round1, type Period } from "./intelShared";
import { paidAmount } from "./moneyFlow";

export type Reliability = "excellent" | "solid" | "watch" | "review" | "new";

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  excellent: "Muy confiable",
  solid: "Confiable",
  watch: "Para observar",
  review: "Para revisar",
  new: "Sin servicios",
};

/** Llegadas mínimas para hablar de la puntualidad de una persona. */
export const MIN_ARRIVALS = 3;
/** Servicios terminados mínimos para llamar «muy confiable» a alguien o proponerlo para el equipo. */
export const MIN_SERVICES_TRUSTED = 3;
/** Desde este porcentaje de las horas en una sola persona hay dependencia. */
export const HIGH_CONCENTRATION_PCT = 60;
/** Desde este porcentaje la concentración se vigila. */
export const MODERATE_CONCENTRATION_PCT = 40;
/** Horas mínimas del periodo para hablar de concentración. */
export const MIN_HOURS_CONCENTRATION = 24;
/** Servicios terminados mínimos del periodo para hablar de concentración. */
export const MIN_SERVICES_CONCENTRATION = 3;
/** Días sin trabajar con alguien del equipo de confianza para llamarlo «quieto». */
export const IDLE_DAYS = 30;
/** Ventana en que se busca a quién sumar al equipo. */
export const CANDIDATE_WINDOW_DAYS = 90;
/** Cuántas personas se listan como quietas o candidatas. */
export const LIST_LIMIT = 3;

export interface TeamMember {
  id: string;
  name: string | null;
  inTeam: boolean;
  rethusVerified: boolean | null;
  services: number;
  hours: number;
  spend: number;
  /** Porcentaje de llegadas puntuales (`null` con menos de 3 llegadas registradas). */
  onTimePct: number | null;
  arrivals: number;
  cancelledByProfessional: number;
  unstarted: number;
  reliability: Reliability;
  /** Último servicio terminado con la institución (en cualquier fecha leída). */
  lastServiceAt: string | null;
}

export type ConcentrationRisk = "none" | "healthy" | "moderate" | "high" | "single";

export type TeamSeverity = "warn" | "info" | "good";

export interface TeamInsight {
  id: string;
  severity: TeamSeverity;
  title: string;
  detail: string;
  action?: string;
  /** Profesional al que se refiere (para abrir uno de sus servicios). */
  professionalId?: string;
}

export interface TeamCandidate {
  id: string;
  name: string | null;
  services: number;
  onTimePct: number;
}

export interface IdleMember {
  id: string;
  name: string | null;
  lastServiceAt: string | null;
}

export interface TeamReport {
  hasData: boolean;
  period: Period;
  members: TeamMember[];
  totals: { professionals: number; services: number; hours: number; spend: number };
  concentration: {
    topProfessionalId: string | null;
    topShare: number | null;
    risk: ConcentrationRisk;
  };
  bench: { teamSize: number; active: number; idle: IdleMember[] };
  candidates: TeamCandidate[];
  insights: TeamInsight[];
}

export interface TeamInput {
  bookings: InstBooking[];
  pros: Record<string, InstProFact> | null;
  /** Ids de los profesionales del equipo de confianza de la institución. */
  teamIds: string[];
  period: Period;
  now: number;
}

export interface TeamTally {
  id: string;
  services: number;
  hours: number;
  spend: number;
  arrivals: number;
  onTime: number;
  cancelledByProfessional: number;
  unstarted: number;
}

function tally(rows: InstBooking[], now: number): Map<string, TeamTally> {
  const out = new Map<string, TeamTally>();
  const get = (id: string): TeamTally => {
    let t = out.get(id);
    if (!t) {
      t = {
        id,
        services: 0,
        hours: 0,
        spend: 0,
        arrivals: 0,
        onTime: 0,
        cancelledByProfessional: 0,
        unstarted: 0,
      };
      out.set(id, t);
    }
    return t;
  };
  for (const b of rows) {
    const t = get(b.professional_id);
    if (isCompleted(b)) {
      t.services += 1;
      t.hours += contractedHours(b);
      t.spend += paidAmount(b);
    }
    if (isCompleted(b) || b.status === "in_progress") {
      const late = lateMinutes(b);
      if (late !== null) {
        t.arrivals += 1;
        if (late <= PUNCTUAL_GRACE_MIN) t.onTime += 1;
      }
    }
    if (cancelledBy(b) === "professional") t.cancelledByProfessional += 1;
    if (isUnstarted(b, now)) t.unstarted += 1;
  }
  return out;
}

const onTimePctOf = (t: Pick<TeamTally, "arrivals" | "onTime">): number | null =>
  t.arrivals >= MIN_ARRIVALS ? pctOf(t.onTime, t.arrivals) : null;

/** La etiqueta de una persona a partir de sus números; solo se juzga con evidencia. */
export function reliabilityOf(t: TeamTally): Reliability {
  const incidents = t.cancelledByProfessional + t.unstarted;
  const onTimePct = onTimePctOf(t);
  if (t.services === 0 && incidents === 0) return "new";
  if (incidents >= 2 || (onTimePct !== null && onTimePct < 60)) return "review";
  if (incidents >= 1 || (onTimePct !== null && onTimePct < 75)) return "watch";
  if (t.services >= MIN_SERVICES_TRUSTED && onTimePct !== null && onTimePct >= 90)
    return "excellent";
  return "solid";
}

function lastServices(rows: InstBooking[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of rows) {
    if (!isCompleted(b)) continue;
    const t = msOf(b.completed_at ?? b.scheduled_at);
    if (!Number.isFinite(t)) continue;
    if (t > (out.get(b.professional_id) ?? Number.NEGATIVE_INFINITY)) out.set(b.professional_id, t);
  }
  return out;
}

export function buildTeamReport(input: TeamInput): TeamReport {
  const { period, now } = input;
  const facts = input.pros ?? {};
  const nameOf = (id: string): string | null => facts[id]?.name?.trim() || null;
  const teamSet = new Set(input.teamIds);

  const due = dueInPeriod(input.bookings, period, now);
  const tallies = tally(due, now);
  const last = lastServices(input.bookings);

  const members: TeamMember[] = [...tallies.values()]
    .map((t) => ({
      id: t.id,
      name: nameOf(t.id),
      inTeam: teamSet.has(t.id),
      rethusVerified: facts[t.id]?.rethusVerified ?? null,
      services: t.services,
      hours: round1(t.hours),
      spend: t.spend,
      onTimePct: onTimePctOf(t),
      arrivals: t.arrivals,
      cancelledByProfessional: t.cancelledByProfessional,
      unstarted: t.unstarted,
      reliability: reliabilityOf(t),
      lastServiceAt: last.has(t.id) ? new Date(last.get(t.id) as number).toISOString() : null,
    }))
    .sort((a, b) => b.hours - a.hours || b.services - a.services || a.id.localeCompare(b.id));

  const delivered = members.filter((m) => m.services > 0);
  const totalHours = round1(delivered.reduce((s, m) => s + m.hours, 0));
  const totalServices = delivered.reduce((s, m) => s + m.services, 0);
  const totals = {
    professionals: delivered.length,
    services: totalServices,
    hours: totalHours,
    spend: delivered.reduce((s, m) => s + m.spend, 0),
  };

  // ── Concentración ────────────────────────────────────────────────────────────
  const top = delivered[0] ?? null;
  const topShare = top && totalHours > 0 ? Math.round((top.hours / totalHours) * 100) : null;
  let risk: ConcentrationRisk = "none";
  if (totalServices >= MIN_SERVICES_CONCENTRATION && totalHours >= MIN_HOURS_CONCENTRATION) {
    if (delivered.length === 1) risk = "single";
    else if ((topShare ?? 0) >= HIGH_CONCENTRATION_PCT) risk = "high";
    else if ((topShare ?? 0) >= MODERATE_CONCENTRATION_PCT) risk = "moderate";
    else risk = "healthy";
  }

  // ── Equipo de confianza ──────────────────────────────────────────────────────
  const idleSince = now - IDLE_DAYS * DAY_MS;
  const teamIds = [...teamSet];
  const idle: IdleMember[] = teamIds
    .filter((id) => (last.get(id) ?? Number.NEGATIVE_INFINITY) < idleSince)
    .map((id) => ({
      id,
      name: nameOf(id),
      lastServiceAt: last.has(id) ? new Date(last.get(id) as number).toISOString() : null,
    }));
  // Primero quienes trabajaron hace más tiempo; quienes nunca trabajaron con la institución, al final.
  idle.sort((a, b) => {
    const x = a.lastServiceAt ? msOf(a.lastServiceAt) : Number.POSITIVE_INFINITY;
    const y = b.lastServiceAt ? msOf(b.lastServiceAt) : Number.POSITIVE_INFINITY;
    return x === y ? a.id.localeCompare(b.id) : x < y ? -1 : 1;
  });

  // ── A quién sumar ────────────────────────────────────────────────────────────
  // Una fecha dañada da NaN y la comparación es falsa: no entra. Lo futuro no suma servicios terminados.
  const recent = input.bookings.filter(
    (b) => msOf(b.scheduled_at) >= now - CANDIDATE_WINDOW_DAYS * DAY_MS,
  );
  const candidates: TeamCandidate[] = [...tally(recent, now).values()]
    .filter(
      (t) =>
        !teamSet.has(t.id) &&
        t.services >= MIN_SERVICES_TRUSTED &&
        t.cancelledByProfessional === 0 &&
        t.unstarted === 0 &&
        (onTimePctOf(t) ?? 0) >= 90,
    )
    .sort((a, b) => b.services - a.services || b.hours - a.hours || a.id.localeCompare(b.id))
    .slice(0, LIST_LIMIT)
    .map((t) => ({
      id: t.id,
      name: nameOf(t.id),
      services: t.services,
      onTimePct: onTimePctOf(t) as number,
    }));

  const report: TeamReport = {
    hasData: members.length > 0,
    period,
    members,
    totals,
    concentration: { topProfessionalId: top?.id ?? null, topShare, risk },
    bench: {
      teamSize: teamIds.length,
      active: teamIds.length - idle.length,
      idle: idle.slice(0, LIST_LIMIT),
    },
    candidates,
    insights: [],
  };
  report.insights = teamInsights(report, idle.length);
  return report;
}

const SEVERITY_ORDER: Record<TeamSeverity, number> = { warn: 0, info: 1, good: 2 };

/** Nombre para una frase; sin nombre conocido, «un profesional» (con mayúscula al empezar). */
const who = (name: string | null, start = false) =>
  name ?? (start ? "Un profesional" : "un profesional");

export function teamInsights(r: TeamReport, idleCount: number): TeamInsight[] {
  if (!r.hasData && r.bench.teamSize === 0) {
    return [
      {
        id: "no_data",
        severity: "info",
        title: "Aún no hay servicios para analizar",
        detail:
          "Cuando tus profesionales presten servicios, aquí verás quién cumple, quién se retrasa y de quién dependes.",
      },
    ];
  }
  const out: TeamInsight[] = [];
  const byId = new Map(r.members.map((m) => [m.id, m]));
  const topMember = r.concentration.topProfessionalId
    ? byId.get(r.concentration.topProfessionalId)
    : undefined;

  if (r.concentration.risk === "single" && topMember) {
    out.push({
      id: "single",
      severity: "warn",
      title: "Todo el cuidado depende de una sola persona",
      detail: `${who(topMember.name, true)} prestó todas las horas del periodo. Si cancela o se enferma, no hay a quién llamar.`,
      action: "Suma al menos dos personas más a tu equipo de confianza.",
      professionalId: topMember.id,
    });
  } else if (r.concentration.risk === "high" && topMember) {
    out.push({
      id: "dependency",
      severity: "warn",
      title: `Dependes de ${who(topMember.name)}: prestó el ${r.concentration.topShare} % de las horas`,
      detail: "Cuando una sola persona cubre casi todo, una ausencia deja turnos sin atender.",
      action: "Suma a más profesionales a tu equipo de confianza para tener plan B.",
      professionalId: topMember.id,
    });
  }

  for (const m of r.members.filter((x) => x.reliability === "review").slice(0, 2)) {
    const parts: string[] = [];
    if (m.cancelledByProfessional > 0)
      parts.push(`canceló ${plural(m.cancelledByProfessional, "turno", "turnos")}`);
    if (m.unstarted > 0) parts.push(`dejó ${plural(m.unstarted, "turno", "turnos")} sin iniciar`);
    if (m.onTimePct !== null && m.onTimePct < 60)
      parts.push(`llegó a tiempo solo el ${m.onTimePct} % de las veces (${m.arrivals} llegadas)`);
    out.push({
      id: `review:${m.id}`,
      severity: "warn",
      title: `Revisa con ${who(m.name)} cómo van los turnos`,
      detail: `${who(m.name, true)} ${joinEs(parts)}. Hablarlo a tiempo suele resolverlo.`,
      action: "Abre uno de sus servicios para ver el detalle.",
      professionalId: m.id,
    });
  }

  if (r.bench.teamSize === 0 && r.totals.services >= MIN_SERVICES_TRUSTED) {
    out.push({
      id: "team_empty",
      severity: "info",
      title: "Aún no tienes equipo de confianza",
      detail:
        "Si un profesional cancela un turno, avisamos de inmediato a tu equipo de confianza para cubrirlo. Sin equipo, esa ayuda no existe.",
      action: "Agrega a quienes ya cumplieron bien desde el servicio.",
    });
  } else if (idleCount > 0) {
    out.push({
      id: "team_idle",
      severity: "info",
      title: `${idleCount} de ${r.bench.teamSize} personas de tu equipo no trabajan contigo hace más de ${IDLE_DAYS} días`,
      detail: "Ya conocen cómo trabajas: son los primeros a quienes invitar a tus próximos turnos.",
      action: "Invítalos desde el centro de cobertura cuando publiques un turno.",
    });
  }

  const candidate = r.candidates[0];
  if (candidate) {
    out.push({
      id: "add_candidate",
      severity: "info",
      title: `${who(candidate.name, true)} podría sumarse a tu equipo de confianza`,
      detail: `Cumplió ${plural(candidate.services, "turno", "turnos")} y llegó a tiempo el ${candidate.onTimePct} % de las veces.`,
      action:
        "Agrégalo desde uno de sus servicios: así lo invitamos primero si un turno queda libre.",
      professionalId: candidate.id,
    });
  }

  const star = r.members.find((m) => m.reliability === "excellent");
  if (star) {
    out.push({
      id: "thank",
      severity: "good",
      title: `Agradece a ${who(star.name)}`,
      detail: `${plural(star.services, "turno cumplido", "turnos cumplidos")} en el periodo, ${star.onTimePct} % de las llegadas puntuales. Un «gracias» en el servicio queda en su trayectoria.`,
      professionalId: star.id,
    });
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}
