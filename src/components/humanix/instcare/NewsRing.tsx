// El «halo» del NEWS2: un anillo que se llena con el puntaje y toma el color de su banda. Es la imagen de marca del monitoreo: de un vistazo se
// ve quién está bien y quién necesita ojos. Con movimiento reducido no hay pulso. Lleva su descripción en texto para lector de pantalla.
import { bandTone } from "@/lib/instCare";
import { bandLabel } from "@/lib/instMonitoring";
import type { News2Band } from "@/lib/news2";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

const SIZE = {
  sm: { box: "h-12 w-12", num: "text-base", cap: "hidden" },
  md: { box: "h-16 w-16", num: "text-xl", cap: "text-[8px]" },
  lg: { box: "h-24 w-24", num: "text-3xl", cap: "text-[10px]" },
} as const;

/** El anillo mide 100 × 100 y se escala al tamaño pedido. */
const R = 42;
const STROKE = 9;
const CIRC = 2 * Math.PI * R;
/** El anillo se llena hasta 12 puntos (con 7 ya es emergencia); un puntaje mayor lo deja lleno. */
const FULL_AT = 12;

export function NewsRing({
  score,
  band,
  size = "md",
  pulse = true,
  className,
}: {
  score: number | null;
  band: News2Band | null;
  size?: keyof typeof SIZE;
  /** Late (anillo que respira) cuando el estado es crítico. */
  pulse?: boolean;
  className?: string;
}) {
  const s = SIZE[size];
  const tone = TONE[bandTone(band)];
  const fill = score === null ? 0 : Math.min(1, Math.max(0.04, score / FULL_AT));
  const label =
    score === null ? "Sin puntaje NEWS2" : `NEWS2 ${score}, ${bandLabel(band).toLowerCase()}`;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "relative shrink-0 rounded-full",
        s.box,
        band === "high" && pulse && "motion-safe:animate-pulse",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-full opacity-60 blur-md",
          score === null ? "" : tone.soft,
        )}
      />
      <svg viewBox="0 0 100 100" className="relative h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={R} className="fill-card stroke-muted" strokeWidth={STROKE} />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - fill)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none",
            score === null ? "stroke-transparent" : tone.stroke,
          )}
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center leading-none"
      >
        <span className={cn("font-display font-bold tabular-nums", s.num, tone.text)}>
          {score === null ? "—" : score}
        </span>
        <span
          className={cn(
            "mt-0.5 font-semibold uppercase tracking-wider text-muted-foreground",
            s.cap,
          )}
        >
          NEWS2
        </span>
      </div>
    </div>
  );
}
