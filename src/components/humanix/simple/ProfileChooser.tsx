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

const MICRO_COPY: Record<Audience, string[]> = {
  familias: ["Profesionales con RETHUS activo", "GPS en tiempo real", "Sin intermediarios"],
  instituciones: ["FUID compliance incluido", "Candidatos verificados", "Cobertura en 2 horas"],
  profesionales: ["Ofertas cerca de ti", "Pago claro y a tiempo", "Tu marca verificada"],
};

const AUDIENCE_GRADIENT: Record<Audience, string> = {
  familias: "audience-familias",
  instituciones: "audience-instituciones",
  profesionales: "audience-profesionales",
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
        Toca para ver tu experiencia personalizada.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {AUDIENCES.map((a, i) => {
          const c = AUDIENCE_COPY[a];
          const hints = MICRO_COPY[a];
          return (
            <li
              key={a}
              style={{ animationDelay: `${i * 100}ms` }}
              className="animate-in fade-in slide-in-from-bottom-6 fill-mode-both duration-500"
            >
              <button
                type="button"
                onClick={() => {
                  say(c.tab);
                  onChoose(a);
                }}
                className={`card-hover group flex min-h-64 w-full flex-col items-start gap-4 rounded-[2rem] p-6 text-left shadow-lg shadow-trust/10 ring-1 ring-border transition duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40 ${AUDIENCE_GRADIENT[a]}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-28 w-28 items-center justify-center self-center rounded-full text-6xl transition-transform group-hover:scale-110 ${TINTS[TINT[a]]}`}
                >
                  {c.emoji}
                </span>
                <div>
                  <span className="block font-display text-2xl font-bold">{c.tab}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{HINT[a]}</span>
                </div>
                {/* micro-copy bullets — appear on hover via group */}
                <ul className="mt-auto space-y-1 transition-opacity duration-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
                  {hints.map((h) => (
                    <li key={h} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <span className="text-ok">✓</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
