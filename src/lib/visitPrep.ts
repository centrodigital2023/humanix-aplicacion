// «Hoja para la cita» — lógica pura, sin base de datos.
//
// Llegar a la consulta con las preguntas claras cambia lo que se logra en esos diez minutos. La hoja junta:
//  1) lo que cambió (solo con el informe de bienestar, que se calcula con los partes del turno),
//  2) las preguntas de la ruta de cuidado más las que salen de lo que se vio en los partes,
//  3) lo que conviene llevar a la mano.
//
// No diagnostica ni sugiere medicamentos o dosis: lleva preguntas al médico, no respuestas. Sin nombres de profesionales,
// direcciones, teléfonos ni valores de pago (igual que `doctorSummary`).

import { ROUTES, ROUTE_DISCLAIMER, type CareRoute } from "./careJourney";
import type { WellbeingReport } from "./wellbeing";

export interface VisitPrepSection {
  heading: string;
  items: string[];
}

export interface VisitPrep {
  title: string;
  sections: VisitPrepSection[];
  /** Texto para copiar o descargar. */
  text: string;
  /** Hay datos de los partes (informe de bienestar) además de las preguntas de la ruta. */
  hasReportData: boolean;
}

/** Preguntas de la ruta cuando no se sabe cuál es: sirven a cualquier consulta. */
export const GENERIC_VISIT_QUESTIONS: readonly string[] = [
  "¿Qué señales deben hacernos consultar el mismo día?",
  "¿Cambiamos algo en la rutina, la alimentación o los medicamentos?",
  "¿Cuándo es el próximo control y qué debemos llevar?",
];

export const VISIT_CARRY: readonly string[] = [
  "Lista actualizada de medicamentos (nombre, dosis y horarios)",
  "Documento de identidad y carné de la EPS",
  "Órdenes y resultados recientes",
  "Estas preguntas, anotadas, y espacio para apuntar la respuesta",
];

const MAX_CHANGES = 4;

/** Lo que cambió, sacado de lo que el informe ya marcó como «a vigilar» o «fuera de rango». */
export function changesFromReport(report: WellbeingReport | null | undefined): string[] {
  if (!report) return [];
  return report.highlights
    .filter((h) => h.severity === "alert" || h.severity === "watch")
    .slice(0, MAX_CHANGES)
    .map((h) => h.title);
}

/** Preguntas que salen de lo observado (sin interpretar: solo pedir criterio médico). */
export function questionsFromReport(report: WellbeingReport | null | undefined): string[] {
  if (!report) return [];
  const q: string[] = [];
  if (report.alerts.total > 0)
    q.push(
      "En estos días hubo avisos en los partes: ¿hay que cambiar algo o vigilar algo en particular?",
    );
  if (report.moods.trend === "worse")
    q.push(
      "Notamos más días de ánimo bajo: ¿puede tener relación con el tratamiento o con otra causa?",
    );
  if (report.medication.gap)
    q.push(
      "Algunas tomas no quedaron registradas: ¿cómo nos aseguramos de que se den a tiempo y se anoten?",
    );
  if (report.vitals.some((v) => v.watch > 0 || v.alert > 0))
    q.push(
      "Algunas lecturas salieron fuera del rango general: ¿cuáles son sus metas para este caso?",
    );
  return q;
}

export function buildVisitPrep(input: {
  route: CareRoute | null;
  report?: WellbeingReport | null;
}): VisitPrep {
  const { route, report } = input;
  const def = route ? ROUTES[route] : null;
  const changes = changesFromReport(report);
  const questions = [
    ...(def ? def.visitQuestions : GENERIC_VISIT_QUESTIONS),
    ...questionsFromReport(report),
  ];

  const sections: VisitPrepSection[] = [];
  if (changes.length > 0) sections.push({ heading: "Lo que cambió", items: changes });
  sections.push({ heading: "Preguntas para llevar", items: questions });
  sections.push({ heading: "Para tener a la mano", items: [...VISIT_CARRY] });

  const title = def ? `Hoja para la cita · ${def.label}` : "Hoja para la cita";
  const lines: string[] = [title, ""];
  for (const s of sections) {
    lines.push(s.heading);
    for (const item of s.items) lines.push(`• ${item}`);
    lines.push("");
  }
  lines.push(ROUTE_DISCLAIMER);

  return {
    title,
    sections,
    text: lines.join("\n"),
    hasReportData: changes.length > 0 || questionsFromReport(report).length > 0,
  };
}
