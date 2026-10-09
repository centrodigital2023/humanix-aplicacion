import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_ERROR_COPY, checkOutgoingMessage } from "@/lib/opportunities";
import { RATING_DIMENSIONS } from "@/lib/ratingDimensions";
import { cn } from "@/lib/utils";

const sb = supabase as unknown as SupabaseClient;

const score = z.number().int().min(1, "Elige una calificación").max(5);
const schema = z.object({
  stars: score,
  clarity: score,
  treatment: score,
  payment: score,
  environment: score,
  comment: z
    .string()
    .max(500, "Máximo 500 caracteres")
    .superRefine((value, ctx) => {
      const check = checkOutgoingMessage(value);
      if (!check.ok) ctx.addIssue({ code: "custom", message: MESSAGE_ERROR_COPY[check.reason] });
    }),
});
type FormValues = z.infer<typeof schema>;
type ScoreKey = "stars" | "clarity" | "treatment" | "payment" | "environment";

function StarInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  error?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <span className="text-sm">{label}</span>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      <div className="flex gap-0.5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} de 5`}
            onClick={() => onChange(n)}
            className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              className={cn(
                "h-6 w-6",
                value >= n ? "fill-copper text-copper" : "text-muted-foreground/40",
              )}
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  bookingId: string;
  raterId: string;
  familyId: string;
  familyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * El profesional califica a quien lo contrató (familia o institución) sin salir del panel: estrellas, cuatro
 * dimensiones (claridad de la solicitud, trato, cumplimiento del pago y entorno) y un comentario. Los otros
 * profesionales solo ven promedios (mínimo 3); el comentario lo ven únicamente la otra parte y el equipo de
 * Humanix.
 */
export function RateFamilyDialog({
  bookingId,
  raterId,
  familyId,
  familyName,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const {
    handleSubmit,
    register,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { stars: 0, clarity: 0, treatment: 0, payment: 0, environment: 0, comment: "" },
  });
  const values = watch();
  const comment = values.comment ?? "";
  const setScore = (key: ScoreKey) => (n: number) => setValue(key, n, { shouldValidate: true });

  const submit = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await sb.from("service_ratings").insert({
        booking_id: bookingId,
        rater_id: raterId,
        rated_id: familyId,
        stars: v.stars,
        comment: v.comment.trim() || null,
      });
      if (error) throw error;

      const { error: dimError } = await sb.from("service_rating_dimensions").insert({
        booking_id: bookingId,
        rater_id: raterId,
        rated_id: familyId,
        rater_role: "professional",
        scores: {
          clarity: v.clarity,
          treatment: v.treatment,
          payment: v.payment,
          environment: v.environment,
        },
      });
      return { dimensionsSaved: !dimError };
    },
    onSuccess: ({ dimensionsSaved }) => {
      if (dimensionsSaved) {
        toast.success("¡Gracias! Tu calificación quedó registrada.");
      } else {
        toast.warning("Guardamos tu calificación, pero no el detalle por dimensiones.");
      }
      onDone();
      onOpenChange(false);
    },
    onError: (error) => {
      const e = error as { code?: string; message?: string };
      toast.error(
        e.code === "23505" ? "Ya calificaste este servicio" : "No se pudo guardar la calificación",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Califica a {familyName}</DialogTitle>
          <DialogDescription>
            Tu opinión ayuda a otros profesionales a saber si quien contrata es clara, respetuosa y
            cumplida.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => submit.mutate(v))} className="space-y-4" noValidate>
          <StarInput
            label="Experiencia general"
            value={values.stars}
            onChange={setScore("stars")}
            error={errors.stars?.message}
          />
          <div className="space-y-3 rounded-lg border border-border p-3">
            {RATING_DIMENSIONS.professional.map((d) => (
              <StarInput
                key={d.key}
                label={d.label}
                value={values[d.key as ScoreKey]}
                onChange={setScore(d.key as ScoreKey)}
                error={errors[d.key as ScoreKey]?.message}
              />
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="family-comment" className="text-sm font-medium">
              Comentario (opcional)
            </Label>
            <Textarea
              id="family-comment"
              rows={3}
              maxLength={500}
              placeholder="Cuéntanos cómo fue el servicio y el trato recibido…"
              aria-invalid={!!errors.comment}
              {...register("comment")}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-destructive">{errors.comment?.message}</p>
              <p className="shrink-0 text-xs text-muted-foreground">{comment.length}/500</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              El comentario lo ven solo la otra parte y el equipo de Humanix; no se publica. No
              incluyas teléfonos, correos ni direcciones.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Guardar calificación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
