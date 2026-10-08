import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus, Users } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;
const emailSchema = z.string().trim().email().max(254);

type Member = {
  id: string;
  owner_id: string;
  invited_email: string;
  relation: string | null;
  status: "invited" | "accepted" | "declined";
  member_id: string | null;
};
type SharedBooking = { id: string; status: string; scheduled_at: string; duration_hours: number };

const STATUS_TEXT: Record<Member["status"], string> = {
  invited: "Invitación enviada",
  accepted: "Activo",
  declined: "Rechazada",
};

export function CareCirclePanel({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<SharedBooking[]>([]);

  const load = useCallback(async () => {
    const { data } = await sb
      .from("care_circle_members")
      .select("*")
      .order("created_at", { ascending: false });
    const all = (data ?? []) as Member[];
    setMembers(all);
    const circlesIBelongTo = all.filter((m) => m.member_id === userId && m.status === "accepted");
    if (circlesIBelongTo.length) {
      const { data: b } = await sb
        .from("service_bookings")
        .select("id,status,scheduled_at,duration_hours")
        .in(
          "client_id",
          circlesIBelongTo.map((m) => m.owner_id),
        )
        .order("scheduled_at", { ascending: false })
        .limit(20);
      setShared((b ?? []) as SharedBooking[]);
    } else {
      setShared([]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = members.filter((m) => m.owner_id === userId);
  const invitationsForMe = members.filter(
    (m) =>
      m.owner_id !== userId &&
      m.status === "invited" &&
      m.invited_email.toLowerCase() === userEmail.toLowerCase(),
  );

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Escribe un correo válido");
      return;
    }
    if (parsed.data.toLowerCase() === userEmail.toLowerCase()) {
      toast.error("No puedes invitarte a ti mismo");
      return;
    }
    setBusy(true);
    const { error } = await sb.from("care_circle_members").insert({
      owner_id: userId,
      invited_email: parsed.data,
      relation: relation.trim().slice(0, 40) || null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.code === "23505" ? "Ya invitaste a esta persona" : "No se pudo enviar la invitación",
      );
      return;
    }
    setEmail("");
    setRelation("");
    toast.success("Invitación creada");
    void load();
  };

  const remove = async (id: string) => {
    const { error } = await sb.from("care_circle_members").delete().eq("id", id);
    if (error) toast.error("No se pudo quitar");
    else void load();
  };

  const respond = async (id: string, accept: boolean) => {
    const { error } = await sb.rpc("respond_circle_invitation", { p_id: id, p_accept: accept });
    if (error) toast.error("No se pudo responder la invitación");
    else {
      toast.success(accept ? "Ahora ves los servicios de este círculo" : "Invitación rechazada");
      void load();
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-biosensor" />
        <h2 className="font-display text-lg font-bold">Círculo de cuidado</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Invita a familiares para que vean el estado de tus servicios. Solo pueden consultar; no
        pueden cambiar nada ni ver pagos.
      </p>

      {invitationsForMe.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <span>Te invitaron a un círculo de cuidado.</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => respond(m.id, true)}>
              Aceptar
            </Button>
            <Button size="sm" variant="outline" onClick={() => respond(m.id, false)}>
              Rechazar
            </Button>
          </span>
        </div>
      ))}

      <form onSubmit={invite} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
        <Input
          type="email"
          required
          placeholder="correo@familiar.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Correo del familiar"
        />
        <Input
          placeholder="Parentesco"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
          maxLength={40}
          aria-label="Parentesco"
        />
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <UserPlus className="h-4 w-4 mr-1.5" /> Invitar
            </>
          )}
        </Button>
      </form>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : mine.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aún no has invitado a nadie.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {mine.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                {m.invited_email}
                {m.relation ? <span className="text-muted-foreground"> · {m.relation}</span> : null}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {STATUS_TEXT[m.status]}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove(m.id)}
                  aria-label="Quitar del círculo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {shared.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Servicios de círculos a los que perteneces</h3>
          <ul className="mt-2 divide-y divide-border text-xs">
            {shared.map((b) => (
              <li key={b.id} className="flex justify-between py-1.5">
                <span>
                  {new Date(b.scheduled_at).toLocaleString("es-CO", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {b.duration_hours} h
                </span>
                <span className="text-muted-foreground">{b.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
