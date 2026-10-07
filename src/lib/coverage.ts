export type CoverageLevel = "covered" | "pending_approval" | "uncovered" | "urgent" | "closed";

export interface CoverageInput {
  status: "open" | "closed" | "filled";
  shiftsCount: number | null;
  startDate: string | null;
  acceptedCount: number;
  pendingCount: number;
}

const URGENT_WINDOW_MS = 48 * 3600_000;

/** Verde: cubierto. Amarillo: hay postulantes sin aprobar. Rojo: sin candidatos (urgente si empieza en <48 h). */
export function coverageLevel(input: CoverageInput, now = Date.now()): CoverageLevel {
  const needed = Math.max(1, input.shiftsCount ?? 1);
  if (input.status === "filled" || input.acceptedCount >= needed) return "covered";
  if (input.status === "closed") return "closed";
  if (input.pendingCount > 0) return "pending_approval";
  const starts = input.startDate ? new Date(input.startDate).getTime() : NaN;
  if (Number.isFinite(starts) && starts - now < URGENT_WINDOW_MS) return "urgent";
  return "uncovered";
}

export const COVERAGE_META: Record<CoverageLevel, { label: string; dot: string }> = {
  covered: { label: "Cubierto", dot: "bg-emerald-500" },
  pending_approval: { label: "Con postulantes, falta aprobar", dot: "bg-amber-500" },
  uncovered: { label: "Sin candidatos", dot: "bg-red-500" },
  urgent: { label: "Sin candidatos · urgente", dot: "bg-red-600 animate-pulse" },
  closed: { label: "Cerrado", dot: "bg-muted-foreground" },
};
