import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Lock, Send, Sparkles, TrendingUp } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { hubKeys, useMarketStats } from "@/hooks/use-opportunity-feed";
import {
  MESSAGE_ERROR_COPY,
  buildApplicationDraft,
  checkOutgoingMessage,
  classifyHubError,
  formatShiftRange,
  type ProIntro,
  type ServerError,
  type Shift,
} from "@/lib/opportunities";
import {
  lowNetWarning,
  marketCopy,
  marketPosition,
  offerErrorCopy,
  rateBand,
  validateOffer,
} from "@/lib/negotiation";
import { buildPriceBreakdown, formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

interface Props {
  shift: Shift;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  intro: ProIntro;
  /** Plan con la función «negociar el valor» (Esencial o superior). */
  canNegotiate: boolean;
  /** 12 en plan Free, 0 en planes de pago. */
  commissionPct: number;
}

function buildSchema(posted: number) {
  return z
    .object({
      message: z
        .string()
        .max(500, "Máximo 500 caracteres")
        .superRefine((value, ctx) => {
          const check = checkOutgoingMessage(value);
          if (!check.ok)
            ctx.addIssue({ code: "custom", message: MESSAGE_ERROR_COPY[check.reason] });
        }),
      negotiate: z.boolean(),
      rate: z.number().optional(),
    })
    .superRefine((value, ctx) => {
      if (!value.negotiate) return;
      const check = validateOffer(posted, value.rate);
      if (!check.ok) {
        ctx.addIssue({ code: "custom", path: ["rate"], message: offerErrorCopy(check, formatCOP) });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

/** Postulación a un turno: mensaje opcional y, con plan de pago, una propuesta de valor distinta. */
export function ApplyDialog({
  shift,
  open,
  onOpenChange,
  userId,
  intro,
  canNegotiate,
  commissionPct,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const posted = shift.rate_avg ?? 0;
  const schema = useMemo(() => buildSchema(posted), [posted]);
  const draft = useMemo(() => buildApplicationDraft(shift, intro), [shift, intro]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { message: draft, negotiate: false, rate: posted || undefined },
  });

  const negotiate = watch("negotiate");
  const rate = watch("rate");
  const message = watch("message") ?? "";
  const effectiveRate = negotiate && rate ? rate : posted;
  const band = rateBand(posted);
  const breakdown = buildPriceBreakdown(effectiveRate, shift.hours, commissionPct);
  const market = useMarketStats(shift.city, open && negotiate);
  const position = marketPosition(effectiveRate, market.data);
  const lowNet = lowNetWarning(effectiveRate, commissionPct, formatCOP);

  const apply = useMutation({
    mutationFn: async (values: FormValues) => {
      const { data, error } = await sb.rpc("apply_to_family_need", {
        p_need_ids: shift.need_ids,
        p_rate: values.negotiate && values.rate && values.rate !== posted ? values.rate : null,
        p_message: values.message.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Postulación enviada", {
        description: "La familia ya puede ver tu perfil y responderte.",
      });
      void qc.invalidateQueries({ queryKey: hubKeys.needs(userId) });
      void qc.invalidateQueries({ queryKey: hubKeys.proposals(userId) });
      onOpenChange(false);
    },
    onError: (error) => {
      const failure = classifyHubError(error as ServerError);
      if (failure.kind === "negotiate_plan") {
        toast.error(failure.message, {
          action: { label: "Ver planes", onClick: () => void navigate({ to: "/planes" }) },
        });
      } else {
        toast.error(failure.message);
      }
      if (failure.kind === "unavailable" || failure.kind === "duplicate") {
        void qc.invalidateQueries({ queryKey: hubKeys.needs(userId) });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Postularme al turno</DialogTitle>
          <DialogDescription>
            {shift.display_name} · {shift.city ?? "Ciudad sin indicar"} ·{" "}
            {formatShiftRange(shift.starts_at, shift.ends_at)}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => apply.mutate(v))} className="space-y-4" noValidate>
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Valor publicado</dt>
              <dd className="text-sm font-semibold">{formatCOP(posted)} / h</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Horas</dt>
              <dd className="text-sm font-semibold">{shift.hours} h</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total del servicio</dt>
              <dd className="text-sm font-semibold">{formatCOP(breakdown.total)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Te quedan{commissionPct > 0 ? ` (−${commissionPct}% comisión)` : ""}
              </dt>
              <dd className="text-sm font-semibold text-ok">
                {formatCOP(breakdown.professionalNet)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="negotiate" className="flex items-center gap-2 text-sm font-medium">
                <TrendingUp className="h-4 w-4 text-biosensor" aria-hidden /> Proponer otro valor
                por hora
                {!canNegotiate && (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                )}
              </Label>
              <Switch
                id="negotiate"
                checked={negotiate}
                disabled={!canNegotiate}
                onCheckedChange={(checked) => {
                  setValue("negotiate", checked, { shouldValidate: true });
                  if (checked && !rate) setValue("rate", posted);
                }}
              />
            </div>

            {!canNegotiate ? (
              <p className="text-xs text-muted-foreground">
                Negociar el valor está disponible desde el plan Esencial (COP 9.000/mes), que además
                no cobra comisión.{" "}
                <button
                  type="button"
                  className="font-medium text-biosensor underline-offset-2 hover:underline"
                  onClick={() => void navigate({ to: "/planes" })}
                >
                  Ver planes
                </button>
              </p>
            ) : negotiate ? (
              <div className="space-y-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={band.min}
                  max={band.max}
                  step={500}
                  aria-label="Valor por hora que propones"
                  aria-invalid={!!errors.rate}
                  {...register("rate", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                />
                {errors.rate && <p className="text-xs text-destructive">{errors.rate.message}</p>}
                <p className="text-xs text-muted-foreground">
                  Rango permitido: {formatCOP(band.min)} a {formatCOP(band.max)} por hora. La
                  familia puede aceptar, rechazar o contraofertar (hasta 3 rondas).
                </p>
                {position !== "unknown" || market.data ? (
                  <p className="text-xs text-muted-foreground">
                    {marketCopy(position, market.data, formatCOP)}
                  </p>
                ) : null}
                {lowNet && <p className="text-xs text-warn">{lowNet}</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin cambios te postulas al valor publicado ({formatCOP(posted)} por hora).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="message" className="text-sm font-medium">
                Mensaje para la familia
              </Label>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-biosensor hover:underline"
                onClick={() => setValue("message", draft, { shouldValidate: true })}
              >
                <Sparkles className="h-3 w-3" aria-hidden /> Usar sugerencia
              </button>
            </div>
            <Textarea
              id="message"
              rows={4}
              maxLength={500}
              aria-invalid={!!errors.message}
              {...register("message")}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-destructive">{errors.message?.message}</p>
              <p className="shrink-0 text-xs text-muted-foreground">{message.length}/500</p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              No incluyas teléfono, correo ni datos de pago. Al postularte con un plan de pago
              podrás ver la dirección y el WhatsApp de la familia. Los pagos se hacen únicamente en
              la página web.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={apply.isPending}>
              {apply.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="mr-2 h-4 w-4" aria-hidden />
              )}
              Enviar postulación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
