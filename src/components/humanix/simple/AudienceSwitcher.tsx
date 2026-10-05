// Selector tripartito persistente: conmuta toda la experiencia sin recargar.
// Patrón ARIA "tabs": flechas ← → / Inicio / Fin para moverse con teclado.
import { useRef } from "react";
import { AUDIENCES, AUDIENCE_COPY, type Audience } from "@/lib/audience";

type Props = {
  value: Audience;
  onChange: (next: Audience) => void;
  panelId: string;
};

export function AudienceSwitcher({ value, onChange, panelId }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAt = (index: number) => {
    const i = (index + AUDIENCES.length) % AUDIENCES.length;
    onChange(AUDIENCES[i]);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight") focusAt(index + 1);
    else if (e.key === "ArrowLeft") focusAt(index - 1);
    else if (e.key === "Home") focusAt(0);
    else if (e.key === "End") focusAt(AUDIENCES.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label="¿Quién eres?"
      className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-sm"
    >
      {AUDIENCES.map((a, index) => {
        const copy = AUDIENCE_COPY[a];
        const active = a === value;
        return (
          <button
            key={a}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`audience-tab-${a}`}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(a)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 sm:flex-row sm:gap-2 sm:text-base ${
              active
                ? "bg-trust text-trust-foreground shadow-md"
                : "text-foreground hover:bg-trust/10"
            }`}
          >
            <span className="text-xl leading-none sm:text-2xl" aria-hidden="true">
              {copy.emoji}
            </span>
            <span className="text-[13px] leading-tight sm:hidden">{copy.tabShort}</span>
            <span className="hidden sm:inline">{copy.tab}</span>
          </button>
        );
      })}
    </div>
  );
}
