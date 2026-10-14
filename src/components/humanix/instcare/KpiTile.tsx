// Una cifra del tablero: número grande que sube suavemente, etiqueta, pista y un detalle de color. Si `alert` es verdadero, la tarjeta se
// marca (borde y anillo del tono): para las cifras que piden ojos, como alertas o críticos. Con movimiento reducido el número aparece de una vez.
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Card } from "@/components/ui/card";
import type { Tone } from "@/lib/instCareTypes";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

/** Sube del número anterior al nuevo en ~600 ms. Cadenas como «4,5» o «—» se muestran tal cual. */
function useCountUp(target: number | null, durationMs = 600): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) {
      setShown(null);
      from.current = null;
      return;
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current ?? 0;
    if (reduce || start === target) {
      setShown(target);
      from.current = target;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target, durationMs]);
  return shown;
}

export function KpiTile({
  label,
  value,
  sub,
  tone,
  icon: Icon,
  alert = false,
  onClick,
  testId,
}: {
  label: string;
  /** Número (sube con animación) o texto ya formateado. */
  value: number | string;
  sub?: string;
  tone: Tone;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  alert?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const t = TONE[tone];
  const numeric = typeof value === "number" ? value : null;
  const counted = useCountUp(numeric);
  const text = numeric === null ? String(value) : String(counted ?? numeric);
  const body = (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl",
          t.soft,
        )}
      />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span
            className={cn("flex h-7 w-7 items-center justify-center rounded-full", t.soft, t.text)}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </div>
      <p
        className={cn(
          "relative mt-1 font-display text-2xl font-bold leading-none tabular-nums sm:text-3xl",
          t.text,
        )}
      >
        {text}
      </p>
      {sub && <p className="relative mt-1.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </>
  );
  const cls = cn(
    "relative overflow-hidden rounded-2xl border bg-gradient-to-br p-3 text-left sm:p-4",
    t.wash,
    alert ? cn(t.border, "ring-1", t.ring) : "border-border",
    onClick && "card-hover cursor-pointer focus-premium",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} data-testid={testId}>
      {body}
    </button>
  ) : (
    <Card className={cls} data-testid={testId}>
      {body}
    </Card>
  );
}
