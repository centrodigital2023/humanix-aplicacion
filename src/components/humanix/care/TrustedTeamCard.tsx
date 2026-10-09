// Mi equipo de confianza: los profesionales que ya te dieron tranquilidad. Si uno cancela, Humanix actúa: a la
// familia le dice cuántos están libres para cubrir el horario; a la institución le avisa a su equipo (plan B).
import { Link } from "@tanstack/react-router";
import { Star, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRemoveFromTeam, useTrustedTeam } from "@/hooks/use-care-loop";
import { memberLine, planBPromise, sortTeam, teamHeadline } from "@/lib/careLoop";
import { cn } from "@/lib/utils";

export function TrustedTeamCard({
  userId,
  role,
  className,
}: {
  userId: string;
  role: "family" | "institution";
  className?: string;
}) {
  const team = useTrustedTeam(userId);
  const remove = useRemoveFromTeam(userId);

  if (team.isLoading) return <Skeleton className="h-40 w-full" />;
  // Antes de aplicar la migración la función no existe: no se muestra un error al usuario.
  if (team.error) return null;
  const members = sortTeam(team.data ?? []);

  return (
    <Card className={cn("space-y-4 p-4 sm:p-5", className)} aria-label="Mi equipo de confianza">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Users className="h-4 w-4 text-biosensor" aria-hidden="true" /> Mi equipo de confianza
        </h2>
        <p className="text-xs text-muted-foreground">{teamHeadline(members)}</p>
      </div>

      <p className="rounded-lg border border-biosensor/30 bg-biosensor/5 px-3 py-2 text-xs text-foreground/90">
        {planBPromise(role, members.length)}
      </p>

      {members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          {role === "family"
            ? "Cuando termine un servicio que te dio tranquilidad, toca «Guardar como favorito» y quedará aquí."
            : "Marca como favoritos a los profesionales que cumplen: serán los primeros en enterarse de tus turnos urgentes."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.professional_id} className="flex flex-wrap items-center gap-3 py-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-biosensor/15 text-sm font-bold text-biosensor"
                aria-hidden="true"
              >
                {m.display_name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                  {m.display_name}
                  {m.avg_rating ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
                      <Star className="h-3 w-3 fill-warn text-warn" aria-hidden="true" />{" "}
                      {m.avg_rating.toFixed(1)}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      m.available ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.available ? "Disponible" : "No disponible"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{memberLine(m)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button asChild size="sm" variant="outline">
                  <Link to="/profesional/$proId" params={{ proId: m.professional_id }}>
                    Pedir de nuevo
                  </Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Quitar a ${m.display_name} del equipo`}
                    >
                      <UserMinus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Quitar a {m.display_name} de tu equipo?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Dejará de recibir tus avisos de turnos urgentes y de contar para tu plan B.
                        Puedes volver a guardarlo cuando quieras.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Mantener</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          remove.mutate(m.professional_id, {
                            onSuccess: () => toast.success("Quitado de tu equipo"),
                            onError: () => toast.error("No se pudo quitar. Inténtalo de nuevo."),
                          })
                        }
                      >
                        Quitar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
