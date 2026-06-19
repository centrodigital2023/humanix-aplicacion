import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, XCircle, Handshake, Loader2, Clock, User, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TrustProfileCard } from "./TrustProfileCard";

const sb = supabase as unknown as SupabaseClient;

type Proposal = {
  id: string;
  family_user_id: string;
  professional_id: string;
  family_need_id: string | null;
  availability_slot_id: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate: number;
  proposed_by: "family" | "professional";
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  message: string | null;
  decision_note: string | null;
  booking_id: string | null;
  created_at: string;
};

type PeerProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

const PLATFORM_FEE_PCT = 15;

export function ProposalsInbox({
  userId,
  role,
}: {
  userId: string;
  role: "family" | "professional";
}) {
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [peers, setPeers] = useState<Record<string, PeerProfile>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      const filter = role === "family" ? `family_user_id=eq.${userId}` : `professional_id=eq.${userId}`;
      const { data } = await sb
        .from("slot_proposals")
        .select(
          "id, family_user_id, professional_id, family_need_id, availability_slot_id, starts_at, ends_at, hourly_rate, proposed_by, status, message, decision_note, booking_id, created_at",
        )
        .or(filter)
        .order("created_at", { ascending: false })
        .limit(40);
      if (!active) return;
      const list = (data ?? []) as Proposal[];
      setProposals(list);

      const peerIds = Array.from(
        new Set(list.map((p) => (role === "family" ? p.professional_id : p.family_user_id))),
      );
      if (peerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", peerIds);
        if (!active) return;
        const map: Record<string, PeerProfile> = {};
        (profs ?? []).forEach((p) => {
          map[p.id] = p as PeerProfile;
        });
        setPeers(map);
      }
      setLoading(false);
    }
    load();

    const filterCol = role === "family" ? `family_user_id=eq.${userId}` : `professional_id=eq.${userId}`;
    const channel = sb
      .channel(`proposals_inbox_${role}_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slot_proposals", filter: filterCol },
        () => load(),
      )
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, [userId, role]);

  const incoming = proposals.filter((p) =>
    role === "family" ? p.proposed_by === "professional" : p.proposed_by === "family",
  );
  const outgoing = proposals.filter((p) =>
    role === "family" ? p.proposed_by === "family" : p.proposed_by === "professional",
  );
  const list = tab === "incoming" ? incoming : outgoing;

  async function accept(p: Proposal) {
    setBusyId(p.id);
    try {
      const durationMs = new Date(p.ends_at).getTime() - new Date(p.starts_at).getTime();
      const duration_hours = Math.max(1, Math.round(durationMs / 3_600_000));
      const total_amount = p.hourly_rate * duration_hours;
      const platform_fee_amount = Math.round((total_amount * PLATFORM_FEE_PCT) / 100);
      const professional_payout = total_amount - platform_fee_amount;

      const { data: booking, error: berr } = await supabase
        .from("service_bookings")
        .insert({
          client_id: p.family_user_id,
          professional_id: p.professional_id,
          status: "confirmed",
          scheduled_at: p.starts_at,
          duration_hours,
          hourly_rate: p.hourly_rate,
          total_amount,
          platform_fee_pct: PLATFORM_FEE_PCT,
          platform_fee_amount,
          professional_payout,
          payment_mode: "pending",
        })
        .select()
        .single();
      if (berr) throw berr;

      const { error: perr } = await sb
        .from("slot_proposals")
        .update({ status: "accepted", booking_id: booking.id })
        .eq("id", p.id);
      if (perr) throw perr;

      // Mark pro slot as busy so otras familias lo vean como ocupado
      if (p.availability_slot_id) {
        await sb.from("availability_slots").update({ status: "busy" }).eq("id", p.availability_slot_id);
      } else {
        // No slot linkeado: crear uno busy
        await sb.from("availability_slots").insert({
          user_id: p.professional_id,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
          status: "busy",
        });
      }

      // Mark family_need as matched
      if (p.family_need_id) {
        await sb.from("family_needs").update({ status: "matched" }).eq("id", p.family_need_id);
      }

      // Auto-rechazar otras propuestas solapadas
      await sb
        .from("slot_proposals")
        .update({ status: "cancelled", decision_note: "Horario ya cubierto" })
        .eq("status", "pending")
        .neq("id", p.id)
        .eq("starts_at", p.starts_at)
        .or(
          p.family_need_id
            ? `family_need_id.eq.${p.family_need_id}`
            : `availability_slot_id.eq.${p.availability_slot_id ?? "00000000-0000-0000-0000-000000000000"}`,
        );

      toast.success("¡Acuerdo cerrado! Reserva creada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error aceptando propuesta");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(p: Proposal) {
    setBusyId(p.id);
    try {
      const { error } = await sb
        .from("slot_proposals")
        .update({ status: "rejected", decision_note: "Rechazada por el usuario" })
        .eq("id", p.id);
      if (error) throw error;
      toast.success("Propuesta rechazada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error rechazando propuesta");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(p: Proposal) {
    setBusyId(p.id);
    try {
      const { error } = await sb.from("slot_proposals").update({ status: "cancelled" }).eq("id", p.id);
      if (error) throw error;
      toast.success("Propuesta cancelada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error cancelando");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <Handshake className="h-4 w-4 text-fuchsia-neural" />
            Propuestas de trabajo
          </p>
          <p className="text-[11px] text-muted-foreground">
            {incoming.filter((p) => p.status === "pending").length} por decidir ·{" "}
            {outgoing.filter((p) => p.status === "pending").length} enviadas
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab("incoming")}
            className={`px-3 py-1 rounded-md transition-colors ${
              tab === "incoming" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Para ti ({incoming.filter((p) => p.status === "pending").length})
          </button>
          <button
            type="button"
            onClick={() => setTab("outgoing")}
            className={`px-3 py-1 rounded-md transition-colors ${
              tab === "outgoing" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Enviadas
          </button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {tab === "incoming" ? "Sin propuestas por decidir" : "Aún no has enviado propuestas"}
          </div>
        ) : (
          list.map((p) => {
            const peerId = role === "family" ? p.professional_id : p.family_user_id;
            const peer = peers[peerId];
            const start = new Date(p.starts_at);
            const end = new Date(p.ends_at);
            const hours = Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000));
            const total = p.hourly_rate * hours;
            const statusColor =
              p.status === "pending"
                ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
                : p.status === "accepted"
                  ? "bg-green-600/10 text-green-700 border-green-600/30"
                  : p.status === "rejected"
                    ? "bg-rose-500/10 text-rose-700 border-rose-500/30"
                    : "bg-muted text-muted-foreground border-border";
            return (
              <div key={p.id} className="p-4 border-b border-border/50 last:border-b-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                  {peer?.avatar_url ? (
                    <img src={peer.avatar_url} alt={peer.full_name ?? ""} className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {peer?.full_name ?? (role === "family" ? "Profesional" : "Familia")}
                  </p>
                  <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {start.toLocaleString("es-CO", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {hours} h · ${total.toLocaleString("es-CO")}
                  </p>
                </div>
                <Badge variant="outline" className={`text-[10px] capitalize ${statusColor}`}>
                  {p.status === "pending"
                    ? "Pendiente"
                    : p.status === "accepted"
                      ? "Aceptada"
                      : p.status === "rejected"
                        ? "Rechazada"
                        : p.status === "cancelled"
                          ? "Cancelada"
                          : "Expirada"}
                </Badge>
                <Button
                  size="sm"
                  variant={expanded === p.id ? "secondary" : "ghost"}
                  onClick={() => setExpanded((e) => (e === p.id ? null : p.id))}
                  title="Ver perfil de confianza"
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
                {p.status === "pending" && tab === "incoming" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => accept(p)}
                      disabled={busyId === p.id}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {busyId === p.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      )}
                      Aceptar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reject(p)} disabled={busyId === p.id}>
                      <XCircle className="h-3 w-3 mr-1" /> Rechazar
                    </Button>
                  </div>
                ) : p.status === "pending" && tab === "outgoing" ? (
                  <Button size="sm" variant="ghost" onClick={() => cancel(p)} disabled={busyId === p.id}>
                    Cancelar
                  </Button>
                ) : p.status === "accepted" && p.booking_id ? (
                  <Button asChild size="sm" variant="outline">
                    <Link to="/servicio/$bookingId" params={{ bookingId: p.booking_id }}>
                      Ver servicio
                    </Link>
                  </Button>
                ) : null}
                </div>
                {expanded === p.id ? (
                  <div className="mt-3">
                    <TrustProfileCard
                      userId={peerId}
                      role={role === "family" ? "professional" : "family"}
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
