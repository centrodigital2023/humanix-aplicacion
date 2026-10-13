// «¿Me ven en el mapa?» para la familia: mientras tenga ofertas u horas abiertas, los profesionales cercanos ven su zona aproximada
// (~1 km) —nunca su dirección ni su teléfono— y la pueden atender. Aquí se ve si está visible ahora y se puede ocultar o volver a
// mostrar. El estado sale de la base (no se supone nada) y se actualiza en vivo.
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Eye, EyeOff, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";
import { liveMapKeys } from "@/hooks/use-live-map";
import { cn } from "@/lib/utils";

const sb = supabase as unknown as SupabaseClient;

const key = (uid: string) => ["family-map-visibility", uid] as const;

interface VisibilityState {
  visible: boolean;
  openOffers: number;
  openHours: number;
}

async function load(userId: string): Promise<VisibilityState> {
  const nowIso = new Date().toISOString();
  const [profile, offers, needs] = await Promise.all([
    sb.from("family_profiles").select("visible_on_map").eq("user_id", userId).maybeSingle(),
    sb
      .from("job_offers")
      .select("id", { count: "exact", head: true })
      .eq("posted_by", userId)
      .eq("status", "open"),
    sb
      .from("family_needs")
      .select("id", { count: "exact", head: true })
      .eq("family_user_id", userId)
      .eq("status", "open")
      .gt("ends_at", nowIso),
  ]);
  return {
    // Sin fila de perfil todavía: visible por defecto (igual que la base).
    visible: profile.data?.visible_on_map ?? true,
    openOffers: offers.count ?? 0,
    openHours: needs.count ?? 0,
  };
}

export function FamilyMapVisibility({ userId, className }: { userId: string; className?: string }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: key(userId), queryFn: () => load(userId), staleTime: 15_000 });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: key(userId) });
  }, [qc, userId]);
  useRealtimeRefresh(
    "family-map-visibility",
    [
      { table: "job_offers", filter: `posted_by=eq.${userId}` },
      { table: "family_needs", filter: `family_user_id=eq.${userId}` },
    ],
    refresh,
  );

  const toggle = useMutation({
    mutationFn: async (visible: boolean) => {
      const { error } = await sb
        .from("family_profiles")
        .upsert({ user_id: userId, visible_on_map: visible }, { onConflict: "user_id" });
      if (error) throw error;
      return visible;
    },
    onSuccess: (visible) => {
      toast.success(
        visible ? "Los profesionales cercanos pueden ver tu zona" : "Ya no apareces en el mapa",
      );
      refresh();
      void qc.invalidateQueries({ queryKey: liveMapKeys.all });
    },
    onError: () => toast.error("No se pudo cambiar. Inténtalo de nuevo."),
  });

  if (state.isLoading) return <Skeleton className={cn("h-24 w-full rounded-2xl", className)} />;
  if (!state.data) return null;

  const { visible, openOffers, openHours } = state.data;
  const hasOpen = openOffers + openHours > 0;
  const showing = visible && hasOpen;
  const open = [
    openOffers > 0 ? `${openOffers} ${openOffers === 1 ? "oferta" : "ofertas"}` : null,
    openHours > 0 ? `${openHours} ${openHours === 1 ? "hora abierta" : "horas abiertas"}` : null,
  ]
    .filter(Boolean)
    .join(" y ");

  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            showing ? "bg-ok/10 text-ok" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {showing
              ? "Los profesionales cercanos te ven en el mapa"
              : visible
                ? "Aparecerás en el mapa cuando publiques"
                : "No apareces en el mapa de los profesionales"}
            {showing && (
              <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-medium text-ok">
                <MapPin className="h-3 w-3" aria-hidden /> Visible ahora
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {showing
              ? `Por tus ${open} abiertas. Ven una zona aproximada (~1 km): nunca tu dirección ni tu teléfono.`
              : visible
                ? "Una oferta u horas abiertas en tu agenda te hacen visible en una zona aproximada (~1 km), sin tu dirección."
                : "Tus ofertas siguen avisando a los profesionales cercanos, pero tu zona no se muestra en el mapa."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Label htmlFor="fam-map-visible" className="text-xs text-muted-foreground">
          Aparecer en el mapa
        </Label>
        <Switch
          id="fam-map-visible"
          checked={visible}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      </div>
    </Card>
  );
}
