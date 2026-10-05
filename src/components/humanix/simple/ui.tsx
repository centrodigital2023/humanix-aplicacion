// Piezas visuales compartidas de la home simple: tarjetas-pictograma grandes,
// indicador de pasos con puntos y botón principal.
import { Check } from "lucide-react";
import { useVoice } from "./voice";

export const TINTS = {
  rose: "bg-rose-100 dark:bg-rose-500/20",
  sky: "bg-sky-100 dark:bg-sky-500/20",
  amber: "bg-amber-100 dark:bg-amber-500/20",
  emerald: "bg-emerald-100 dark:bg-emerald-500/20",
  violet: "bg-violet-100 dark:bg-violet-500/20",
} as const;

export type Tint = keyof typeof TINTS;

type PictoProps = {
  emoji: string;
  label: string;
  hint?: string;
  tint: Tint;
  selected?: boolean;
  onSelect: () => void;
  size?: "lg" | "md";
};

/** Opción con imagen grande + 1-3 palabras. Con modo voz, dice su nombre al tocarla. */
export function PictoCard({
  emoji,
  label,
  hint,
  tint,
  selected,
  onSelect,
  size = "lg",
}: PictoProps) {
  const { say } = useVoice();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        say(label);
        onSelect();
      }}
      className={`group relative flex flex-col items-center justify-center gap-2 rounded-3xl border-2 bg-card p-3 text-center transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40 ${
        size === "lg" ? "min-h-40" : "min-h-28"
      } ${selected ? "border-trust shadow-lg" : "border-transparent shadow-sm"}`}
    >
      {selected && (
        <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-trust text-trust-foreground animate-in zoom-in">
          <Check className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
      <span
        aria-hidden="true"
        className={`flex items-center justify-center rounded-full transition-transform group-hover:scale-110 ${TINTS[tint]} ${
          size === "lg" ? "h-20 w-20 text-5xl" : "h-14 w-14 text-3xl"
        }`}
      >
        {emoji}
      </span>
      <span className={`font-bold leading-tight ${size === "lg" ? "text-lg" : "text-base"}`}>
        {label}
      </span>
      {hint && <span className="text-sm leading-tight text-muted-foreground">{hint}</span>}
    </button>
  );
}

/** Pasos como puntos: ● ● ○  (más un texto oculto para lectores de pantalla). */
export function StepDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className="sr-only">
        Paso {step} de {total}
      </span>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-3 rounded-full transition-all duration-300 ${
            i + 1 === step ? "w-10 bg-trust" : i + 1 < step ? "w-3 bg-trust" : "w-3 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

export const primaryBtn =
  "flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground shadow-lg shadow-trust/25 transition hover:bg-trust/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40 disabled:opacity-70";

export const okBtn =
  "flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-ok px-6 text-lg font-bold text-ok-foreground shadow-lg shadow-ok/25 transition hover:bg-ok/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40";

export const ghostBtn =
  "flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card px-4 text-base font-bold transition hover:border-trust active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40";
