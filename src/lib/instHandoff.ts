// Relevo de turno (I-PASS) — lógica pura.
//
// I-PASS (Starmer et al., NEJM 2014) ordena lo que se cuenta al relevar a alguien: Illness severity (gravedad) · Patient summary (resumen)
// · Action list (qué falta hacer) · Situation awareness & contingency (qué vigilar y qué hacer si cambia) · Synthesis by receiver (quien
// recibe repite lo que entendió). La pantalla propone un borrador por paciente con los datos reales (NEWS2, alertas, tareas); la persona
// lo corrige y se guarda en la historia de cada paciente (plan IPS Mejorado). La «síntesis» queda en la hoja impresa, para firmar.
//
// Nada de esto reemplaza el criterio clínico: es un borrador.

import { ageLabel, clockLabel, dateLabel, dayClockLabel, nowMs, type Clock } from "./instCare";
import type { InstAlert, InstLive, InstPatient, InstTask, Tone } from "./instCareTypes";
import { ALERT_TITLE, monitorStatus, type MonitorStatus } from "./instMonitoring";
import { obsIntervalMinutes } from "./news2";

export type Illness = "stable" | "watcher" | "unstable";

export const ILLNESS_META: Record<
  Illness,
  { label: string; tone: Tone; help: string; rank: number }
> = {
  unstable: {
    label: "Inestable",
    tone: "sos",
    help: "Puede deteriorarse pronto o ya lo está: vigilancia continua.",
    rank: 0,
  },
  watcher: {
    label: "En observación",
    tone: "warn",
    help: "Preocupa algo concreto: revisar más seguido.",
    rank: 1,
  },
  stable: { label: "Estable", tone: "ok", help: "Sin preocupaciones por ahora.", rank: 2 },
};

/** Límites del servidor para cada texto del relevo. */
export const HANDOFF_TEXT_MAX = 600;
export const HANDOFF_MAX_PATIENTS = 150;

export function suggestIllness(status: MonitorStatus, overdueTasks: number): Illness {
  if (status.state === "critical") return "unstable";
  if (status.state === "urgent" || status.state === "attention" || status.openAlerts > 0)
    return "watcher";
  if (status.overdue && status.state !== "pending") return "watcher";
  if (overdueTasks > 0 && status.state === "pending") return "watcher";
  return "stable";
}

export interface HandoffDraft {
  patientId: string;
  name: string;
  room: string | null;
  age: string;
  illness: Illness;
  /** Lo que el sistema sugirió (para saber si la persona lo cambió). */
  suggested: Illness;
  summary: string;
  actions: string;
  contingency: string;
  /** Datos que no se deben olvidar al relevar (alergias, escala de saturación). */
  flags: string[];
}

const clip = (s: string, n = HANDOFF_TEXT_MAX) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

function summaryFor(p: InstPatient, s: MonitorStatus, alerts: InstAlert[], now: Clock): string {
  const parts: string[] = [];
  const age = ageLabel(p.birth_date, now);
  if (age) parts.push(age);
  if (p.conditions.length) parts.push(p.conditions.slice(0, 3).join(", "));
  if (s.news2 !== null && s.band) {
    const label = { low: "estable", low_medium: "atención", medium: "urgente", high: "crítico" }[
      s.band
    ];
    parts.push(`NEWS2 ${s.news2} (${label}) ${s.lastSeenLabel}`);
  } else if (p.monitoring) {
    parts.push(s.lastSeenAt ? `Sin puntaje NEWS2 (${s.lastSeenLabel})` : "Aún sin controles");
  }
  const open = alerts.filter((a) => a.status !== "resolved");
  if (open.length) {
    parts.push(
      `Alertas abiertas: ${open
        .slice(0, 3)
        .map(
          (a) => `${ALERT_TITLE[a.reason].toLowerCase()}${a.status === "open" ? " (sin ver)" : ""}`,
        )
        .join("; ")}`,
    );
  }
  return clip(parts.join(". "));
}

function actionsFor(tasks: InstTask[], s: MonitorStatus, monitored: boolean, now: Clock): string {
  const t = nowMs(now);
  const horizon = t + 12 * 3_600_000;
  const todo = tasks
    .filter((x) => x.status === "open" && Date.parse(x.due_at) <= horizon)
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
    .slice(0, 5)
    .map((x) => {
      const late = Date.parse(x.due_at) < t;
      return `${x.title} (${late ? "vencida" : clockLabel(x.due_at)})`;
    });
  const out: string[] = [];
  if (monitored && s.overdue && s.state !== "pending")
    out.push("Tomar signos ahora (control vencido)");
  if (monitored && s.state === "pending" && s.dueAt === null)
    out.push("Hacer el primer control de signos");
  out.push(...todo);
  return clip(out.length ? out.join("; ") : "Sin tareas pendientes.");
}

/** Cada cuánto repetir los signos según el puntaje (frecuencia mínima de la guía NEWS2). */
function cadence(s: MonitorStatus): string {
  if (s.news2 === null || s.band === null) return "según el protocolo de la institución";
  const mins = obsIntervalMinutes(s.news2, s.band === "low_medium" ? 3 : 0);
  if (mins >= 720) return "cada 12 h";
  if (mins >= 360) return "cada 4–6 h";
  if (mins >= 60) return "cada hora";
  return "de forma continua";
}

function contingencyFor(illness: Illness, s: MonitorStatus): string {
  if (illness === "unstable")
    return "Monitoreo continuo y traslado listo. Si empeora, activar la emergencia y avisar al médico de inmediato.";
  if (illness === "watcher")
    return `Repetir los signos ${cadence(s)}. Si el NEWS2 llega a 7 o más, o un parámetro suma 3 puntos, avisar al médico de turno.`;
  return `Controles ${cadence(s)}. Si el NEWS2 sube a 5 o más o un parámetro suma 3 puntos, avisar al médico de turno.`;
}

export interface HandoffInput {
  patients: InstPatient[];
  live: Map<string, InstLive>;
  alerts: InstAlert[];
  tasks: InstTask[];
  now: Clock;
}

/** Un borrador por cada paciente activo, los más delicados primero. */
export function draftHandoff(input: HandoffInput): HandoffDraft[] {
  const { live, now } = input;
  const t = nowMs(now);
  const drafts = input.patients
    .filter((p) => p.status === "active")
    .map((p): HandoffDraft => {
      const alerts = input.alerts.filter((a) => a.patient_id === p.id);
      const tasks = input.tasks.filter((x) => x.patient_id === p.id);
      const status = monitorStatus(p.monitoring ? live.get(p.id) : undefined, alerts, now);
      const overdueTasks = tasks.filter(
        (x) => x.status === "open" && Date.parse(x.due_at) < t,
      ).length;
      const illness = suggestIllness(status, overdueTasks);
      const flags: string[] = [];
      if (p.allergies.length) flags.push(`Alergias: ${p.allergies.join(", ")}`);
      if (p.spo2_scale === 2) flags.push("Escala 2 de saturación (meta 88–92 %)");
      return {
        patientId: p.id,
        name: p.full_name,
        room: p.room,
        age: ageLabel(p.birth_date, now),
        illness,
        suggested: illness,
        summary: summaryFor(p, status, alerts, now),
        actions: actionsFor(tasks, status, p.monitoring, now),
        contingency: contingencyFor(illness, status),
        flags,
      };
    });
  return drafts.sort(
    (a, b) =>
      ILLNESS_META[a.illness].rank - ILLNESS_META[b.illness].rank ||
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
  );
}

export interface HandoffCheck {
  ok: boolean;
  errors: string[];
}

export function validateHandoff(drafts: HandoffDraft[]): HandoffCheck {
  const errors: string[] = [];
  if (drafts.length === 0) errors.push("Elige al menos un paciente.");
  if (drafts.length > HANDOFF_MAX_PATIENTS)
    errors.push(`Un relevo admite hasta ${HANDOFF_MAX_PATIENTS} pacientes.`);
  for (const d of drafts) {
    for (const [label, text] of [
      ["resumen", d.summary],
      ["acciones", d.actions],
      ["qué hacer si cambia", d.contingency],
    ] as const) {
      if (text.length > HANDOFF_TEXT_MAX)
        errors.push(`${d.name}: el texto de «${label}» pasa de ${HANDOFF_TEXT_MAX} caracteres.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Lo que recibe `inst_handoff_commit`. */
export function handoffPayload(drafts: HandoffDraft[]): Array<Record<string, string>> {
  return drafts.map((d) => ({
    patient_id: d.patientId,
    illness: d.illness,
    summary: d.summary.trim(),
    actions: d.actions.trim(),
    contingency: d.contingency.trim(),
  }));
}

/** La hoja del relevo, lista para copiar o imprimir (con el espacio de la síntesis de quien recibe). */
export function handoffToText(
  drafts: HandoffDraft[],
  meta: { institution: string; now: Clock; from?: string; to?: string },
): string {
  const lines: string[] = [
    "RELEVO DE TURNO · I-PASS",
    `${meta.institution} · ${dateLabel(new Date(nowMs(meta.now)).toISOString())} · ${clockLabel(new Date(nowMs(meta.now)).toISOString())}`,
  ];
  if (meta.from || meta.to) lines.push(`De: ${meta.from || "—"}   A: ${meta.to || "—"}`);
  const count = (i: Illness) => drafts.filter((d) => d.illness === i).length;
  lines.push(
    `${drafts.length} pacientes · ${count("unstable")} inestables · ${count("watcher")} en observación · ${count("stable")} estables`,
    "",
  );
  drafts.forEach((d, i) => {
    const head = [`${i + 1}. ${d.name}`, d.age, d.room ? `hab. ${d.room}` : ""]
      .filter(Boolean)
      .join(" · ");
    lines.push(`[${ILLNESS_META[d.illness].label.toUpperCase()}] ${head}`);
    if (d.flags.length) lines.push(`   ⚠ ${d.flags.join(" · ")}`);
    lines.push(
      `   Resumen: ${d.summary || "—"}`,
      `   Acciones: ${d.actions || "—"}`,
      `   Si cambia: ${d.contingency || "—"}`,
      "",
    );
  });
  lines.push(
    "Síntesis de quien recibe (repetir con sus palabras lo más importante):",
    "______________________________________________",
    "Firma de quien entrega: ______________   Firma de quien recibe: ______________",
  );
  return lines.join("\n");
}

/** ¿Cuándo fue el último relevo? Para recordar hacerlo al final del turno. */
export function lastHandoffLabel(at: string | null | undefined, now: Clock): string {
  return at ? `Último relevo: ${dayClockLabel(at, now)}` : "Aún no se ha guardado ningún relevo";
}
