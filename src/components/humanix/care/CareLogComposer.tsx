// El profesional escribe el parte del turno: atajos de un toque, signos vitales con señales de rango y alertas
// que avisan al instante a la familia y a su círculo. Los registros no se editan ni se borran (bitácora de
// solo-agregar): por eso el formulario pide confirmar antes de enviar y la base de datos impone las reglas.
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  AlertTriangle,
  FileText,
  Loader2,
  Lock,
  PersonStanding,
  Pill,
  Send,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAddCareLog, friendlyError } from "@/hooks/use-care-loop";
import {
  ALERT_REASON_MAX,
  CARE_MOODS,
  CARE_PRESETS,
  DESCRIPTION_MAX,
  EVENT_META,
  MANUAL_EVENT_TYPES,
  MOOD_META,
  VITALS_DISCLAIMER,
  VITAL_LIMITS,
  careLogFormSchema,
  parseLooseVitals,
  suggestsAlert,
  vitalFlags,
  type CareLogFormInput,
  type CareLogFormValues,
  type CarePreset,
  type ManualEventType,
} from "@/lib/careLog";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<ManualEventType, React.ElementType> = {
  medication: Pill,
  vital_signs: Activity,
  meal: Utensils,
  activity: PersonStanding,
  note: FileText,
  incident: AlertTriangle,
};

const DEFAULTS: CareLogFormInput = {
  eventType: "note",
  description: "",
  mood: "",
  isAlert: false,
  alertReason: "",
  systolic: "",
  diastolic: "",
  heartRate: "",
  temperature: "",
  oxygen: "",
};

type Props = {
  bookingId: string;
  professionalId: string;
  /** Solo se escribe con el servicio en curso (lo impone también la base de datos). */
  status: string;
  patientName?: string | null;
  onLogged?: () => void;
};

export function CareLogComposer({
  bookingId,
  professionalId,
  status,
  patientName,
  onLogged,
}: Props) {
  const add = useAddCareLog(bookingId, professionalId, patientName);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    control,
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CareLogFormInput, unknown, CareLogFormValues>({
    resolver: zodResolver(careLogFormSchema),
    defaultValues: DEFAULTS,
  });

  const eventType = watch("eventType");
  const description = watch("description") ?? "";
  const isAlert = watch("isAlert") === true || eventType === "incident";
  const mood = watch("mood");
  const flags =
    eventType === "vital_signs"
      ? vitalFlags(
          parseLooseVitals({
            systolic: watch("systolic"),
            diastolic: watch("diastolic"),
            heartRate: watch("heartRate"),
            temperature: watch("temperature"),
            oxygen: watch("oxygen"),
          }),
        )
      : [];

  // Un incidente siempre es alerta.
  useEffect(() => {
    if (eventType === "incident") setValue("isAlert", true);
  }, [eventType, setValue]);

  if (status !== "in_progress") {
    return (
      <Card className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {status === "completed"
            ? "El servicio ya terminó: el parte quedó cerrado y la familia puede verlo completo."
            : "El parte del turno se abre cuando marcas «Llegué al sitio». Desde ahí cada registro llega en vivo a la familia."}
        </p>
      </Card>
    );
  }

  const applyPreset = (p: CarePreset) => {
    setValue("eventType", p.type, { shouldValidate: true, shouldDirty: true });
    setValue("description", p.text, { shouldValidate: true, shouldDirty: true });
    setValue("mood", p.mood ?? "", { shouldDirty: true });
    descRef.current?.focus();
  };

  const onSubmit = (values: CareLogFormValues) => {
    add.mutate(values, {
      onSuccess: () => {
        toast.success(
          values.eventType === "incident" || values.isAlert
            ? "Alerta enviada a la familia"
            : "Registrado · la familia lo ve al instante",
        );
        reset(DEFAULTS);
        onLogged?.();
      },
      onError: (err) =>
        toast.error(friendlyError(err, "No se pudo guardar el registro. Inténtalo de nuevo.")),
    });
  };

  const descRegister = register("description");

  return (
    <Card className="space-y-4 p-4 sm:p-5" aria-label="Registrar en el parte del turno">
      <div>
        <h2 className="font-display text-base font-semibold">Registrar en el parte</h2>
        <p className="text-xs text-muted-foreground">
          La familia y su círculo de cuidado lo ven al instante. Toca un atajo o escribe.
          {patientName ? ` Paciente: ${patientName}.` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atajos de un toque">
        {CARE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-biosensor/50 hover:bg-biosensor/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
            Tipo de registro
          </legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {MANUAL_EVENT_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t];
              const selected = eventType === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setValue("eventType", t, { shouldValidate: true, shouldDirty: true })
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? cn(EVENT_META[t].tone, "border-current shadow-sm")
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {EVENT_META[t].label}
                </button>
              );
            })}
          </div>
          {errors.eventType?.message && (
            <p className="mt-1 text-xs text-destructive">{errors.eventType.message}</p>
          )}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={`care-desc-${bookingId}`} className="text-sm font-medium">
            ¿Qué pasó?
          </Label>
          <Textarea
            id={`care-desc-${bookingId}`}
            rows={3}
            maxLength={DESCRIPTION_MAX + 50}
            placeholder="Ej.: Tomó su losartán a las 8:00 y desayunó completo."
            aria-invalid={!!errors.description}
            {...descRegister}
            ref={(el) => {
              descRegister.ref(el);
              descRef.current = el;
            }}
          />
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-destructive" role="alert">
              {errors.description?.message}
            </p>
            <p
              className={cn(
                "shrink-0 text-xs",
                description.length > DESCRIPTION_MAX ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {description.length}/{DESCRIPTION_MAX}
            </p>
          </div>
        </div>

        {eventType === "vital_signs" && (
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Signos vitales
            </legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  ["systolic", "Sistólica"],
                  ["diastolic", "Diastólica"],
                  ["heartRate", "FC"],
                  ["temperature", "Temp. °C"],
                  ["oxygen", "SpO₂ %"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`care-${key}-${bookingId}`} className="text-xs">
                    {label}
                  </Label>
                  <Input
                    id={`care-${key}-${bookingId}`}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={`${VITAL_LIMITS[key].min}–${VITAL_LIMITS[key].max}`}
                    aria-invalid={!!errors[key]}
                    {...register(key)}
                  />
                  {errors[key]?.message && (
                    <p className="text-[11px] text-destructive">{errors[key]?.message as string}</p>
                  )}
                </div>
              ))}
            </div>
            {flags.length > 0 && (
              <div
                className={cn(
                  "rounded-lg border p-2.5 text-xs",
                  suggestsAlert(flags) ? "border-sos/40 bg-sos/5" : "border-warn/40 bg-warn/5",
                )}
              >
                <ul className="space-y-0.5 font-medium">
                  {flags.map((f) => (
                    <li
                      key={`${f.key}-${f.level}`}
                      className={f.level === "alert" ? "text-sos" : "text-warn"}
                    >
                      {f.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">{VITALS_DISCLAIMER}</p>
                {suggestsAlert(flags) && !isAlert && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 border-sos/50 text-sos"
                    onClick={() => setValue("isAlert", true, { shouldDirty: true })}
                  >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Avisar a la
                    familia como alerta
                  </Button>
                )}
              </div>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
            ¿Cómo está de ánimo? (opcional)
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CARE_MOODS.map((m) => {
              const selected = mood === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setValue("mood", selected ? "" : m, { shouldDirty: true })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? cn(MOOD_META[m].tone, "border-current")
                      : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <span aria-hidden="true">{MOOD_META[m].emoji}</span> {MOOD_META[m].label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div
          className={cn(
            "space-y-2 rounded-xl border p-3",
            isAlert ? "border-sos/40 bg-sos/5" : "border-border",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor={`care-alert-${bookingId}`} className="text-sm font-medium">
                Marcar como alerta
              </Label>
              <p className="text-xs text-muted-foreground">
                {eventType === "incident"
                  ? "Un incidente siempre avisa de inmediato a la familia."
                  : "Avisa al instante a la familia y a su círculo de cuidado."}
              </p>
            </div>
            <Controller
              control={control}
              name="isAlert"
              render={({ field }) => (
                <Switch
                  id={`care-alert-${bookingId}`}
                  checked={isAlert}
                  disabled={eventType === "incident"}
                  onCheckedChange={(v) => field.onChange(v)}
                />
              )}
            />
          </div>
          {isAlert && (
            <div className="space-y-1">
              <Label htmlFor={`care-reason-${bookingId}`} className="text-xs">
                Motivo corto (opcional)
              </Label>
              <Input
                id={`care-reason-${bookingId}`}
                maxLength={ALERT_REASON_MAX}
                placeholder="Ej.: Saturación 89 %, se elevó la cabecera"
                {...register("alertReason")}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-[11px] text-muted-foreground">
            Los registros no se pueden editar ni borrar: revisa antes de enviar. No incluyas
            teléfonos, correos ni datos de pago.
          </p>
          <Button type="submit" variant="hero" disabled={add.isPending} className="gap-2">
            {add.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isAlert ? "Enviar alerta" : "Registrar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
