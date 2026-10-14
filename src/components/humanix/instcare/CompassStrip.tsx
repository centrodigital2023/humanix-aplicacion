// La brújula del día dentro de cada módulo: un saludo por la hora de Colombia y lo que hoy pide atención, en botones que llevan al lugar.
// «Todo al día» habla del trabajo (alertas, controles y tareas), no de la salud de nadie.
import { CheckCircle2, Compass as CompassIcon } from "lucide-react";
import type { Compass, FocusTarget } from "@/lib/instCelebrate";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

export function CompassStrip({
  compass,
  onFocus,
  className,
}: {
  compass: Compass;
  onFocus?: (target: FocusTarget) => void;
  className?: string;
}) {
  const t = TONE[compass.tone];
  return (
    <section
      aria-label="Brújula del día"
      data-testid="care-compass"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-gradient-to-r p-3 sm:p-4",
        t.border,
        t.wash,
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              t.soft,
              t.text,
            )}
          >
            {compass.allClear ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            ) : (
              <CompassIcon className="h-5 w-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">{compass.greeting}</p>
            <p
              className={cn(
                "font-display text-base font-bold leading-snug",
                compass.tone === "sos" && "text-sos",
              )}
            >
              {compass.headline}
            </p>
            <p className="text-xs text-muted-foreground">{compass.sub}</p>
          </div>
        </div>
        {compass.items.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 sm:justify-end" aria-label="Lo pendiente de hoy">
            {compass.items.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  onClick={() => onFocus?.(i.target)}
                  disabled={!onFocus}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-premium",
                    TONE[i.tone].chip,
                    onFocus && "hover:brightness-95",
                  )}
                >
                  <span className="tabular-nums">{i.count}</span> {i.label}
                  {i.detail && <span className="font-normal opacity-80">· {i.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
