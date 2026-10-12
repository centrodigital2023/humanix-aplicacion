// Línea mínima de evolución (SVG, sin librerías). Con una serie plana dibuja una raya al centro; con menos de dos
// puntos no dibuja nada. Lleva descripción en texto para lector de pantalla.
import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  label,
  className,
}: {
  values: number[];
  label: string;
  className?: string;
}) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const w = 88;
  const h = 28;
  const pad = 3;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (clean.length - 1);
  const y = (v: number) => (span === 0 ? h / 2 : h - pad - ((v - min) * (h - 2 * pad)) / span);
  const points = clean.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = clean[clean.length - 1];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-7 w-[5.5rem] shrink-0 text-trust", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={x(clean.length - 1)} cy={y(last)} r="2.5" fill="currentColor" />
    </svg>
  );
}
