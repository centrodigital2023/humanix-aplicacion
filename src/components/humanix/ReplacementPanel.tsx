import { useEffect, useState } from "react";
import { Heart, Loader2, Star } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;

type Candidate = {
  user_id: string; full_name: string | null; avatar_url: string | null; specialty: string | null;
  hourly_rate: number | null; avg_rating: number | null; total_jobs: number | null; is_favorite: boolean;
};

interface Props {
  bookingId: string;
  clientId: string;
  scheduledAt: string;
  durationHours: number;
  hourlyRate: number;
}

export function ReplacementPanel({ bookingId, clientId, scheduledAt, durationHours, hourlyRate }: Props) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    sb.rpc("find_replacement_candidates", { p_booking_id: bookingId }).then(({ data, error }) => {
      if (!active) return;
      if (error) toast.error("No se pudieron buscar reemplazos");
      setCandidates((data ?? []) as Candidate[]);
    });
    return () => {
      active = false;
    };
  }, [bookingId]);

  const propose = async (c: Candidate) => {
    setBusy(c.user_id);
    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + durationHours * 3_600_000);
    const { error } = await sb.from("slot_proposals").insert({
      family_user_id: clientId,
      professional_id: c.user_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      hourly_rate: c.hourly_rate ?? hourlyRate,
      proposed_by: "family",
      message: "Reemplazo para un servicio cancelado. ¿Puedes cubrir este horario?",
    });
    setBusy(null);
    if (error) {
      toast.error("No se pudo enviar la propuesta");
      return;
    }
    setSent((s) => new Set(s).add(c.user_id));
    toast.success("Propuesta enviada. Te avisaremos cuando responda.");
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">Reemplazo disponible para el mismo horario</h2>
      <p className="text-xs text-muted-foreground mt-1">
        Profesionales publicados, sin servicios que se crucen. Tus favoritos aparecen primero.
      </p>
      {candidates === null ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
        </div>
      ) : candidates.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No encontramos profesionales libres en ese horario por ahora.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {candidates.map((c) => (
            <li key={c.user_id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {c.full_name ?? "Profesional"}
                  {c.is_favorite && <Heart className="inline h-3.5 w-3.5 ml-1 fill-current text-fuchsia-neural" aria-label="Favorito" />}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.specialty ?? "Salud"}
                  {c.avg_rating ? <> · <Star className="inline h-3 w-3 fill-amber-400 text-amber-400" /> {Number(c.avg_rating).toFixed(1)}</> : null}
                  {c.total_jobs ? ` · ${c.total_jobs} servicios` : ""}
                </p>
              </div>
              <Button size="sm" disabled={busy === c.user_id || sent.has(c.user_id)} onClick={() => propose(c)}>
                {sent.has(c.user_id) ? "Enviada" : "Proponer"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
