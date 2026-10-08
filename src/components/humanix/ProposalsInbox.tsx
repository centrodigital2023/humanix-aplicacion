import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Clock,
  Handshake,
  History,
  Info,
  Loader2,
  Lock,
  MessageSquareQuote,
  Repeat2,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hubKeys } from "@/hooks/use-opportunity-feed";
import { usePlan } from "@/hooks/use-plan";
import {
  classifyHubError,
  estimatedTotal,
  formatShiftRange,
  hoursBetween,
} from "@/lib/opportunities";
import {
  isExpired,
  respondOptions,
  roundLabel,
  timeLeftLabel,
  type NegotiationRole,
  type ProposalStatus,
} from "@/lib/negotiation";
import { formatCOP } from "@/lib/pricing";
import { FREE_COMMISSION_PCT } from "@/lib/proIncome";
import { cn } from "@/lib/utils";
import { CounterOfferDialog } from "./hub/CounterOfferDialog";
import { PriceBreakdownCard } from "./PriceBreakdownCard";
import { TrustProfileCard } from "./TrustProfileCard";

const sb = supabase as unknown as SupabaseClient;

interface ProposalRow {
  id: string;
  family_user_id: string;
  professional_id: string;
  family_need_id: string | null;
  starts_at: string;
  ends_at: string;
  hourly_rate: number;
  proposed_by: NegotiationRole;
  status: ProposalStatus;
  message: string | null;
  decision_note: string | null;
  booking_id: string | null;
  created_at: string;
  round_no: number;
  parent_proposal_id: string | null;
  posted_rate: number | null;
  expires_at: string | null;
  peer_id: string | null;
  peer_name: string | null;
  peer_avatar: string | null;
  peer_city: string | null;
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  expired: "Vencida",
  countered: "Con contraoferta",
};

const STATUS_STYLE: Record<ProposalStatus, string> = {
  pending: "border-warn/40 bg-warn/10 text-warn",
  accepted: "border-ok/40 bg-ok/10 text-ok",
  rejected: "border-sos/40 bg-sos/10 text-sos",
  cancelled: "border-border bg-muted text-muted-foreground",
  expired: "border-border bg-muted text-muted-foreground",
  countered: "border-border bg-muted text-muted-foreground",
};

/** Cadena de ofertas hacia atrás: oferta inicial → … → anterior a la actual. */
function ancestorsOf(row: ProposalRow, byId: Map<string, ProposalRow>): ProposalRow[] {
  const chain: ProposalRow[] = [];
  let cursor = row.parent_proposal_id ? byId.get(row.parent_proposal_id) : undefined;
  while (cursor && chain.length < 5) {
    chain.unshift(cursor);
    cursor = cursor.parent_proposal_id ? byId.get(cursor.parent_proposal_id) : undefined;
  }
  return chain;
}

export function ProposalsInbox({ userId, role }: { userId: string; role: NegotiationRole }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePlan(userId);
  const [tab, setTab] = useState<"incoming" | "outgoing">("incoming");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [countering, setCountering] = useState<ProposalRow | null>(null);
  // Para refrescar las cuentas regresivas sin pedir datos otra vez.
  const [now, setNow] = useState(() => Date.now());

  const key = hubKeys.proposals(userId);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await sb.rpc("my_slot_proposals", { p_limit: 80 });
      if (error) throw error;
      return (data ?? []) as ProposalRow[];
    },
  });

  useEffect(() => {
    const filterCol =
      role === "family" ? `family_user_id=eq.${userId}` : `professional_id=eq.${userId}`;
    const channel = sb
      .channel(`proposals_inbox_${role}_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "slot_proposals", filter: filterCol },
        () => void qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(tick);
      void sb.removeChannel(channel);
    };
  }, [role, userId, qc, key]);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  // Las ofertas superadas («countered») son historial: solo se muestra la vigente de cada negociación.
  const heads = useMemo(() => rows.filter((r) => r.status !== "countered"), [rows]);
  const isIncoming = (r: ProposalRow) => r.proposed_by !== role;
  const incoming = heads.filter(isIncoming);
  const outgoing = heads.filter((r) => !isIncoming(r));
  const list = tab === "incoming" ? incoming : outgoing;
  const live = (r: ProposalRow) => r.status === "pending" && !isExpired(r, now);

  const commissionPct = role === "professional" && !can("no_commission") ? FREE_COMMISSION_PCT : 0;
  const canNegotiate = role === "family" || can("negotiate_rate");

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["hub", "needs", userId] });
  };

  const accept = useMutation({
    mutationFn: async (p: ProposalRow) => {
      // Precio, comisión, reserva y estados se resuelven atómicamente en el servidor.
      const { error } = await sb.rpc("accept_slot_proposal", { p_proposal_id: p.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("¡Acuerdo cerrado! Reserva creada.");
      refreshAll();
    },
    onError: (e) => toast.error(classifyHubError(e as { message?: string }).message),
  });

  const setStatus = useMutation({
    mutationFn: async ({
      p,
      status,
      note,
    }: {
      p: ProposalRow;
      status: "rejected" | "cancelled";
      note?: string;
    }) => {
      const { error } = await sb
        .from("slot_proposals")
        .update({ status, ...(note ? { decision_note: note } : {}) })
        .eq("id", p.id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === "rejected" ? "Propuesta rechazada" : "Propuesta retirada");
      refreshAll();
    },
    onError: (e) => toast.error(classifyHubError(e as { message?: string }).message),
  });

  const busyId =
    (accept.isPending && accept.variables?.id) ||
    (setStatus.isPending && setStatus.variables?.p.id) ||
    null;

  const counterTarget = countering
    ? (() => {
        const mine = [...ancestorsOf(countering, byId)]
          .reverse()
          .find((a) => a.proposed_by === role);
        return {
          id: countering.id,
          hourly_rate: countering.hourly_rate,
          posted_rate: countering.posted_rate,
          round_no: countering.round_no,
          my_last_offer: mine?.hourly_rate ?? null,
          peer_city: role === "professional" ? countering.peer_city : null,
        };
      })()
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold">
            <Handshake className="h-4 w-4 text-fuchsia-neural" aria-hidden />
            Propuestas y negociación
          </p>
          <p className="text-[11px] text-muted-foreground">
            {incoming.filter(live).length} por responder · {outgoing.filter(live).length} enviadas
            esperando
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-xs" role="tablist">
          {(
            [
              ["incoming", `Para ti (${incoming.filter(live).length})`],
              ["outgoing", "Enviadas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1 transition-colors",
                tab === id ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border">
        {query.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden /> Cargando…
          </div>
        ) : query.error ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No pudimos cargar las propuestas.{" "}
            <button
              className="font-medium text-biosensor hover:underline"
              onClick={() => void query.refetch()}
            >
              Reintentar
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {tab === "incoming" ? "Sin propuestas por responder" : "Aún no has enviado propuestas"}
          </div>
        ) : (
          list.map((p) => {
            const hours = Math.max(1, hoursBetween(p.starts_at, p.ends_at));
            const total = estimatedTotal(p.hourly_rate, hours) ?? 0;
            const expired = p.status === "pending" && isExpired(p, now);
            const options = respondOptions(
              {
                status: p.status,
                proposed_by: p.proposed_by,
                round: p.round_no,
                expires_at: p.expires_at,
              },
              role,
              now,
            );
            const chain = ancestorsOf(p, byId);
            const delta =
              p.posted_rate && p.posted_rate !== p.hourly_rate
                ? Math.round(((p.hourly_rate - p.posted_rate) / p.posted_rate) * 100)
                : null;
            const left = live(p) ? timeLeftLabel(p.expires_at, now) : null;
            const status: ProposalStatus = expired ? "expired" : p.status;
            const busy = busyId === p.id;

            return (
              <div key={p.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                    {p.peer_avatar ? (
                      <img src={p.peer_avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 truncate text-sm font-semibold">
                      {p.peer_name ?? (role === "family" ? "Profesional" : "Familia")}
                      {p.round_no > 1 && (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <Repeat2 className="h-3 w-3" aria-hidden /> {roundLabel(p.round_no)}
                        </Badge>
                      )}
                    </p>
                    <p className="inline-flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden />{" "}
                      {formatShiftRange(p.starts_at, p.ends_at)} ·{" "}
                      <strong className="text-foreground">{formatCOP(p.hourly_rate)}/h</strong> ·{" "}
                      {formatCOP(total)}
                      {delta != null && (
                        <span className={delta > 0 ? "text-warn" : "text-ok"}>
                          ({delta > 0 ? "+" : ""}
                          {delta}% vs publicado {formatCOP(p.posted_rate ?? 0)})
                        </span>
                      )}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLE[status])}>
                    {STATUS_LABEL[status]}
                  </Badge>
                </div>

                {p.message && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                    <MessageSquareQuote
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    {p.message}
                  </p>
                )}
                {left && <p className="text-[11px] font-medium text-warn">{left}</p>}
                {options.reason && live(p) && (
                  <p className="text-[11px] text-muted-foreground">{options.reason}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {options.accept && (
                    <Button
                      size="sm"
                      className="bg-ok text-ok-foreground hover:bg-ok/90"
                      onClick={() => accept.mutate(p)}
                      disabled={busy}
                    >
                      {busy && accept.isPending ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                      )}
                      Aceptar {formatCOP(p.hourly_rate)}/h
                    </Button>
                  )}
                  {options.counter &&
                    (canNegotiate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCountering(p)}
                        disabled={busy}
                      >
                        <Repeat2 className="mr-1 h-3 w-3" aria-hidden /> Contraofertar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          toast.info("Negociar el valor está disponible desde el plan Esencial", {
                            action: {
                              label: "Ver planes",
                              onClick: () => void navigate({ to: "/planes" }),
                            },
                          });
                        }}
                      >
                        <Lock className="mr-1 h-3 w-3" aria-hidden /> Contraofertar (Esencial)
                      </Button>
                    ))}
                  {options.reject && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setStatus.mutate({
                          p,
                          status: "rejected",
                          note: "Rechazada por el usuario",
                        })
                      }
                      disabled={busy}
                    >
                      <XCircle className="mr-1 h-3 w-3" aria-hidden /> Rechazar
                    </Button>
                  )}
                  {options.withdraw && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus.mutate({ p, status: "cancelled" })}
                      disabled={busy}
                    >
                      Retirar
                    </Button>
                  )}
                  {p.status === "accepted" && p.booking_id && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/servicio/$bookingId" params={{ bookingId: p.booking_id }}>
                        Ver servicio
                      </Link>
                    </Button>
                  )}
                  {chain.length > 0 && (
                    <Button
                      size="sm"
                      variant={history === p.id ? "secondary" : "ghost"}
                      onClick={() => setHistory((h) => (h === p.id ? null : p.id))}
                    >
                      <History className="mr-1 h-3.5 w-3.5" aria-hidden /> Historial (
                      {chain.length + 1})
                    </Button>
                  )}
                  {p.peer_id && (
                    <Button
                      size="sm"
                      variant={expanded === p.id ? "secondary" : "ghost"}
                      onClick={() => setExpanded((e) => (e === p.id ? null : p.id))}
                      aria-label="Ver perfil de confianza"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>

                {history === p.id && (
                  <ol className="space-y-1 rounded-lg border border-border p-3 text-xs">
                    {[...chain, p].map((step) => (
                      <li
                        key={step.id}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <span>
                          <strong>{roundLabel(step.round_no)}</strong> ·{" "}
                          {step.proposed_by === role ? "tú" : (step.peer_name ?? "la otra parte")}
                        </span>
                        <span className="tabular-nums">{formatCOP(step.hourly_rate)}/h</span>
                      </li>
                    ))}
                  </ol>
                )}

                {live(p) && (
                  <div className="max-w-xs">
                    <PriceBreakdownCard
                      hourlyRate={p.hourly_rate}
                      hours={hours}
                      professionalId={p.professional_id}
                      viewer={role === "professional" ? "professional" : "payer"}
                    />
                  </div>
                )}

                {expanded === p.id && p.peer_id && (
                  <TrustProfileCard
                    userId={p.peer_id}
                    role={role === "family" ? "professional" : "family"}
                    compact
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {countering && counterTarget && (
        <CounterOfferDialog
          key={countering.id}
          target={counterTarget}
          role={role}
          hours={Math.max(1, hoursBetween(countering.starts_at, countering.ends_at))}
          commissionPct={commissionPct}
          open
          onOpenChange={(o) => !o && setCountering(null)}
          onDone={refreshAll}
        />
      )}
    </div>
  );
}
