import { useState } from "react";
import { Star } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RATING_DIMENSIONS, isCompleteScores, type RaterRole } from "@/lib/ratingDimensions";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;

interface Props {
  bookingId: string;
  raterId: string;
  ratedId: string;
  role: RaterRole;
  onSubmitted?: () => void;
}

export function DimensionRatingForm({ bookingId, raterId, ratedId, role, onSubmitted }: Props) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!isCompleteScores(role, scores)) {
      toast.error("Califica todas las dimensiones");
      return;
    }
    setBusy(true);
    const { error } = await sb.from("service_rating_dimensions").insert({
      booking_id: bookingId,
      rater_id: raterId,
      rated_id: ratedId,
      rater_role: role,
      scores,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Ya calificaste este servicio"
          : "No se pudo guardar la calificación",
      );
      if (error.code === "23505") setDone(true);
      return;
    }
    setDone(true);
    toast.success("Calificación registrada");
    onSubmitted?.();
  };

  if (done) {
    return (
      <p className="text-sm text-muted-foreground">
        Gracias, tu calificación por dimensiones quedó registrada.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <h3 className="font-semibold">Calificación detallada</h3>
      {RATING_DIMENSIONS[role].map((d) => (
        <div key={d.key} className="flex items-center justify-between gap-3">
          <span className="text-sm">{d.label}</span>
          <div className="flex gap-0.5" role="radiogroup" aria-label={d.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={scores[d.key] === n}
                aria-label={`${n} de 5`}
                onClick={() => setScores((s) => ({ ...s, [d.key]: n }))}
              >
                <Star
                  className={`h-6 w-6 ${(scores[d.key] ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
                />
              </button>
            ))}
          </div>
        </div>
      ))}
      <Button
        onClick={submit}
        disabled={busy || !isCompleteScores(role, scores)}
        className="w-full"
      >
        Guardar calificación
      </Button>
    </div>
  );
}
