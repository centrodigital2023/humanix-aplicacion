import { describe, it, expect } from "vitest";
import { computePqrsKpis, type KpiTicket } from "./pqrsKpis";

const NOW = Date.UTC(2026, 10, 20, 17, 0, 0);
const H = 3_600_000;
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const t = (o: Partial<KpiTicket> = {}): KpiTicket => ({
  type: "peticion",
  status: "open",
  created_at: iso(NOW - 1 * D),
  due_at: iso(NOW + 14 * D),
  first_response_at: null,
  resolved_at: null,
  ai_priority: "normal",
  ai_sentiment: null,
  assigned_to: null,
  safety_level: "none",
  reply_draft_edited: null,
  ...o,
});

describe("computePqrsKpis", () => {
  it("cuenta activos, vencidos, en riesgo y críticos", () => {
    const k = computePqrsKpis(
      [
        t(), // reciente
        t({ created_at: iso(NOW - 40 * D) }), // vencido
        t({ created_at: iso(NOW - 19 * D) }), // en riesgo (faltan pocos días hábiles)
        t({ safety_level: "critical" }),
        t({ status: "resolved", resolved_at: iso(NOW - D) }),
      ],
      NOW,
    );
    expect(k.active).toBe(4);
    expect(k.breached).toBe(1);
    expect(k.atRisk).toBeGreaterThanOrEqual(1);
    expect(k.criticalSafety).toBe(1);
  });

  it("no inventa medianas ni tasas con muestra insuficiente", () => {
    const k = computePqrsKpis([t({ first_response_at: iso(NOW - D + 2 * H) })], NOW);
    expect(k.medianFirstResponseHours).toBeNull();
    expect(k.onTimeRate).toBeNull();
    expect(k.draftAcceptRate).toBeNull();
  });

  it("calcula la mediana de primera respuesta con 3 o más casos", () => {
    const mk = (hours: number) =>
      t({ created_at: iso(NOW - 3 * D), first_response_at: iso(NOW - 3 * D + hours * H) });
    const k = computePqrsKpis([mk(2), mk(4), mk(10)], NOW);
    expect(k.medianFirstResponseHours).toBe(4);
  });

  it("mide cumplimiento de plazo y aceptación de borradores con 5 o más casos", () => {
    const closedOnTime = (edited: boolean | null) =>
      t({
        status: "resolved",
        created_at: iso(NOW - 10 * D),
        due_at: iso(NOW - 2 * D),
        resolved_at: iso(NOW - 5 * D),
        reply_draft_edited: edited,
      });
    const closedLate = t({
      status: "resolved",
      created_at: iso(NOW - 30 * D),
      due_at: iso(NOW - 10 * D),
      resolved_at: iso(NOW - 3 * D),
      reply_draft_edited: true,
    });
    const k = computePqrsKpis(
      [
        closedOnTime(false),
        closedOnTime(false),
        closedOnTime(true),
        closedOnTime(false),
        closedLate,
      ],
      NOW,
    );
    expect(k.onTimeRate).toBeCloseTo(0.8);
    expect(k.draftAcceptRate).toBeCloseTo(0.6);
  });
});
