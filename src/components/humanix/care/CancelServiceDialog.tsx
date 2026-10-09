// Cancelar un servicio con motivos guiados (antes era un cuadro de texto del navegador) y con la consecuencia a la
// vista: a quién se avisa y qué hace el plan B. Solo las partes del servicio ven este botón.
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, XCircle } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  CANCEL_DETAIL_MAX,
  CANCEL_REASONS,
  buildCancelPatch,
  cancelConsequence,
  cancelFormSchema,
  type CancelFormValues,
  type CancelParty,
} from "@/lib/serviceCancel";

type Patch = ReturnType<typeof buildCancelPatch>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  party: CancelParty;
  /** `offer`: el servicio nació de un turno publicado, así que si el profesional cancela se activa el plan B. */
  mode?: "direct" | "offer";
  /** Devuelve true cuando la reserva quedó cancelada (el diálogo se cierra). */
  onConfirm: (patch: Patch) => Promise<boolean>;
};

export function CancelServiceDialog({
  open,
  onOpenChange,
  party,
  mode = "direct",
  onConfirm,
}: Props) {
  const {
    control,
    handleSubmit,
    register,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CancelFormValues>({
    resolver: zodResolver(cancelFormSchema(party)),
    defaultValues: { reason: "", detail: "" },
  });
  const reason = watch("reason");
  const detail = watch("detail") ?? "";

  const submit = async (values: CancelFormValues) => {
    const ok = await onConfirm(buildCancelPatch(party, values));
    if (ok) {
      reset({ reason: "", detail: "" });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar el servicio</DialogTitle>
          <DialogDescription>{cancelConsequence(party, mode)}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">¿Por qué cancelas?</legend>
            <Controller
              control={control}
              name="reason"
              render={({ field }) => (
                <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-2">
                  {CANCEL_REASONS[party].map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                    >
                      <RadioGroupItem value={r.id} id={`cancel-${r.id}`} />
                      <Label
                        htmlFor={`cancel-${r.id}`}
                        className="flex-1 cursor-pointer text-sm font-normal"
                      >
                        {r.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            />
            {errors.reason?.message && (
              <p className="text-xs text-destructive" role="alert">
                {errors.reason.message}
              </p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-detail" className="text-sm font-medium">
              {reason === "other" ? "Cuéntale a la otra parte qué pasó" : "Detalle (opcional)"}
            </Label>
            <Textarea
              id="cancel-detail"
              rows={3}
              maxLength={CANCEL_DETAIL_MAX + 50}
              placeholder="Una frase basta. No incluyas teléfonos, correos ni datos de pago."
              aria-invalid={!!errors.detail}
              {...register("detail")}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-destructive" role="alert">
                {errors.detail?.message}
              </p>
              <p className="shrink-0 text-xs text-muted-foreground">
                {detail.length}/{CANCEL_DETAIL_MAX}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Volver
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Cancelar servicio
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
