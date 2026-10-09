import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Circle,
  FileSignature,
  Flame,
  Inbox,
  Info,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SmartContractDialog } from "@/components/humanix/contracts/SmartContractDialog";
import {
  instKeys,
  useCoverageOffers,
  useInstitutionInbox,
  useMySmartContracts,
  useSupplySnapshot,
  useTeamCount,
} from "@/hooks/use-institution-hub";
import { classifyHubError, formatShiftRange, type ServerError } from "@/lib/opportunities";
import { isOfferModality, validatePublishedAmount } from "@/lib/institutionNegotiation";
import {
  RISK_LABEL,
  assessShifts,
  coverageHeadline,
  firstRunSteps,
  nextBestActions,
  summarizeCoverage,
  type ActionSeverity,
  type CoverageAction,
  type CoverageRisk,
  type CoverageShiftInput,
} from "@/lib/institutionCoverage";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";

const sb = supabase as unknown as SupabaseClient;

export interface CoverageProfile {
  institution_name: string;
  city: string | null;
  verified: boolean | null;
  nit: string | null;
}

interface Props {
  userId: string;
  profile: CoverageProfile | null;
  onPublish: () => void;
  onGoToInbox: () => void;
  onGoToTalent: () => void;
}

const RISK_STYLE: Record<CoverageRisk, string> = {
  critical: "bg-sos text-sos-foreground",
  high: "bg-warn text-warn-foreground",
  watch: "bg-secondary text-secondary-foreground",
  ok: "bg-muted text-muted-foreground",
  covered: "bg-ok/15 text-ok",
};

const SEVERITY_STYLE: Record<ActionSeverity, string> = {
  critical: "border-sos/40 bg-sos/5",
  high: "border-warn/40 bg-warn/5",
  medium: "border-border bg-card",
  info: "border-border bg-muted/30",
};

/** Reloj que avanza cada minuto: los riesgos dependen de cuánto falta para cada turno. */
function useClock(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "sos" | "ok";
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold tabular-nums",
          tone === "sos" && "text-sos",
          tone === "warn" && "text-warn",
          tone === "ok" && "text-ok",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Centro de cobertura: qué turnos están en riesgo, qué postulaciones esperan y qué hacer ahora. Todo sale de
 * datos que la institución ya puede leer, y cada sugerencia explica por qué aparece.
 */
export function CoverageCenter({ userId, profile, onPublish, onGoToInbox, onGoToTalent }: Props) {
  const qc = useQueryClient();
  const offers = useCoverageOffers(userId);
  const inbox = useInstitutionInbox(userId);
  const contracts = useMySmartContracts(userId);
  const team = useTeamCount(userId);
  const [contractId, setContractId] = useState<string | null>(null);
  const [raise, setRaise] = useState<{ offerId: string; amount: number; title: string } | null>(
    null,
  );

  const now = useClock(60_000);
  const applicants = useMemo(() => inbox.data ?? [], [inbox.data]);

  const inputs = useMemo<CoverageShiftInput[]>(() => {
    const out: CoverageShiftInput[] = [];
    for (const offer of offers.data ?? []) {
      if (offer.status !== "open") continue;
      const modality = isOfferModality(offer.modality) ? offer.modality : "shift";
      for (const shift of offer.job_offer_shifts ?? []) {
        if (shift.status === "cancelled") continue;
        const forShift = applicants.filter(
          (a) =>
            a.offerId === offer.id &&
            a.status === "pending" &&
            (a.shifts.length === 0 || a.shifts.some((s) => s.id === shift.id)),
        );
        const waiting = forShift.filter((a) => a.awaiting === "institution");
        out.push({
          offerId: offer.id,
          title: offer.title,
          serviceArea: offer.service_area,
          specialty: offer.specialty_required,
          city: offer.city,
          modality,
          amount: offer.amount,
          isUrgent: Boolean(offer.is_urgent),
          shiftId: shift.id,
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          positions: shift.positions,
          filled: shift.filled,
          applicants: forShift.length,
          awaitingResponse: waiting.length,
          oldestWaitingAt: waiting.length ? waiting.map((a) => a.createdAt).sort()[0] : null,
        });
      }
    }
    return out;
  }, [offers.data, applicants]);

  const shifts = useMemo(() => assessShifts(inputs, now), [inputs, now]);
  const summary = useMemo(() => summarizeCoverage(shifts), [shifts]);
  const waitingApplications = useMemo(
    () =>
      applicants
        .filter((a) => a.status === "pending" && a.awaiting === "institution")
        .map((a) => ({ id: a.id, createdAt: a.createdAt, offerTitle: a.offerTitle })),
    [applicants],
  );
  const unsignedContracts = useMemo(
    () =>
      (contracts.data ?? [])
        .filter(
          (c) =>
            (c.status === "pending_signature" || c.status === "partially_signed") && !c.i_signed,
        )
        .map((c) => ({ id: c.contract_id, firstShiftAt: c.first_shift })),
    [contracts.data],
  );

  const firstUncovered = summary.nextUncovered;
  const supply = useSupplySnapshot(
    profile?.city ?? firstUncovered?.city ?? null,
    firstUncovered?.specialty ?? null,
    shifts.some((s) => s.open > 0),
  );

  const actions = useMemo(
    () =>
      nextBestActions({
        shifts,
        waitingApplications,
        unsignedContracts,
        favoritesCount: team.data ?? 0,
        supplyProfessionals: supply.data?.professionals ?? null,
        now,
      }),
    [shifts, waitingApplications, unsignedContracts, team.data, supply.data, now],
  );

  const firstRun = firstRunSteps({
    profileComplete: Boolean(profile?.nit && profile?.city),
    verified: Boolean(profile?.verified),
    offersPublished: offers.data?.length ?? 0,
    applicationsReceived: applicants.length,
    contractsSigned: (contracts.data ?? []).filter(
      (c) => c.status === "active" || c.status === "completed",
    ).length,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: instKeys.coverage(userId) });

  const markUrgent = useMutation({
    mutationFn: async (offerId: string) => {
      const { error } = await sb.from("job_offers").update({ is_urgent: true }).eq("id", offerId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Turno marcado como urgente", {
        description: "Llega primero a los profesionales con alertas activas.",
      });
      invalidate();
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const raiseRate = useMutation({
    mutationFn: async ({ offerId, amount }: { offerId: string; amount: number }) => {
      const { error } = await sb.from("job_offers").update({ amount }).eq("id", offerId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Valor actualizado", {
        description: "Las postulaciones que ya existen conservan el valor con el que se enviaron.",
      });
      setRaise(null);
      invalidate();
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const inviteTeam = useMutation({
    mutationFn: async (offerId: string) => {
      const { data, error } = await sb.rpc("invite_team_to_offer", { p_offer_id: offerId });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (invited) => {
      if (invited > 0) {
        toast.success(
          invited === 1
            ? "Invitaste a 1 profesional de tu equipo"
            : `Invitaste a ${invited} profesionales de tu equipo`,
          { description: "Reciben un aviso personal con el turno para postularse." },
        );
      } else {
        toast.info("Tu equipo ya fue invitado a este turno o ya se postuló.");
      }
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const run = (action: CoverageAction) => {
    switch (action.kind) {
      case "publish_first":
        return onPublish();
      case "respond_applications":
        return onGoToInbox();
      case "mark_urgent":
        return action.offerId ? markUrgent.mutate(action.offerId) : undefined;
      case "raise_rate": {
        const shift = shifts.find((s) => s.offerId === action.offerId);
        if (!action.offerId || !action.suggestedAmount || !shift) return;
        const check = validatePublishedAmount(shift.modality, action.suggestedAmount);
        if (!check.ok) {
          toast.error("Ese valor queda fuera del rango permitido para la modalidad.");
          return;
        }
        return setRaise({
          offerId: action.offerId,
          amount: action.suggestedAmount,
          title: shift.title,
        });
      }
      case "invite_favorites":
        return action.offerId ? inviteTeam.mutate(action.offerId) : onGoToTalent();
      case "sign_contracts":
        return unsignedContracts[0] ? setContractId(unsignedContracts[0].id) : undefined;
      default:
        return undefined;
    }
  };

  const ACTION_LABEL: Partial<Record<CoverageAction["kind"], string>> = {
    publish_first: "Publicar turnos",
    respond_applications: "Ver postulaciones",
    mark_urgent: "Marcar urgente",
    raise_rate: "Subir el valor",
    invite_favorites: "Invitar a mi equipo",
    sign_contracts: "Revisar y firmar",
  };

  if (offers.isLoading || inbox.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando el centro de cobertura">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const noAgenda = (offers.data ?? []).filter(
    (o) => o.status === "open" && (o.job_offer_shifts?.length ?? 0) === 0,
  ).length;
  const risky = summary.byRisk.critical + summary.byRisk.high;
  const showChecklist = firstRun.doneCount < 4;
  const listed = shifts.filter((s) => s.open > 0).slice(0, 6);

  return (
    <section className="space-y-4" aria-label="Centro de cobertura">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <TrendingUp className="h-4 w-4 shrink-0 text-fuchsia-neural" aria-hidden /> Centro de
            cobertura
            <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-medium text-ok">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden /> En vivo
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">{coverageHeadline(summary)}</p>
        </div>
        <Button variant="hero" size="sm" onClick={onPublish}>
          <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden /> Publicar turnos
        </Button>
      </div>

      {showChecklist && (
        <Card className="space-y-3 border-fuchsia-neural/30 bg-fuchsia-neural/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-fuchsia-neural" aria-hidden /> Empieza en 5 pasos (
            {firstRun.doneCount} de {firstRun.steps.length})
          </p>
          <Progress value={(firstRun.doneCount / firstRun.steps.length) * 100} className="h-1.5" />
          <ol className="space-y-1.5">
            {firstRun.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2 text-xs">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={cn(step.done && "text-muted-foreground line-through")}>
                  <strong className="font-medium">{step.title}.</strong> {step.hint}
                </span>
              </li>
            ))}
          </ol>
          {firstRun.next?.id === "publish" && (
            <Button size="sm" variant="hero" onClick={onPublish}>
              Publicar mi primer turno
            </Button>
          )}
        </Card>
      )}

      {shifts.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Cobertura"
              value={summary.coveragePct != null ? `${summary.coveragePct} %` : "—"}
              sub={`${summary.filledPositions} de ${summary.totalPositions} cupos`}
              tone={summary.coveragePct === 100 ? "ok" : undefined}
            />
            <Tile
              label="Turnos en riesgo"
              value={String(risky)}
              sub={`${summary.byRisk.critical} críticos`}
              tone={risky > 0 ? (summary.byRisk.critical > 0 ? "sos" : "warn") : undefined}
            />
            <Tile
              label="Por responder"
              value={String(waitingApplications.length)}
              sub="postulaciones"
              tone={waitingApplications.length > 0 ? "warn" : undefined}
            />
            <Tile
              label="Sin postulantes"
              value={String(summary.shiftsWithoutCandidates)}
              sub="turnos con cupo"
            />
          </div>
          <Progress
            value={summary.coveragePct ?? 0}
            className="h-1.5"
            aria-label="Cobertura de cupos"
          />
        </>
      )}

      {noAgenda > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {noAgenda === 1
            ? "Tienes 1 oferta abierta sin horario"
            : `Tienes ${noAgenda} ofertas abiertas sin horario`}
          : no entra en la cobertura. Define sus turnos al aceptar una postulación o publícala de
          nuevo con agenda.
        </p>
      )}

      {actions.length > 0 && shifts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Qué hacer ahora
          </h3>
          <ul className="space-y-2">
            {actions.map((action) => {
              const label = ACTION_LABEL[action.kind];
              return (
                <li
                  key={action.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between",
                    SEVERITY_STYLE[action.severity],
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {action.severity === "critical" || action.severity === "high" ? (
                        <AlertTriangle
                          className={cn(
                            "h-4 w-4 shrink-0",
                            action.severity === "critical" ? "text-sos" : "text-warn",
                          )}
                          aria-hidden
                        />
                      ) : action.kind === "sign_contracts" ? (
                        <FileSignature className="h-4 w-4 shrink-0 text-biosensor" aria-hidden />
                      ) : action.kind === "respond_applications" ? (
                        <Inbox className="h-4 w-4 shrink-0 text-biosensor" aria-hidden />
                      ) : action.kind === "invite_favorites" ? (
                        <Users className="h-4 w-4 shrink-0 text-biosensor" aria-hidden />
                      ) : action.kind === "mark_urgent" ? (
                        <Flame className="h-4 w-4 shrink-0 text-sos" aria-hidden />
                      ) : (
                        <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      {action.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{action.detail}</p>
                  </div>
                  {label && (
                    <Button
                      size="sm"
                      variant={action.severity === "critical" ? "hero" : "outline"}
                      className="shrink-0"
                      disabled={markUrgent.isPending || raiseRate.isPending || inviteTeam.isPending}
                      onClick={() => run(action)}
                    >
                      {label}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {listed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Turnos con cupo abierto
          </h3>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {listed.map((s) => (
              <li
                key={s.shiftId}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="text-muted-foreground">
                    {formatShiftRange(s.startsAt, s.endsAt)} · {s.open}{" "}
                    {s.open === 1 ? "cupo" : "cupos"} · {s.applicants}{" "}
                    {s.applicants === 1 ? "postulante" : "postulantes"}
                  </p>
                  <p className="text-muted-foreground">{s.reasons[0]}</p>
                </div>
                <Badge className={cn("border-0 text-[10px]", RISK_STYLE[s.risk])}>
                  {RISK_LABEL[s.risk]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {supply.data?.professionals != null && shifts.some((s) => s.open > 0) && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Hay {supply.data.professionals} profesionales disponibles
          {profile?.city ? ` en ${profile.city}` : ""}
          {supply.data.verified != null ? `, ${supply.data.verified} con RETHUS verificado` : ""}.
        </p>
      )}

      <AlertDialog open={!!raise} onOpenChange={(o) => !o && setRaise(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Subir el valor de «{raise?.title}»</AlertDialogTitle>
            <AlertDialogDescription>
              El nuevo valor será {raise ? formatCOP(raise.amount) : ""}. Las postulaciones que ya
              existen conservan el valor con el que se enviaron; las nuevas se harán sobre este.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={raiseRate.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (raise) raiseRate.mutate({ offerId: raise.offerId, amount: raise.amount });
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
