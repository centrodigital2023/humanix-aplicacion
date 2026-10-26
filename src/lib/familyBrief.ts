// «Tu día, resuelto» — lo que la familia debe atender ahora, ordenado por urgencia — lógica pura.
//
// Junta lo que ya pasa en el panel (turnos en curso, propuestas que vencen, postulaciones sin responder, horas sin
// cubrir, servicios por calificar, datos de emergencia) en una lista corta y priorizada. Cada ítem nombra la regla que
// lo produjo y a dónde llevar a la persona. Es para TODAS las familias: lo que mueve el mercado y la seguridad
// (responder, calificar, cubrir) nunca se esconde tras un plan. Con plan de pago se añaden avisos sacados del informe
// de bienestar y del presupuesto; sin plan, una sola invitación a conocerlos. No contacta a nadie ni decide nada.

import type { GapLevel } from "./coverageRadar";
import { orderBrief, type HeroStat } from "./dayHero";
import { DAY_MS, HOUR_MS, ageEs, countdownEs, msOf, plural, whenEs } from "./intelShared";

export { whenEs };

export type BriefPriority = "critical" | "high" | "medium" | "low";

/** A dónde lleva el botón de cada ítem (la pantalla los traduce a rutas con tipos). */
export type BriefTarget =
  | { kind: "service"; bookingId: string }
  | { kind: "agenda" }
  | { kind: "proposals" }
  | { kind: "applications" }
  | { kind: "ratings" }
  | { kind: "team" }
  | { kind: "circle" }
  | { kind: "profile" }
  | { kind: "search" }
  | { kind: "plans" }
  | { kind: "wellbeing" }
  | { kind: "budget" };

export interface BriefItem {
  id: string;
  priority: BriefPriority;
  title: string;
  detail: string;
  cta: { label: string; target: BriefTarget };
  /** Solo se genera para quien tiene plan de pago. */
  premium?: boolean;
}

export interface BriefService {
  bookingId: string;
  side: "client" | "circle";
  /** confirmed · in_route · in_progress */
  status: string;
  scheduledAt: string;
  counterpartName: string | null;
  /** Titular del cuidado (solo en servicios del círculo). */
  ownerName?: string | null;
  alerts: number;
}

export interface BriefProposal {
  id: string;
  status: string;
  /** «family» o «professional»: solo esperan respuesta las que llegan de un profesional. */
  proposedBy: string;
  expiresAt: string | null;
  peerName: string | null;
}

export interface BriefApplication {
  id: string;
  status: string;
  createdAt: string;
}

export interface BriefUnrated {
  bookingId: string;
  proName: string | null;
  completedAt: string | null;
}

export interface BriefGap {
  startsAt: string;
  endsAt: string;
  hours: number;
  level: GapLevel;
}

export interface PremiumHints {
  /** Alertas e incidentes de los últimos 7 días. */
  alerts7d?: number;
  moodTrend?: "better" | "worse" | "stable" | "unknown";
  /** Gasto del mes frente al mes pasado a la misma altura. */
  budgetDeltaPct?: number | null;
  /** Cuánto por encima de la mediana de la ciudad paga la familia. */
  aboveMarketPct?: number | null;
}

export interface FamilySnapshot {
  now: number;
  services: BriefService[];
  proposals: BriefProposal[];
  applications: BriefApplication[];
  gaps: BriefGap[];
  unrated: BriefUnrated[];
  profile: { complete: boolean; hasEmergencyContact: boolean };
  completedServices: number;
  teamSize: number;
  /** Miembros del círculo de cuidado (aceptados o con invitación enviada). */
  circleMembers: number;
  premium: boolean;
  hints?: PremiumHints;
}

/**
 * Orden de las reglas cuando la prioridad y la hora empatan (primero lo que se actúa ya, al final lo que invita).
 * Los ítems de una misma regla comparten el lugar; entre ellos desempata el id.
 */
const RULE_RANK = [
  "service_alert",
  "proposal_expiring",
  "gap_soon",
  "proposals_waiting",
  "applications_waiting",
  "emergency_contact",
  "profile_incomplete",
  "unrated",
  "save_team",
  "wellbeing_alerts",
  "wellbeing_mood",
  "budget_pace",
  "first_request",
  "service_live",
  "service_soon",
  "budget_market",
  "invite_circle",
  "upgrade",
];

/** Horas antes de vencer para tratar una propuesta como urgente. */
export const PROPOSAL_URGENT_HOURS = 6;
/** Horas sin responder una postulación para subirla a prioridad alta. */
export const APPLICATION_STALE_HOURS = 24;
/** Días hacia atrás en que un servicio terminado todavía se invita a calificar. */
export const RATING_WINDOW_DAYS = 14;
/** Horas hacia adelante en que un servicio confirmado se anuncia. */
export const SERVICE_SOON_HOURS = 24;

const name = (n: string | null | undefined, fallback: string) =>
  n && n.trim() ? n.trim() : fallback;

/** Propuestas de un profesional que esperan respuesta y todavía no vencen. */
function waitingProposals(s: FamilySnapshot): BriefProposal[] {
  return s.proposals.filter(
    (p) =>
      p.status === "pending" &&
      p.proposedBy !== "family" &&
      (p.expiresAt === null || msOf(p.expiresAt) > s.now),
  );
}

type Keyed = BriefItem & { sortKey: number };

export function buildFamilyBrief(s: FamilySnapshot): BriefItem[] {
  const now = s.now;
  const out: Keyed[] = [];
  const add = (item: BriefItem, sortKey = Number.POSITIVE_INFINITY) =>
    out.push({ ...item, sortKey });

  // ── Turnos ─────────────────────────────────────────────────────────────────
  for (const v of s.services) {
    const start = msOf(v.scheduledAt);
    const who = name(v.counterpartName, "tu profesional");
    const owner = name(v.ownerName, "tu familiar");
    const mine = v.side === "client";

    if (v.status === "in_progress") {
      if (v.alerts > 0) {
        add(
          {
            id: `service_alert:${v.bookingId}`,
            priority: "critical",
            title: mine ? `Alerta en el turno de ${who}` : `Alerta en el servicio de ${owner}`,
            detail: `${plural(v.alerts, "alerta registrada", "alertas registradas")} en el parte de hoy. Revísalo ahora.`,
            cta: { label: "Ver el parte", target: { kind: "service", bookingId: v.bookingId } },
          },
          Number.isFinite(start) ? start : 0,
        );
      } else {
        add(
          {
            id: `service_live:${v.bookingId}`,
            priority: "low",
            title: mine ? `Turno en curso con ${who}` : `Servicio en curso de ${owner}`,
            detail: "Sin alertas por ahora. Puedes seguir el parte en vivo.",
            cta: {
              label: "Ver el parte en vivo",
              target: { kind: "service", bookingId: v.bookingId },
            },
          },
          Number.isFinite(start) ? start : 0,
        );
      }
    } else if (v.side === "client" && Number.isFinite(start)) {
      if (v.status === "in_route") {
        add(
          {
            id: `service_soon:${v.bookingId}`,
            priority: "low",
            title: `${who} va en camino`,
            detail: "Te avisamos cuando llegue y comience el parte del turno.",
            cta: { label: "Ver servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      } else if (
        v.status === "confirmed" &&
        start > now &&
        start - now <= SERVICE_SOON_HOURS * HOUR_MS
      ) {
        add(
          {
            id: `service_soon:${v.bookingId}`,
            priority: "low",
            title: `${who} llega ${whenEs(start, now)}`,
            detail: "El servicio está confirmado.",
            cta: { label: "Ver servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      }
    }
  }

  // ── Propuestas de profesionales ────────────────────────────────────────────
  const waiting = waitingProposals(s);
  const urgent = waiting
    .filter(
      (p) => p.expiresAt !== null && msOf(p.expiresAt) - now <= PROPOSAL_URGENT_HOURS * HOUR_MS,
    )
    .sort((a, b) => msOf(a.expiresAt) - msOf(b.expiresAt) || a.id.localeCompare(b.id));
  const rest = waiting.filter((p) => !urgent.includes(p));

  if (urgent.length) {
    const first = urgent[0];
    const left = countdownEs(msOf(first.expiresAt), now);
    add(
      {
        id: "proposal_expiring",
        priority: "high",
        title:
          urgent.length === 1
            ? `Responde antes de que venza: ${name(first.peerName, "una propuesta")}`
            : `${urgent.length} propuestas vencen pronto`,
        detail: `${urgent.length === 1 ? "Vence" : "La primera vence"} ${left}. Si no respondes, se pierde.`,
        cta: { label: "Ver propuestas", target: { kind: "proposals" } },
      },
      msOf(first.expiresAt),
    );
  }
  if (rest.length) {
    add({
      id: "proposals_waiting",
      priority: "high",
      title: plural(
        rest.length,
        "propuesta esperando tu respuesta",
        "propuestas esperando tu respuesta",
      ),
      detail: "Cada una es un profesional dispuesto a cubrir un horario tuyo.",
      cta: { label: "Ver propuestas", target: { kind: "proposals" } },
    });
  }

  // ── Postulaciones ──────────────────────────────────────────────────────────
  const pendingApps = s.applications.filter((a) => a.status === "pending");
  if (pendingApps.length) {
    const oldest = Math.min(
      ...pendingApps.map((a) => msOf(a.createdAt)).filter((t) => Number.isFinite(t)),
    );
    const stale = Number.isFinite(oldest) && now - oldest >= APPLICATION_STALE_HOURS * HOUR_MS;
    add({
      id: "applications_waiting",
      priority: stale ? "high" : "medium",
      title: plural(pendingApps.length, "postulación sin responder", "postulaciones sin responder"),
      detail: Number.isFinite(oldest)
        ? `La más antigua llegó ${ageEs(oldest, now)}. Quien espera mucho suele aceptar otra oferta.`
        : "Responde para no perder a quienes se postularon.",
      cta: { label: "Ver postulaciones", target: { kind: "applications" } },
    });
  }

  // ── Horas sin cubrir ───────────────────────────────────────────────────────
  const soon = s.gaps
    .filter((g) => g.level !== "low" && Number.isFinite(msOf(g.startsAt)))
    .sort((a, b) => msOf(a.startsAt) - msOf(b.startsAt));
  if (soon.length) {
    const g = soon[0];
    const start = msOf(g.startsAt);
    const priority: BriefPriority =
      g.level === "critical" ? "critical" : g.level === "high" ? "high" : "medium";
    const more = soon.length - 1;
    add(
      {
        id: "gap_soon",
        priority,
        title:
          start <= now
            ? "Hay un turno ya empezado sin profesional"
            : `Sin profesional ${whenEs(start, now)}`,
        detail:
          `${plural(Math.round(g.hours * 10) / 10, "hora sin cubrir", "horas sin cubrir")}` +
          (more > 0 ? `, y ${plural(more, "hueco más", "huecos más")} en los próximos días` : "") +
          ".",
        cta: { label: "Ver mi agenda", target: { kind: "agenda" } },
      },
      start,
    );
  }

  // ── Datos de seguridad ─────────────────────────────────────────────────────
  if (!s.profile.hasEmergencyContact) {
    add({
      id: "emergency_contact",
      priority: s.services.length > 0 ? "high" : "medium",
      title: "Agrega un contacto de emergencia",
      detail: "Si algo pasa durante un turno, el equipo sabe a quién llamar sin perder tiempo.",
      cta: { label: "Completar mis datos", target: { kind: "profile" } },
    });
  } else if (!s.profile.complete) {
    add({
      id: "profile_incomplete",
      priority: "medium",
      title: "Completa tu perfil",
      detail:
        "Faltan datos (documento, dirección o autorización) para que el servicio llegue bien y tú estés protegido.",
      cta: { label: "Completar mis datos", target: { kind: "profile" } },
    });
  }

  // ── Servicios por calificar ────────────────────────────────────────────────
  const recent = s.unrated.filter((u) => {
    const t = msOf(u.completedAt);
    return !Number.isFinite(t) || now - t <= RATING_WINDOW_DAYS * DAY_MS;
  });
  if (recent.length) {
    add({
      id: "unrated",
      priority: "medium",
      title:
        recent.length === 1
          ? `Califica el servicio con ${name(recent[0].proName, "tu profesional")}`
          : `${recent.length} servicios por calificar`,
      detail: "Tu opinión ayuda a otras familias y reconoce a quien cuidó bien.",
      cta: { label: "Calificar", target: { kind: "ratings" } },
    });
  }

  // ── Plan B y círculo ───────────────────────────────────────────────────────
  if (s.completedServices >= 1 && s.teamSize === 0) {
    add({
      id: "save_team",
      priority: "medium",
      title: "Guarda a quien te dio tranquilidad",
      detail:
        "Tu equipo de confianza es tu plan B: si alguien cancela, sabrás cuántos están libres.",
      cta: { label: "Ver mi equipo", target: { kind: "team" } },
    });
  }
  if (s.circleMembers === 0 && (s.completedServices >= 1 || s.services.length > 0)) {
    add({
      id: "invite_circle",
      priority: "low",
      title: "Invita a un familiar a tu círculo",
      detail: "Podrá ver el parte del turno en vivo, sin acciones y sin precios.",
      cta: { label: "Invitar", target: { kind: "circle" } },
    });
  }

  // ── Primer paso ────────────────────────────────────────────────────────────
  if (
    s.services.length === 0 &&
    s.completedServices === 0 &&
    s.gaps.length === 0 &&
    s.unrated.length === 0 &&
    s.proposals.length === 0 &&
    s.applications.length === 0
  ) {
    add({
      id: "first_request",
      priority: "medium",
      title: "Pide tu primer cuidado",
      detail: "Cuéntanos qué necesitas y te mostramos profesionales verificados cerca de ti.",
      cta: { label: "Buscar cuidado", target: { kind: "search" } },
    });
  }

  // ── Con plan de pago: lo que dicen el informe y el presupuesto ─────────────
  if (s.premium && s.hints) {
    const h = s.hints;
    if ((h.alerts7d ?? 0) > 0) {
      add({
        id: "wellbeing_alerts",
        priority: "medium",
        premium: true,
        title: `Hubo ${plural(h.alerts7d as number, "alerta o incidente", "alertas o incidentes")} esta semana`,
        detail:
          "El informe de bienestar los junta con los signos vitales y el ánimo para que puedas comentarlo con el médico.",
        cta: { label: "Abrir el informe", target: { kind: "wellbeing" } },
      });
    }
    if (h.moodTrend === "worse") {
      add({
        id: "wellbeing_mood",
        priority: "medium",
        premium: true,
        title: "El ánimo ha ido bajando",
        detail:
          "En los últimos servicios hay más días cansado, decaído o con dolor. Vale la pena mirar el informe completo.",
        cta: { label: "Abrir el informe", target: { kind: "wellbeing" } },
      });
    }
    if (h.budgetDeltaPct !== null && h.budgetDeltaPct !== undefined && h.budgetDeltaPct >= 25) {
      add({
        id: "budget_pace",
        priority: "medium",
        premium: true,
        title: `Vas ${h.budgetDeltaPct} % por encima del mes pasado`,
        detail:
          "A la misma fecha del mes anterior llevabas menos. Revisa si subieron las horas o la tarifa.",
        cta: { label: "Ver mi presupuesto", target: { kind: "budget" } },
      });
    }
    if (h.aboveMarketPct !== null && h.aboveMarketPct !== undefined && h.aboveMarketPct >= 10) {
      add({
        id: "budget_market",
        priority: "low",
        premium: true,
        title: `Pagas ${h.aboveMarketPct} % más que la mediana de tu ciudad`,
        detail: "Una contraoferta a tiempo suele ahorrar dinero sin perder calidad.",
        cta: { label: "Ver mi presupuesto", target: { kind: "budget" } },
      });
    }
  }

  // ── Sin plan de pago: una sola invitación, solo a quien ya tiene actividad ─
  if (!s.premium && (s.completedServices >= 1 || s.services.length > 0)) {
    add({
      id: "upgrade",
      priority: "low",
      title: "Entiende mejor el cuidado de tu familiar",
      detail:
        "Con el plan Familiar ves tendencias de ánimo y signos vitales, comparas postulaciones, controlas el gasto y anticipas horas sin cubrir.",
      cta: { label: "Ver el plan Familiar", target: { kind: "plans" } },
    });
  }

  return orderBrief(out, RULE_RANK).map(({ sortKey: _sortKey, ...item }) => item);
}

/** Una frase para el encabezado: cuántas cosas piden atención ya. */
export function briefHeadline(items: BriefItem[]): {
  text: string;
  tone: "alert" | "attention" | "calm";
} {
  const critical = items.filter((i) => i.priority === "critical").length;
  const high = items.filter((i) => i.priority === "high").length;
  if (critical > 0)
    return {
      text: `${plural(critical, "cosa urgente", "cosas urgentes")} para mirar ahora`,
      tone: "alert",
    };
  if (high > 0)
    return {
      text: `${plural(high, "cosa pide", "cosas piden")} tu atención hoy`,
      tone: "attention",
    };
  return { text: "Todo en orden por ahora", tone: "calm" };
}

/** Las tres cifras del encabezado: lo que está en curso, lo que viene y lo que espera una respuesta. */
export function heroStats(s: FamilySnapshot): HeroStat[] {
  const live = s.services.filter((v) => v.status === "in_progress").length;
  const scheduled = s.services.filter(
    (v) => v.status === "confirmed" || v.status === "in_route",
  ).length;
  const toAnswer =
    waitingProposals(s).length + s.applications.filter((a) => a.status === "pending").length;
  return [
    { label: "En curso", value: live },
    { label: "Programados", value: scheduled },
    { label: "Por responder", value: toAnswer },
  ];
}
