// Reconocimientos en el perfil público de un profesional: solo agregados (servicios, horas, familias que vuelven,
// racha) y las gracias por tipo con personas distintas. Sin nombres, sin mensajes, sin cifras internas.
import { Award, HeartHandshake } from "lucide-react";
import { usePublicCareerStats, usePublicKudos } from "@/hooks/use-care-loop";
import { careerLevel, publicHighlights } from "@/lib/careerStats";
import { kudosChips } from "@/lib/kudos";

export function PublicRecognition({ proId }: { proId: string }) {
  const stats = usePublicCareerStats(proId);
  const kudos = usePublicKudos(proId);

  const s = stats.data;
  // Sin migración aplicada o sin servicios completados: no se ocupa espacio en el perfil.
  if (!s || s.completedServices === 0) return null;

  const highlights = publicHighlights(s);
  const chips = kudosChips(kudos.data, 6);
  const level = careerLevel(s.completedServices);

  return (
    <section
      aria-label="Trayectoria en Humanix"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Award className="h-5 w-5 text-copper" aria-hidden="true" /> Trayectoria en Humanix
        </h2>
        <span className="rounded-full bg-copper/10 px-3 py-1 text-xs font-bold text-copper">
          Nivel {level.level} · {level.label}
        </span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {highlights.map((h) => (
          <li
            key={h}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium"
          >
            {h}
          </li>
        ))}
      </ul>

      {chips.length > 0 && (
        <div className="mt-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <HeartHandshake className="h-4 w-4 text-copper" aria-hidden="true" /> Lo que agradecen
            las familias
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {chips.map((c) => (
              <li
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-copper/10 px-3 py-1 text-sm font-medium text-copper"
              >
                <span aria-hidden="true">{c.emoji}</span> {c.label}
                <span className="rounded-full bg-copper/15 px-1.5 text-[11px] font-bold">
                  {c.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Cifras calculadas por Humanix a partir de servicios completados en la plataforma.
      </p>
    </section>
  );
}
