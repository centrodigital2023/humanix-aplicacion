/** Tasa de apertura medida; null si no hay datos confiables (nunca 0 ni valores estimados). */
export function calculateOpenRate(delivered: number, opened: number): number | null {
  if (!Number.isFinite(delivered) || !Number.isFinite(opened)) return null;
  if (delivered <= 0) return null;
  if (opened < 0 || opened > delivered) return null;
  return Number(((opened / delivered) * 100).toFixed(1));
}

export function formatRate(rate: number | null | undefined): string {
  return rate == null ? "Datos insuficientes" : `${rate.toFixed(1)}%`;
}
