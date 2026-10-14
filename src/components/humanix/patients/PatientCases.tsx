// Los casos de un paciente: abrir, editar, cerrar (con desenlace y, si se quiere, la valoración del servicio) y valorar después. Cada caso
// muestra su avance contra la fecha estimada. Cerrar o valorar son acciones del servidor: aquí solo se piden los datos.
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CheckCircle2, FolderPlus, Loader2, Pencil, Star, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AcceptedApplication, CareActions } from "@/hooks/use-inst-care";
import {
  CARE_TYPE_META,
  CASE_STATUS_META,
  OUTCOME_LABEL,
  PRIORITY_META,
  caseProgress,
  dateLabel,
  dayClockLabel,
  type Clock,
} from "@/lib/instCare";
import type { InstCase, InstPatient } from "@/lib/instCareTypes";
import {
  CARE_TYPE_OPTIONS,
  CASE_FORM_DEFAULTS,
  OUTCOME_OPTIONS,
  PRIORITY_OPTIONS,
  SATISFACTION_BY_OPTIONS,
  bogotaToday,
  caseEditPayload,
  caseFormSchema,
  casePayload,
  caseToFormValues,
  closeCasePayload,
  closeCaseSchema,
  type CaseFormValues,
  type CloseCaseValues,
} from "@/lib/instForms";
import { cn } from "@/lib/utils";
import { SelectField, TextAreaField, TextField } from "@/components/humanix/instcare/fields";
import { TONE } from "@/components/humanix/instcare/tones";

/** Cinco estrellas para elegir (accesibles con teclado: es un grupo de botones de opción). */
export function StarPicker({
  value,
  onChange,
  label = "Valoración",
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          onClick={() => onChange(value === n ? 0 : n)}
          className="rounded-md p-0.5 transition-transform hover:scale-110 focus-premium motion-reduce:transition-none"
        >
          <Star
            className={cn(
              "h-6 w-6",
              n <= value ? "fill-copper text-copper" : "text-muted-foreground/40",
            )}
            aria-hidden
          />
        </button>
      ))}
      <span className="ml-2 text-xs text-muted-foreground" aria-live="polite">
        {value === 0 ? "Sin valorar" : `${value} de 5`}
      </span>
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${n} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i <= n ? "fill-copper text-copper" : "text-muted-foreground/30",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

// ── Abrir o editar un caso ───────────────────────────────────────────────────────────────────────────────────────────

export function CaseDialog({
  open,
  onOpenChange,
  actions,
  patient,
  existing,
  applications,
  presetApplicationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  patient: Pick<InstPatient, "id" | "full_name">;
  /** Con caso: se edita; sin él: se abre uno nuevo. */
  existing?: InstCase | null;
  applications: AcceptedApplication[];
  presetApplicationId?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CaseFormValues>({
    resolver: zodResolver(caseFormSchema),
    defaultValues: CASE_FORM_DEFAULTS,
    mode: "onTouched",
  });
  const applicationId = form.watch("application_id");
  const application = applications.find((a) => a.application_id === applicationId) ?? null;
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (existing) {
      form.reset(caseToFormValues(existing));
    } else {
      const preset = applications.find((a) => a.application_id === presetApplicationId);
      form.reset({
        ...CASE_FORM_DEFAULTS,
        ...(preset ? { application_id: preset.application_id, title: preset.offer_title } : {}),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, presetApplicationId]);

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      if (existing) {
        await actions.updateCase.mutateAsync({
          id: existing.id,
          data: caseEditPayload(v, !!existing.application_id),
        });
        toast.success("Caso actualizado");
      } else {
        await actions.openCase.mutateAsync({ patientId: patient.id, data: casePayload(v) });
        toast.success("Caso abierto");
      }
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" data-testid="case-form">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-copper" aria-hidden />{" "}
            {existing ? "Editar caso" : "Abrir un caso"}
          </DialogTitle>
          <DialogDescription>
            {patient.full_name}. Un caso reúne el servicio, quién lo presta y su seguimiento.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="space-y-3"
          aria-label={existing ? "Editar caso" : "Abrir un caso"}
        >
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!existing && applications.length > 0 && (
            <SelectField
              form={form}
              name="application_id"
              label="Desde una postulación aceptada"
              allowEmpty
              emptyLabel="Caso manual (sin postulación)"
              options={applications.map((a) => ({
                value: a.application_id,
                label: `${a.offer_title}${a.professional_label ? ` · ${a.professional_label}` : ""}`,
              }))}
            />
          )}
          <TextField
            form={form}
            name="title"
            label="Título del caso"
            required
            placeholder="Ej.: Curaciones posoperatorias"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              form={form}
              name="care_type"
              label="Tipo de cuidado"
              options={CARE_TYPE_OPTIONS}
            />
            <SelectField form={form} name="priority" label="Prioridad" options={PRIORITY_OPTIONS} />
            <TextField
              form={form}
              name="target_date"
              label="Fecha estimada de cierre"
              type="date"
              min={bogotaToday()}
            />
            {!application && !existing?.application_id && (
              <TextField
                form={form}
                name="professional_label"
                label="Profesional a cargo"
                placeholder="Opcional"
              />
            )}
          </div>
          <TextAreaField form={form} name="summary" label="Resumen" rows={3} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              {existing ? "Guardar" : "Abrir caso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Cerrar un caso ───────────────────────────────────────────────────────────────────────────────────────────────────

export function CloseCaseDialog({
  open,
  onOpenChange,
  actions,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  target: InstCase | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CloseCaseValues>({
    resolver: zodResolver(closeCaseSchema),
    defaultValues: {
      status: "completed",
      outcome: "recovered",
      satisfaction: 0,
      by: "coordinator",
      note: "",
    },
  });
  const status = form.watch("status");
  const stars = form.watch("satisfaction");
  const { isSubmitting } = form.formState;

  useEffect(() => {
    if (open) {
      setError(null);
      form.reset({
        status: "completed",
        outcome: "recovered",
        satisfaction: 0,
        by: "coordinator",
        note: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  const submit = form.handleSubmit(async (v) => {
    if (!target) return;
    setError(null);
    try {
      await actions.closeCase.mutateAsync({ id: target.id, ...closeCasePayload(v) });
      toast.success(v.status === "completed" ? "Caso completado" : "Caso cancelado");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="close-case">
        <DialogHeader>
          <DialogTitle>Cerrar el caso</DialogTitle>
          <DialogDescription>
            {target?.title}. Al cerrarlo se omiten sus tareas pendientes; queda en la historia.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-3" aria-label="Cerrar el caso">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <SelectField
            form={form}
            name="status"
            label="¿Cómo termina?"
            options={[
              { value: "completed", label: "Completado" },
              { value: "cancelled", label: "Cancelado" },
            ]}
          />
          <SelectField form={form} name="outcome" label="Desenlace" options={OUTCOME_OPTIONS} />
          {status === "completed" && (
            <div className="space-y-2 rounded-2xl border border-copper/30 bg-copper/5 p-3">
              <Label className="text-xs font-medium">¿Cómo valoran el servicio? (opcional)</Label>
              <StarPicker
                value={stars}
                onChange={(n) => form.setValue("satisfaction", n, { shouldValidate: true })}
              />
              {stars > 0 && (
                <>
                  <SelectField
                    form={form}
                    name="by"
                    label="Quién valora"
                    options={SATISFACTION_BY_OPTIONS}
                  />
                  <TextAreaField
                    form={form}
                    name="note"
                    label="Comentario"
                    rows={2}
                    placeholder="Opcional"
                  />
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={status === "completed" ? "hero" : "destructive"}
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              {status === "completed" ? "Completar caso" : "Cancelar caso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Valorar un caso ya completado ────────────────────────────────────────────────────────────────────────────────────

export function RateCaseDialog({
  open,
  onOpenChange,
  actions,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CareActions;
  target: InstCase | null;
}) {
  const [stars, setStars] = useState(0);
  const [by, setBy] = useState<string>("coordinator");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setStars(target?.satisfaction ?? 0);
      setBy(target?.satisfaction_by ?? "coordinator");
      setNote(target?.satisfaction_note ?? "");
      setError(null);
    }
  }, [open, target]);
  const save = async () => {
    if (!target || stars < 1) return;
    setBusy(true);
    setError(null);
    try {
      await actions.rateCase.mutateAsync({ id: target.id, satisfaction: stars, by, note });
      toast.success("Valoración guardada");
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md" data-testid="rate-case">
        <DialogHeader>
          <DialogTitle>Valorar el servicio</DialogTitle>
          <DialogDescription>{target?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <StarPicker value={stars} onChange={setStars} />
          <div className="space-y-1.5">
            <Label htmlFor="rate-by" className="text-xs font-medium">
              Quién valora
            </Label>
            <Select value={by} onValueChange={setBy}>
              <SelectTrigger id="rate-by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SATISFACTION_BY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rate-note" className="text-xs font-medium">
              Comentario
            </Label>
            <Textarea
              id="rate-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={2}
              placeholder="Opcional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="hero"
            onClick={() => void save()}
            disabled={busy || stars < 1}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />} Guardar valoración
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Lista de casos ───────────────────────────────────────────────────────────────────────────────────────────────────

export function CasesPanel({
  cases,
  now,
  canWrite,
  onOpen,
  onEdit,
  onClose,
  onRate,
}: {
  cases: InstCase[];
  now: Clock;
  canWrite: boolean;
  onOpen: () => void;
  onEdit: (c: InstCase) => void;
  onClose: (c: InstCase) => void;
  onRate: (c: InstCase) => void;
}) {
  return (
    <div className="space-y-3" data-testid="cases-panel">
      {canWrite && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={onOpen}>
            <FolderPlus aria-hidden /> Abrir un caso
          </Button>
        </div>
      )}
      {cases.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Todavía no hay casos. Abre el primero para coordinar el servicio, la persona que lo presta
          y su seguimiento.
        </p>
      ) : (
        <ul className="space-y-3">
          {cases.map((c) => {
            const st = CASE_STATUS_META[c.status];
            const pr = PRIORITY_META[c.priority];
            const p = caseProgress(c, now);
            const open = c.status === "active" || c.status === "pending";
            return (
              <li key={c.id}>
                <Card className="rounded-2xl p-4" data-testid="case-item" data-status={c.status}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-bold">{c.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {CARE_TYPE_META[c.care_type].label}
                        {c.professional_label ? ` · Con ${c.professional_label}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          TONE[st.tone].chip,
                        )}
                      >
                        {st.label}
                      </span>
                      {open && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            TONE[pr.tone].chip,
                          )}
                        >
                          Prioridad {pr.label.toLowerCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {p.pct !== null && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>Abierto el {dateLabel(c.opened_at)}</span>
                        <span className={cn(p.late && "font-semibold text-sos")}>{p.label}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div
                          className={cn(
                            "h-full rounded-full",
                            p.late ? "bg-sos" : open ? "bg-ok" : "bg-trust",
                          )}
                          style={{ width: `${p.pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {p.pct === null && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {p.label} · desde el {dateLabel(c.opened_at)}
                    </p>
                  )}

                  {c.summary && (
                    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                      {c.summary}
                    </p>
                  )}

                  {!open && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {c.outcome && (
                        <span className="text-muted-foreground">
                          Desenlace: {OUTCOME_LABEL[c.outcome]}
                        </span>
                      )}
                      {c.closed_at && (
                        <span className="text-muted-foreground">
                          Cerrado {dayClockLabel(c.closed_at, now)}
                        </span>
                      )}
                      {c.satisfaction !== null && (
                        <span className="inline-flex items-center gap-1.5">
                          <Stars n={c.satisfaction} />
                          {c.satisfaction_note && (
                            <span className="italic text-muted-foreground">
                              «{c.satisfaction_note}»
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  )}

                  {canWrite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {open && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onEdit(c)}
                          >
                            <Pencil aria-hidden /> Editar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onClose(c)}
                          >
                            <CheckCircle2 aria-hidden /> Cerrar caso
                          </Button>
                        </>
                      )}
                      {c.status === "completed" && (
                        <Button type="button" size="sm" variant="outline" onClick={() => onRate(c)}>
                          <Star aria-hidden />{" "}
                          {c.satisfaction === null ? "Valorar servicio" : "Cambiar valoración"}
                        </Button>
                      )}
                      {c.status === "cancelled" && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <XCircle className="h-3.5 w-3.5" aria-hidden /> Cerrado sin completar
                        </span>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
