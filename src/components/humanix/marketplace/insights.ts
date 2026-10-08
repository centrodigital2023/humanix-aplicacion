import { coverageLevel, type CoverageLevel } from "@/lib/coverage";
import {
  maxSeverity,
  offerQuality,
  offerRiskSignals,
  priceBenchmark,
  type ApplicationRow,
  type OfferRow,
  type PriceBenchmark,
  type RiskSeverity,
  type RiskSignal,
} from "@/lib/marketplaceInsights";
import { evaluateSla, type SlaResult } from "@/lib/pqrsRules";
import type { TicketRow } from "./types";

const DAY = 86_400_000;

export interface OfferInsight {
  apps: ApplicationRow[];
  accepted: number;
  pending: number;
  coverage: CoverageLevel;
  bench: PriceBenchmark;
  quality: { score: number; missing: string[] };
  risk: RiskSignal[];
  maxRisk: RiskSeverity | null;
  urgentUncovered: boolean;
  /** Mayor número = requiere atención antes. */
  attention: number;
}

export function buildOfferInsights(
  offers: OfferRow[],
  apps: ApplicationRow[],
  now: number,
): Map<string, OfferInsight> {
  const byOffer = new Map<string, ApplicationRow[]>();
  for (const a of apps) {
    const list = byOffer.get(a.job_offer_id);
    if (list) list.push(a);
    else byOffer.set(a.job_offer_id, [a]);
  }
  const out = new Map<string, OfferInsight>();
  for (const o of offers) {
    const list = byOffer.get(o.id) ?? [];
    const accepted = list.filter((a) => a.status === "accepted").length;
    const pending = list.filter((a) => a.status === "pending").length;
    const coverage = coverageLevel(
      {
        status: o.status,
        shiftsCount: o.shifts_count ?? null,
        startDate: o.start_date ?? null,
        acceptedCount: accepted,
        pendingCount: pending,
      },
      now,
    );
    const risk = offerRiskSignals(o, offers, now);
    const maxRisk = maxSeverity(risk);
    const startsSoon = o.start_date ? new Date(o.start_date).getTime() - now < 2 * DAY : false;
    const urgentUncovered = o.status === "open" && !o.blocked && list.length === 0 && startsSoon;
    const attention =
      (urgentUncovered ? 50 : 0) +
      (coverage === "uncovered" || coverage === "urgent" ? 25 : 0) +
      (maxRisk === "high" ? 40 : maxRisk === "medium" ? 20 : 0) +
      (pending > 0 && coverage === "pending_approval" ? 10 : 0);
    out.set(o.id, {
      apps: list,
      accepted,
      pending,
      coverage,
      bench: priceBenchmark(o, offers),
      quality: offerQuality(o),
      risk,
      maxRisk,
      urgentUncovered,
      attention: o.status === "open" && !o.blocked ? attention : 0,
    });
  }
  return out;
}

export interface TicketInsight {
  sla: SlaResult;
  active: boolean;
}

export function buildTicketInsights(tickets: TicketRow[], now: number): Map<string, TicketInsight> {
  const out = new Map<string, TicketInsight>();
  for (const t of tickets) {
    out.set(t.id, {
      active: t.status !== "resolved" && t.status !== "closed",
      sla: evaluateSla(
        {
          type: t.type,
          status: t.status,
          created_at: t.created_at,
          ai_priority: t.ai_priority,
          ai_sentiment: t.ai_sentiment,
          first_response_at: t.first_response_at,
          assigned_to: t.assigned_to,
          safety_level: t.safety_level,
        },
        now,
      ),
    });
  }
  return out;
}
