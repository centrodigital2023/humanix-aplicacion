// Primeros pasos: la lista que convierte un tablero vacío en el hábito de usarlo. Cada paso tiene su botón; los que pide el plan IPS Mejorado
// se ven con candado y no cuentan para el avance (nunca se castiga a quien tiene Free).
import { Check, ChevronRight, Lock, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Onboarding, OnboardingStep } from "@/lib/instCare";
import { cn } from "@/lib/utils";

export function OnboardingCard({
  onboarding,
  onStep,
  className,
}: {
  onboarding: Onboarding;
  onStep: (key: OnboardingStep["key"]) => void;
  className?: string;
}) {
  if (onboarding.complete) return null;
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-2xl border-trust/30 bg-gradient-to-br from-trust/5 via-card to-biosensor/5 p-4",
        className,
      )}
      data-testid="onboarding"
    >
      <div className="flex items-center gap-3">
        <div
          className="relative h-11 w-11 shrink-0"
          role="img"
          aria-label={`${onboarding.pct} % completado`}
        >
          <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="20" cy="20" r={r} className="fill-none stroke-muted" strokeWidth="4" />
            <circle
              cx="20"
              cy="20"
              r={r}
              className="fill-none stroke-trust transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * r}
              strokeDashoffset={c * (1 - onboarding.pct / 100)}
            />
          </svg>
          <Rocket className="absolute inset-0 m-auto h-4 w-4 text-trust" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="font-display text-sm font-bold">Empieza en minutos</p>
          <p className="text-xs text-muted-foreground">
            {onboarding.done} de {onboarding.total} pasos · {onboarding.pct} %
          </p>
        </div>
      </div>

      <ol className="mt-3 space-y-1.5">
        {onboarding.steps.map((s) => {
          const isNext = onboarding.next?.key === s.key;
          return (
            <li
              key={s.key}
              data-done={s.done}
              data-locked={s.locked}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                isNext ? "bg-trust/10 ring-1 ring-trust/30" : "bg-transparent",
                s.locked && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  s.done
                    ? "border-ok bg-ok text-ok-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
                aria-hidden
              >
                {s.done ? (
                  <Check className="h-3 w-3" />
                ) : s.locked ? (
                  <Lock className="h-2.5 w-2.5" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "leading-tight",
                    s.done && "text-muted-foreground line-through decoration-muted-foreground/40",
                  )}
                >
                  {s.label}
                  {s.locked && (
                    <span className="ml-1.5 text-[10px] font-semibold text-copper">
                      IPS Mejorado
                    </span>
                  )}
                </p>
                {isNext && <p className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</p>}
              </div>
              {isNext && (
                <Button
                  type="button"
                  size="sm"
                  variant="hero"
                  onClick={() => onStep(s.key)}
                  className="shrink-0"
                >
                  Empezar <ChevronRight aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
