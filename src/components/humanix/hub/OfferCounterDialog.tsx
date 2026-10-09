import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Send, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MESSAGE_ERROR_COPY,
  checkOutgoingMessage,
  classifyHubError,
  type ServerError,
} from "@/lib/opportunities";
import {
  MODALITY_LABEL,
  amountErrorCopy,
  applicationRoundLabel,
  contractTotal,
  describeAmount,
  offerBand,
  professionalNet,
  suggestApplicationCounter,
  validateOfferAmount,
  type OfferModality,
  type PartyRole,
} from "@/lib/institutionNegotiation";
import { MAX_ROUNDS } from "@/lib/negotiation";
import { formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

export interface OfferCounterTarget {
  applicationId: string;
  title: string;
  modality: OfferModality;
  posted: number;
  /** Última oferta vigente (la que se contesta o se cambia). */
  currentOffer: number;
  round: number;
  /** Tu oferta anterior en esta negociación, si la hay. */
  myLastOffer: number | null;
  /** Horas de cada turno incluido (para calcular el total). */
  shiftHours: number[];
}

interface Props {
  target: OfferCounterTarget;
  role: PartyRole;
  /** `revise` = el profesional cambia su propia propuesta; no gasta una ronda. */
  kind: "counter" | "revise";
  /** Comisión que se descuenta al profesional (12 en Free, 0 en planes de pago). */
  commissionPct: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function buildSchema(posted: number, modality: OfferModality) {
  return z
    .object({
      amount: z.number().optional(),
      message: z
        .string()
        .max(500, "Máximo 500 caracteres")
        .superRefine((value, ctx) => {
          const check = checkOutgoingMessage(value);
          if (!check.ok)
            ctx.addIssue({ code: "custom", message: MESSAGE_ERROR_COPY[check.reason] });
        }),
    })
    .superRefine((value, ctx) => {
      const check = validateOfferAmount(posted, modality, value.amount);
      if (!check.ok) {
        ctx.addIssue({
          code: "custom",
          path: ["amount"],
          message: amountErrorCopy(check, formatCOP),
        });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Contraoferta (o cambio de propuesta) del valor de un turno de institución: acotada y explicada. */
export function OfferCounterDialog({
  target,
  role,
  kind,
  commissionPct,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const qc = useQueryClient();
  const band = offerBand(target.posted, target.modality);
  const suggestion = useMemo(
    () =>
      suggestApplicationCounter({
        theirOffer: target.currentOffer,
        myLastOffer: target.myLastOffer,
        posted: target.posted,
        modality: target.modality,
        round: target.round,
      }),
    [target.currentOffer, target.myLastOffer, target.posted, target.modality, target.round],
  );
  const schema = useMemo(() => buildSchema(target.posted, target.modality), [target]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: kind === "revise" ? target.currentOffer : suggestion.suggested,
      message: "",
    },
  });
  const amount = watch("amount");
  const total = amount
    ? contractTotal(
        target.modality,
        amount,
        target.shiftHours.map((hours) => ({ hours })),
      )
    : null;
  const net =
    role === "professional" && total != null ? professionalNet(total, commissionPct) : null;
  const nextRound = kind === "revise" ? target.round : target.round + 1;

  const send = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await sb.rpc("counter_application", {
        p_application_id: target.applicationId,
        p_amount: v.amount,
        p_message: v.message.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(kind === "revise" ? "Propuesta actualizada" : "Contraoferta enviada", {
        description: "La otra parte tiene tiempo para responder antes de que venza.",
      });
      void qc.invalidateQueries({ queryKey: ["inst"] });
      onDone();
      onOpenChange(false);
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {kind === "revise" ? "Cambiar mi propuesta" : "Contraofertar el valor"}
          </DialogTitle>
          <DialogDescription>
            {target.title} · Oferta actual:{" "}
            {describeAmount(target.currentOffer, target.modality, formatCOP)} · Publicado:{" "}
            {formatCOP(target.posted)} · {applicationRoundLabel(nextRound)} de {MAX_ROUNDS}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => send.mutate(v))} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="offer-counter-amount" className="text-sm font-medium">
                Tu valor
              </Label>
              {kind === "counter" && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-biosensor hover:underline"
                  onClick={() => setValue("amount", suggestion.suggested, { shouldValidate: true })}
                >
                  <Sparkles className="h-3 w-3" aria-hidden /> Sugerido:{" "}
                  {formatCOP(suggestion.suggested)}
                </button>
              )}
            </div>
            <Input
              id="offer-counter-amount"
              type="number"
              inputMode="numeric"
              min={band.min}
              max={band.max}
              step={500}
              aria-invalid={!!errors.amount}
              {...register("amount", {
                setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
              })}
            />
            {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            <p className="text-xs text-muted-foreground">
              {kind === "counter" ? `${suggestion.rationale} ` : ""}Rango permitido:{" "}
              {formatCOP(band.min)} a {formatCOP(band.max)} ({MODALITY_LABEL[target.modality]}).
            </p>
            {total != null && (
              <p className="text-xs text-muted-foreground">
                Total del contrato: <strong>{formatCOP(total)}</strong>
                {net && (
                  <>
                    {" "}
                    · te quedan <strong>{formatCOP(net.net)}</strong>
                    {commissionPct > 0 ? ` (−${commissionPct}% comisión)` : " (sin comisión)"}
                  </>
                )}
              </p>
            )}
            {kind === "counter" && suggestion.isLastCounter && (
              <p className="text-xs font-medium text-warn">
                Esta será la última contraoferta: la otra parte solo podrá aceptarla o rechazarla.
              </p>
            )}
            {kind === "revise" && (
              <p className="text-xs text-muted-foreground">
                Mientras la institución no responda puedes cambiar tu propuesta; no gasta una ronda
                de negociación.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offer-counter-message" className="text-sm font-medium">
              Mensaje (opcional)
            </Label>
            <Textarea
              id="offer-counter-message"
              rows={3}
              maxLength={500}
              aria-invalid={!!errors.message}
              {...register("message")}
            />
            {errors.message && <p className="text-xs text-destructive">{errors.message.message}</p>}
            <p className="text-[11px] text-muted-foreground">
              Sin teléfonos, correos ni datos de pago. Los pagos se hacen únicamente en la página
              web.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={send.isPending}>
              {send.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              {kind === "revise" ? "Actualizar propuesta" : "Enviar contraoferta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
