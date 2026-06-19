import { useEffect, useState } from "react";
import { Loader2, Sparkles, MapPin, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Offer = {
  id: string;
  title: string;
  description: string | null;
  city: string;
  modality: "hour" | "shift" | "month" | "package";
  amount: number;
  specialty_required: string | null;
};

type Match = { offer_id: string; similarity: number };

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const labelModality = (m: Offer["modality"]) =>
  m === "hour" ? "Hora" : m === "shift" ? "Turno" : m === "month" ? "Mes" : "Paquete";

export function SemanticOffers({
  userId,
  appliedIds,
  onApply,
}: {
  userId: string;
  appliedIds: Set<string>;
  onApply: (id: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [hasFingerprint, setHasFingerprint] = useState(false);
  const [items, setItems] = useState<{ offer: Offer; similarity: number }[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data: emb } = await supabase
        .from("profile_embeddings")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!emb) {
        if (active) {
          setHasFingerprint(false);
          setItems([]);
          setLoading(false);
        }
        return;
      }
      if (!active) return;
      setHasFingerprint(true);

      const { data: matchRows } = await supabase.rpc("match_offers_for_professional", {
        _user_id: userId,
        _match_count: 8,
        _min_similarity: 0.4,
      });
      const matches = (matchRows ?? []) as Match[];
      if (matches.length === 0) {
        if (active) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const ids = matches.map((m) => m.offer_id);
      const { data: offerRows } = await supabase
        .from("job_offers")
        .select("id, title, description, city, modality, amount, specialty_required")
        .in("id", ids)
        .eq("status", "open");
      const byId = new Map((offerRows ?? []).map((o) => [o.id, o as Offer]));
      const merged = matches
        .map((m) => {
          const o = byId.get(m.offer_id);
          return o ? { offer: o, similarity: m.similarity } : null;
        })
        .filter(Boolean) as { offer: Offer; similarity: number }[];
      if (active) {
        setItems(merged);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando matches semánticos…
      </div>
    );
  }

  if (!hasFingerprint) {
    return (
      <p className="text-sm text-muted-foreground">
        Genera tu <span className="font-semibold text-foreground">Huella IA</span> arriba para ver
        ofertas que encajan contigo por significado, no solo por palabras clave.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay ofertas suficientemente afines. Te avisaremos en cuanto aparezcan.
      </p>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {items.map(({ offer: o, similarity }) => {
        const applied = appliedIds.has(o.id);
        const score = Math.round(similarity * 100);
        return (
          <article
            key={o.id}
            className="rounded-xl border border-fuchsia-neural/30 bg-fuchsia-neural/5 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate">{o.title}</h3>
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural border border-fuchsia-neural/30">
                    <Sparkles className="h-3 w-3" /> Afinidad {score}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {o.city}
                  {o.specialty_required && ` · ${o.specialty_required}`}
                </p>
                {o.description && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{o.description}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-sm font-semibold inline-flex items-center gap-2">
                {COP(o.amount)}
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> {labelModality(o.modality)}
                </span>
              </p>
              <Button
                size="sm"
                variant={applied ? "glass" : "hero"}
                disabled={applied}
                onClick={() => onApply(o.id)}
              >
                {applied ? "Aplicada" : "Aplicar"}
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
