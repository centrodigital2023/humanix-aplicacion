// «Profesionales cercanos» para familias e IPS/EPS: la misma fuente que el mapa (`useValidatedMapProfessionals`), con los datos validados
// del buscador (nombre autorizado, ciudad y turnos) y en vivo. Disponibles primero; «Disponible» sigue encendido aunque el profesional
// cierre Humanix o apague el celular, y «en vivo» marca a quien tiene la aplicación abierta ahora.
import { Link } from "@tanstack/react-router";
import { Loader2, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValidatedMapProfessionals } from "@/hooks/use-live-map";
import { formatKm, type LatLng } from "@/lib/geo";
import { kmTo, sortProfessionals, STATUS_LABEL } from "@/lib/liveMap";
import { presenceLine, proSubtitle } from "@/lib/mapDirectory";
import { trustBadgeText } from "@/lib/trustScore";

export function NearbyProsList({
  origin = null,
  limit = 8,
  title = "Profesionales cercanos",
  emptyText = "Aún no hay profesionales con perfil completo en el mapa.",
  seeAll = true,
}: {
  origin?: LatLng | null;
  limit?: number;
  title?: string;
  emptyText?: string;
  seeAll?: boolean;
}) {
  const q = useValidatedMapProfessionals({ authed: true });
  const pros = q.data ? sortProfessionals(q.data, origin).slice(0, limit) : null;
  const now = Date.now();

  return (
    <section aria-label={title} data-testid="nearby-pros">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Users className="h-4 w-4 text-fuchsia-neural" aria-hidden /> {title}
        </h2>
        {seeAll && (
          <Link to="/buscar" className="text-xs text-muted-foreground hover:text-foreground">
            Ver todos →
          </Link>
        )}
      </div>
      {pros === null ? (
        <Card className="flex items-center justify-center p-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Buscando profesionales…
        </Card>
      ) : pros.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{emptyText}</Card>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {pros.map((p) => {
            const km = kmTo(origin, p);
            const presence = presenceLine(p, now);
            return (
              <li key={p.id} className="min-w-0">
                <Card className="flex items-center gap-3 p-3">
                  <div className="relative shrink-0">
                    {p.avatarUrl ? (
                      <img
                        src={p.avatarUrl}
                        alt=""
                        className="h-10 w-10 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span
                      title={p.live ? "En vivo" : STATUS_LABEL[p.status]}
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background ${
                        p.status === "available"
                          ? p.live
                            ? "animate-pulse bg-ok"
                            : "bg-ok"
                          : p.status === "busy"
                            ? "bg-warn"
                            : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {proSubtitle(p)}
                      {p.rating != null && (
                        <>
                          {" "}
                          · <Star className="inline h-2.5 w-2.5 fill-copper text-copper" />{" "}
                          {p.rating.toFixed(1)}
                        </>
                      )}
                      {p.trust.score != null && <> · Confianza {trustBadgeText(p.trust)}</>}
                    </p>
                    <p
                      className={`truncate text-[11px] font-medium ${
                        p.status === "available" ? "text-ok" : "text-muted-foreground"
                      }`}
                    >
                      {presence ?? STATUS_LABEL[p.status]}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {km != null ? (
                      <span className="text-xs font-semibold text-biosensor">~{formatKm(km)}</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                    <Button size="sm" variant="outline" className="mt-1 block h-7 text-xs" asChild>
                      <Link to="/profesional/$proId" params={{ proId: p.id }}>
                        Ver
                      </Link>
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
