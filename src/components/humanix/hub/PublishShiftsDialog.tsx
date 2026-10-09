import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarPlus, Loader2, Lock, Plus, Repeat, Send, Siren, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  MESSAGE_ERROR_COPY,
  bogotaToday,
  checkOutgoingMessage,
  classifyHubError,
  type ServerError,
} from "@/lib/opportunities";
import {
  MODALITY_BOUNDS,
  MODALITY_LABEL,
  MODALITY_NAME,
  amountErrorCopy,
  validatePublishedAmount,
  type OfferModality,
} from "@/lib/institutionNegotiation";
import {
  MAX_REQUIREMENTS,
  MAX_REQUIREMENT_LENGTH,
  MAX_SHIFTS_PER_OFFER,
  SHIFT_ERROR_COPY,
  WEEKDAY_LABEL,
  buildShift,
  buildShiftBatch,
  estimateBudget,
  expandPattern,
  findDuplicateShifts,
  parseRequirements,
  type ShiftDraft,
} from "@/lib/institutionShifts";
import { formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

const MODALITIES = ["shift", "hour", "month", "package"] as const;
const DAY_MS = 86_400_000;

const PRESETS: Array<{ id: string; label: string; start: string; end: string }> = [
  { id: "day", label: "Diurno 07:00–19:00", start: "07:00", end: "19:00" },
  { id: "night", label: "Nocturno 19:00–07:00", start: "19:00", end: "07:00" },
  { id: "morning", label: "Mañana 07:00–13:00", start: "07:00", end: "13:00" },
  { id: "afternoon", label: "Tarde 13:00–19:00", start: "13:00", end: "19:00" },
];

const shiftSchema = z.object({
  date: z.string(),
  start: z.string(),
  end: z.string(),
  positions: z.number().optional(),
});

const schema = z
  .object({
    title: z.string().trim().min(5, "Mínimo 5 caracteres").max(120, "Máximo 120 caracteres"),
    serviceArea: z.string().trim().max(80, "Máximo 80 caracteres"),
    specialty: z.string().trim().max(80, "Máximo 80 caracteres"),
    city: z.string().trim().min(2, "Indica la ciudad").max(80, "Máximo 80 caracteres"),
    modality: z.enum(MODALITIES),
    amount: z.number().optional(),
    isUrgent: z.boolean(),
    description: z.string().max(2000, "Máximo 2000 caracteres"),
    requirements: z.string().max(1500, "Demasiado largo"),
    address: z.string().trim().max(200, "Máximo 200 caracteres"),
    contactPhone: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\+?[\d\s().-]{7,20}$/.test(v), "Escribe un teléfono válido"),
    accessNotes: z.string().trim().max(300, "Máximo 300 caracteres"),
    shifts: z
      .array(shiftSchema)
      .min(1, "Agrega al menos un turno")
      .max(MAX_SHIFTS_PER_OFFER, `Máximo ${MAX_SHIFTS_PER_OFFER} turnos por oferta`),
  })
  .superRefine((v, ctx) => {
    const amount = validatePublishedAmount(v.modality, v.amount);
    if (!amount.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: amountErrorCopy(amount, formatCOP),
      });
    }

    // Lo público de la oferta no puede llevar datos de contacto ni de pago.
    for (const [field, text, max] of [
      ["title", v.title, 120],
      ["serviceArea", v.serviceArea, 80],
      ["description", v.description, 2000],
    ] as const) {
      const check = checkOutgoingMessage(text, { maxChars: max });
      if (!check.ok && check.reason !== "empty") {
        ctx.addIssue({ code: "custom", path: [field], message: MESSAGE_ERROR_COPY[check.reason] });
      }
    }

    const reqs = parseRequirements(v.requirements);
    if (reqs.length > MAX_REQUIREMENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["requirements"],
        message: `Máximo ${MAX_REQUIREMENTS} requisitos`,
      });
    } else if (reqs.some((r) => r.length > MAX_REQUIREMENT_LENGTH)) {
      ctx.addIssue({
        code: "custom",
        path: ["requirements"],
        message: `Cada requisito admite hasta ${MAX_REQUIREMENT_LENGTH} caracteres`,
      });
    } else {
      const check = checkOutgoingMessage(reqs.join(". "), { maxChars: 1500 });
      if (!check.ok && check.reason !== "empty") {
        ctx.addIssue({
          code: "custom",
          path: ["requirements"],
          message: MESSAGE_ERROR_COPY[check.reason],
        });
      }
    }

    const drafts = v.shifts.map<ShiftDraft>((s) => ({
      date: s.date,
      start: s.start,
      end: s.end,
      positions: s.positions ?? Number.NaN,
    }));
    drafts.forEach((draft, i) => {
      const built = buildShift(draft);
      if (built.ok) return;
      const path =
        built.reason === "same_time" || built.reason === "bad_time"
          ? "end"
          : built.reason === "positions"
            ? "positions"
            : "date";
      ctx.addIssue({
        code: "custom",
        path: ["shifts", i, path],
        message: SHIFT_ERROR_COPY[built.reason],
      });
    });
    for (const i of findDuplicateShifts(drafts)) {
      ctx.addIssue({
        code: "custom",
        path: ["shifts", i, "date"],
        message: "Este turno está repetido.",
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCity?: string;
  /** Se llama con el id de la oferta publicada. */
  onPublished?: (offerId: string) => void;
}

const numberOrUndefined = (v: unknown) => (v === "" || v == null ? undefined : Number(v));

function nextDay(date: string): string {
  const t = Date.parse(`${date}T12:00:00-05:00`);
  return Number.isFinite(t) ? bogotaToday(t + DAY_MS) : bogotaToday(Date.now() + DAY_MS);
}

/**
 * Publicar turnos de una institución: servicio, valor, agenda de turnos (diurnos, nocturnos o repetidos) y
 * datos privados. La dirección y el teléfono NO se publican: solo llegan a quien aceptes (y a quien
 * desbloquee el contacto con plan de pago). Toda la validación se repite en el servidor.
 */
export function PublishShiftsDialog({ open, onOpenChange, defaultCity, onPublished }: Props) {
  const qc = useQueryClient();
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [pattern, setPattern] = useState({
    weekdays: [1, 2, 3, 4, 5] as number[],
    from: bogotaToday(Date.now() + DAY_MS),
    to: bogotaToday(Date.now() + 14 * DAY_MS),
    start: "07:00",
    end: "19:00",
    positions: 1,
  });

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      serviceArea: "",
      specialty: "",
      city: defaultCity ?? "",
      modality: "shift",
      amount: undefined,
      isUrgent: false,
      description: "",
      requirements: "",
      address: "",
      contactPhone: "",
      accessNotes: "",
      shifts: [
        { date: bogotaToday(Date.now() + DAY_MS), start: "07:00", end: "19:00", positions: 1 },
      ],
    },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: "shifts" });

  const modality = watch("modality") as OfferModality;
  const amount = watch("amount");
  const shifts = watch("shifts");
  const bounds = MODALITY_BOUNDS[modality];

  const batch = useMemo(
    () =>
      buildShiftBatch(
        (shifts ?? []).map((s) => ({
          date: s.date,
          start: s.start,
          end: s.end,
          positions: s.positions ?? Number.NaN,
        })),
      ),
    [shifts],
  );
  const budget = amount ? estimateBudget(modality, amount, batch.shifts) : 0;

  const publish = useMutation({
    mutationFn: async (v: FormValues) => {
      const built = buildShiftBatch(
        v.shifts.map((s) => ({
          date: s.date,
          start: s.start,
          end: s.end,
          positions: s.positions ?? 1,
        })),
      );
      const { data, error } = await sb.rpc("publish_institution_offer", {
        p_offer: {
          title: v.title,
          description: v.description.trim() || null,
          modality: v.modality,
          amount: v.amount,
          city: v.city,
          specialty_required: v.specialty || null,
          service_area: v.serviceArea || null,
          is_urgent: v.isUrgent,
          requirements: parseRequirements(v.requirements),
          address: v.address || null,
          contact_phone: v.contactPhone || null,
          access_notes: v.accessNotes || null,
          shifts: built.shifts.map(({ starts_at, ends_at, positions }) => ({
            starts_at,
            ends_at,
            positions,
          })),
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (offerId) => {
      toast.success("Turnos publicados", {
        description:
          "Avisamos a los profesionales con alertas que coinciden. Verás las postulaciones en tu panel.",
      });
      void qc.invalidateQueries({ queryKey: ["inst"] });
      reset();
      onPublished?.(offerId);
      onOpenChange(false);
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const addShift = () => {
    const last = shifts?.[shifts.length - 1];
    append({
      date: last?.date ? nextDay(last.date) : bogotaToday(Date.now() + DAY_MS),
      start: last?.start || "07:00",
      end: last?.end || "19:00",
      positions: last?.positions ?? 1,
    });
  };

  const addPattern = () => {
    const drafts = expandPattern({
      from: pattern.from,
      to: pattern.to,
      weekdays: pattern.weekdays,
      start: pattern.start,
      end: pattern.end,
      positions: pattern.positions,
    });
    if (drafts.length === 0) {
      toast.error("Elige al menos un día y un rango de fechas válido (máximo 120 días).");
      return;
    }
    const current = (shifts ?? []).filter((s) => s.date && s.start && s.end);
    const known = new Set(current.map((s) => `${s.date}|${s.start}|${s.end}`));
    const fresh = drafts.filter((d) => !known.has(`${d.date}|${d.start}|${d.end}`));
    const merged = [...current, ...fresh].slice(0, MAX_SHIFTS_PER_OFFER);
    replace(merged);
    toast.success(
      `${Math.min(fresh.length, MAX_SHIFTS_PER_OFFER - current.length)} turnos agregados`,
    );
    setRepeatOpen(false);
  };

  const shiftError = (i: number, key: "date" | "start" | "end" | "positions") =>
    errors.shifts?.[i]?.[key]?.message as string | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-biosensor" aria-hidden /> Publicar turnos
          </DialogTitle>
          <DialogDescription>
            Los profesionales verificados cercanos ven el servicio, el horario y el valor. Publicar
            es gratis.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => publish.mutate(v))} className="space-y-6" noValidate>
          {/* 1. Servicio */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">1. Servicio</legend>
            <div className="space-y-1.5">
              <Label htmlFor="pub-title">Título</Label>
              <Input
                id="pub-title"
                placeholder="Enfermería UCI adultos, turno de noche"
                aria-invalid={!!errors.title}
                {...register("title")}
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pub-area">Servicio o área</Label>
                <Input
                  id="pub-area"
                  placeholder="UCI, urgencias, hospitalización…"
                  aria-invalid={!!errors.serviceArea}
                  {...register("serviceArea")}
                />
                {errors.serviceArea && (
                  <p className="text-xs text-destructive">{errors.serviceArea.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-spec">Perfil requerido</Label>
                <Input
                  id="pub-spec"
                  placeholder="Enfermería, auxiliar…"
                  aria-invalid={!!errors.specialty}
                  {...register("specialty")}
                />
                {errors.specialty && (
                  <p className="text-xs text-destructive">{errors.specialty.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-city">Ciudad</Label>
                <Input
                  id="pub-city"
                  placeholder="Bogotá"
                  aria-invalid={!!errors.city}
                  {...register("city")}
                />
                {errors.city && <p className="text-xs text-destructive">{errors.city.message}</p>}
              </div>
            </div>
          </fieldset>

          {/* 2. Valor */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">2. Valor</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pub-modality">Se paga por</Label>
                <Select
                  value={modality}
                  onValueChange={(v) =>
                    setValue("modality", v as OfferModality, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="pub-modality" aria-label="Modalidad de pago">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODALITIES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODALITY_NAME[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-amount">Valor {MODALITY_LABEL[modality]}</Label>
                <Input
                  id="pub-amount"
                  type="number"
                  inputMode="numeric"
                  step={500}
                  min={bounds.floor}
                  max={bounds.cap}
                  aria-invalid={!!errors.amount}
                  {...register("amount", { setValueAs: numberOrUndefined })}
                />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Switch
                  checked={watch("isUrgent")}
                  onCheckedChange={(v) => setValue("isUrgent", v)}
                  aria-label="Marcar como urgente"
                />
                <span className="inline-flex items-center gap-1">
                  <Siren className="h-3.5 w-3.5 text-sos" aria-hidden /> Urgente
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Rango permitido: {formatCOP(bounds.floor)} a {formatCOP(bounds.cap)} (
              {MODALITY_LABEL[modality]}). Los profesionales con plan Esencial o superior pueden
              proponer entre 0,8× y 2× de este valor; tú decides si aceptas. Los pagos se hacen
              únicamente en la página web de Humanix.
            </p>
          </fieldset>

          {/* 3. Turnos */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">3. Turnos</legend>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-accent"
                  onClick={() => {
                    const last = (shifts?.length ?? 0) - 1;
                    if (last < 0) return;
                    setValue(`shifts.${last}.start`, p.start, { shouldValidate: true });
                    setValue(`shifts.${last}.end`, p.end, { shouldValidate: true });
                  }}
                >
                  {p.label}
                </button>
              ))}
              <span className="text-[11px] text-muted-foreground">(se aplica al último turno)</span>
            </div>

            <ul className="space-y-2">
              {fields.map((field, i) => (
                <li
                  key={field.id}
                  className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1.2fr_1fr_1fr_5rem_auto] sm:items-start"
                >
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`pub-date-${i}`}>
                      Fecha
                    </Label>
                    <Input
                      id={`pub-date-${i}`}
                      type="date"
                      aria-invalid={!!shiftError(i, "date")}
                      {...register(`shifts.${i}.date`)}
                    />
                    {shiftError(i, "date") && (
                      <p className="text-[11px] text-destructive">{shiftError(i, "date")}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="sm:order-last"
                    aria-label={`Quitar el turno ${i + 1}`}
                    onClick={() => remove(i)}
                    disabled={fields.length === 1}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`pub-start-${i}`}>
                      Inicio
                    </Label>
                    <Input
                      id={`pub-start-${i}`}
                      type="time"
                      aria-invalid={!!shiftError(i, "start")}
                      {...register(`shifts.${i}.start`)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`pub-end-${i}`}>
                      Fin
                    </Label>
                    <Input
                      id={`pub-end-${i}`}
                      type="time"
                      aria-invalid={!!shiftError(i, "end")}
                      {...register(`shifts.${i}.end`)}
                    />
                    {shiftError(i, "end") && (
                      <p className="text-[11px] text-destructive">{shiftError(i, "end")}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor={`pub-pos-${i}`}>
                      Cupos
                    </Label>
                    <Input
                      id={`pub-pos-${i}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={50}
                      aria-invalid={!!shiftError(i, "positions")}
                      {...register(`shifts.${i}.positions`, { setValueAs: numberOrUndefined })}
                    />
                    {shiftError(i, "positions") && (
                      <p className="text-[11px] text-destructive">{shiftError(i, "positions")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {errors.shifts?.message && (
              <p className="text-xs text-destructive">{errors.shifts.message}</p>
            )}
            {errors.shifts?.root?.message && (
              <p className="text-xs text-destructive">{errors.shifts.root.message}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addShift}
                disabled={fields.length >= MAX_SHIFTS_PER_OFFER}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Agregar turno
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRepeatOpen((o) => !o)}
              >
                <Repeat className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Repetir un horario
              </Button>
            </div>

            {repeatOpen && (
              <div className="space-y-3 rounded-lg border border-biosensor/30 bg-biosensor/5 p-3">
                <p className="text-xs font-medium">
                  Un turno por cada día elegido entre dos fechas (hasta 120 días).
                </p>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  size="sm"
                  value={pattern.weekdays.map(String)}
                  onValueChange={(v) => setPattern((p) => ({ ...p, weekdays: v.map(Number) }))}
                  aria-label="Días de la semana"
                  className="flex-wrap justify-start"
                >
                  {WEEKDAY_LABEL.map((label, day) => (
                    <ToggleGroupItem key={label} value={String(day)} aria-label={label}>
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor="rep-from">
                      Desde
                    </Label>
                    <Input
                      id="rep-from"
                      type="date"
                      value={pattern.from}
                      onChange={(e) => setPattern((p) => ({ ...p, from: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor="rep-to">
                      Hasta
                    </Label>
                    <Input
                      id="rep-to"
                      type="date"
                      value={pattern.to}
                      onChange={(e) => setPattern((p) => ({ ...p, to: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor="rep-start">
                      Inicio
                    </Label>
                    <Input
                      id="rep-start"
                      type="time"
                      value={pattern.start}
                      onChange={(e) => setPattern((p) => ({ ...p, start: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor="rep-end">
                      Fin
                    </Label>
                    <Input
                      id="rep-end"
                      type="time"
                      value={pattern.end}
                      onChange={(e) => setPattern((p) => ({ ...p, end: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground" htmlFor="rep-pos">
                      Cupos
                    </Label>
                    <Input
                      id="rep-pos"
                      type="number"
                      min={1}
                      max={50}
                      value={pattern.positions}
                      onChange={(e) =>
                        setPattern((p) => ({
                          ...p,
                          positions: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRepeatOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button type="button" size="sm" variant="hero" onClick={addPattern}>
                    Agregar turnos
                  </Button>
                </div>
              </div>
            )}

            <p className="rounded-lg bg-muted/40 p-2 text-xs">
              <strong>{batch.shifts.length}</strong>{" "}
              {batch.shifts.length === 1 ? "turno" : "turnos"} ·{" "}
              <strong>{batch.totalPositions}</strong>{" "}
              {batch.totalPositions === 1 ? "cupo" : "cupos"} ·{" "}
              <strong>{batch.totalHours} h</strong> en total
              {budget > 0 && (
                <>
                  {" "}
                  · presupuesto estimado <strong>{formatCOP(budget)}</strong>
                </>
              )}
              .
            </p>
          </fieldset>

          {/* 4. Detalles */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">4. Detalles</legend>
            <div className="space-y-1.5">
              <Label htmlFor="pub-desc">Descripción (opcional)</Label>
              <Textarea
                id="pub-desc"
                rows={3}
                maxLength={2000}
                aria-invalid={!!errors.description}
                {...register("description")}
              />
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-reqs">Requisitos (separados por coma o por línea)</Label>
              <Textarea
                id="pub-reqs"
                rows={2}
                placeholder="RETHUS vigente, BLS, experiencia en UCI"
                aria-invalid={!!errors.requirements}
                {...register("requirements")}
              />
              {errors.requirements && (
                <p className="text-xs text-destructive">{errors.requirements.message}</p>
              )}
            </div>
          </fieldset>

          {/* 5. Privado */}
          <fieldset className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <Lock className="h-3.5 w-3.5" aria-hidden /> 5. Datos privados
            </legend>
            <p className="text-xs text-muted-foreground">
              No se publican. La dirección llega al profesional cuando aceptas su postulación; el
              teléfono y las indicaciones de acceso, a quien desbloquee el contacto con un plan de
              pago. Si dejas la dirección vacía usamos la de tu perfil.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pub-address">Dirección del servicio</Label>
                <Input
                  id="pub-address"
                  autoComplete="off"
                  aria-invalid={!!errors.address}
                  {...register("address")}
                />
                {errors.address && (
                  <p className="text-xs text-destructive">{errors.address.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pub-phone">WhatsApp / teléfono de contacto</Label>
                <Input
                  id="pub-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  aria-invalid={!!errors.contactPhone}
                  {...register("contactPhone")}
                />
                {errors.contactPhone && (
                  <p className="text-xs text-destructive">{errors.contactPhone.message}</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-access">Cómo ingresar (portería, piso, a quién preguntar)</Label>
              <Textarea
                id="pub-access"
                rows={2}
                maxLength={300}
                aria-invalid={!!errors.accessNotes}
                {...register("accessNotes")}
              />
              {errors.accessNotes && (
                <p className="text-xs text-destructive">{errors.accessNotes.message}</p>
              )}
            </div>
          </fieldset>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={publish.isPending}>
              {publish.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              Publicar turnos
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
