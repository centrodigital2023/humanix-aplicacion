import { describe, expect, it } from "vitest";
import { CARE_ROUTES, ROUTES, ROUTE_DISCLAIMER } from "./careJourney";
import {
  GENERIC_VISIT_QUESTIONS,
  VISIT_CARRY,
  buildVisitPrep,
  changesFromReport,
  questionsFromReport,
} from "./visitPrep";
import type { WellbeingReport } from "./wellbeing";

type Sev = "alert" | "watch" | "ok" | "info";

/** Solo los campos que lee la hoja; el resto del informe no importa aquí. */
function report(
  over: {
    highlights?: Array<{ severity: Sev; title: string }>;
    alerts?: number;
    trend?: "better" | "worse" | "stable" | "unknown";
    medGap?: boolean;
    vitals?: Array<{ watch: number; alert: number }>;
  } = {},
): WellbeingReport {
  return {
    highlights: (over.highlights ?? []).map((h, i) => ({ id: `h${i}`, detail: "", ...h })),
    alerts: { total: over.alerts ?? 0, last7d: 0, recent: [] },
    moods: { trend: over.trend ?? "unknown" },
    medication: { gap: over.medGap ?? false },
    vitals: over.vitals ?? [],
  } as unknown as WellbeingReport;
}

describe("hoja para la cita: sin informe (todas las familias)", () => {
  it("sin ruta usa preguntas generales", () => {
    const p = buildVisitPrep({ route: null });
    expect(p.title).toBe("Hoja para la cita");
    expect(p.sections.map((s) => s.heading)).toEqual([
      "Preguntas para llevar",
      "Para tener a la mano",
    ]);
    expect(p.sections[0].items).toEqual([...GENERIC_VISIT_QUESTIONS]);
    expect(p.hasReportData).toBe(false);
  });

  it.each(CARE_ROUTES)("la ruta %s lleva sus propias preguntas y su nombre en el título", (r) => {
    const p = buildVisitPrep({ route: r });
    expect(p.title).toBe(`Hoja para la cita · ${ROUTES[r].label}`);
    expect(p.sections[0].items).toEqual([...ROUTES[r].visitQuestions]);
  });

  it("siempre incluye qué llevar y el aviso de que no diagnostica", () => {
    const p = buildVisitPrep({ route: "elder" });
    expect(p.sections.at(-1)?.items).toEqual([...VISIT_CARRY]);
    expect(p.text).toContain(ROUTE_DISCLAIMER);
    expect(p.text).toContain("• ");
  });
});

describe("hoja para la cita: con informe de bienestar", () => {
  it("«Lo que cambió» toma solo lo a vigilar o fuera de rango, máximo 4", () => {
    const r = report({
      highlights: [
        { severity: "ok", title: "Ánimo estable" },
        { severity: "alert", title: "Presión fuera de rango" },
        { severity: "info", title: "Datos limitados" },
        { severity: "watch", title: "Oxígeno a vigilar" },
        { severity: "watch", title: "A" },
        { severity: "watch", title: "B" },
        { severity: "watch", title: "C" },
      ],
    });
    expect(changesFromReport(r)).toEqual(["Presión fuera de rango", "Oxígeno a vigilar", "A", "B"]);
    const p = buildVisitPrep({ route: "chronic", report: r });
    expect(p.sections[0].heading).toBe("Lo que cambió");
    expect(p.hasReportData).toBe(true);
  });

  it("agrega preguntas según lo observado, sin interpretar", () => {
    const q = questionsFromReport(
      report({ alerts: 2, trend: "worse", medGap: true, vitals: [{ watch: 1, alert: 0 }] }),
    );
    expect(q).toHaveLength(4);
    expect(q.join(" ")).toMatch(/avisos/);
    expect(q.join(" ")).toMatch(/ánimo bajo/);
    expect(q.join(" ")).toMatch(/no quedaron registradas/);
    expect(q.join(" ")).toMatch(/fuera del rango general/);
  });

  it("un informe sin novedades no inventa preguntas ni cambios", () => {
    const r = report({ highlights: [{ severity: "ok", title: "Todo en rango" }] });
    expect(questionsFromReport(r)).toEqual([]);
    expect(changesFromReport(r)).toEqual([]);
    const p = buildVisitPrep({ route: "elder", report: r });
    expect(p.sections.map((s) => s.heading)).not.toContain("Lo que cambió");
    expect(p.hasReportData).toBe(false);
    expect(p.sections[0].items).toEqual([...ROUTES.elder.visitQuestions]);
  });

  it("las preguntas de la ruta van primero y las del informe después", () => {
    const p = buildVisitPrep({ route: "postop", report: report({ alerts: 1 }) });
    const items = p.sections.find((s) => s.heading === "Preguntas para llevar")!.items;
    expect(items.slice(0, 3)).toEqual([...ROUTES.postop.visitQuestions]);
    expect(items).toHaveLength(4);
  });

  it("un informe nulo o ausente se trata igual", () => {
    expect(changesFromReport(null)).toEqual([]);
    expect(changesFromReport(undefined)).toEqual([]);
    expect(questionsFromReport(null)).toEqual([]);
  });
});

describe("hoja para la cita: privacidad y tono", () => {
  it("sin dinero, teléfonos, correos ni enlaces; sin medicamentos ni dosis", () => {
    for (const r of [null, ...CARE_ROUTES]) {
      const { text } = buildVisitPrep({
        route: r,
        report: report({ alerts: 3, trend: "worse", medGap: true }),
      });
      expect(text).not.toMatch(/\$|\bCOP\b|pago|pagar|whatsapp|@|https?:/i);
      expect(text).not.toMatch(/\d{7,}/);
      expect(text).not.toMatch(/\b\d+\s?(mg|ml|mcg)\b/i);
    }
  });

  it("el texto es estable", () => {
    const a = buildVisitPrep({ route: "child", report: report({ alerts: 1 }) }).text;
    const b = buildVisitPrep({ route: "child", report: report({ alerts: 1 }) }).text;
    expect(a).toBe(b);
  });
});
