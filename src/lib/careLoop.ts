// Equipo de confianza y plan B — lógica pura de presentación.
//
// El servidor decide todo lo que importa (`my_trusted_team`, `invite_team_core`, `plan_b_after_cancel`,
// `trusted_team_free_count`; migración 20261010100000_care_loop.sql): quién está en el equipo, a quién se avisa
// cuando un profesional cancela y cuántos están libres. Aquí solo se normaliza y se escribe en español claro.

const DAY_MS = 86_400_000;

export interface TrustedMember {
  professional_id: string;
  display_name: string;
  specialty: string | null;
  avatar_url: string | null;
  avg_rating: number | null;
  services_together: number;
  last_service_at: string | null;
  favorite_since: string;
  available: boolean;
}

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? d : n;
};

/** Filas de `my_trusted_team()` → miembros tipados. Ignora filas sin id. */
export function parseTeam(rows: unknown): TrustedMember[] {
  if (!Array.isArray(rows)) return [];
  const out: TrustedMember[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r.professional_id !== "string") continue;
    out.push({
      professional_id: r.professional_id,
      display_name:
        typeof r.display_name === "string" && r.display_name ? r.display_name : "Profesional",
      specialty: typeof r.specialty === "string" && r.specialty ? r.specialty : null,
      avatar_url: typeof r.avatar_url === "string" && r.avatar_url ? r.avatar_url : null,
      avg_rating: r.avg_rating === null || r.avg_rating === undefined ? null : num(r.avg_rating),
      services_together: num(r.services_together),
      last_service_at: typeof r.last_service_at === "string" ? r.last_service_at : null,
      favorite_since: typeof r.favorite_since === "string" ? r.favorite_since : "",
      available: r.available === true,
    });
  }
  return out;
}

/** Con quien más has trabajado primero; a igualdad, quien está disponible y luego el más reciente. */
export function sortTeam(members: TrustedMember[]): TrustedMember[] {
  return [...members].sort(
    (a, b) =>
      b.services_together - a.services_together ||
      Number(b.available) - Number(a.available) ||
      b.favorite_since.localeCompare(a.favorite_since) ||
      a.professional_id.localeCompare(b.professional_id),
  );
}

/** «hoy», «ayer», «hace 5 días», «hace 3 semanas», «hace 2 meses», «hace más de un año». */
export function relativeDaysEs(
  iso: string | null | undefined,
  now: Date | number | string = Date.now(),
): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  const n = new Date(now).getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  const days = Math.floor((n - t) / DAY_MS);
  if (days < 0) return "próximamente";
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 14) return `hace ${days} días`;
  if (days < 60) return `hace ${Math.floor(days / 7)} semanas`;
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`;
  return "hace más de un año";
}

/** «Auxiliar de enfermería · 3 servicios juntos · el último hace 2 semanas». */
export function memberLine(m: TrustedMember, now: Date | number | string = Date.now()): string {
  const parts: string[] = [];
  if (m.specialty) parts.push(m.specialty);
  if (m.services_together > 0) {
    parts.push(
      `${m.services_together} ${m.services_together === 1 ? "servicio juntos" : "servicios juntos"}`,
    );
    const last = relativeDaysEs(m.last_service_at, now);
    if (last) parts.push(`el último ${last}`);
  } else {
    parts.push("aún no han trabajado juntos");
  }
  return parts.join(" · ");
}

export function teamHeadline(members: TrustedMember[]): string {
  const total = members.length;
  if (total === 0) return "Aún no tienes equipo de confianza";
  const free = members.filter((m) => m.available).length;
  const noun = total === 1 ? "profesional" : "profesionales";
  return `${total} ${noun} de confianza · ${free} ${free === 1 ? "disponible" : "disponibles"} ahora`;
}

/** Qué hará Humanix si tu profesional cancela. Se muestra como tranquilidad, no como alarma. */
export function planBPromise(role: "family" | "institution", teamSize: number): string {
  if (teamSize === 0) {
    return role === "institution"
      ? "Guarda como favoritos a quienes trabajan bien contigo: si alguien cancela, los avisamos primero."
      : "Guarda como favoritos a quienes te dan confianza: si tu profesional cancela, sabrás cuántos están libres para cubrirte.";
  }
  return role === "institution"
    ? `Si un profesional cancela, avisamos de inmediato a tu equipo (${teamSize}) para que se postule antes que nadie.`
    : `Si tu profesional cancela, te decimos cuántos de tu equipo (${teamSize}) están libres en ese horario.`;
}

/** «1 profesional de tu equipo de confianza está libre…» — misma frase que el aviso del servidor. */
export function freeTeamNotice(free: number): string {
  if (free <= 0)
    return "Puedes buscar un reemplazo disponible para el mismo horario desde el detalle del servicio.";
  return `${free} ${free === 1 ? "profesional de tu equipo de confianza está libre" : "profesionales de tu equipo de confianza están libres"} en ese horario. Pídeles que te cubran desde el detalle del servicio.`;
}

/** Invitación para compartir en el momento más cálido: la familia habla de cuidado; el profesional, de turnos. */
export function inviteText(role: "family" | "professional", link: string): string {
  return role === "family"
    ? `Estoy cuidando a mi familiar en casa con Humanix: profesionales verificados y el parte del turno en vivo, con tranquilidad desde cualquier lugar. Entra con mi enlace: ${link}`
    : `Estoy usando Humanix para encontrar turnos de salud y llevar mi trayectoria verificada. Únete con mi enlace: ${link}`;
}

// ─── Servicios en curso (my_active_services) ─────────────────────────────────

export type ServiceSide = "client" | "professional" | "circle";

export interface ActiveService {
  booking_id: string;
  side: ServiceSide;
  status: string;
  scheduled_at: string;
  duration_hours: number;
  counterpart_id: string;
  counterpart_name: string;
  /** Solo para el círculo: nombre corto del titular (el familiar al que se acompaña). */
  owner_name: string | null;
  started_at: string | null;
  events: number;
  alerts: number;
  last_mood: string | null;
  last_vitals: {
    at: string;
    systolic: number | null;
    diastolic: number | null;
    heartRate: number | null;
    temperature: number | null;
    oxygen: number | null;
  } | null;
}

const isSide = (v: unknown): v is ServiceSide =>
  v === "client" || v === "professional" || v === "circle";

/** Filas de `my_active_services()` → tipadas. Ignora filas sin id o con un lado desconocido. */
export function parseActiveServices(rows: unknown): ActiveService[] {
  if (!Array.isArray(rows)) return [];
  const out: ActiveService[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r.booking_id !== "string" || !isSide(r.side)) continue;
    const lv = r.last_vitals as Record<string, unknown> | null | undefined;
    out.push({
      booking_id: r.booking_id,
      side: r.side,
      status: String(r.status ?? ""),
      scheduled_at: String(r.scheduled_at ?? ""),
      duration_hours: num(r.duration_hours),
      counterpart_id: String(r.counterpart_id ?? ""),
      counterpart_name:
        typeof r.counterpart_name === "string" && r.counterpart_name
          ? r.counterpart_name
          : "Alguien de Humanix",
      owner_name: typeof r.owner_name === "string" && r.owner_name ? r.owner_name : null,
      started_at: typeof r.started_at === "string" ? r.started_at : null,
      events: num(r.events),
      alerts: num(r.alerts),
      last_mood: typeof r.last_mood === "string" ? r.last_mood : null,
      last_vitals: lv
        ? {
            at: String(lv.at ?? ""),
            systolic: (lv.systolic as number | null) ?? null,
            diastolic: (lv.diastolic as number | null) ?? null,
            heartRate: (lv.heart_rate as number | null) ?? null,
            temperature: (lv.temperature as number | null) ?? null,
            oxygen: (lv.oxygen as number | null) ?? null,
          }
        : null,
    });
  }
  return out;
}

export const SERVICE_STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  in_route: "En camino",
  in_progress: "En curso",
};

/** Qué sigue para cada rol en cada estado (texto del botón del tablero). */
export function nextStepLabel(side: ServiceSide, status: string): string {
  if (side === "professional") {
    if (status === "confirmed") return "Abrir y salir en camino";
    if (status === "in_route") return "Abrir y marcar llegada";
    if (status === "in_progress") return "Registrar en el parte";
  }
  if (status === "in_progress") return "Ver el parte en vivo";
  return "Ver servicio";
}

/** Hay algo que requiere atención ya: una alerta en un turno en curso. */
export function needsAttention(s: ActiveService): boolean {
  return s.status === "in_progress" && s.alerts > 0;
}

/** Los que requieren atención primero, luego en curso, luego por hora. */
export function sortActive(rows: ActiveService[]): ActiveService[] {
  const rank = (s: ActiveService) =>
    needsAttention(s) ? 0 : s.status === "in_progress" ? 1 : s.status === "in_route" ? 2 : 3;
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.scheduled_at.localeCompare(b.scheduled_at) ||
      a.booking_id.localeCompare(b.booking_id),
  );
}

/** Aviso por WhatsApp para quien acaba de ser invitado a un círculo de cuidado (la invitación vive en la cuenta, por correo). */
export function circleInviteText(email: string, link = "https://humanix.lat/auth"): string {
  return `Te invité a mi círculo de cuidado en Humanix para que veas, en vivo, cómo va el cuidado en casa. Entra a ${link} con este correo (${email}) y acepta la invitación.`;
}

// ─── Avisos de la campana ────────────────────────────────────────────────────

export type NotificationTone = "alert" | "warm" | "info" | null;

/** Tono visual de un aviso por su tipo: las alertas del parte destacan; los gracias y hitos son cálidos. */
export function notificationTone(type: string | null | undefined): NotificationTone {
  switch (type) {
    case "care_alert":
      return "alert";
    case "kudos_received":
    case "career_milestone":
    case "care_finished":
      return "warm";
    case "care_started":
    case "plan_b_started":
    case "team_invite_urgent":
      return "info";
    default:
      return null;
  }
}
