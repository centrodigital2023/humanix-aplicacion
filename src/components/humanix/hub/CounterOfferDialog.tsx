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
import { useMarketStats } from "@/hooks/use-opportunity-feed";
import {
  MESSAGE_ERROR_COPY,
  checkOutgoingMessage,
  classifyHubError,
  type ServerError,
} from "@/lib/opportunities";
import {
  lowNetWarning,
  marketCopy,
  marketPosition,
  netPerHour,
  offerErrorCopy,
  rateBand,
  roundLabel,
  suggestCounter,
  validateOffer,
  MAX_ROUNDS,
  type NegotiationRole,
} from "@/lib/negotiation";
import { formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

export interface CounterTarget {
  id: string;
  hourly_rate: number;
  posted_rate: number | null;
  round_no: number;
  /** Tu oferta anterior en esta negociación, si la hay. */
  my_last_offer: number | null;
  peer_city: string | null;
}

interface Props {
  target: CounterTarget;
  role: NegotiationRole;
  hours: number;
  /** Comisión que se descuenta al profesional (12 en Free, 0 en planes de pago). */
  commissionPct: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

function buildSchema(posted: number) {
  return z
    .object({
      rate: z.number().optional(),
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
      const check = validateOffer(posted, value.rate);
      if (!check.ok) {
        ctx.addIssue({ code: "custom", path: ["rate"], message: offerErrorCopy(check, formatCOP) });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Contraoferta del valor por hora: acotada, explicada y con punto medio sugerido. */
export function CounterOfferDialog({
  target,
  role,
  hours,
  commissionPct,
  open,
  onOpenChange,
  onDone,
}: Props) {
  const qc = useQueryClient();
  const posted = target.posted_rate ?? target.hourly_rate;
  const band = rateBand(posted);
  const suggestion = useMemo(
    () =>
      suggestCounter({
        theirOffer: target.hourly_rate,
        myLastOffer: target.my_last_offer,
        posted,
        round: target.round_no,
      }),
    [target.hourly_rate, target.my_last_offer, posted, target.round_no],
  );
  const schema = useMemo(() => buildSchema(posted), [posted]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { rate: suggestion.suggested, message: "" },
  });
  const rate = watch("rate");
  const market = useMarketStats(target.peer_city, open);
  const position = rate ? marketPosition(rate, market.data) : "unknown";
  const lowNet =
    role === "professional" && rate ? lowNetWarning(rate, commissionPct, formatCOP) : null;
  const nextRound = target.round_no + 1;

  const counter = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await sb.rpc("counter_slot_proposal", {
        p_proposal_id: target.id,
        p_rate: v.rate,
        p_message: v.message.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contraoferta enviada", {
        description: "La otra parte tiene 24 horas para responder.",
      });
      void qc.invalidateQueries({ queryKey: ["hub"] });
      onDone();
      onOpenChange(false);
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contraofertar el valor</DialogTitle>
          <DialogDescription>
            Oferta actual: {formatCOP(target.hourly_rate)} por hora · Valor publicado:{" "}
            {formatCOP(posted)} · {roundLabel(nextRound)} de {MAX_ROUNDS}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => counter.mutate(v))} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="counter-rate" className="text-sm font-medium">
                Tu valor por hora
              </Label>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-biosensor hover:underline"
                onClick={() => setValue("rate", suggestion.suggested, { shouldValidate: true })}
              >
                <Sparkles className="h-3 w-3" aria-hidden /> Sugerido:{" "}
                {formatCOP(suggestion.suggested)}
              </button>
            </div>
            <Input
              id="counter-rate"
              type="number"
              inputMode="numeric"
              min={band.min}
              max={band.max}
              step={500}
              aria-invalid={!!errors.rate}
              {...register("rate", {
                setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
              })}
            />
            {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
            <p className="text-xs text-muted-foreground">
              {suggestion.rationale} Rango permitido: {formatCOP(band.min)} a {formatCOP(band.max)}.
            </p>
            {rate ? (
              <p className="text-xs text-muted-foreground">
                Total por {hours} h: <strong>{formatCOP(rate * hours)}</strong>
                {role === "professional" && (
                  <>
                    {" "}
                    · te quedan <strong>{formatCOP(netPerHour(rate, commissionPct))}</strong> por
                    hora
                  </>
                )}
              </p>
            ) : null}
            {market.data && (
              <p className="text-xs text-muted-foreground">
                {marketCopy(position, market.data, formatCOP)}
              </p>
            )}
            {lowNet && <p className="text-xs text-warn">{lowNet}</p>}
            {suggestion.isLastCounter && (
              <p className="text-xs font-medium text-warn">
                Esta será la última contraoferta: la otra parte solo podrá aceptarla o rechazarla.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="counter-message" className="text-sm font-medium">
              Mensaje (opcional)
            </Label>
            <Textarea
              id="counter-message"
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
            <Button type="submit" variant="hero" disabled={counter.isPending}>
              {counter.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              Enviar contraoferta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
