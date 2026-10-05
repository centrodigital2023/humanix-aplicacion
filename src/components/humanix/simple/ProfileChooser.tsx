// Primera pantalla: "¿Quién eres?" — 3 tarjetas grandes con imagen.
// Después de elegir, todo el sitio muestra solo ese perfil.
import { AUDIENCES, AUDIENCE_COPY, type Audience } from "@/lib/audience";
import { TINTS, type Tint } from "./ui";
import { useSpeakOnChange, useVoice } from "./voice";

const TINT: Record<Audience, Tint> = {
  familias: "rose",
  instituciones: "sky",
  profesionales: "emerald",
};

const HINT: Record<Audience, string> = {
  familias: "Busco cuidado en casa",
  instituciones: "Necesito cubrir turnos",
  profesionales: "Busco trabajo en salud",
};

export function ProfileChooser({ onChoose }: { onChoose: (a: Audience) => void }) {
  const { say } = useVoice();
  useSpeakOnChange("¿Quién eres? Toca una imagen.");

  return (
    <section
      aria-labelledby="chooser-title"
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14"
    >
      <h1
        id="chooser-title"
        className="text-center font-display text-4xl font-bold tracking-tight text-trust sm:text-6xl"
      >
        ¿Quién eres?
      </h1>
      <p className="mt-3 text-center text-xl text-muted-foreground">
        Toca una imagen para empezar.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {AUDIENCES.map((a, i) => {
          const c = AUDIENCE_COPY[a];
          return (
            <li
              key={a}
              style={{ animationDelay: `${i * 90}ms` }}
              className="animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500"
            >
              <button
                type="button"
                onClick={() => {
                  say(c.tab);
                  onChoose(a);
                }}
                className="group flex min-h-56 w-full flex-col items-center justify-center gap-4 rounded-[2rem] bg-card p-6 text-center shadow-lg shadow-trust/10 ring-1 ring-border transition duration-200 hover:-translate-y-1 hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-28 w-28 items-center justify-center rounded-full text-6xl transition-transform group-hover:scale-110 ${TINTS[TINT[a]]}`}
                >
                  {c.emoji}
                </span>
                <span className="font-display text-2xl font-bold">{c.tab}</span>
                <span className="text-base text-muted-foreground">{HINT[a]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
