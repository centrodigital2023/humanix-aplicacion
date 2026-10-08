import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OfferRow } from "@/lib/marketplaceInsights";
import { normalizeText } from "@/lib/pqrsRules";
import { ModerateDialog } from "./ModerateDialog";
import { OfferCard } from "./OfferCard";
import type { OfferInsight } from "./insights";

const sb = supabase as unknown as SupabaseClient;
const PAGE = 25;

type Filter = "attention" | "all" | "uncovered" | "risk" | "blocked" | "open";
type Sort = "attention" | "recent";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "attention", label: "Requieren atención" },
  { id: "uncovered", label: "Sin candidatos" },
  { id: "risk", label: "Con señales de riesgo" },
  { id: "open", label: "Abiertas" },
  { id: "blocked", label: "Bloqueadas" },
];

interface Props {
  offers: OfferRow[];
  insights: Map<string, OfferInsight>;
  search: string;
  now: number;
  onChanged: () => void;
}

export function OffersPanel({ offers, insights, search, now, onChanged }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("attention");
  const [limit, setLimit] = useState(PAGE);
  const [matchFor, setMatchFor] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<OfferRow | null>(null);

  const q = normalizeText(search);
  const searched = useMemo(
    () =>
      offers.filter(
        (o) =>
          !q ||
          normalizeText(
            `${o.title} ${o.city} ${o.specialty_required ?? ""} ${o.description ?? ""}`,
          ).includes(q),
      ),
    [offers, q],
  );

  const matches = (o: OfferRow, f: Filter) => {
    const i = insights.get(o.id);
    if (!i) return false;
    switch (f) {
      case "attention":
        return i.attention > 0;
      case "uncovered":
        return (
          o.status === "open" &&
          !o.blocked &&
          (i.coverage === "uncovered" || i.coverage === "urgent")
        );
      case "risk":
        return i.maxRisk === "high" || i.maxRisk === "medium";
      case "blocked":
        return !!o.blocked;
      case "open":
        return o.status === "open" && !o.blocked;
      default:
        return true;
    }
  };

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.id, searched.filter((o) => matches(o, f.id)).length]),
      ) as Record<Filter, number>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, insights],
  );

  const visible = useMemo(() => {
    const list = searched.filter((o) => matches(o, filter));
    return list.sort((a, b) =>
      sort === "attention"
        ? (insights.get(b.id)?.attention ?? 0) - (insights.get(a.id)?.attention ?? 0) ||
          b.created_at.localeCompare(a.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched, insights, filter, sort]);

  const run = async (action: "unblock" | "close", offer: OfferRow) => {
    if (
      action === "close" &&
      !window.confirm(`¿Cerrar la oferta «${offer.title}»? Dejará de recibir postulaciones.`)
    )
      return;
    const { error } = await sb.rpc("moderate_offer", { p_offer_id: offer.id, p_action: action });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(action === "unblock" ? "Oferta desbloqueada" : "Oferta cerrada");
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar ofertas">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
              aria-pressed={filter === f.id}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f.id
                  ? "border-biosensor bg-biosensor/10 text-biosensor"
                  : "border-border hover:bg-muted"
              }`}
            >
              {f.label} <span className="text-muted-foreground">({counts[f.id]})</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Ordenar por
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="attention">Prioridad de atención</option>
            <option value="recent">Más recientes</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {offers.length === 0
            ? "Aún no hay ofertas publicadas. Cuando familias o IPS/EPS publiquen, aparecerán aquí con su análisis."
            : "Ninguna oferta coincide con este filtro."}
        </Card>
      ) : (
        <>
          {visible.slice(0, limit).map((o) => {
            const insight = insights.get(o.id);
            if (!insight) return null;
            return (
              <OfferCard
                key={o.id}
                offer={o}
                insight={insight}
                now={now}
                matchOpen={matchFor === o.id}
                onToggleMatch={() => setMatchFor((cur) => (cur === o.id ? null : o.id))}
                onBlock={() => setBlocking(o)}
                onUnblock={() => run("unblock", o)}
                onClose={() => run("close", o)}
              />
            );
          })}
          {visible.length > limit && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar más ({visible.length - limit} restantes)
              </Button>
            </div>
          )}
        </>
      )}

      <ModerateDialog
        offer={blocking}
        onOpenChange={(open) => !open && setBlocking(null)}
        onDone={onChanged}
      />
    </div>
  );
}
