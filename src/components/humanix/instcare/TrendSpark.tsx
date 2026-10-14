// Mini gráfica de una serie de signos (SVG, sin librerías): el eje horizontal es el TIEMPO (dos controles muy separados no quedan pegados).
// Con menos de dos puntos dibuja solo el punto; sin datos, una línea punteada. Lleva su descripción para lector de pantalla.
import { useId, useMemo } from "react";
import { sparkline, type SeriesPoint } from "@/lib/instMonitoring";
import type { Tone } from "@/lib/instCareTypes";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

export function TrendSpark({
  points,
  label,
  tone = "trust",
  width = 96,
  height = 32,
  fillArea = true,
  className,
}: {
  points: SeriesPoint[];
  label: string;
  tone?: Tone;
  width?: number;
  height?: number;
  fillArea?: boolean;
  className?: string;
}) {
  const gid = useId();
  const spark = useMemo(() => sparkline(points, width, height), [points, width, height]);
  const t = TONE[tone];
  const first = spark.points.split(" ")[0];
  const area =
    spark.last && first && points.length > 1
      ? `${spark.points} ${spark.last.x},${height} ${first.split(",")[0]},${height}`
      : "";
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", t.text, className)}
      style={{ width, height }}
    >
      {points.length === 0 ? (
        <line
          x1="3"
          x2={width - 3}
          y1={height / 2}
          y2={height / 2}
          className="stroke-muted-foreground/40"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
      ) : (
        <>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {fillArea && area && <polygon points={area} fill={`url(#${gid})`} />}
          {points.length > 1 && (
            <polyline
              points={spark.points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {spark.last && <circle cx={spark.last.x} cy={spark.last.y} r="2.6" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}
