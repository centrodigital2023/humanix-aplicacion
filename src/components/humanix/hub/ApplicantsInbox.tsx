import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BadgeDollarSign,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  Inbox,
  Loader2,
  MessageSquareQuote,
  PenLine,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserRound,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SmartContractDialog } from "@/components/humanix/contracts/SmartContractDialog";
import { useInstitutionInbox } from "@/hooks/use-institution-hub";
import {
  MESSAGE_ERROR_COPY,
  bogotaToday,
  checkOutgoingMessage,
  classifyHubError,
  formatShiftRange,
  hoursBetween,
  redactContactInfo,
  type ServerError,
} from "@/lib/opportunities";
import {
  applicationActions,
  applicationRoundLabel,
  contractTotal,
  describeAmount,
} from "@/lib/institutionNegotiation";
import {
  acceptanceWarning,
  expiryLabel,
  groupInbox,
  headlineFor,
  shiftsSummary,
  trustBadges,
  type Applicant,
  type Tone,
} from "@/lib/institutionApplications";
import { applicationSla } from "@/lib/institutionCoverage";
import { SHIFT_ERROR_COPY, buildShift, findDuplicateShifts } from "@/lib/institutionShifts";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { OfferCounterDialog, type OfferCounterTarget } from "./OfferCounterDialog";

const sb = supabase as unknown as SupabaseClient;

const TONE_STYLE: Record<Tone, string> = {
  action: "bg-warn/15 text-warn",
  waiting: "bg-muted text-muted-foreground",
  ok: "bg-ok/15 text-ok",
  muted: "bg-muted text-muted-foreground",
  alert: "bg-sos/15 text-sos",
};

const BADGE_STYLE = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  info: "border-trust/40 bg-trust/10 text-trust",
  muted: "border-border bg-muted text-muted-foreground",
} as const;

const SLA_STYLE = {
  fresh: "text-muted-foreground",
  watch: "text-muted-foreground",
  late: "text-warn",
  overdue: "text-sos",
} as const;

// ─── Aceptar ─────────────────────────────────────────────────────────────────

const scheduleSchema = z
  .object({
    shifts: z
      .array(z.object({ date: z.string(), start: z.string(), end: z.string() }))
      .min(1, "Agrega al menos un turno")
      .max(30, "Máximo 30 turnos"),
  })
  .superRefine((v, ctx) => {
    const drafts = v.shifts.map((s) => ({ ...s, positions: 1 }));
    drafts.forEach((d, i) => {
      const built = buildShift(d);
      if (!built.ok) {
        ctx.addIssue({
          code: "custom",
          path: [
            "shifts",
            i,
            built.reason === "same_time" || built.reason === "bad_time" ? "end" : "date",
          ],
          message: SHIFT_ERROR_COPY[built.reason],
        });
      }
    });
    for (const i of findDuplicateShifts(drafts)) {
      ctx.addIssue({
        code: "custom",
        path: ["shifts", i, "date"],
        message: "Este turno está repetido.",
      });
    }
  });
type ScheduleValues = z.infer<typeof scheduleSchema>;

function AcceptDialog({
  app,
  open,
  onOpenChange,
  onAccepted,
}: {
  app: Applicant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: (contractId: string | null) => void;
}) {
  const qc = useQueryClient();
  const needsSchedule = app.shifts.length === 0;
  const warning = acceptanceWarning(app);
  const total = contractTotal(
    app.modality,
    app.proposed,
    app.shifts.map((s) => ({ hours: hoursBetween(s.starts_at, s.ends_at) })),
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      shifts: [{ date: bogotaToday(Date.now() + 86_400_000), start: "07:00", end: "19:00" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "shifts" });

  const accept = useMutation({
    mutationFn: async (values: ScheduleValues | null) => {
      const p_shifts = values
        ? values.shifts.flatMap((s) => {
            const built = buildShift({ ...s, positions: 1 });
            return built.ok
              ? [{ starts_at: built.shift.starts_at, ends_at: built.shift.ends_at }]
              : [];
          })
        : null;
      const { data, error } = await sb.rpc("accept_application", {
        p_application_id: app.id,
        p_shifts,
      });
      if (error) throw error;
      return data as { contract_id?: string | null; shifts?: number } | null;
    },
    onSuccess: (result) => {
      toast.success(`Aceptaste a ${app.name}`, {
        description: result?.contract_id
          ? "La reserva quedó con la dirección y el contrato está listo para firmar."
          : "La reserva quedó confirmada.",
      });
      void qc.invalidateQueries({ queryKey: ["inst"] });
      onAccepted(result?.contract_id ?? null);
      onOpenChange(false);
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const submit = needsSchedule
    ? handleSubmit((v) => accept.mutate(v))
    : (e: React.FormEvent) => {
        e.preventDefault();
        accept.mutate(null);
      };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aceptar a {app.name}</DialogTitle>
          <DialogDescription>
            {app.offerTitle} · {describeAmount(app.proposed, app.modality, formatCOP)}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <ul className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-xs">
            <li>
              Se reservan{" "}
              <strong>
                {needsSchedule ? "los turnos que definas abajo" : shiftsSummary(app.shifts)}
              </strong>{" "}
              a nombre de {app.name}, con la dirección del servicio.
            </li>
            {total > 0 && (
              <li>
                Valor acordado del contrato: <strong>{formatCOP(total)}</strong> (
                {describeAmount(app.proposed, app.modality, formatCOP)}).
              </li>
            )}
            <li>
              Se genera el <strong>contrato inteligente</strong>: ambas partes firman validando su
              identidad.
            </li>
            <li>El pago se hace únicamente en la página web de Humanix.</li>
          </ul>

          {warning && (
            <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden /> {warning}
            </p>
          )}

          {needsSchedule && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Horario de los turnos</legend>
              <p className="text-xs text-muted-foreground">
                Esta oferta se publicó sin agenda. Indica los turnos que cubrirá el profesional
                (hora de Colombia; si la hora de fin es menor que la de inicio, el turno termina al
                día siguiente).
              </p>
              {fields.map((field, i) => (
                <div key={field.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`acc-date-${i}`}>
                      Fecha
                    </Label>
                    <Input id={`acc-date-${i}`} type="date" {...register(`shifts.${i}.date`)} />
                    {errors.shifts?.[i]?.date?.message && (
                      <p className="text-[11px] text-destructive">
                        {errors.shifts[i]?.date?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`acc-start-${i}`}>
                      Inicio
                    </Label>
                    <Input id={`acc-start-${i}`} type="time" {...register(`shifts.${i}.start`)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`acc-end-${i}`}>
                      Fin
                    </Label>
                    <Input id={`acc-end-${i}`} type="time" {...register(`shifts.${i}.end`)} />
                    {errors.shifts?.[i]?.end?.message && (
                      <p className="text-[11px] text-destructive">
                        {errors.shifts[i]?.end?.message}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="mt-5"
                    aria-label={`Quitar el turno ${i + 1}`}
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {errors.shifts?.message && (
                <p className="text-xs text-destructive">{errors.shifts.message}</p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  append({
                    date: bogotaToday(Date.now() + 2 * 86_400_000),
                    start: "07:00",
                    end: "19:00",
                  })
                }
                disabled={fields.length >= 30}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Agregar turno
              </Button>
            </fieldset>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={accept.isPending}>
              {accept.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
              )}
              Aceptar y reservar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rechazar ────────────────────────────────────────────────────────────────

function DeclineDialog({
  app,
  open,
  onOpenChange,
}: {
  app: Applicant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const check = checkOutgoingMessage(note, { maxChars: 300 });

  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("decline_application", {
        p_application_id: app.id,
        p_note: check.ok && check.text ? check.text : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Postulación rechazada", { description: "El profesional fue avisado." });
      void qc.invalidateQueries({ queryKey: ["inst"] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar a {app.name}</DialogTitle>
          <DialogDescription>
            El profesional recibirá un aviso. Puedes dejarle una nota breve (opcional).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="decline-note">Nota (opcional)</Label>
          <Textarea
            id="decline-note"
            rows={3}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={!check.ok}
          />
          {!check.ok && (
            <p className="text-xs text-destructive">{MESSAGE_ERROR_COPY[check.reason]}</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={decline.isPending || !check.ok}
            onClick={() => decline.mutate()}
          >
            {decline.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tarjeta de postulante ───────────────────────────────────────────────────

function ApplicantCard({
  app,
  onAccept,
  onCounter,
  onDecline,
  onOpenContract,
}: {
  app: Applicant;
  onAccept: () => void;
  onCounter: () => void;
  onDecline: () => void;
  onOpenContract: (contractId: string) => void;
}) {
  const headline = headlineFor(app, "institution", formatCOP);
  const actions = applicationActions(
    { status: app.status, awaiting: app.awaiting, round_no: app.round, expires_at: app.expiresAt },
    "institution",
    { canNegotiate: true },
  );
  const sla =
    app.status === "pending" && app.awaiting === "institution"
      ? applicationSla(app.createdAt)
      : null;
  const expiry = app.status === "pending" ? expiryLabel(app.expiresAt) : null;
  const first = app.shifts[0];
  const message = app.message ? redactContactInfo(app.message) : null;
  const contractNeedsMe =
    app.contractStatus === "pending_signature" || app.contractStatus === "partially_signed";

  return (
    <Card className="space-y-3 p-4" aria-label={`Postulación de ${app.name}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          {app.avatar && <AvatarImage src={app.avatar} alt="" />}
          <AvatarFallback>{app.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{app.name}</p>
            <Badge className={cn("border-0 text-[10px]", TONE_STYLE[headline.tone])}>
              {headline.title}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {[app.specialty, app.city].filter(Boolean).join(" · ") || "Profesional de la salud"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {trustBadges(app).map((b) => (
              <span
                key={b.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  BADGE_STYLE[b.tone],
                )}
              >
                {b.id === "rethus" || b.id === "verified" ? (
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                ) : null}
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs">
        <p className="font-medium">{app.offerTitle}</p>
        <p className="text-muted-foreground">
          {shiftsSummary(app.shifts)}
          {first ? ` · ${formatShiftRange(first.starts_at, first.ends_at)}` : ""}
        </p>
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
            {app.awaiting === "professional" ? "Tu oferta" : "Propone"}
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

      {message && (
        <p className="flex items-start gap-2 rounded-lg bg-muted/30 p-2 text-xs italic text-muted-foreground">
          <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {message}
        </p>
      )}

      {app.status === "pending" && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">{applicationRoundLabel(app.round)}</span>
          {sla && <span className={SLA_STYLE[sla.level]}>{sla.label}</span>}
          {expiry && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CalendarClock className="h-3 w-3" aria-hidden /> {expiry}
            </span>
          )}
        </p>
      )}

      {app.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2">
          {actions.accept && (
            <Button size="sm" variant="hero" onClick={onAccept}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Aceptar{" "}
              {formatCOP(app.proposed)}
            </Button>
          )}
          {actions.counter && (
            <Button size="sm" variant="outline" onClick={onCounter}>
              <BadgeDollarSign className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Contraofertar
            </Button>
          )}
          {actions.decline && (
            <Button size="sm" variant="ghost" onClick={onDecline}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Rechazar
            </Button>
          )}
          {actions.reason && !actions.accept && (
            <span className="text-[11px] text-muted-foreground">{actions.reason}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {app.status === "accepted" && app.contractId && (
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
            {contractNeedsMe ? "Ver contrato y firmar" : "Ver contrato"}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <Link to="/profesional/$proId" params={{ proId: app.professionalId }}>
            <UserRound className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Ver perfil
          </Link>
        </Button>
      </div>
    </Card>
  );
}

// ─── Buzón ───────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
  /** En el inicio: solo lo que espera respuesta y lo reciente. */
  compact?: boolean;
  /** Para saltar a la lista completa desde la vista compacta. */
  onSeeAll?: () => void;
}

/** Postulaciones recibidas: aceptar (reserva + contrato), contraofertar el valor o rechazar. */
export function ApplicantsInbox({ userId, compact = false, onSeeAll }: Props) {
  const inbox = useInstitutionInbox(userId);
  const groups = useMemo(() => groupInbox(inbox.data ?? []), [inbox.data]);
  const [accepting, setAccepting] = useState<Applicant | null>(null);
  const [countering, setCountering] = useState<Applicant | null>(null);
  const [declining, setDeclining] = useState<Applicant | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  if (inbox.isLoading) return <Skeleton className="h-32 w-full" />;
  if (inbox.error) {
    const message = (inbox.error as Error).message ?? "";
    const notReady = /institution_application_inbox|schema cache|Could not find the function/i.test(
      message,
    );
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="font-semibold">
          {notReady
            ? "Estamos activando las postulaciones inteligentes"
            : "No pudimos cargar las postulaciones"}
        </p>
        <p className="text-muted-foreground">
          {notReady
            ? "Esta función se está habilitando en tu cuenta. Vuelve a intentarlo en unos minutos."
            : "Revisa tu conexión e inténtalo de nuevo."}
        </p>
        <Button size="sm" variant="outline" onClick={() => void inbox.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reintentar
        </Button>
      </Card>
    );
  }

  const rows = inbox.data ?? [];
  const limit = compact ? 5 : Number.POSITIVE_INFINITY;
  const sections: Array<{ id: string; title: string; items: Applicant[]; hint?: string }> = [
    {
      id: "needs",
      title: "Esperan tu respuesta",
      items: groups.needsResponse,
      hint: "Responder rápido sube la cobertura.",
    },
    { id: "waiting", title: "Esperando al profesional", items: groups.waiting },
    { id: "accepted", title: "Aceptadas", items: groups.accepted },
  ];

  const counterTarget: OfferCounterTarget | null = countering
    ? {
        applicationId: countering.id,
        title: countering.offerTitle,
        modality: countering.modality,
        posted: countering.posted,
        currentOffer: countering.proposed,
        round: countering.round,
        myLastOffer: null,
        shiftHours: countering.shifts.map((s) => hoursBetween(s.starts_at, s.ends_at)),
      }
    : null;

  return (
    <section className="space-y-4" aria-label="Postulaciones recibidas">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          <Inbox className="h-4 w-4 shrink-0 text-fuchsia-neural" aria-hidden /> Postulaciones
          {groups.needsResponse.length > 0 && (
            <span className="rounded-full bg-warn px-2 py-0.5 text-[10px] font-bold text-warn-foreground">
              {groups.needsResponse.length} por responder
            </span>
          )}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length} en total</span>
      </div>

      {rows.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Aún no recibes postulaciones. Cuando un profesional se postule, aparecerá aquí con su
          verificación RETHUS y su calificación.
        </Card>
      )}

      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <div key={s.id} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.title} · {s.items.length}
                {s.hint ? <span className="ml-2 font-normal normal-case">{s.hint}</span> : null}
              </h3>
              {s.items.slice(0, limit).map((a) => (
                <ApplicantCard
                  key={a.id}
                  app={a}
                  onAccept={() => setAccepting(a)}
                  onCounter={() => setCountering(a)}
                  onDecline={() => setDeclining(a)}
                  onOpenContract={setContractId}
                />
              ))}
              {compact && s.items.length > limit && onSeeAll && (
                <button
                  type="button"
                  className="text-xs font-medium text-biosensor hover:underline"
                  onClick={onSeeAll}
                >
                  Ver las {s.items.length} →
                </button>
              )}
            </div>
          ),
      )}

      {!compact && groups.closed.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
          >
            {showClosed ? "Ocultar" : "Ver"} cerradas · {groups.closed.length}
          </button>
          {showClosed &&
            groups.closed.map((a) => (
              <ApplicantCard
                key={a.id}
                app={a}
                onAccept={() => undefined}
                onCounter={() => undefined}
                onDecline={() => undefined}
                onOpenContract={setContractId}
              />
            ))}
        </div>
      )}

      {accepting && (
        <AcceptDialog
          key={accepting.id}
          app={accepting}
          open
          onOpenChange={(o) => !o && setAccepting(null)}
          onAccepted={(id) => id && setContractId(id)}
        />
      )}
      {declining && (
        <DeclineDialog
          key={declining.id}
          app={declining}
          open
          onOpenChange={(o) => !o && setDeclining(null)}
        />
      )}
      {countering && counterTarget && (
        <OfferCounterDialog
          key={countering.id}
          target={counterTarget}
          role="institution"
          kind="counter"
          commissionPct={0}
          open
          onOpenChange={(o) => !o && setCountering(null)}
          onDone={() => setCountering(null)}
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
