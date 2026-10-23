// «Tu día» de la institución — lo que debe atender ahora, ordenado por urgencia — lógica pura.
//
// Junta lo que ya pasa en su panel (turnos en curso con alertas, profesionales que no llegan, turnos que van a quedar sin
// cubrir, postulaciones sin responder, contratos sin firma, servicios por calificar, perfil) en una lista corta y
// priorizada. Es para TODAS las instituciones: lo que protege al paciente y mueve la cobertura nunca se esconde tras un
// plan. Con el plan Institucional se añade el aviso de calidad; sin él, una sola invitación honesta a conocer los números.
// No contacta a nadie, no acepta nada por la institución y nunca habla de pagos fuera de la página web.

import { orderBrief, type HeroPriority, type HeroStat } from "./dayHero";
import type { CoverageRisk } from "./institutionCoverage";
import { DAY_MS, HOUR_MS, countdownEs, msOf, plural } from "./intelShared";

export type InstBriefPriority = HeroPriority;

/** A dónde lleva el botón de cada ítem (la pantalla los traduce a rutas con tipos, pestañas y secciones). */
export type InstBriefTarget =
  | { kind: "service"; bookingId: string }
  | { kind: "coverage" }
  | { kind: "applications" }
  | { kind: "contracts" }
  | { kind: "ratings" }
  | { kind: "profile" }
  | { kind: "publish" }
  | { kind: "live" }
  | { kind: "quality" }
  | { kind: "plans" };

export interface InstBriefItem {
  id: string;
  priority: InstBriefPriority;
  title: string;
  detail: string;
  /** Etiqueta pequeña junto al título (por ejemplo «Plan Institucional»). */
  badge?: string;
  cta: { label: string; target: InstBriefTarget };
}

export interface InstService {
  bookingId: string;
  /** confirmed · in_route · in_progress */
  status: string;
  scheduledAt: string;
  counterpartName: string | null;
  alerts: number;
}

export interface InstShiftRisk {
  shiftId: string;
  offerTitle: string;
  risk: CoverageRisk;
  open: number;
  hoursToStart: number;
  startsAt: string;
}

export interface InstWaiting {
  id: string;
  createdAt: string;
}

export interface InstUnsigned {
  id: string;
  firstShiftAt: string | null;
}

export interface InstUnrated {
  bookingId: string;
  completedAt: string | null;
}

/** Resumen de calidad para el aviso del día (solo con el plan Institucional). */
export interface InstQualityHint {
  alerts: number;
  /** El indicador más bajo en rojo. */
  worst: { label: string; value: number } | null;
}

export interface InstSnapshot {
  now: number;
  services: InstService[];
  shifts: InstShiftRisk[];
  waiting: InstWaiting[];
  unsigned: InstUnsigned[];
  unrated: InstUnrated[];
  profile: { complete: boolean; verified: boolean | null };
  /** Porcentaje de cupos cubiertos de los turnos publicados (`null` sin turnos). */
  coveragePct: number | null;
  /** La institución ya publicó al menos un turno. */
  hasShifts: boolean;
  completedServices: number;
  /** Plan Institucional (el de las instituciones). */
  premium: boolean;
  quality: InstQualityHint | null;
}

/** Minutos de gracia antes de decir que un servicio confirmado ya debió empezar. */
export const INST_LATE_GRACE_MIN = 15;
/** Minutos de retraso desde los que la ausencia es urgente. */
export const INST_LATE_URGENT_MIN = 30;
/** Horas después de la hora programada en que todavía se avisa de un servicio sin iniciar. */
export const INST_LATE_MAX_HOURS = 12;
/** Horas de espera desde las que una postulación sin responder es importante. */
export const INST_WAITING_HIGH_HOURS = 24;
/** Horas antes del primer turno en que un contrato sin firma es importante. */
export const INST_CONTRACT_SOON_HOURS = 48;
/** Días hacia atrás en que un servicio terminado todavía se invita a calificar. */
export const INST_RATING_WINDOW_DAYS = 14;
/** Servicios terminados mínimos para invitar a conocer el plan. */
export const INST_UPGRADE_MIN_SERVICES = 3;

/** Orden de las reglas cuando la prioridad y la hora empatan (primero lo que se actúa ya, al final lo que invita). */
const RULE_RANK = [
  "service_alert",
  "service_no_show",
  "coverage_critical",
  "service_late_route",
  "coverage_high",
  "applications_waiting",
  "contracts_unsigned",
  "quality_attention",
  "unrated",
  "profile_incomplete",
  "publish_first",
  "unverified",
  "service_live",
  "upgrade",
];

const who = (n: string | null | undefined, fallback: string) =>
  n && n.trim() ? n.trim() : fallback;

/** «hace 25 min» / «hace 2 h». */
function sinceLabel(minutes: number): string {
  if (minutes < 60) return `hace ${Math.round(minutes)} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

type Keyed = InstBriefItem & { sortKey: number };

export function buildInstBrief(s: InstSnapshot): InstBriefItem[] {
  const now = s.now;
  const out: Keyed[] = [];
  const add = (item: InstBriefItem, sortKey = Number.POSITIVE_INFINITY) =>
    out.push({ ...item, sortKey });

  // ── Servicios en curso o por empezar ───────────────────────────────────────
  for (const v of s.services) {
    const start = msOf(v.scheduledAt);
    const person = who(v.counterpartName, "tu profesional");
    if (v.status === "in_progress") {
      if (v.alerts > 0) {
        add(
          {
            id: `service_alert:${v.bookingId}`,
            priority: "critical",
            title: `Alerta en el turno de ${person}`,
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
            title: `Turno en curso con ${person}`,
            detail: "Puedes seguir el parte en vivo.",
            cta: { label: "Ver el parte", target: { kind: "service", bookingId: v.bookingId } },
          },
          Number.isFinite(start) ? start : 0,
        );
      }
      continue;
    }
    // Sin hora (fecha dañada) `lateMs` es NaN y ninguna comparación se cumple: no se avisa de lo que no tiene hora.
    const lateMs = now - start;
    const lateMin = lateMs / 60_000;
    const isLate = lateMs > INST_LATE_GRACE_MIN * 60_000 && lateMs <= INST_LATE_MAX_HOURS * HOUR_MS;
    if (v.status === "confirmed" && isLate) {
      add(
        {
          id: `service_no_show:${v.bookingId}`,
          priority: lateMin > INST_LATE_URGENT_MIN ? "critical" : "high",
          title: `${person} aún no ha iniciado su turno`,
          detail: `Debía empezar ${sinceLabel(lateMin)}. Si no hay noticias, invita a tu equipo de confianza a cubrirlo.`,
          cta: { label: "Abrir el servicio", target: { kind: "service", bookingId: v.bookingId } },
        },
        start,
      );
    } else if (v.status === "in_route" && isLate) {
      add(
        {
          id: `service_late_route:${v.bookingId}`,
          priority: lateMin > INST_LATE_URGENT_MIN ? "high" : "medium",
          title: `${person} va en camino, con retraso`,
          detail: `Su turno debía empezar ${sinceLabel(lateMin)}. Ya avisó que viene en camino.`,
          cta: { label: "Ver el servicio", target: { kind: "service", bookingId: v.bookingId } },
        },
        start,
      );
    }
  }

  // ── Cobertura ──────────────────────────────────────────────────────────────
  const open = s.shifts.filter((x) => x.open > 0);
  const critical = open
    .filter((x) => x.risk === "critical")
    .sort((a, b) => msOf(a.startsAt) - msOf(b.startsAt));
  const high = open.filter((x) => x.risk === "high");
  if (critical.length) {
    const first = critical[0];
    add(
      {
        id: "coverage_critical",
        priority: "critical",
        title: plural(critical.length, "turno crítico sin cubrir", "turnos críticos sin cubrir"),
        detail: `El primero: «${first.offerTitle}», ${first.hoursToStart <= 0 ? "ya empezó" : `empieza ${countdownEs(msOf(first.startsAt), now)}`}.`,
        cta: { label: "Cubrir ahora", target: { kind: "coverage" } },
      },
      msOf(first.startsAt),
    );
  }
  if (high.length) {
    add({
      id: "coverage_high",
      priority: "high",
      title: plural(
        high.length,
        "turno en riesgo de quedar sin cubrir",
        "turnos en riesgo de quedar sin cubrir",
      ),
      detail: "Empiezan pronto y todavía tienen cupos libres.",
      cta: { label: "Ver cobertura", target: { kind: "coverage" } },
    });
  }

  // ── Postulaciones ──────────────────────────────────────────────────────────
  if (s.waiting.length) {
    const oldest = Math.max(...s.waiting.map((w) => (now - msOf(w.createdAt)) / HOUR_MS));
    const hours = Number.isFinite(oldest) ? oldest : 0;
    add({
      id: "applications_waiting",
      priority: hours >= INST_WAITING_HIGH_HOURS ? "high" : "medium",
      title: plural(
        s.waiting.length,
        "postulación espera tu respuesta",
        "postulaciones esperan tu respuesta",
      ),
      detail: `La más antigua lleva ${hours < 1 ? "menos de 1 h" : hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} días`} esperando. Pasadas 24 h muchos profesionales aceptan otra oferta.`,
      cta: { label: "Ver postulaciones", target: { kind: "applications" } },
    });
  }

  // ── Contratos ──────────────────────────────────────────────────────────────
  if (s.unsigned.length) {
    const soon = s.unsigned.filter((c) => {
      // Sin fecha del primer turno (NaN) la comparación es falsa: no se trata como urgente.
      return msOf(c.firstShiftAt) - now <= INST_CONTRACT_SOON_HOURS * HOUR_MS;
    });
    add({
      id: "contracts_unsigned",
      priority: soon.length ? "high" : "medium",
      title: plural(s.unsigned.length, "contrato espera tu firma", "contratos esperan tu firma"),
      detail: soon.length
        ? "Hay turnos que empiezan en menos de 48 h sin contrato firmado por ambas partes."
        : "Un contrato firmado deja evidencia verificable de lo acordado y protege a las dos partes.",
      cta: { label: "Revisar y firmar", target: { kind: "contracts" } },
    });
  }

  // ── Calidad (plan Institucional) ─────────────────────────────────────────────
  if (s.premium && s.quality && s.quality.alerts > 0) {
    add({
      id: "quality_attention",
      priority: "medium",
      badge: "Plan Institucional",
      title: plural(
        s.quality.alerts,
        "indicador de calidad pide atención",
        "indicadores de calidad piden atención",
      ),
      detail: s.quality.worst
        ? `El más bajo: ${s.quality.worst.label} (${s.quality.worst.value} %).`
        : "Revisa en detalle qué indicadores están en rojo.",
      cta: { label: "Ver calidad y cumplimiento", target: { kind: "quality" } },
    });
  }

  // ── Por calificar ──────────────────────────────────────────────────────────
  const unrated = s.unrated.filter((u) => {
    const t = msOf(u.completedAt);
    return !Number.isFinite(t) || now - t <= INST_RATING_WINDOW_DAYS * DAY_MS;
  });
  if (unrated.length) {
    add({
      id: "unrated",
      priority: "medium",
      title: plural(unrated.length, "servicio por calificar", "servicios por calificar"),
      detail: "Tu calificación ayuda a que las próximas contrataciones salgan mejor.",
      cta: { label: "Calificar", target: { kind: "ratings" } },
    });
  }

  // ── Perfil ─────────────────────────────────────────────────────────────────
  if (!s.profile.complete) {
    add({
      id: "profile_incomplete",
      priority: "medium",
      title: "Completa el perfil de tu institución",
      detail: "Con el NIT y la ciudad apareces en las búsquedas y puedes contratar profesionales.",
      cta: { label: "Completar el perfil", target: { kind: "profile" } },
    });
  } else if (s.profile.verified === false) {
    add({
      id: "unverified",
      priority: "low",
      title: "Tu institución aún no está verificada",
      detail:
        "Con el NIT y los documentos, el equipo de Humanix te da el sello de verificada y los profesionales confían más.",
      cta: { label: "Ver mi perfil", target: { kind: "profile" } },
    });
  }

  // ── Primer turno ───────────────────────────────────────────────────────────
  if (s.profile.complete && !s.hasShifts && s.completedServices === 0 && s.services.length === 0) {
    add({
      id: "publish_first",
      priority: "medium",
      title: "Publica tu primer turno",
      detail:
        "Tarda un par de minutos: indicas el servicio, el horario y el valor, y los profesionales verificados cercanos lo ven al instante.",
      cta: { label: "Publicar turnos", target: { kind: "publish" } },
    });
  }

  // ── Plan (invitación honesta, con datos propios) ───────────────────────────
  if (!s.premium && s.completedServices >= INST_UPGRADE_MIN_SERVICES) {
    add({
      id: "upgrade",
      priority: "low",
      title: "Conoce tus números",
      detail:
        "Con el plan Institucional ves tus costos por mes y por hora, la puntualidad y el cumplimiento de tus profesionales, el pronóstico de cobertura y un informe listo para tu gerencia.",
      cta: { label: "Ver el plan Institucional", target: { kind: "plans" } },
    });
  }

  return orderBrief(out, RULE_RANK).map(({ sortKey: _sortKey, ...item }) => item);
}

/** Una frase para el encabezado: cuántas cosas piden atención ya (o una buena noticia si todo está en orden). */
export function instHeadline(
  items: InstBriefItem[],
  coveragePct: number | null = null,
): { text: string; tone: "alert" | "attention" | "calm" } {
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
  if (coveragePct === 100)
    return { text: "Todo en orden y tus turnos están cubiertos", tone: "calm" };
  return { text: "Todo en orden por ahora", tone: "calm" };
}

/** Las tres cifras del encabezado: cobertura, lo que está en curso y lo que espera una respuesta. */
export function instHeroStats(s: InstSnapshot): HeroStat[] {
  return [
    { label: "Cobertura", value: s.coveragePct === null ? "—" : `${s.coveragePct} %` },
    { label: "En curso", value: s.services.filter((v) => v.status === "in_progress").length },
    { label: "Por responder", value: s.waiting.length },
  ];
}
