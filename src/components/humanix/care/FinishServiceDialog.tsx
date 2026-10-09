// Cierre del turno. El profesional deja el último ánimo y una nota de cierre (opcionales) y la familia recibe el
// parte final; quien no es profesional solo confirma. La salida del turno la registra sola la base de datos.
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError, useAddCareLog } from "@/hooks/use-care-loop";
import { CARE_MOODS, MOOD_META, careLogFormSchema, closingNoteText } from "@/lib/careLog";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "@/lib/opportunities";
import { cn } from "@/lib/utils";

const NOTE_MAX = 400;

const closingSchema = z
  .object({
    mood: z.union([z.enum(CARE_MOODS), z.literal("")]),
    note: z.string().max(NOTE_MAX + 100, `Máximo ${NOTE_MAX} caracteres.`),
  })
  .superRefine((v, ctx) => {
    const check = checkOutgoingMessage(v.note, { maxChars: NOTE_MAX });
    if (!check.ok)
      ctx.addIssue({ code: "custom", path: ["note"], message: MESSAGE_ERROR_COPY[check.reason] });
  });
type ClosingValues = z.infer<typeof closingSchema>;

type FinishProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  professionalId: string;
  patientName?: string | null;
  /** Cambia el estado a «completado». Devuelve true si funcionó. */
  onFinish: () => Promise<boolean>;
};

export function FinishServiceDialog({
  open,
  onOpenChange,
  bookingId,
  professionalId,
  patientName,
  onFinish,
}: FinishProps) {
  const add = useAddCareLog(bookingId, professionalId, patientName);
  const [busy, setBusy] = useState(false);
  const {
    control,
    handleSubmit,
    register,
    reset,
    watch,
    formState: { errors },
  } = useForm<ClosingValues>({
    resolver: zodResolver(closingSchema),
    defaultValues: { mood: "", note: "" },
  });
  const note = watch("note") ?? "";

  const finish = async (values: ClosingValues | null) => {
    setBusy(true);
    try {
      const text = values ? closingNoteText(values) : null;
      if (values && text) {
        // La nota de cierre usa el mismo formulario validado del parte: si el servidor la rechaza, no se finaliza.
        const parsed = careLogFormSchema.parse({
          eventType: "note",
          description: text,
          mood: values.mood,
        });
        await add.mutateAsync(parsed);
      }
      const ok = await onFinish();
      if (ok) {
        reset({ mood: "", note: "" });
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(
        friendlyError(err, "No se pudo guardar la nota de cierre. Puedes finalizar sin nota."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Finalizar el servicio</DialogTitle>
          <DialogDescription>
            Un cierre cálido tranquiliza a la familia: cuéntale cómo quedó el paciente. Ella recibe
            el parte final y podrá darte las gracias.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => finish(v))} className="space-y-4" noValidate>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">¿Cómo quedó de ánimo? (opcional)</legend>
            <Controller
              control={control}
              name="mood"
              render={({ field }) => (
                <div className="flex flex-wrap gap-1.5">
                  {CARE_MOODS.map((m) => {
                    const selected = field.value === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => field.onChange(selected ? "" : m)}
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
              )}
            />
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="finish-note" className="text-sm font-medium">
              Nota de cierre (opcional)
            </Label>
            <Textarea
              id="finish-note"
              rows={3}
              maxLength={NOTE_MAX + 50}
              placeholder="Ej.: Quedó descansando, cenó completo y tomó sus medicamentos de la noche."
              aria-invalid={!!errors.note}
              {...register("note")}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-destructive" role="alert">
                {errors.note?.message}
              </p>
              <p className="shrink-0 text-xs text-muted-foreground">
                {note.length}/{NOTE_MAX}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void finish(null)}>
              Finalizar sin nota
            </Button>
            <Button type="submit" variant="hero" disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Finalizar servicio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinish: () => Promise<boolean>;
};

/** La parte que contrata también puede dar por terminado el servicio. */
export function ConfirmFinishDialog({ open, onOpenChange, onFinish }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿El servicio ya terminó?</AlertDialogTitle>
          <AlertDialogDescription>
            Al finalizar se cierra el parte del turno y podrás darle las gracias a tu profesional y
            calificar el servicio. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Todavía no</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              const ok = await onFinish();
              setBusy(false);
              if (ok) onOpenChange(false);
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Sí, finalizar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
