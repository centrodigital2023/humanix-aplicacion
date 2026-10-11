// Brújula del día: resume en lenguaje humano lo que importa hoy y propone las próximas acciones,
// ordenadas por urgencia y con su motivo. Lógica pura (sin red) para cada rol.
import type { ActiveService } from "@/lib/careLoop";

export type CompassRole = "family" | "professional" | "institution";
export type CompassTone = "calm" | "attention" | "urgent";

export interface CompassSignals {
  role: CompassRole;
  now: Date;
  firstName?: string | null;
  services: ActiveService[];
  unreadNotifications: number;
  /** Propuestas de horario esperando mi respuesta. */
  pendingProposals: number;
  /** Postulaciones esperando mi respuesta (profesional o institución). */
  pendingApplications: number;
  /** Solo institución: ofertas/turnos abiertos sin cubrir. */
  openOffers?: number;
}

export interface CompassAction {
  id: string;
  title: string;
  reason: string;
  priority: number; // mayor = más urgente
  tone: CompassTone;
  to: string;
}

export interface CompassBriefing {
  greeting: string;
  headline: string;
  tone: CompassTone;
  /** 0-100: qué tan tranquilo está el día (100 = todo en orden). */
  calm: number;
  stats: { label: string; value: number }[];
  actions: CompassAction[];
}

export function greetingFor(now: Date, name?: string | null): string {
  const h =
    Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hour12: false,
        timeZone: "America/Bogota",
      }).format(now),
    ) % 24;
  const base = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${base}, ${first}` : base;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildBriefing(s: CompassSignals): CompassBriefing {
  const live = s.services.filter((x) => x.started_at && x.status !== "completed");
  const alerts = s.services.reduce((a, x) => a + (x.alerts > 0 ? x.alerts : 0), 0);
  const nowMs = s.now.getTime();
  const soon = s.services.filter((x) => {
    if (x.started_at) return false;
    const t = new Date(x.scheduled_at).getTime();
    return t >= nowMs - 15 * 60_000 && t - nowMs <= 3 * 3_600_000;
  });
  const actions: CompassAction[] = [];

  if (alerts > 0) {
    actions.push({
      id: "alerts",
      title:
        s.role === "professional"
          ? "Revisa las alertas de tu paciente"
          : "Hay alertas en un turno en vivo",
      reason: `${plural(alerts, "alerta registrada", "alertas registradas")} en el parte de cuidado.`,
      priority: 100,
      tone: "urgent",
      to: "/dashboard",
    });
  }
  if (soon.length > 0) {
    actions.push({
      id: "soon",
      title:
        s.role === "professional"
          ? "Prepárate para tu próximo servicio"
          : "Un servicio empieza pronto",
      reason: `${plural(soon.length, "servicio empieza", "servicios empiezan")} en las próximas 3 horas.`,
      priority: 80,
      tone: "attention",
      to: "/dashboard",
    });
  }
  if (s.pendingProposals > 0) {
    actions.push({
      id: "proposals",
      title: "Responde las propuestas de horario",
      reason: `${plural(s.pendingProposals, "propuesta espera", "propuestas esperan")} tu respuesta; responder rápido genera confianza.`,
      priority: 70,
      tone: "attention",
      to: "/dashboard",
    });
  }
  if (s.pendingApplications > 0) {
    actions.push({
      id: "applications",
      title:
        s.role === "institution" ? "Revisa a tus candidatos" : "Tienes contraofertas por responder",
      reason:
        s.role === "institution"
          ? `${plural(s.pendingApplications, "profesional se postuló", "profesionales se postularon")} y espera${s.pendingApplications === 1 ? "" : "n"} tu decisión.`
          : `${plural(s.pendingApplications, "negociación espera", "negociaciones esperan")} tu respuesta antes de vencer.`,
      priority: 65,
      tone: "attention",
      to: "/dashboard",
    });
  }
  if (s.role === "institution" && (s.openOffers ?? 0) > 0) {
    actions.push({
      id: "coverage",
      title: "Cubre tus turnos abiertos",
      reason: `${plural(s.openOffers ?? 0, "turno sigue", "turnos siguen")} sin cubrir. Invita a tu equipo de confianza primero.`,
      priority: 60,
      tone: "attention",
      to: "/dashboard",
    });
  }
  if (s.unreadNotifications > 0) {
    actions.push({
      id: "notifications",
      title: "Ponte al día",
      reason: `${plural(s.unreadNotifications, "aviso sin leer", "avisos sin leer")}.`,
      priority: 30,
      tone: "calm",
      to: "/mensajes",
    });
  }
  if (actions.length === 0) {
    const idle: Record<CompassRole, CompassAction> = {
      family: {
        id: "idle",
        title: "Programa el próximo cuidado",
        reason: "Vuelve a contratar a quien ya conoce a tu familiar, en un toque.",
        priority: 10,
        tone: "calm",
        to: "/buscar",
      },
      professional: {
        id: "idle",
        title: "Explora nuevas oportunidades",
        reason: "Mantén tu disponibilidad al día para recibir ofertas compatibles.",
        priority: 10,
        tone: "calm",
        to: "/dashboard",
      },
      institution: {
        id: "idle",
        title: "Publica los turnos de la semana",
        reason: "Publicar con anticipación mejora la cobertura y el tiempo de respuesta.",
        priority: 10,
        tone: "calm",
        to: "/dashboard",
      },
    };
    actions.push(idle[s.role]);
  }
  actions.sort((a, b) => b.priority - a.priority);

  const penalty =
    Math.min(alerts, 3) * 20 +
    soon.length * 5 +
    Math.min(s.pendingProposals + s.pendingApplications, 6) * 5 +
    Math.min(s.openOffers ?? 0, 6) * 4;
  const calm = Math.max(0, Math.min(100, 100 - penalty));
  const tone: CompassTone =
    alerts > 0 ? "urgent" : actions.some((a) => a.tone === "attention") ? "attention" : "calm";

  const headlines: Record<CompassRole, Record<CompassTone, string>> = {
    family: {
      urgent: "Tu ser querido necesita atención: revisa el parte ahora.",
      attention: "Hay algunas cosas por decidir, te ayudamos a priorizarlas.",
      calm:
        live.length > 0
          ? "Tu ser querido está acompañado y todo va bien."
          : "Todo en orden. Estamos contigo.",
    },
    professional: {
      urgent: "Un paciente tuyo tiene una alerta. Tu cuidado hace la diferencia.",
      attention: "Tienes oportunidades y servicios esperando por ti.",
      calm: "Tu día está en orden. Gracias por cuidar.",
    },
    institution: {
      urgent: "Hay alertas clínicas en turnos en vivo.",
      attention: "Tu cobertura necesita algunas decisiones hoy.",
      calm: "Cobertura estable. Tu operación está bajo control.",
    },
  };

  const stats =
    s.role === "institution"
      ? [
          { label: "En vivo", value: live.length },
          { label: "Por cubrir", value: s.openOffers ?? 0 },
          { label: "Candidatos", value: s.pendingApplications },
        ]
      : [
          { label: "En vivo", value: live.length },
          { label: "Próximos", value: soon.length },
          { label: "Por responder", value: s.pendingProposals + s.pendingApplications },
        ];

  return {
    greeting: greetingFor(s.now, s.firstName),
    headline: headlines[s.role][tone],
    tone,
    calm,
    stats,
    actions: actions.slice(0, 4),
  };
}
