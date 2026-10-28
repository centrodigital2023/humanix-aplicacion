// Postulaciones a lo que publicó la familia, en tarjetas: quién es (nombre según el plan, foto, especialidad), cuánto confía la
// plataforma (Trust Score), qué dicen de esa persona (estrellas), dónde está (zona y cercanía por rangos), cuánto propone y qué
// puede hacer la familia —aceptar, rechazar, negociar el valor o ver su WhatsApp— según su plan.
//
// Dos orígenes en una sola lista: necesidades por horas (`family_applicants`) y ofertas de trabajo (`family_offer_applicants`).
// La base decide qué nombre se ve, quién puede negociar y el cupo diario de contactos; aquí solo se presenta y se actúa.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Phone,
  Scale,
  Sparkles,
  Star,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustBadge } from "@/components/humanix/TrustBadge";
import { CounterOfferDialog } from "@/components/humanix/hub/CounterOfferDialog";
import { OfferCounterDialog } from "@/components/humanix/hub/OfferCounterDialog";
import {
  applicantKeys,
  useApplicantActions,
  useFamilyApplicants,
  type RevealedContact,
} from "@/hooks/use-applicants";
import {
  APPLICANT_SORT_LABEL,
  acceptNeedsSchedule,
  applicantError,
  applicantWhatsAppLink,
  contactState,
  CONTACT_STATE_COPY,
  defaultAcceptShifts,
  deltaFromPosted,
  expiryText,
  familyToProMessage,
  initialsOf,
  negotiationState,
  partitionApplicants,
  priceLine,
  sortApplicants,
  starsText,
  summarizeApplicants,
  turnLabel,
  type ApplicantCard,
  type ApplicantSort,
  type ShiftInput,
} from "@/lib/applicants";
import { MAX_ROUNDS, roundLabel } from "@/lib/negotiation";
import { hoursBetween, type ServerError } from "@/lib/opportunities";
import { distanceBandLabel } from "@/lib/trustScore";
import { cn } from "@/lib/utils";

// ─── Horario al aceptar una oferta de trabajo sin turnos ─────────────────────

const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const scheduleSchema = z
  .object({
    start: z.string().min(1, "Elige cuándo empieza"),
    end: z.string().min(1, "Elige cuándo termina"),
  })
  .superRefine((v, ctx) => {
    const s = Date.parse(v.start);
    const e = Date.parse(v.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return;
    if (e <= s)
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "El fin debe ser después del inicio",
      });
    else if (e - s > 24 * 3_600_000)
      ctx.addIssue({ code: "custom", path: ["end"], message: "Un turno dura máximo 24 horas" });
    if (s < Date.now() - 3_600_000)
      ctx.addIssue({
        code: "custom",
        path: ["start"],
        message: "El turno debe empezar en el futuro",
      });
  });
type ScheduleValues = z.infer<typeof scheduleSchema>;

function ScheduleDialog({
  card,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: {
  card: ApplicantCard;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (shifts: ShiftInput[]) => void;
}) {
  const proposed = defaultAcceptShifts(card);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ScheduleValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      start: toLocalInput(proposed?.[0]?.starts_at ?? card.startsAt),
      end: toLocalInput(proposed?.[0]?.ends_at ?? card.endsAt),
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿En qué horario será el servicio?</DialogTitle>
          <DialogDescription>
            Tu oferta «{card.title}» no tiene turnos definidos. Indica el horario para confirmar la
            reserva con {card.displayName}.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit((v) =>
            onConfirm([
              {
                starts_at: new Date(v.start).toISOString(),
                ends_at: new Date(v.end).toISOString(),
              },
            ]),
          )}
        >
          <div className="space-y-1.5">
            <Label htmlFor="sched-start">Empieza</Label>
            <Input
              id="sched-start"
              type="datetime-local"
              aria-invalid={!!errors.start}
              {...register("start")}
            />
            {errors.start && <p className="text-xs text-destructive">{errors.start.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-end">Termina</Label>
            <Input
              id="sched-end"
              type="datetime-local"
              aria-invalid={!!errors.end}
              {...register("end")}
            />
            {errors.end && <p className="text-xs text-destructive">{errors.end.message}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              )}
              Confirmar reserva
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Una tarjeta ─────────────────────────────────────────────────────────────

type Pending =
  | { kind: "accept"; card: ApplicantCard }
  | { kind: "reject"; card: ApplicantCard }
  | { kind: "schedule"; card: ApplicantCard }
  | { kind: "counter"; card: ApplicantCard }
  | null;

function Applicant({
  card,
  familyName,
  revealed,
  busyKey,
  onAccept,
  onReject,
  onCounter,
  onReveal,
}: {
  card: ApplicantCard;
  familyName: string | null | undefined;
  revealed: RevealedContact | undefined;
  busyKey: string | null;
  onAccept: (c: ApplicantCard) => void;
  onReject: (c: ApplicantCard) => void;
  onCounter: (c: ApplicantCard) => void;
  onReveal: (c: ApplicantCard) => void;
}) {
  const neg = negotiationState(card);
  const contact = contactState(card);
  const delta = deltaFromPosted(card);
  const expiry = expiryText(card);
  const busy = busyKey === card.key;
  const mine = card.turn === "family";
  const wa = revealed?.phone
    ? applicantWhatsAppLink(
        revealed.phone,
        familyToProMessage({ familyName, proName: revealed.fullName, title: card.title }),
      )
    : null;

  return (
    <Card className={cn("p-4", mine && "border-biosensor/40")} data-testid="applicant-card">
      {/* En pantallas angostas el turno va arriba para que el nombre tenga todo el ancho; en las anchas, a la derecha. */}
      <Badge variant={mine ? "default" : "secondary"} className="mb-2 whitespace-nowrap sm:hidden">
        {turnLabel(card)}
      </Badge>
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12 shrink-0">
          {card.avatarUrl ? <AvatarImage src={card.avatarUrl} alt="" /> : null}
          <AvatarFallback className="bg-muted text-sm font-semibold">
            {initialsOf(card.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p
              className="truncate font-semibold"
              title={card.nameIsShort ? "Nombre completo con el plan Familiar" : undefined}
            >
              {card.displayName}
            </p>
            {card.rethusVerified && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> RETHUS
              </span>
            )}
            <TrustBadge summary={card.trust} kind="professional" />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Star
                className={cn("h-3 w-3", card.starsAvg != null && "fill-copper text-copper")}
                aria-hidden
              />
              {starsText(card)}
            </span>
            {card.specialty && <span>{` · ${card.specialty}`}</span>}
            {card.yearsExperience ? <span>{` · ${card.yearsExperience} años`}</span> : null}
            {card.totalJobs ? <span>{` · ${card.totalJobs} servicios`}</span> : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            <span>{card.city ?? "Zona no indicada"}</span>
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">{distanceBandLabel(card.distanceBandKm)}</span>
          </p>
        </div>
        <Badge
          variant={mine ? "default" : "secondary"}
          className="max-w-[9.5rem] whitespace-normal text-center leading-tight max-sm:hidden"
        >
          {turnLabel(card)}
        </Badge>
      </div>

      <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
        <p className="font-medium">{card.title}</p>
        <p className="mt-0.5">
          {priceLine(card)}
          {delta.pct !== 0 && (
            <span className="ml-2 text-xs text-muted-foreground">{delta.label}</span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {card.round > 1 && (
            <span className="inline-flex items-center gap-1">
              <Scale className="h-3 w-3" aria-hidden /> {roundLabel(card.round)} de {MAX_ROUNDS}
            </span>
          )}
          {expiry && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden /> {expiry}
            </span>
          )}
        </p>
        {card.message && (
          <p className="mt-2 text-sm italic text-muted-foreground">«{card.message}»</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {card.turn === "family" && (
          <>
            <Button size="sm" variant="hero" disabled={busy} onClick={() => onAccept(card)}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Aceptar
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReject(card)}>
              <XCircle className="h-3.5 w-3.5" aria-hidden /> Rechazar
            </Button>
            {neg.state === "available" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onCounter(card)}>
                <Scale className="h-3.5 w-3.5" aria-hidden /> Negociar valor
              </Button>
            )}
            {neg.state === "locked_plan" && (
              <Button size="sm" variant="outline" asChild title={neg.reason}>
                <Link to="/planes">
                  <Lock className="h-3.5 w-3.5" aria-hidden /> Negociar (plan Familiar)
                </Link>
              </Button>
            )}
          </>
        )}
        {card.turn === "done" && card.bookingId && (
          <Button size="sm" variant="hero" asChild>
            <Link to="/servicio/$bookingId" params={{ bookingId: card.bookingId }}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Ver el servicio
            </Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link to="/profesional/$proId" params={{ proId: card.professionalId }}>
            <UserRound className="h-3.5 w-3.5" aria-hidden /> Ver perfil
          </Link>
        </Button>
        {contact === "plan" ? (
          <Button size="sm" variant="ghost" asChild title={CONTACT_STATE_COPY.plan}>
            <Link to="/planes">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Ver contacto (plan Familiar)
            </Link>
          </Button>
        ) : contact === "ready" || (contact === "unlocked" && !revealed) ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReveal(card)}>
            <Phone className="h-3.5 w-3.5" aria-hidden />
            {contact === "unlocked"
              ? "Ver contacto de hoy"
              : `Ver WhatsApp (${card.revealsLeft} hoy)`}
          </Button>
        ) : null}
        {wa && (
          <Button
            size="sm"
            variant="outline"
            asChild
            className="border-biosensor/40 text-biosensor"
          >
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
            </a>
          </Button>
        )}
      </div>

      {revealed?.phone && (
        <p className="mt-2 text-xs text-muted-foreground">
          Teléfono: <strong className="text-foreground">{revealed.phone}</strong> · Coordina los
          detalles; los pagos se hacen solo en la página web de Humanix.
        </p>
      )}
      {card.turn === "family" &&
        neg.state !== "available" &&
        neg.state !== "locked_plan" &&
        neg.state !== "closed" && (
          <p className="mt-2 text-xs text-muted-foreground">{neg.reason}</p>
        )}
      {contact !== "ready" && contact !== "unlocked" && card.turn !== "done" && (
        <p className="mt-2 text-xs text-muted-foreground">{CONTACT_STATE_COPY[contact]}</p>
      )}
    </Card>
  );
}

// ─── La lista ────────────────────────────────────────────────────────────────

export function ApplicantCards({
  userId,
  familyName,
  hideWhenEmpty = false,
  className,
}: {
  userId: string;
  familyName?: string | null;
  /** Sin postulaciones (y ya cargadas), no ocupa lugar: el inicio de la familia solo muestra lo que pide acción. */
  hideWhenEmpty?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useFamilyApplicants(userId);
  const { accept, reject, reveal } = useApplicantActions(userId);
  const [sort, setSort] = useState<ApplicantSort>("recent");
  const [pending, setPending] = useState<Pending>(null);
  const [revealed, setRevealed] = useState<Record<string, RevealedContact>>({});

  const cards = useMemo(() => sortApplicants(list.data ?? [], sort), [list.data, sort]);
  const groups = useMemo(() => partitionApplicants(cards), [cards]);
  const summary = useMemo(() => summarizeApplicants(cards), [cards]);
  const plan = cards[0]?.plan ?? "free";
  const busyKey =
    accept.isPending && accept.variables
      ? accept.variables.card.key
      : reject.isPending && reject.variables
        ? reject.variables.card.key
        : reveal.isPending && reveal.variables
          ? reveal.variables.key
          : null;

  const fail = (e: unknown) => {
    const err = applicantError(e as ServerError);
    toast.error(
      err.message,
      err.upsell
        ? { action: { label: "Ver planes", onClick: () => void navigate({ to: "/planes" }) } }
        : undefined,
    );
  };

  const doAccept = (card: ApplicantCard, shifts?: ShiftInput[]) =>
    accept.mutate(
      { card, shifts },
      {
        onSuccess: ({ bookingId }) => {
          setPending(null);
          toast.success(`Aceptaste a ${card.displayName}`, {
            description: "Se creó la reserva. Coordina los detalles desde el servicio.",
            action: bookingId
              ? {
                  label: "Ver servicio",
                  onClick: () =>
                    void navigate({ to: "/servicio/$bookingId", params: { bookingId } }),
                }
              : undefined,
          });
        },
        onError: (e) => {
          const err = applicantError(e as ServerError);
          if (err.kind === "shifts_required") {
            setPending({ kind: "schedule", card });
            return;
          }
          // La confirmación se cierra para que el aviso de error se vea y se pueda usar («Ver planes»). El horario se deja
          // abierto: si el cruce es con otro servicio, la familia lo corrige sin volver a escribirlo.
          if (pending?.kind !== "schedule") setPending(null);
          fail(e);
        },
      },
    );

  const askAccept = (card: ApplicantCard) => {
    if (acceptNeedsSchedule(card) && defaultAcceptShifts(card) === null)
      setPending({ kind: "schedule", card });
    else setPending({ kind: "accept", card });
  };

  const doReject = (card: ApplicantCard) =>
    reject.mutate(
      { card },
      {
        onSuccess: () => {
          setPending(null);
          toast.success("Rechazaste la postulación");
        },
        onError: (e) => {
          setPending(null);
          fail(e);
        },
      },
    );

  const doReveal = (card: ApplicantCard) =>
    reveal.mutate(card, {
      onSuccess: (c) => {
        setRevealed((m) => ({ ...m, [card.key]: c }));
        if (!c.phone) toast.info("Este profesional aún no registró un teléfono.");
      },
      onError: fail,
    });

  const refreshAfterCounter = () => {
    void qc.invalidateQueries({ queryKey: applicantKeys.list(userId) });
    setPending(null);
  };

  if (hideWhenEmpty && !list.isError && (list.isLoading || cards.length === 0)) return null;

  return (
    <section
      id="postulaciones"
      className={cn("scroll-mt-4", className)}
      aria-labelledby="postulaciones-title"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="postulaciones-title"
          className="flex items-center gap-2 font-display text-base font-semibold"
        >
          <Inbox className="h-4 w-4 text-fuchsia-neural" aria-hidden /> Postulaciones
        </h2>
        {cards.length > 1 && (
          <Select value={sort} onValueChange={(v) => setSort(v as ApplicantSort)}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Ordenar postulaciones">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(APPLICANT_SORT_LABEL) as ApplicantSort[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {APPLICANT_SORT_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {list.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : list.isError ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No pudimos cargar tus postulaciones.{" "}
          <button type="button" className="underline" onClick={() => void list.refetch()}>
            Reintentar
          </button>
        </Card>
      ) : cards.length === 0 ? (
        <Card className="p-8 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">Sin postulaciones aún</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Publica una necesidad u oferta y avisamos a los profesionales cercanos. Cuando alguien
            se postule, lo verás aquí al instante.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {summary.toAnswer} {summary.toAnswer === 1 ? "te espera" : "te esperan"} ·{" "}
            {summary.waiting} en espera de respuesta · {summary.accepted}{" "}
            {summary.accepted === 1 ? "aceptada" : "aceptadas"}
          </p>
          {plan === "free" && (
            <Card className="flex flex-wrap items-center justify-between gap-2 border-copper/40 bg-copper/5 p-3 text-xs">
              <span className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-copper" aria-hidden />
                <span>
                  Con el plan gratuito ves nombres abreviados y puedes aceptar o rechazar. Con el{" "}
                  <strong>plan Familiar</strong>: nombre completo, WhatsApp del profesional y
                  negociar el valor.
                </span>
              </span>
              <Button size="sm" variant="copper" asChild>
                <Link to="/planes">Ver planes</Link>
              </Button>
            </Card>
          )}
          {(
            [
              ["Te toca responder", groups.action],
              ["Esperando respuesta del profesional", groups.waiting],
              ["Aceptadas", groups.done],
            ] as const
          ).map(([title, items]) =>
            items.length === 0 ? null : (
              <div key={title} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {title}
                </h3>
                <div className="grid gap-3">
                  {items.map((c) => (
                    <Applicant
                      key={c.key}
                      card={c}
                      familyName={familyName}
                      revealed={revealed[c.key]}
                      busyKey={busyKey}
                      onAccept={askAccept}
                      onReject={(card) => setPending({ kind: "reject", card })}
                      onCounter={(card) => setPending({ kind: "counter", card })}
                      onReveal={doReveal}
                    />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {/* Confirmaciones */}
      <AlertDialog open={pending?.kind === "accept"} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aceptar a {pending?.card.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.card ? priceLine(pending.card) : ""}. Se crea la reserva y se avisa al
              profesional. Los pagos se hacen solo en la página web de Humanix.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pending?.kind === "accept")
                  doAccept(pending.card, defaultAcceptShifts(pending.card) ?? undefined);
              }}
            >
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pending?.kind === "reject"} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Rechazar la postulación de {pending?.card.displayName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Le avisamos que no continúas con su propuesta. Puedes seguir recibiendo otras
              postulaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pending?.kind === "reject") doReject(pending.card);
              }}
            >
              Rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pending?.kind === "schedule" && (
        <ScheduleDialog
          card={pending.card}
          open
          busy={accept.isPending}
          onOpenChange={(o) => !o && setPending(null)}
          onConfirm={(shifts) => doAccept(pending.card, shifts)}
        />
      )}

      {pending?.kind === "counter" && pending.card.source === "slots" && (
        <CounterOfferDialog
          target={{
            id: pending.card.id,
            hourly_rate: pending.card.amount,
            posted_rate: pending.card.postedAmount,
            round_no: pending.card.round,
            my_last_offer: null,
            peer_city: pending.card.city,
          }}
          role="family"
          hours={pending.card.hours ?? 1}
          commissionPct={0}
          open
          onOpenChange={(o) => !o && setPending(null)}
          onDone={refreshAfterCounter}
        />
      )}
      {pending?.kind === "counter" && pending.card.source === "offer" && (
        <OfferCounterDialog
          target={{
            applicationId: pending.card.id,
            title: pending.card.title,
            modality: pending.card.modality,
            posted: pending.card.postedAmount ?? pending.card.amount,
            currentOffer: pending.card.amount,
            round: pending.card.round,
            myLastOffer: null,
            shiftHours:
              pending.card.startsAt && pending.card.endsAt
                ? [hoursBetween(pending.card.startsAt, pending.card.endsAt)]
                : [],
          }}
          role="institution"
          kind="counter"
          commissionPct={0}
          open
          onOpenChange={(o) => !o && setPending(null)}
          onDone={refreshAfterCounter}
        />
      )}
    </section>
  );
}
