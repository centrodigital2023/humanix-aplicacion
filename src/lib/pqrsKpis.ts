import { median, MIN_SAMPLE } from "./marketplaceInsights";
import { evaluateSla } from "./pqrsRules";

export interface KpiTicket {
  type: string | null;
  status: string;
  created_at: string;
  due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  ai_priority: string | null;
  ai_sentiment: string | null;
  assigned_to: string | null;
  safety_level: string | null;
  reply_draft_edited: boolean | null;
}

export interface PqrsKpis {
  active: number;
  breached: number;
  atRisk: number;
  criticalSafety: number;
  medianFirstResponseHours: number | null;
  sampleFirstResponse: number;
  /** Proporción de solicitudes cerradas dentro de su plazo legal de referencia. */
  onTimeRate: number | null;
  sampleResolved: number;
  /** Proporción de borradores de IA enviados sin editar. */
  draftAcceptRate: number | null;
  sampleDrafts: number;
}

const HOUR = 3_600_000;

export function computePqrsKpis(tickets: KpiTicket[], now: number = Date.now()): PqrsKpis {
  const isActive = (t: KpiTicket) => t.status !== "resolved" && t.status !== "closed";
  let breached = 0;
  let atRisk = 0;
  let criticalSafety = 0;
  const active = tickets.filter(isActive);
  for (const t of active) {
    const sla = evaluateSla(t, now);
    if (sla.legalState === "breached") breached++;
    else if (sla.legalState === "at_risk") atRisk++;
    if (t.safety_level === "critical") criticalSafety++;
  }

  const firstHours = tickets
    .filter((t) => t.first_response_at)
    .map(
      (t) =>
        (new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime()) /
        HOUR,
    )
    .filter((h) => Number.isFinite(h) && h >= 0);

  const closed = tickets.filter((t) => !isActive(t) && t.resolved_at && t.due_at);
  const onTime = closed.filter(
    (t) => new Date(t.resolved_at as string).getTime() <= new Date(t.due_at as string).getTime(),
  ).length;

  const drafts = tickets.filter((t) => typeof t.reply_draft_edited === "boolean");
  const accepted = drafts.filter((t) => t.reply_draft_edited === false).length;

  return {
    active: active.length,
    breached,
    atRisk,
    criticalSafety,
    medianFirstResponseHours: firstHours.length >= 3 ? median(firstHours) : null,
    sampleFirstResponse: firstHours.length,
    onTimeRate: closed.length >= MIN_SAMPLE ? onTime / closed.length : null,
    sampleResolved: closed.length,
    draftAcceptRate: drafts.length >= MIN_SAMPLE ? accepted / drafts.length : null,
    sampleDrafts: drafts.length,
  };
}
