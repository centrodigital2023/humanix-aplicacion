import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Star, ArrowRight, Clock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  userId: string;
  /** family = user es el cliente; professional = user es el profesional */
  role: "family" | "professional";
};

type PendingRow = {
  booking_id: string;
  peer_name: string;
  completed_at: string | null;
  scheduled_at: string;
};

/**
 * Lista de servicios completados que aún no han sido calificados por el usuario actual.
 * - Familia califica al profesional, y viceversa.
 * - Lleva al detalle del servicio (/servicio/:id) donde vive el VoiceRating.
 */
export function PendingRatingsCard({ userId, role }: Props) {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      // 1. Bookings completados donde soy cliente o profesional.
      const idField = role === "family" ? "client_id" : "professional_id";
      const peerField = role === "family" ? "professional_id" : "client_id";
      const { data: bookings } = await supabase
        .from("service_bookings")
        .select(`id, ${peerField}, scheduled_at, completed_at`)
        .eq(idField, userId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(20);
      if (!active) return;
      const list = (bookings ?? []) as Array<{
        id: string;
        scheduled_at: string;
        completed_at: string | null;
      } & Record<string, string>>;
      if (list.length === 0) {
        setPending([]);
        setLoading(false);
        return;
      }
      const ids = list.map((b) => b.id);

      // 2. ¿Cuáles YA tienen rating de ESTE usuario?
      const { data: rated } = await supabase
        .from("service_ratings")
        .select("booking_id")
        .eq("rater_id", userId)
        .in("booking_id", ids);
      if (!active) return;
      const ratedSet = new Set((rated ?? []).map((r) => r.booking_id));

      const missing = list.filter((b) => !ratedSet.has(b.id));
      if (missing.length === 0) {
        setPending([]);
        setLoading(false);
        return;
      }

      // 3. Nombres de la contraparte.
      const peerIds = Array.from(new Set(missing.map((b) => b[peerField])));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", peerIds);
      if (!active) return;
      const nameMap = new Map<string, string>(
        (profiles ?? []).map((p) => [p.user_id, p.full_name ?? "Persona"]),
      );

      setPending(
        missing.map((b) => ({
          booking_id: b.id,
          peer_name: nameMap.get(b[peerField]) ?? "Tu contraparte",
          completed_at: b.completed_at,
          scheduled_at: b.scheduled_at,
        })),
      );
      setLoading(false);
    }
    load();

    const channel = supabase
      .channel(`pending-ratings-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_bookings" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "service_ratings" },
        load,
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, role]);

  if (loading || pending.length === 0) return null;

  const title =
    role === "family" ? "Califica a tu profesional" : "Califica a la familia";
  const hint =
    role === "family"
      ? "Cuéntanos cómo te fue con el profesional. Tu valoración mejora la confianza de toda la red."
      : "Tu valoración ayuda a otras familias a saber si son confiables y respetuosas.";

  return (
    <Card className="border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 shrink-0">
          <Star className="h-5 w-5 fill-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-display text-base font-semibold">{title}</p>
            <Badge className="bg-amber-500/20 text-amber-700 border-amber-500/30 text-xs">
              <Sparkles className="h-3 w-3 mr-0.5" /> {pending.length} pendiente
              {pending.length > 1 ? "s" : ""}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>
        </div>
      </div>

      <div className="space-y-2">
        {pending.slice(0, 4).map((p) => {
          const date = p.completed_at ?? p.scheduled_at;
          return (
            <div
              key={p.booking_id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.peer_name}</p>
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(date).toLocaleDateString("es-CO", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Button size="sm" variant="hero" asChild>
                <Link to="/servicio/$bookingId" params={{ bookingId: p.booking_id }}>
                  Calificar
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>

      {pending.length > 4 && (
        <p className="text-[11px] text-muted-foreground text-center">
          +{pending.length - 4} más pendientes
        </p>
      )}
    </Card>
  );
}
