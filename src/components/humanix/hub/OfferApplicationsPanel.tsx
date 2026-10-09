import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BadgeDollarSign,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  Handshake,
  Loader2,
  Lock,
  PenLine,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyOfferApplications } from "@/hooks/use-institution-hub";
import { usePlan } from "@/hooks/use-plan";
import { SmartContractDialog } from "@/components/humanix/contracts/SmartContractDialog";
import {
  classifyHubError,
  formatShiftRange,
  hoursBetween,
  type ServerError,
} from "@/lib/opportunities";
import {
  applicationActions,
  applicationRoundLabel,
  describeAmount,
} from "@/lib/institutionNegotiation";
import {
  expiryLabel,
  headlineFor,
  needsMyAction,
  shiftsSummary,
  sortByUrgency,
  type MyApplication,
  type Tone,
} from "@/lib/institutionApplications";
import { formatCOP } from "@/lib/pricing";
import { FREE_COMMISSION_PCT } from "@/lib/proIncome";
import { cn } from "@/lib/utils";
import { OfferContactPanel } from "./OfferContactPanel";
import { OfferCounterDialog, type OfferCounterTarget } from "./OfferCounterDialog";

const sb = supabase as unknown as SupabaseClient;

const TONE_STYLE: Record<Tone, string> = {
  action: "bg-warn/15 text-warn",
  waiting: "bg-muted text-muted-foreground",
  ok: "bg-ok/15 text-ok",
  muted: "bg-muted text-muted-foreground",
  alert: "bg-sos/15 text-sos",
};

interface Props {
  userId: string;
  proName: string | null;
  /** Se llama cuando una acción cambia las reservas (para refrescar la agenda del panel). */
  onChanged?: () => void;
}

function ApplicationCard({
  app,
  userId,
  proName,
  onCounter,
  onOpenContract,
  onChanged,
}: {
  app: MyApplication;
  userId: string;
  proName: string | null;
  onCounter: (app: MyApplication, kind: "counter" | "revise") => void;
  onOpenContract: (contractId: string) => void;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { plan, can } = usePlan(userId);
  const canNegotiate = can("negotiate_rate");
  const headline = headlineFor(app, "professional", formatCOP);
  const actions = applicationActions(
    {
      status: app.status,
      awaiting: app.awaiting,
      round_no: app.round,
      expires_at: app.expiresAt,
    },
    "professional",
    { canNegotiate },
  );
  const expiry = app.status === "pending" ? expiryLabel(app.expiresAt) : null;
  const myAction = needsMyAction(app, "professional", app.iSigned);
  const firstShift = app.shifts[0];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["inst"] });
    onChanged?.();
  };

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await sb.rpc("accept_application", { p_application_id: app.id });
      if (error) throw error;
      return data as { booking_ids?: string[]; contract_id?: string | null } | null;
    },
    onSuccess: (result) => {
      toast.success("Aceptaste la propuesta", {
        description: result?.contract_id
          ? "La reserva quedó con la dirección y el contrato está listo para firmar."
          : "La reserva quedó confirmada con la dirección.",
      });
      refresh();
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("decline_application", {
        p_application_id: app.id,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        app.awaiting === "professional" ? "Rechazaste la contraoferta" : "Retiraste tu postulación",
      );
      refresh();
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const busy = accept.isPending || decline.isPending;
  const contractNeedsMe =
    app.status === "accepted" &&
    (app.contractStatus === "pending_signature" || app.contractStatus === "partially_signed") &&
    !app.iSigned;
  const shiftHint = firstShift
    ? `«${app.offerTitle}» (${formatShiftRange(firstShift.starts_at, firstShift.ends_at)})`
    : `«${app.offerTitle}»`;

  return (
    <Card className="space-y-3 p-4" aria-label={`Postulación a ${app.institutionName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            {app.institutionName}
            {app.city && (
              <span className="text-xs font-normal text-muted-foreground">· {app.city}</span>
            )}
          </p>
          <p className="mt-0.5 text-sm">{app.offerTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {shiftsSummary(app.shifts)}
            {firstShift ? ` · ${formatShiftRange(firstShift.starts_at, firstShift.ends_at)}` : ""}
          </p>
        </div>
        <Badge className={cn("border-0 text-[10px]", TONE_STYLE[headline.tone])}>
          {headline.title}
        </Badge>
      </div>

      {headline.detail && <p className="text-xs text-muted-foreground">{headline.detail}</p>}

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 p-2">
          <dt className="text-muted-foreground">Publicado</dt>
          <dd className="font-semibold tabular-nums">
            {describeAmount(app.posted, app.modality, formatCOP)}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 p-2">
          <dt className="text-muted-foreground">
            {app.awaiting === "professional" ? "Contraoferta" : "Tu propuesta"}
          </dt>
          <dd className="font-semibold tabular-nums">
            {describeAmount(app.proposed, app.modality, formatCOP)}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 p-2">
          <dt className="text-muted-foreground">Acordado</dt>
          <dd className="font-semibold tabular-nums">
            {app.agreed != null ? describeAmount(app.agreed, app.modality, formatCOP) : "—"}
          </dd>
        </div>
      </dl>

      {app.status === "pending" && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{applicationRoundLabel(app.round)}</span>
          {expiry && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" aria-hidden /> {expiry}
            </span>
          )}
        </p>
      )}

      {app.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.accept && (
            <Button size="sm" variant="hero" disabled={busy} onClick={() => accept.mutate()}>
              {accept.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              Aceptar {formatCOP(app.proposed)}
            </Button>
          )}
          {actions.counter && actions.counterKind && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onCounter(app, actions.counterKind ?? "counter")}
            >
              <BadgeDollarSign className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {actions.counterKind === "revise" ? "Cambiar mi propuesta" : "Contraofertar"}
            </Button>
          )}
          {actions.needsPlanToNegotiate && (
            <Button asChild size="sm" variant="outline">
              <Link to="/planes">
                <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Negociar el valor: plan Esencial
              </Link>
            </Button>
          )}
          {actions.decline && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decline.mutate()}>
              {decline.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {app.awaiting === "professional" ? "Rechazar" : "Retirar"}
            </Button>
          )}
          {actions.reason && !actions.counter && !actions.needsPlanToNegotiate && (
            <span className="text-[11px] text-muted-foreground">{actions.reason}</span>
          )}
        </div>
      )}

      {app.status === "accepted" && (
        <div className="flex flex-wrap items-center gap-2">
          {app.bookingIds[0] && (
            <Button asChild size="sm" variant="outline">
              <Link to="/servicio/$bookingId" params={{ bookingId: app.bookingIds[0] }}>
                <Handshake className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Ver reserva y dirección
              </Link>
            </Button>
          )}
          {app.contractId && (
            <Button
              size="sm"
              variant={contractNeedsMe ? "hero" : "outline"}
              onClick={() => onOpenContract(app.contractId as string)}
            >
              {contractNeedsMe ? (
                <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              ) : (
                <FileSignature className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {contractNeedsMe ? "Revisar y firmar" : "Ver contrato"}
            </Button>
          )}
        </div>
      )}

      {myAction && app.status === "pending" && (
        <p className="text-[11px] font-medium text-warn">Esperan tu respuesta.</p>
      )}

      {(app.status === "pending" || app.status === "accepted") && (
        <OfferContactPanel
          applicationId={app.id}
          userId={userId}
          plan={plan}
          institutionName={app.institutionName}
          shiftHint={shiftHint}
          proName={proName}
          accepted={app.status === "accepted"}
        />
      )}
    </Card>
  );
}

/** Postulaciones del profesional a ofertas de instituciones: responder, negociar, firmar y contactar. */
export function OfferApplicationsPanel({ userId, proName, onChanged }: Props) {
  const apps = useMyOfferApplications(userId);
  const { can } = usePlan(userId);
  const [counter, setCounter] = useState<{ app: MyApplication; kind: "counter" | "revise" } | null>(
    null,
  );
  const [contractId, setContractId] = useState<string | null>(null);
  const commissionPct = can("no_commission") ? 0 : FREE_COMMISSION_PCT;

  const rows = useMemo(
    () => sortByUrgency(apps.data ?? [], "professional", (a) => a.iSigned),
    [apps.data],
  );
  const pending = rows.filter((a) => needsMyAction(a, "professional", a.iSigned)).length;

  if (apps.isLoading) return <Skeleton className="h-24 w-full" />;
  // Antes de aplicar la migración la función no existe: la sección simplemente no aparece.
  if (apps.error || rows.length === 0) return null;

  const target: OfferCounterTarget | null = counter
    ? {
        applicationId: counter.app.id,
        title: counter.app.offerTitle,
        modality: counter.app.modality,
        posted: counter.app.posted,
        currentOffer: counter.app.proposed,
        round: counter.app.round,
        myLastOffer: counter.kind === "revise" ? counter.app.proposed : null,
        shiftHours: counter.app.shifts.map((s) => hoursBetween(s.starts_at, s.ends_at)),
      }
    : null;

  return (
    <section className="space-y-3" aria-label="Mis postulaciones a instituciones">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Handshake className="h-4 w-4 shrink-0 text-biosensor" aria-hidden /> Mis postulaciones a
          instituciones
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} en total{pending > 0 ? ` · ${pending} por atender` : ""}
        </span>
      </div>

      {rows.map((app) => (
        <ApplicationCard
          key={app.id}
          app={app}
          userId={userId}
          proName={proName}
          onCounter={(a, kind) => setCounter({ app: a, kind })}
          onOpenContract={setContractId}
          onChanged={onChanged}
        />
      ))}

      {counter && target && (
        <OfferCounterDialog
          key={`${counter.app.id}:${counter.kind}`}
          target={target}
          role="professional"
          kind={counter.kind}
          commissionPct={commissionPct}
          open
          onOpenChange={(o) => !o && setCounter(null)}
          onDone={() => {
            setCounter(null);
            onChanged?.();
          }}
        />
      )}

      {contractId && (
        <SmartContractDialog
          contractId={contractId}
          userId={userId}
          open
          onOpenChange={(o) => !o && setContractId(null)}
        />
      )}
    </section>
  );
}
