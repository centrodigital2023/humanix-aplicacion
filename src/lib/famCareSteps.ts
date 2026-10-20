// Próximos pasos de cada persona: citas, vacunas, exámenes, renovar la fórmula. Puro.
//
// Es una libreta de la familia: ella pone la fecha que le dieron (no se adivina ningún calendario, ni de vacunación ni de
// controles: cada EPS y cada médico indican los suyos). Aquí solo se ordena, se dice cuánto falta y se avisa lo atrasado.
import { STEP_KINDS, type StepKind } from "./famCareTypes";
import { daysBetween, isDayKey, type DayKey } from "./famCareDays";
import { plural } from "./intelShared";

export interface StepRow {
  id: string;
  recipient_id: string;
  title: string;
  kind: StepKind | string;
  due_on: string;
  done_at: string | null;
  created_at?: string;
}

export type StepState = "overdue" | "today" | "soon" | "later" | "done";

/** Hasta cuántos días hacia adelante un paso se considera «próximo». */
export const SOON_DAYS = 7;

export function isStepKind(k: unknown): k is StepKind {
  return typeof k === "string" && (STEP_KINDS as readonly string[]).includes(k);
}

export function stepState(s: Pick<StepRow, "due_on" | "done_at">, today: DayKey): StepState {
  if (s.done_at) return "done";
  if (!isDayKey(s.due_on)) return "later";
  const d = daysBetween(today, s.due_on);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  return d <= SOON_DAYS ? "soon" : "later";
}

/** Abiertos primero (lo atrasado, lo de hoy, lo que viene), después lo hecho (lo más reciente arriba). */
export function sortSteps<T extends StepRow>(steps: readonly T[], today: DayKey): T[] {
  const open = steps
    .filter((s) => !s.done_at)
    .sort(
      (a, b) =>
        a.due_on.localeCompare(b.due_on) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
  const done = steps
    .filter((s) => s.done_at)
    .sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)) || a.id.localeCompare(b.id));
  void today;
  return [...open, ...done];
}

export interface StepsOverview {
  open: number;
  overdue: number;
  today: number;
  soon: number;
  /** El siguiente paso abierto (el más cercano o el más atrasado). */
  next: StepRow | null;
}

export function stepsOverview(steps: readonly StepRow[], today: DayKey): StepsOverview {
  const open = sortSteps(steps, today).filter((s) => !s.done_at);
  const count = (st: StepState) => open.filter((s) => stepState(s, today) === st).length;
  return {
    open: open.length,
    overdue: count("overdue"),
    today: count("today"),
    soon: count("soon"),
    next: open[0] ?? null,
  };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «20 de oct» */
export function shortDateEs(key: DayKey): string {
  if (!isDayKey(key)) return "";
  const [, m, d] = key.split("-").map(Number);
  return `${d} de ${MONTHS[m - 1]}`;
}

/** «Hoy», «Mañana», «En 3 días», «Ayer», «Hace 4 días» o, lejos, «El 20 de oct». */
export function dueLabelEs(due: DayKey, today: DayKey): string {
  if (!isDayKey(due)) return "";
  const d = daysBetween(today, due);
  if (d === 0) return "Hoy";
  if (d === 1) return "Mañana";
  if (d === -1) return "Ayer";
  if (d > 1 && d <= SOON_DAYS) return `En ${plural(d, "día", "días")}`;
  if (d < -1 && d >= -30) return `Hace ${plural(-d, "día", "días")}`;
  return `El ${shortDateEs(due)}`;
}
