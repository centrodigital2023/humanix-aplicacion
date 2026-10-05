// Indicador de pasos del servicio con imágenes (📝 → ✅ → 🚗 → 🏠 → ⭐).
// El mismo en la home, el panel de familia y el seguimiento en vivo.
import { JOURNEY_STEPS, journeyIndex, journeySentence } from "@/lib/family-journey";

export function JourneySteps({
  status,
  proName,
  compact = false,
}: {
  status: string;
  proName: string;
  compact?: boolean;
}) {
  const current = journeyIndex(status);
  const sentence = journeySentence(status, proName);

  if (current === -1) {
    return (
      <p role="status" className="text-lg font-bold text-muted-foreground">
        ❌ {sentence}
      </p>
    );
  }

  return (
    <div>
      <p role="status" className={`font-bold ${compact ? "text-lg" : "text-xl sm:text-2xl"}`}>
        {sentence}
      </p>
      <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Pasos del servicio">
        {JOURNEY_STEPS.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li
              key={s.status}
              aria-current={now ? "step" : undefined}
              className="flex flex-col items-center gap-1.5 text-center"
            >
              <span
                aria-hidden="true"
                className={`flex items-center justify-center rounded-full transition-all ${
                  compact ? "h-11 w-11 text-xl" : "h-14 w-14 text-2xl"
                } ${
                  now
                    ? "bg-trust text-trust-foreground shadow-lg shadow-trust/30 ring-4 ring-trust/20"
                    : done
                      ? "bg-ok/15"
                      : "bg-muted opacity-60"
                }`}
              >
                {done ? "✔️" : s.emoji}
              </span>
              <span
                className={`text-xs font-bold leading-tight sm:text-sm ${
                  now ? "text-trust" : done ? "text-ok" : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
