import { useState } from "react";
import { BadgeCheck, Building2, Sparkles, Star } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { useInstitutionReputation } from "@/hooks/use-institution-hub";
import { MIN_RATINGS_TO_SHOW } from "@/lib/familyReputation";
import { summarizeInstitutionReputation } from "@/lib/institutionReputation";
import { cn } from "@/lib/utils";

interface Props {
  institutionId: string;
  stars: number | null;
  ratings: number;
  completed: number;
}

/**
 * Reputación de la institución vista por el profesional: solo agregados (mínimo 3 calificaciones).
 * Los comentarios de texto nunca se muestran aquí: son privados.
 */
export function InstitutionReputationBadge({ institutionId, stars, ratings, completed }: Props) {
  const [open, setOpen] = useState(false);
  const detail = useInstitutionReputation(institutionId, open);
  const isNew = stars == null || ratings < MIN_RATINGS_TO_SHOW;
  const rep = summarizeInstitutionReputation(
    detail.data ?? {
      ratings_count: ratings,
      stars_avg: stars,
      completed_services: completed,
      dimensions: [],
    },
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent",
            isNew ? "border-border text-muted-foreground" : "border-ok/40 bg-ok/10 text-ok",
          )}
          aria-label="Ver reputación de la institución"
        >
          {isNew ? (
            <>
              <Sparkles className="h-3 w-3" aria-hidden /> Institución nueva
            </>
          ) : (
            <>
              <Star className="h-3 w-3 fill-current" aria-hidden /> {stars?.toFixed(1)} · {ratings}{" "}
              reseñas
              {completed > 0 && (
                <span className="text-muted-foreground">· {completed} servicios</span>
              )}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 text-sm" align="start">
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <Building2 className="h-4 w-4" aria-hidden /> {rep.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {rep.stars != null
              ? `${rep.stars.toFixed(2)} de 5 · ${rep.ratings} calificaciones de profesionales`
              : `Se muestran promedios desde ${MIN_RATINGS_TO_SHOW} calificaciones.`}
            {rep.completedServices > 0 && ` ${rep.completedServices} servicios completados.`}
          </p>
        </div>

        {rep.reliablePayer && (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-ok/10 px-2 py-1 text-xs font-medium text-ok">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Pago cumplido según otros
            profesionales
          </p>
        )}

        {detail.isLoading ? (
          <p className="text-xs text-muted-foreground">Cargando detalle…</p>
        ) : rep.dimensions.length > 0 ? (
          <ul className="space-y-2">
            {rep.dimensions.map((d) => (
              <li key={d.key}>
                <div className="flex items-center justify-between text-xs">
                  <span>{d.label}</span>
                  <span className="font-medium">{d.average.toFixed(1)}</span>
                </div>
                <Progress value={(d.average / 5) * 100} className="mt-1 h-1.5" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Aún no hay suficientes calificaciones por dimensión (claridad, trato, pago y ambiente).
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          Los comentarios son privados: solo los ve la institución y el equipo de Humanix.
        </p>
      </PopoverContent>
    </Popover>
  );
}
