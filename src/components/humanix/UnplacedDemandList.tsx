// Solicitudes abiertas de familias e instituciones que aún no tienen ubicación: no pueden ser un punto en el mapa (no se inventa un
// sitio), pero el profesional igual las ve aquí, debajo del mapa. Misma fuente segura que el mapa (`map_open_demand`), en vivo.
import { Link } from "@tanstack/react-router";
import { ArrowRight, MapPinOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMapDemand } from "@/hooks/use-live-map";
import { demandHeadline } from "@/lib/liveMap";
import { displayCity, unplacedDemand } from "@/lib/proMapDemand";

export function UnplacedDemandList({ limit = 6 }: { limit?: number }) {
  const q = useMapDemand({ authed: true });
  const list = q.data ? unplacedDemand(q.data).slice(0, limit) : [];
  if (list.length === 0) return null;

  return (
    <section aria-label="Solicitudes sin ubicación en el mapa" data-testid="unplaced-demand" className="mt-4 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MapPinOff className="h-4 w-4 text-muted-foreground" aria-hidden />
        También buscan profesional (sin ubicación en el mapa)
      </h3>
      <ul className="grid grid-cols-1 gap-2">
        {list.map((d) => {
          const city = displayCity(d.city);
          return (
            <li key={`${d.kind}-${d.id}`} className="min-w-0">
              <Card className="flex items-center gap-3 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl" aria-hidden>
                  {d.kind === "institution" ? "🏥" : "🏠"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {d.kind === "institution" ? d.name : `Familia ${d.name}`}
                    {d.urgent && (
                      <span className="ml-2 rounded-full bg-sos/10 px-2 py-0.5 text-[10px] font-semibold text-sos">
                        Urgente
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {demandHeadline(d)} · {city ?? "Lugar a convenir"}
                  </p>
                </div>
                {d.offerId ? (
                  <Link
                    to="/oferta/$offerId"
                    params={{ offerId: d.offerId }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    Ver <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                ) : (
                  <Link
                    to="/dashboard/profesional"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    Ver <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
