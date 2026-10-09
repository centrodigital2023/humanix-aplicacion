// Postulaciones a ofertas de instituciones: filas del servidor → lo que ven cada parte.
//
// Seguridad: `my_offer_applications` (profesional) y `institution_application_inbox` (institución) ya
// resuelven la contraparte y recortan lo que no corresponde. Aquí solo se interpretan los estados, se
// ordenan por urgencia de respuesta y se explican en español.

import type { ApplicationStatus, OfferModality, PartyRole } from "./institutionNegotiation";
import { isOfferModality } from "./institutionNegotiation";

export interface ApplicationShift {
  id: string;
  starts_at: string;
  ends_at: string;
}

/** Fila de `public.my_offer_applications()` (vista del profesional). */
export interface MyApplicationRow {
  application_id: string;
  job_offer_id: string;
  offer_title: string;
  institution_name: string | null;
  institution_id: string;
  city: string | null;
  modality: string;
  posted_amount: number | null;
  proposed_amount: number | null;
  agreed_amount: number | null;
  status: string;
  awaiting: string;
  round_no: number;
  expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
  closed_reason: string | null;
  shifts: ApplicationShift[] | null;
  booking_ids: string[] | null;
  contract_id: string | null;
  contract_status: string | null;
  i_signed: boolean | null;
  other_signed: boolean | null;
}

/** Fila de `public.institution_application_inbox()` (vista de la institución). */
export interface InboxRow {
  application_id: string;
  job_offer_id: string;
  offer_title: string;
  modality: string;
  posted_amount: number | null;
  proposed_amount: number | null;
  agreed_amount: number | null;
  status: string;
  awaiting: string;
  round_no: number;
  expires_at: string | null;
  message: string | null;
  created_at: string;
  accepted_at: string | null;
  closed_reason: string | null;
  shifts: ApplicationShift[] | null;
  professional_id: string;
  professional_name: string | null;
  professional_avatar: string | null;
  professional_city: string | null;
  specialty: string | null;
  years_experience: number | null;
  rethus_verified: boolean | null;
  profile_verified: boolean | null;
  avg_rating: number | string | null;
  total_jobs: number | null;
  jobs_with_me: number | null;
  contract_id: string | null;
  contract_status: string | null;
}

export interface ApplicationView {
  id: string;
  offerId: string;
  offerTitle: string;
  modality: OfferModality;
  posted: number;
  proposed: number;
  agreed: number | null;
  status: ApplicationStatus;
  awaiting: PartyRole;
  round: number;
  expiresAt: string | null;
  createdAt: string;
  acceptedAt: string | null;
  closedReason: string | null;
  shifts: ApplicationShift[];
  contractId: string | null;
  contractStatus: string | null;
}

const toStatus = (v: string): ApplicationStatus =>
  v === "accepted" || v === "rejected" || v === "withdrawn" ? v : "pending";

function baseView(r: MyApplicationRow | InboxRow): ApplicationView {
  return {
    id: r.application_id,
    offerId: r.job_offer_id,
    offerTitle: r.offer_title,
    modality: isOfferModality(r.modality) ? r.modality : "shift",
    posted: r.posted_amount ?? 0,
    proposed: r.proposed_amount ?? r.posted_amount ?? 0,
    agreed: r.agreed_amount,
    status: toStatus(r.status),
    awaiting: r.awaiting === "professional" ? "professional" : "institution",
    round: Math.max(1, r.round_no ?? 1),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    closedReason: r.closed_reason,
    shifts: [...(r.shifts ?? [])].sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    ),
    contractId: r.contract_id,
    contractStatus: r.contract_status,
  };
}

export interface MyApplication extends ApplicationView {
  institutionId: string;
  institutionName: string;
  city: string | null;
  bookingIds: string[];
  iSigned: boolean;
  otherSigned: boolean;
}

export function normalizeMyApplication(r: MyApplicationRow): MyApplication {
  return {
    ...baseView(r),
    institutionId: r.institution_id,
    institutionName: (r.institution_name ?? "").trim() || "Institución de salud",
    city: r.city,
    bookingIds: r.booking_ids ?? [],
    iSigned: Boolean(r.i_signed),
    otherSigned: Boolean(r.other_signed),
  };
}

export interface Applicant extends ApplicationView {
  professionalId: string;
  name: string;
  avatar: string | null;
  city: string | null;
  specialty: string | null;
  yearsExperience: number | null;
  rethusVerified: boolean;
  profileVerified: boolean;
  stars: number | null;
  totalJobs: number;
  jobsWithMe: number;
  message: string | null;
}

export function normalizeInboxRow(r: InboxRow): Applicant {
  const stars = r.avg_rating == null ? null : Number(r.avg_rating);
  return {
    ...baseView(r),
    professionalId: r.professional_id,
    name: (r.professional_name ?? "").trim() || "Profesional",
    avatar: r.professional_avatar,
    city: r.professional_city,
    specialty: r.specialty,
    yearsExperience: r.years_experience,
    rethusVerified: Boolean(r.rethus_verified),
    profileVerified: Boolean(r.profile_verified),
    stars: stars != null && Number.isFinite(stars) && stars > 0 ? stars : null,
    totalJobs: Math.max(0, r.total_jobs ?? 0),
    jobsWithMe: Math.max(0, r.jobs_with_me ?? 0),
    message: r.message,
  };
}

// ─── Lectura humana del estado ───────────────────────────────────────────────

export type Tone = "action" | "waiting" | "ok" | "muted" | "alert";

export interface Headline {
  title: string;
  detail: string | null;
  tone: Tone;
}

const isOpenContract = (s: string | null) => s === "pending_signature" || s === "partially_signed";

export function closedReasonLabel(reason: string | null, viewer: PartyRole): string {
  switch (reason) {
    case "expired":
      return "Venció sin respuesta.";
    case "professional_withdrew":
      return viewer === "professional" ? "La retiraste." : "El profesional retiró su postulación.";
    case "professional_declined_counter":
      return viewer === "professional"
        ? "Rechazaste la contraoferta."
        : "El profesional rechazó tu contraoferta.";
    case "institution_declined":
      return viewer === "institution"
        ? "La rechazaste."
        : "La institución no continuó con tu postulación.";
    case "offer_filled":
      return "El turno ya fue cubierto por otra persona.";
    case "offer_closed":
      return "La oferta se cerró.";
    case "overlapping_booking":
      return "Se retiró porque el profesional confirmó otro servicio en ese horario.";
    default:
      return "Esta postulación ya no está activa.";
  }
}

/** Resumen de una línea del estado, desde el punto de vista de quien mira. */
export function headlineFor(
  app: ApplicationView,
  viewer: PartyRole,
  format: (n: number) => string,
  now = Date.now(),
): Headline {
  if (app.status === "accepted") {
    if (isOpenContract(app.contractStatus)) {
      return {
        title: "Aceptada: falta firmar el contrato",
        detail: "Revisa las condiciones y firma para dejar todo en regla.",
        tone: "action",
      };
    }
    if (app.contractStatus === "active") {
      return { title: "Contrato vigente", detail: "Ambas partes firmaron.", tone: "ok" };
    }
    if (app.contractStatus === "completed") {
      return { title: "Servicio cumplido", detail: null, tone: "ok" };
    }
    if (app.contractStatus === "declined" || app.contractStatus === "expired") {
      return {
        title: "Aceptada, pero el contrato no se firmó",
        detail: "Coordina por el chat de la reserva.",
        tone: "alert",
      };
    }
    return { title: "Aceptada: reserva confirmada", detail: null, tone: "ok" };
  }
  if (app.status !== "pending") {
    return {
      title: app.status === "rejected" ? "No continuó" : "Cerrada",
      detail: closedReasonLabel(app.closedReason, viewer),
      tone: "muted",
    };
  }
  const expired = app.expiresAt != null && new Date(app.expiresAt).getTime() <= now;
  if (expired) return { title: "Venció sin respuesta", detail: null, tone: "muted" };

  const offered = app.proposed !== app.posted;
  const myTurn = app.awaiting === viewer;
  if (myTurn) {
    const who = viewer === "institution" ? "El profesional" : "La institución";
    return {
      title: "Te toca responder",
      detail:
        app.round >= 3
          ? `${who} hizo su última oferta de ${format(app.proposed)}.`
          : offered
            ? `${who} propone ${format(app.proposed)} (valor publicado ${format(app.posted)}).`
            : `${who} acepta el valor publicado de ${format(app.posted)}.`,
      tone: "action",
    };
  }
  return {
    title: viewer === "institution" ? "Esperando al profesional" : "Esperando a la institución",
    detail: offered
      ? `Propuesta enviada: ${format(app.proposed)}.`
      : `Enviada al valor publicado (${format(app.posted)}).`,
    tone: "waiting",
  };
}

/** ¿Requiere una acción de esta parte (responder o firmar)? */
export function needsMyAction(
  app: ApplicationView,
  viewer: PartyRole,
  iSigned = false,
  now = Date.now(),
): boolean {
  if (app.status === "pending") {
    const expired = app.expiresAt != null && new Date(app.expiresAt).getTime() <= now;
    return !expired && app.awaiting === viewer;
  }
  return app.status === "accepted" && isOpenContract(app.contractStatus) && !iSigned;
}

/** Postulaciones ordenadas por lo que más urge: responder, firmar, esperar y, al final, lo cerrado. */
export function sortByUrgency<T extends ApplicationView>(
  items: T[],
  viewer: PartyRole,
  signedByMe: (a: T) => boolean = () => false,
  now = Date.now(),
): T[] {
  const rank = (a: T) => {
    if (needsMyAction(a, viewer, signedByMe(a), now)) return 0;
    if (a.status === "pending") return 1;
    if (a.status === "accepted") return 2;
    return 3;
  };
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    // Dentro de lo que espera mi respuesta, primero lo más antiguo (es lo que más se enfría).
    if (rank(a) === 0) return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export interface InboxGroups {
  needsResponse: Applicant[];
  waiting: Applicant[];
  accepted: Applicant[];
  closed: Applicant[];
}

export function groupInbox(rows: Applicant[], now = Date.now()): InboxGroups {
  const sorted = sortByUrgency(rows, "institution", () => false, now);
  const groups: InboxGroups = { needsResponse: [], waiting: [], accepted: [], closed: [] };
  for (const a of sorted) {
    if (a.status === "accepted") groups.accepted.push(a);
    else if (a.status !== "pending") groups.closed.push(a);
    else if (needsMyAction(a, "institution", false, now)) groups.needsResponse.push(a);
    else groups.waiting.push(a);
  }
  return groups;
}

/** Señales de confianza del postulante, de la más fuerte a la más débil. */
export function trustBadges(
  a: Applicant,
): Array<{ id: string; label: string; tone: "ok" | "info" | "muted" }> {
  const out: Array<{ id: string; label: string; tone: "ok" | "info" | "muted" }> = [];
  if (a.rethusVerified) out.push({ id: "rethus", label: "RETHUS verificado", tone: "ok" });
  else if (a.profileVerified) out.push({ id: "verified", label: "Perfil verificado", tone: "ok" });
  else out.push({ id: "unverified", label: "Sin verificar", tone: "muted" });
  if (a.jobsWithMe > 0) {
    out.push({
      id: "repeat",
      label:
        a.jobsWithMe === 1
          ? "Ya trabajó con ustedes"
          : `Ha trabajado ${a.jobsWithMe} veces con ustedes`,
      tone: "ok",
    });
  }
  if (a.stars != null) out.push({ id: "stars", label: `${a.stars.toFixed(1)} ★`, tone: "info" });
  if (a.totalJobs > 0)
    out.push({
      id: "jobs",
      label: `${a.totalJobs} ${a.totalJobs === 1 ? "servicio" : "servicios"}`,
      tone: "info",
    });
  if (a.yearsExperience && a.yearsExperience > 0) {
    out.push({
      id: "years",
      label: `${a.yearsExperience} ${a.yearsExperience === 1 ? "año" : "años"} de experiencia`,
      tone: "info",
    });
  }
  return out;
}

/** Aviso honesto antes de aceptar a alguien cuya identidad aún no está verificada. */
export function acceptanceWarning(a: Applicant): string | null {
  if (a.rethusVerified || a.profileVerified) return null;
  return "Este profesional aún no tiene la verificación RETHUS completa: no podrá firmar el contrato inteligente hasta completarla.";
}

/** «Vence en 5 h» / «Vence en 20 min» / «Venció»: cuánto tiempo queda para responder. */
export function expiryLabel(expiresAt: string | null, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const left = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "Venció";
  const hours = Math.floor(left / 3_600_000);
  if (hours >= 48) return `Vence en ${Math.floor(hours / 24)} días`;
  if (hours >= 1) return `Vence en ${hours} h`;
  return `Vence en ${Math.max(1, Math.floor(left / 60_000))} min`;
}

export function shiftsSummary(shifts: ApplicationShift[]): string {
  if (shifts.length === 0) return "Horario por coordinar";
  return `${shifts.length} ${shifts.length === 1 ? "turno" : "turnos"}`;
}
