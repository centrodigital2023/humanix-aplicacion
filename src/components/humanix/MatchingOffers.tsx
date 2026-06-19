import { useEffect, useState } from "react";
import { Sparkles, Loader2, MapPin, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Offer = {
  id: string;
  title: string;
  description: string | null;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  city: string;
  specialty_required: string | null;
};

type Match = { offer_id: string; score: number; reason: string };

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function MatchingOffers({
  profile,
  offers,
  appliedIds,
  onApply,
}: {
  profile: Record<string, unknown> | null;
  offers: Offer[];
  appliedIds: Set<string>;
  onApply: (id: string) => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile || offers.length === 0) return;
    setLoading(true);
    (async () => {
      try {
        const slim = offers.slice(0, 20).map((o) => ({
          id: o.id,
          title: o.title,
          modality: o.modality,
          amount: o.amount,
          city: o.city,
          specialty_required: o.specialty_required,
          description: o.description?.slice(0, 200),
        }));
        const { data, error } = await supabase.functions.invoke("match-offers", {
          body: { profile, offers: slim },
        });
        if (error) throw error;
        setMatches((data?.matches ?? []) as Match[]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error matching IA");
      } finally {
        setLoading(false);
      }
    })();
  }, [profile, offers]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando ofertas que encajan contigo...
      </div>
    );
  }
  if (matches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay ofertas que encajen perfectamente. Te avisaremos cuando aparezcan.
      </p>
    );
  }

  const offerById = new Map(offers.map((o) => [o.id, o]));

  return (
    <div className="space-y-3">
      {matches.map((m) => {
        const o = offerById.get(m.offer_id);
        if (!o) return null;
        const applied = appliedIds.has(o.id);
        return (
          <article
            key={m.offer_id}
            className="rounded-xl border border-biosensor/30 bg-biosensor/5 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold">{o.title}</h3>
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/30">
                    <Sparkles className="h-3 w-3" /> Match {Math.round(m.score)}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {o.city}
                  {o.specialty_required && ` · ${o.specialty_required}`}
                </p>
                <p className="mt-2 text-sm">{m.reason}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{COP(o.amount)}</p>
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 justify-end">
                  <Briefcase className="h-3 w-3" />
                  {o.modality === "hour"
                    ? "Hora"
                    : o.modality === "shift"
                      ? "Turno"
                      : o.modality === "month"
                        ? "Mes"
                        : "Paquete"}
                </p>
                <Button
                  size="sm"
                  variant={applied ? "glass" : "hero"}
                  className="mt-2"
                  disabled={applied}
                  onClick={() => onApply(o.id)}
                >
                  {applied ? "Aplicada" : "Aplicar"}
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
