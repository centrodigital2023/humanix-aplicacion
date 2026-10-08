export interface PriceBreakdown {
  hourlyRate: number;
  hours: number;
  /** Lo que paga la familia o institución. */
  total: number;
  commissionPct: number;
  /** Comisión de Humanix, descontada al profesional. */
  commission: number;
  /** Lo que recibe el profesional. */
  professionalNet: number;
}

export function buildPriceBreakdown(
  hourlyRate: number,
  hours: number,
  commissionPct: number,
): PriceBreakdown {
  const safeRate = Math.max(0, Math.round(hourlyRate));
  const safeHours = Math.max(0, hours);
  const pct = Math.min(100, Math.max(0, commissionPct));
  const total = Math.round(safeRate * safeHours);
  const commission = Math.round((total * pct) / 100);
  return {
    hourlyRate: safeRate,
    hours: safeHours,
    total,
    commissionPct: pct,
    commission,
    professionalNet: total - commission,
  };
}

export function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}
