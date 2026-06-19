import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Handshake, Loader2, Clock, MapPin, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TrustProfileCard } from "./TrustProfileCard";

const sb = supabase as unknown as SupabaseClient;

type Need = {
  id: string;
  family_user_id: string;
  starts_at: string;
  ends_at: string;
  hourly_rate: number;
  status: "open" | "matched" | "cancelled" | "expired";
  service_address: string | null;
  notes: string | null;
  care_type: string | null;
};

type Fam = { id: string; full_name: string | null; avatar_url: string | null };

export function OpenFamilyNeedsList({ professionalId }: { professionalId: string }) {
  const [loading, setLoading] = useState(true);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [families, setFamilies] = useState<Record<string, Fam>>({});
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const { data } = await sb
        .from("family_needs")
        .select("id, family_user_id, starts_at, ends_at, hourly_rate, status, service_address, notes, care_type")
        .eq("status", "open")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(30);
      if (!active) return;
      const list = (data ?? []) as Need[];
      setNeeds(list);

      const famIds = Array.from(new Set(list.map((n) => n.family_user_id)));
      if (famIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", famIds);
        if (!active) return;
        const map: Record<string, Fam> = {};
        (profs ?? []).forEach((p) => {
          map[p.id] = p as Fam;
        });
        setFamilies(map);
      }

      // Already applied proposals for this pro
      const { data: props } = await sb
        .from("slot_proposals")
        .select("family_need_id")
        .eq("professional_id", professionalId)
        .in("status", ["pending", "accepted"]);
      if (!active) return;
      setApplied(new Set((props ?? []).map((p) => (p as { family_need_id: string }).family_need_id)));
      setLoading(false);
    }
    load();

    const channel = sb
      .channel(`open_needs_${professionalId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "family_needs" }, () => load())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slot_proposals", filter: `professional_id=eq.${professionalId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, [professionalId]);

  async function apply(n: Need) {
    setBusyId(n.id);
    try {
      const { error } = await sb.from("slot_proposals").insert({
        family_user_id: n.family_user_id,
        professional_id: professionalId,
        family_need_id: n.id,
        starts_at: n.starts_at,
        ends_at: n.ends_at,
        hourly_rate: n.hourly_rate,
        proposed_by: "professional",
        status: "pending",
      });
      if (error) throw error;
      setApplied((s) => new Set(s).add(n.id));
      toast.success("Postulación enviada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error postulando");
    } finally {
      setBusyId(null);
    }
  }

  const visible = needs.filter((n) => !applied.has(n.id));

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border">
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Heart className="h-4 w-4 text-blue-500" />
          Familias buscando ayuda ahora
        </p>
        <p className="text-[11px] text-muted-foreground">
          {visible.length} necesidades abiertas · postúlate y la familia decide
        </p>
      </div>
      <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Buscando…
          </div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            Sin necesidades abiertas. Mantén tu agenda al día para recibir solicitudes directas.
          </div>
        ) : (
          visible.map((n) => {
            const fam = families[n.family_user_id];
            const start = new Date(n.starts_at);
            const end = new Date(n.ends_at);
            const hours = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000));
            const total = n.hourly_rate * hours;
            return (
              <div key={n.id} className="p-4 border-b border-border/50 last:border-b-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {fam?.full_name ?? "Familia Humanix"}
                  </p>
                  <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {start.toLocaleString("es-CO", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {" · "}
                    {hours} h · ${total.toLocaleString("es-CO")}
                  </p>
                  {n.service_address ? (
                    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {n.service_address}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant={expanded === n.id ? "secondary" : "outline"}
                  onClick={() => setExpanded((e) => (e === n.id ? null : n.id))}
                >
                  <Info className="h-3 w-3 mr-1" /> Perfil
                </Button>
                <Button size="sm" onClick={() => apply(n)} disabled={busyId === n.id}>
                  {busyId === n.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Handshake className="h-3 w-3 mr-1" />
                  )}
                  Postularme
                </Button>
                </div>
                {expanded === n.id ? (
                  <div className="mt-3">
                    <TrustProfileCard
                      userId={n.family_user_id}
                      role="family"
                      highlightAddress={n.service_address}
                      compact
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
