// «Tu día» del profesional — lo que debe atender ahora, ordenado por urgencia — lógica pura.
//
// Junta lo que ya pasa en su panel (servicios en curso o por empezar, propuestas de familias y contraofertas de
// instituciones que vencen, cruces en la agenda, descanso, servicios por calificar, perfil y turnos compatibles) en una
// lista corta y priorizada. Es para TODOS los profesionales: lo que mueve el mercado y su seguridad (responder, llegar,
// descansar) nunca se esconde tras un plan. No contacta a nadie, no acepta nada por la persona y nunca habla de pagos
// fuera de la página web.
import { orderBrief, type HeroPriority, type HeroStat } from "./dayHero";
import { HOUR_MS, DAY_MS, countdownEs, msOf, plural, whenEs } from "./intelShared";
import { formatCOP } from "./pricing";
import type { WorkloadLevel } from "./proWorkload";

export type ProBriefPriority = HeroPriority;

/** A dónde lleva el botón de cada ítem (la pantalla los traduce a rutas con tipos y a pestañas). */
export type ProBriefTarget =
  | { kind: "service"; bookingId: string }
  | { kind: "proposals" }
  | { kind: "counters" }
  | { kind: "opportunities" }
  | { kind: "agenda" }
  | { kind: "profile" }
  | { kind: "documents" }
  | { kind: "ratings" }
  | { kind: "career" }
  | { kind: "rest" }
  | { kind: "plans" };

export interface ProBriefItem {
  id: string;
  priority: ProBriefPriority;
  title: string;
  detail: string;
  cta: { label: string; target: ProBriefTarget };
}

export interface ProService {
  bookingId: string;
  /** confirmed · in_route · in_progress */
  status: string;
  scheduledAt: string;
  counterpartName: string | null;
  alerts: number;
}

export interface ProProposal {
  id: string;
  status: string;
  /** «family» o «professional»: solo esperan respuesta las que llegan de la familia. */
  proposedBy: string;
  expiresAt: string | null;
  peerName: string | null;
}

/** Contraoferta de una institución que espera la respuesta del profesional. */
export interface ProCounter {
  id: string;
  expiresAt: string | null;
  institutionName: string | null;
}

export interface ProUnrated {
  bookingId: string;
  peerName: string | null;
  completedAt: string | null;
}

export interface ProWorkloadHint {
  level: WorkloadLevel;
  runLength: number;
  nextRestLabel: string | null;
  nextRestIsToday: boolean;
  overlapsAhead: number;
}

export interface ProSnapshot {
  now: number;
  services: ProService[];
  proposals: ProProposal[];
  counters: ProCounter[];
  unrated: ProUnrated[];
  workload: ProWorkloadHint | null;
  profile: { completionPct: number; verified: boolean | null; hasRate: boolean };
  /** Turnos compatibles del hub (null si todavía no se leen). */
  opportunities: { fits: number; excellent: number } | null;
  /** «Gracias» recibidos en los últimos 7 días. */
  kudosThisWeek: number;
  completedServices: number;
  /** Plan Esencial o superior. */
  premium: boolean;
  /** Comisión que le cobraron este mes (solo aplica al plan gratuito). */
  commissionMonth: number;
}

/** Horas antes de vencer para tratar una propuesta de familia como urgente. */
export const PRO_PROPOSAL_URGENT_HOURS = 6;
/** Horas antes de vencer para tratar una contraoferta como urgente. */
export const PRO_COUNTER_URGENT_HOURS = 12;
/** Horas hacia adelante en que un servicio confirmado se anuncia como «va a empezar». */
export const PRO_SERVICE_SOON_HOURS = 3;
/** Horas hacia adelante en que un servicio confirmado se menciona. */
export const PRO_SERVICE_NEXT_HOURS = 24;
/** Minutos de gracia antes de decir que un servicio confirmado ya debió empezar. */
export const PRO_LATE_GRACE_MIN = 15;
/** Horas después de la hora programada en que todavía se avisa de un servicio sin iniciar. */
export const PRO_LATE_MAX_HOURS = 12;
/** Días hacia atrás en que un servicio terminado todavía se invita a calificar. */
export const PRO_RATING_WINDOW_DAYS = 14;
/** Perfil por debajo de este porcentaje se señala. */
export const PRO_PROFILE_LOW_PCT = 70;
/** Servicios terminados mínimos para invitar a conocer el plan. */
export const PRO_UPGRADE_MIN_SERVICES = 3;

/** Orden de las reglas cuando la prioridad y la hora empatan (primero lo que se actúa ya, al final lo que invita). */
const RULE_RANK = [
  "service_alert",
  "service_late",
  "service_soon",
  "proposal_expiring",
  "counter_expiring",
  "overlap",
  "rest_high",
  "proposals_waiting",
  "counters_waiting",
  "opportunities_excellent",
  "unrated",
  "verification",
  "profile_incomplete",
  "rest_watch",
  "no_rate",
  "kudos_new",
  "service_live",
  "service_next",
  "opportunities",
  "commission_hint",
  "upgrade",
];

const who = (n: string | null | undefined, fallback: string) =>
  n && n.trim() ? n.trim() : fallback;

function waitingProposals(s: ProSnapshot): ProProposal[] {
  return s.proposals.filter(
    (p) =>
      p.status === "pending" &&
      p.proposedBy === "family" &&
      (p.expiresAt === null || msOf(p.expiresAt) > s.now),
  );
}

function waitingCounters(s: ProSnapshot): ProCounter[] {
  return s.counters.filter((c) => c.expiresAt === null || msOf(c.expiresAt) > s.now);
}

type Keyed = ProBriefItem & { sortKey: number };

export function buildProBrief(s: ProSnapshot): ProBriefItem[] {
  const now = s.now;
  const out: Keyed[] = [];
  const add = (item: ProBriefItem, sortKey = Number.POSITIVE_INFINITY) =>
    out.push({ ...item, sortKey });

  // ── Servicios ──────────────────────────────────────────────────────────────
  for (const v of s.services) {
    const start = msOf(v.scheduledAt);
    const person = who(v.counterpartName, "tu paciente");
    if (v.status === "in_progress") {
      if (v.alerts > 0) {
        add(
          {
            id: `service_alert:${v.bookingId}`,
            priority: "critical",
            title: `Alerta en tu servicio con ${person}`,
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
            title: `Servicio en curso con ${person}`,
            detail: "Registra el parte a medida que avanzas: queda como evidencia de tu trabajo.",
            cta: { label: "Abrir el parte", target: { kind: "service", bookingId: v.bookingId } },
          },
          Number.isFinite(start) ? start : 0,
        );
      }
      continue;
    }
    if (!Number.isFinite(start)) continue;
    if (v.status === "confirmed" || v.status === "in_route") {
      const lateBy = now - start;
      if (
        v.status === "confirmed" &&
        lateBy > PRO_LATE_GRACE_MIN * 60_000 &&
        lateBy <= PRO_LATE_MAX_HOURS * HOUR_MS
      ) {
        add(
          {
            id: `service_late:${v.bookingId}`,
            priority: "high",
            title: `Tu servicio con ${person} ya debería haber empezado`,
            detail:
              "Si vas en camino, avísalo desde el servicio; si no puedes ir, avisa de inmediato para que busquen reemplazo.",
            cta: { label: "Abrir servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      } else if (v.status === "in_route") {
        add(
          {
            id: `service_soon:${v.bookingId}`,
            priority: "medium",
            title: `Vas en camino a tu servicio con ${person}`,
            detail: "Registra tu llegada apenas estés ahí.",
            cta: { label: "Ver servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      } else if (
        start > now - PRO_LATE_GRACE_MIN * 60_000 &&
        start - now <= PRO_SERVICE_SOON_HOURS * HOUR_MS
      ) {
        add(
          {
            id: `service_soon:${v.bookingId}`,
            priority: "high",
            title: `Tu servicio con ${person} es ${whenEs(start, now)}`,
            detail: "Revisa la dirección y sal con margen para llegar a tiempo.",
            cta: { label: "Ver servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      } else if (start > now && start - now <= PRO_SERVICE_NEXT_HOURS * HOUR_MS) {
        add(
          {
            id: `service_next:${v.bookingId}`,
            priority: "low",
            title: `Tu próximo servicio: ${person}, ${whenEs(start, now)}`,
            detail: "El servicio está confirmado.",
            cta: { label: "Ver servicio", target: { kind: "service", bookingId: v.bookingId } },
          },
          start,
        );
      }
    }
  }

  // ── Propuestas de familias ─────────────────────────────────────────────────
  const waiting = waitingProposals(s);
  const urgent = waiting
    .filter(
      (p) => p.expiresAt !== null && msOf(p.expiresAt) - now <= PRO_PROPOSAL_URGENT_HOURS * HOUR_MS,
    )
    .sort((a, b) => msOf(a.expiresAt) - msOf(b.expiresAt) || a.id.localeCompare(b.id));
  const rest = waiting.filter((p) => !urgent.includes(p));
  if (urgent.length) {
    const first = urgent[0];
    add(
      {
        id: "proposal_expiring",
        priority: "high",
        title:
          urgent.length === 1
            ? `Responde antes de que venza: ${who(first.peerName, "una propuesta")}`
            : `${urgent.length} propuestas de familias vencen pronto`,
        detail: `${urgent.length === 1 ? "Vence" : "La primera vence"} ${countdownEs(msOf(first.expiresAt), now)}. Responder rápido genera confianza.`,
        cta: { label: "Ver propuestas", target: { kind: "proposals" } },
      },
      msOf(first.expiresAt),
    );
  }
  if (rest.length) {
    add({
      id: "proposals_waiting",
      priority: "medium",
      title: plural(
        rest.length,
        "propuesta de una familia espera tu respuesta",
        "propuestas de familias esperan tu respuesta",
      ),
      detail: "Cada una es una familia que te eligió para cubrir un horario.",
      cta: { label: "Ver propuestas", target: { kind: "proposals" } },
    });
  }

  // ── Contraofertas de instituciones ─────────────────────────────────────────
  const counters = waitingCounters(s);
  const urgentCounters = counters
    .filter(
      (c) => c.expiresAt !== null && msOf(c.expiresAt) - now <= PRO_COUNTER_URGENT_HOURS * HOUR_MS,
    )
    .sort((a, b) => msOf(a.expiresAt) - msOf(b.expiresAt) || a.id.localeCompare(b.id));
  const restCounters = counters.filter((c) => !urgentCounters.includes(c));
  if (urgentCounters.length) {
    const first = urgentCounters[0];
    add(
      {
        id: "counter_expiring",
        priority: "high",
        title:
          urgentCounters.length === 1
            ? `Una contraoferta vence pronto: ${who(first.institutionName, "una institución")}`
            : `${urgentCounters.length} contraofertas vencen pronto`,
        detail: `${urgentCounters.length === 1 ? "Vence" : "La primera vence"} ${countdownEs(msOf(first.expiresAt), now)}. Si no respondes, se pierde.`,
        cta: { label: "Ver contraofertas", target: { kind: "counters" } },
      },
      msOf(first.expiresAt),
    );
  }
  if (restCounters.length) {
    add({
      id: "counters_waiting",
      priority: "medium",
      title: plural(
        restCounters.length,
        "contraoferta espera tu respuesta",
        "contraofertas esperan tu respuesta",
      ),
      detail: "Acepta, propón otro valor o rechaza: cada ronda tiene un plazo.",
      cta: { label: "Ver contraofertas", target: { kind: "counters" } },
    });
  }

  // ── Agenda y descanso ──────────────────────────────────────────────────────
  const w = s.workload;
  if (w && w.overlapsAhead > 0) {
    add({
      id: "overlap",
      priority: "high",
      title: `${plural(w.overlapsAhead, "servicio se cruza", "servicios se cruzan")} con otro en tu agenda`,
      detail: "No podrás cumplir los dos. Avisa con tiempo a quien corresponda.",
      cta: { label: "Ver mi agenda", target: { kind: "agenda" } },
    });
  }
  if (w && w.level !== "ok") {
    const restAdvice = w.nextRestLabel
      ? w.nextRestIsToday
        ? "Hoy no tienes servicios: aprovecha para descansar."
        : `El ${w.nextRestLabel} no tienes servicios: puede ser tu descanso.`
      : "No tienes un día libre en los próximos 7 días; si puedes, deja uno sin turnos.";
    const target: ProBriefTarget = s.premium ? { kind: "rest" } : { kind: "agenda" };
    const label = s.premium ? "Ver mi carga" : "Ver mi agenda";
    if (w.level === "high") {
      add({
        id: "rest_high",
        priority: "high",
        title:
          w.runLength >= 7
            ? `Llevas ${w.runLength} días seguidos: tu descanso también cuenta`
            : "Tu carga de esta semana es muy alta: cuídate",
        detail: restAdvice,
        cta: { label, target },
      });
    } else {
      add({
        id: "rest_watch",
        priority: "medium",
        title:
          w.runLength >= 5
            ? `Llevas ${w.runLength} días seguidos con servicios`
            : "Tu semana viene cargada: planea un descanso",
        detail: restAdvice,
        cta: { label, target },
      });
    }
  }

  // ── Por calificar ──────────────────────────────────────────────────────────
  const unrated = s.unrated.filter((u) => {
    const t = msOf(u.completedAt);
    return !Number.isFinite(t) || now - t <= PRO_RATING_WINDOW_DAYS * DAY_MS;
  });
  if (unrated.length) {
    add({
      id: "unrated",
      priority: "medium",
      title: plural(unrated.length, "servicio por calificar", "servicios por calificar"),
      detail: "Tu calificación ayuda a otros profesionales a conocer a cada familia.",
      cta: { label: "Calificar", target: { kind: "ratings" } },
    });
  }

  // ── Perfil ─────────────────────────────────────────────────────────────────
  if (s.profile.verified === false) {
    add({
      id: "verification",
      priority: "medium",
      title: "Verifica tu identidad y tu RETHUS",
      detail: "Un perfil verificado genera más confianza en las familias y en las instituciones.",
      cta: { label: "Ir a mis documentos", target: { kind: "documents" } },
    });
  }
  if (s.profile.completionPct < PRO_PROFILE_LOW_PCT) {
    add({
      id: "profile_incomplete",
      priority: "medium",
      title: `Tu perfil está al ${Math.round(s.profile.completionPct)} %`,
      detail:
        "Foto, biografía y documentos ayudan a que te elijan y a que te lleguen mejores ofertas.",
      cta: { label: "Completar mi perfil", target: { kind: "profile" } },
    });
  }
  if (!s.profile.hasRate) {
    add({
      id: "no_rate",
      priority: "low",
      title: "Publica tu tarifa por hora",
      detail:
        "Sin tarifa no podemos calcular lo que te dejaría cada turno ni sugerirte los mejores.",
      cta: { label: "Poner mi tarifa", target: { kind: "profile" } },
    });
  }

  // ── Turnos compatibles ─────────────────────────────────────────────────────
  const o = s.opportunities;
  if (o && o.excellent > 0) {
    add({
      id: "opportunities_excellent",
      priority: "medium",
      title: plural(o.excellent, "turno excelente para ti", "turnos excelentes para ti"),
      detail: "Encajan con tu zona, tu especialidad y tu agenda. Los mejores se llenan primero.",
      cta: { label: "Ver turnos", target: { kind: "opportunities" } },
    });
  } else if (o && o.fits > 0) {
    add({
      id: "opportunities",
      priority: "low",
      title: plural(o.fits, "turno compatible con tu agenda", "turnos compatibles con tu agenda"),
      detail: "Mira cuáles te convienen y postúlate con un toque.",
      cta: { label: "Ver turnos", target: { kind: "opportunities" } },
    });
  }

  // ── Lo bueno ───────────────────────────────────────────────────────────────
  if (s.kudosThisWeek > 0) {
    add({
      id: "kudos_new",
      priority: "low",
      title: `${plural(s.kudosThisWeek, "persona te dio", "personas te dieron")} las gracias esta semana`,
      detail: "Quedaron en tu trayectoria. Léelas: son para ti.",
      cta: { label: "Ver mi trayectoria", target: { kind: "career" } },
    });
  }

  // ── Plan (invitación honesta, con datos propios) ───────────────────────────
  if (!s.premium && s.commissionMonth > 0) {
    add({
      id: "commission_hint",
      priority: "low",
      title: `Este mes llevas ${formatCOP(s.commissionMonth)} en comisión`,
      detail:
        "El plan Esencial no cobra comisión. Mira si con tu volumen te conviene; la suscripción se hace en la página web.",
      cta: { label: "Ver los planes", target: { kind: "plans" } },
    });
  } else if (!s.premium && s.completedServices >= PRO_UPGRADE_MIN_SERVICES) {
    add({
      id: "upgrade",
      priority: "low",
      title: "Conoce tus números",
      detail:
        "Con el plan Esencial ves cuánto ganas por mes, tu mejor día, tu carga de trabajo y tu tarifa frente al mercado.",
      cta: { label: "Ver el plan Esencial", target: { kind: "plans" } },
    });
  }

  return orderBrief(out, RULE_RANK).map(({ sortKey: _sortKey, ...item }) => item);
}

/** Una frase para el encabezado: cuántas cosas piden atención ya (o una buena noticia si todo está en orden). */
export function proHeadline(items: ProBriefItem[]): {
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
  if (items.some((i) => i.id === "kudos_new"))
    return { text: "Todo en orden, y alguien te dio las gracias", tone: "calm" };
  return { text: "Todo en orden por ahora", tone: "calm" };
}

/** Las tres cifras del encabezado: lo que está en curso, lo que viene y lo que espera una respuesta. */
export function proHeroStats(s: ProSnapshot): HeroStat[] {
  const live = s.services.filter((v) => v.status === "in_progress").length;
  const scheduled = s.services.filter(
    (v) => v.status === "confirmed" || v.status === "in_route",
  ).length;
  return [
    { label: "En curso", value: live },
    { label: "Programados", value: scheduled },
    { label: "Por responder", value: waitingProposals(s).length + waitingCounters(s).length },
  ];
}
