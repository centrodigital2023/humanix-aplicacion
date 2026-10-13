import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import {
  ServiceOfferError,
  useMyServiceOffers,
  useServiceOfferActions,
} from "@/hooks/use-service-offers";
import { MODALITY_BOUNDS, MODALITY_LABEL, MODALITY_NAME } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import {
  MAX_ACTIVE_SERVICE_OFFERS,
  SERVICE_STATUS_LABEL,
  buildServiceOfferSchema,
  countActiveServiceOffers,
  isoToBogotaDate,
  myOfferHeadline,
  serviceOfferFormDefaults,
  type MyServiceOffer,
  type ServiceOfferFormValues,
} from "@/lib/serviceOffers";
import { cn } from "@/lib/utils";

export interface MyServiceOffersProfile {
  specialty: string | null;
  city: string | null;
  hourlyRate: number | null;
  /** El perfil está publicado: sin eso ninguna oferta se muestra a familias ni instituciones. */
  published: boolean;
}

const STATUS_STYLE = {
  visible: "border-ok/40 bg-ok/10 text-ok",
  paused: "border-warn/40 bg-warn/10 text-warn",
  closed: "border-border bg-muted text-muted-foreground",
  blocked: "border-sos/40 bg-sos/10 text-sos",
} as const;

function statusOf(o: MyServiceOffer): { label: string; style: string } {
  if (o.blocked) return { label: "Bloqueada", style: STATUS_STYLE.blocked };
  if (o.status === "closed")
    return { label: SERVICE_STATUS_LABEL.closed, style: STATUS_STYLE.closed };
  if (o.status === "paused")
    return { label: SERVICE_STATUS_LABEL.paused, style: STATUS_STYLE.paused };
  return o.visible
    ? { label: SERVICE_STATUS_LABEL.open, style: STATUS_STYLE.visible }
    : { label: "Vencida", style: STATUS_STYLE.closed };
}

/**
 * «Mi oferta de servicio»: el profesional publica cómo y cuánto cobra. Familias e instituciones la ven con su Trust Score, su RETHUS y su
 * calificación (nunca su teléfono ni su dirección). La base modera el texto —sin groserías, sin venta de artículos, solo salud y
 * cuidado, sin teléfonos ni enlaces— y limita a 5 ofertas vigentes.
 */
export function MyServiceOffers({
  userId,
  profile,
  onGoToProfile,
}: {
  userId: string;
  profile: MyServiceOffersProfile;
  onGoToProfile?: () => void;
}) {
  const offers = useMyServiceOffers(userId);
  const actions = useServiceOfferActions(userId);
  const [editing, setEditing] = useState<MyServiceOffer | "new" | null>(null);
  const [deleting, setDeleting] = useState<MyServiceOffer | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = offers.data ?? [];
  const active = countActiveServiceOffers(list);
  const atLimit = active >= MAX_ACTIVE_SERVICE_OFFERS;

  const changeStatus = async (o: MyServiceOffer, status: "open" | "paused" | "closed") => {
    setBusyId(o.id);
    try {
      await actions.setStatus.mutateAsync({ id: o.id, status });
      toast.success(
        status === "open"
          ? "Tu oferta está publicada"
          : status === "paused"
            ? "Pausaste tu oferta"
            : "Cerraste tu oferta",
      );
    } catch (e) {
      toast.error(e instanceof ServiceOfferError ? e.message : "No pudimos cambiar tu oferta.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await actions.remove.mutateAsync(deleting.id);
      toast.success("Eliminaste tu oferta");
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof ServiceOfferError ? e.message : "No pudimos eliminar tu oferta.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      id="mi-oferta"
      aria-label="Mi oferta de servicio"
      className="scroll-mt-4 space-y-4 rounded-2xl border border-border bg-card/95 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold">
            <Megaphone className="h-4 w-4 text-biosensor" aria-hidden /> Mi oferta de servicio
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Publica cómo y cuánto cobras. Las familias y las EPS/IPS la ven con tu Trust Score, tu
            RETHUS y tu calificación; el contacto se desbloquea según tu plan y los pagos se hacen
            solo en la página web.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs text-muted-foreground"
            data-testid="service-offers-count"
            aria-label={`${active} de ${MAX_ACTIVE_SERVICE_OFFERS} ofertas vigentes`}
          >
            {active} de {MAX_ACTIVE_SERVICE_OFFERS} vigentes
          </span>
          <Button
            size="sm"
            variant="hero"
            onClick={() => setEditing("new")}
            disabled={atLimit}
            title={atLimit ? "Cierra o elimina una oferta para publicar otra" : undefined}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Publicar oferta
          </Button>
        </div>
      </div>

      {!profile.published && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
          <span>
            Tu perfil aún no está publicado: puedes preparar tus ofertas, pero familias e
            instituciones no las verán hasta que publiques tu perfil.{" "}
            {onGoToProfile && (
              <button
                type="button"
                className="font-medium text-biosensor underline-offset-2 hover:underline"
                onClick={onGoToProfile}
              >
                Ir a mi perfil
              </button>
            )}
          </span>
        </p>
      )}

      {offers.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando tus ofertas">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : offers.error ? (
        <Card className="space-y-2 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-warn" aria-hidden />
            {/relation .* does not exist|schema cache|professional_service_offers/i.test(
              offers.error.message,
            )
              ? "Estamos activando «Mi oferta de servicio»"
              : "No pudimos cargar tus ofertas"}
          </p>
          <p className="text-xs text-muted-foreground">
            Vuelve a intentarlo en unos minutos.{" "}
            <button
              type="button"
              className="font-medium text-biosensor hover:underline"
              onClick={() => void offers.refetch()}
            >
              Reintentar
            </button>
          </p>
        </Card>
      ) : list.length === 0 ? (
        <Card className="space-y-2 border-dashed p-5 text-center text-sm">
          <p className="font-semibold">Aún no publicas tu oferta</p>
          <p className="text-xs text-muted-foreground">
            Cuéntales a las familias qué cuidado ofreces, en qué ciudad y cuánto cobras. Es la forma
            más rápida de que te encuentren.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Mis ofertas de servicio">
          {list.map((o) => {
            const st = statusOf(o);
            const busy = busyId === o.id;
            return (
              <li key={o.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{o.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[o.specialty, o.city].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("text-[11px]", st.style)}>
                    {st.label}
                  </Badge>
                </div>
                <p className="text-sm font-semibold">
                  {formatCOP(o.amount)} {MODALITY_LABEL[o.modality]}
                  {o.availableUntil && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                      <CalendarDays className="h-3 w-3" aria-hidden /> hasta{" "}
                      {isoToBogotaDate(o.availableUntil)}
                    </span>
                  )}
                </p>
                <p
                  className={cn(
                    "flex items-start gap-1.5 text-xs",
                    o.blocked ? "text-sos" : "text-muted-foreground",
                  )}
                >
                  {o.blocked ? (
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : o.visible ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                  ) : null}
                  {myOfferHeadline(o)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {o.status === "open" && !o.blocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void changeStatus(o, "paused")}
                    >
                      <Pause className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Pausar
                    </Button>
                  )}
                  {(o.status === "paused" || o.status === "closed") && !o.blocked && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || (o.status === "closed" && atLimit)}
                      title={
                        o.status === "closed" && atLimit
                          ? "Ya tienes 5 ofertas vigentes: cierra o elimina una"
                          : undefined
                      }
                      onClick={() => void changeStatus(o, "open")}
                    >
                      <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />{" "}
                      {o.status === "paused" ? "Reanudar" : "Reabrir"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(o)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Editar
                  </Button>
                  {o.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void changeStatus(o, "closed")}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Cerrar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-sos hover:text-sos"
                    disabled={busy}
                    onClick={() => setDeleting(o)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Eliminar
                  </Button>
                  {busy && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <ServiceOfferDialog
          key={editing === "new" ? "new" : editing.id}
          existing={editing === "new" ? null : editing}
          profile={profile}
          onClose={() => setEditing(null)}
          save={async (values) => {
            if (editing === "new") await actions.create.mutateAsync(values);
            else await actions.update.mutateAsync({ id: editing.id, values });
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta oferta?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleting?.title}» dejará de mostrarse a familias e instituciones y no podrás
              recuperarla. Si solo quieres dejar de recibir interesados por un tiempo, mejor ponla
              en pausa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conservarla</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ServiceOfferDialog({
  existing,
  profile,
  onClose,
  save,
}: {
  existing: MyServiceOffer | null;
  profile: MyServiceOffersProfile;
  onClose: () => void;
  save: (values: ServiceOfferFormValues) => Promise<void>;
}) {
  const schema = useMemo(() => buildServiceOfferSchema(Date.now()), []);
  const defaults = useMemo(() => serviceOfferFormDefaults(existing, profile), [existing, profile]);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ServiceOfferFormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    // Sin valor todavía (oferta nueva sin tarifa en el perfil): el campo queda vacío y pide escribirlo.
    defaultValues: { ...defaults, amount: defaults.amount > 0 ? defaults.amount : undefined },
  });
  const modality = watch("modality");
  const description = watch("description") ?? "";
  const bounds = MODALITY_BOUNDS[modality];
  const today = isoToBogotaDate(new Date().toISOString());

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save(values);
      toast.success(existing ? "Cambios guardados" : "Tu oferta está publicada", {
        description: existing
          ? "Si cambiaste el texto, volvimos a revisarlo."
          : "Familias e instituciones ya pueden verla con tu Trust Score.",
      });
      onClose();
    } catch (e) {
      const kind = e instanceof ServiceOfferError ? e.kind : "other";
      const message = e instanceof Error ? e.message : "No pudimos guardar tu oferta.";
      if (kind === "rude" || kind === "sale") setError("title", { message });
      else if (kind === "offtopic" || kind === "contact") setError("description", { message });
      else setFormError(message);
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !isSubmitting && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Editar mi oferta de servicio" : "Publicar mi oferta de servicio"}
          </DialogTitle>
          <DialogDescription>
            Solo ofertas de salud y cuidado. Sin teléfonos, correos, enlaces ni datos de pago: el
            contacto se desbloquea según tu plan.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="so-title">Título</Label>
            <Input
              id="so-title"
              maxLength={120}
              placeholder="Ej.: Enfermera profesional para cuidado domiciliario"
              aria-invalid={!!errors.title}
              {...register("title")}
            />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="so-specialty">Especialidad (opcional)</Label>
              <Input
                id="so-specialty"
                maxLength={80}
                placeholder="Ej.: Enfermería, Fisioterapia"
                aria-invalid={!!errors.specialty}
                {...register("specialty")}
              />
              {errors.specialty && (
                <p className="text-xs text-destructive">{errors.specialty.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-city">Ciudad</Label>
              <Input
                id="so-city"
                maxLength={80}
                placeholder="Ej.: Bogotá"
                aria-invalid={!!errors.city}
                {...register("city")}
              />
              {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="so-description">Descripción (opcional)</Label>
              <span className="text-xs text-muted-foreground">{description.length}/800</span>
            </div>
            <Textarea
              id="so-description"
              rows={4}
              maxLength={800}
              placeholder="Qué cuidado ofreces, tu experiencia y en qué horarios."
              aria-invalid={!!errors.description}
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-destructive">{errors.description.message}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="so-modality">Cobras</Label>
              <Select
                value={modality}
                onValueChange={(v) =>
                  setValue("modality", v as ServiceOfferFormValues["modality"], {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger id="so-modality" aria-label="Modalidad de cobro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["hour", "shift", "month", "package"] as const).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODALITY_NAME[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="so-amount">Valor {MODALITY_LABEL[modality]} (COP)</Label>
              <Input
                id="so-amount"
                type="number"
                inputMode="numeric"
                step={500}
                min={bounds.floor}
                max={bounds.cap}
                aria-invalid={!!errors.amount}
                {...register("amount", {
                  setValueAs: (v) => (v === "" || v == null ? Number.NaN : Number(v)),
                })}
              />
              {errors.amount ? (
                <p className="text-xs text-destructive">{errors.amount.message}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Entre {formatCOP(bounds.floor)} y {formatCOP(bounds.cap)}{" "}
                  {MODALITY_LABEL[modality]}.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="so-until">Ofreces tu servicio hasta (opcional)</Label>
            <Input
              id="so-until"
              type="date"
              min={today}
              aria-invalid={!!errors.availableUntil}
              {...register("availableUntil")}
            />
            {errors.availableUntil ? (
              <p className="text-xs text-destructive">{errors.availableUntil.message}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Sin fecha, tu oferta sigue publicada hasta que la pauses o la cierres.
              </p>
            )}
          </div>

          {formError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-sos/40 bg-sos/10 p-3 text-xs text-sos"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {formError}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {existing ? "Guardar cambios" : "Publicar oferta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
