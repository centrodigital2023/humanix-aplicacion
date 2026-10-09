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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { instKeys } from "@/hooks/use-institution-hub";
import {
  MESSAGE_ERROR_COPY,
  checkOutgoingMessage,
  classifyHubError,
  formatShiftRange,
  hoursBetween,
  type ProIntro,
  type ServerError,
} from "@/lib/opportunities";
import {
  buildOfferApplicationDraft,
  type InstitutionOffer,
  type OfferMatch,
} from "@/lib/institutionOffers";
import {
  MODALITY_LABEL,
  amountErrorCopy,
  contractTotal,
  offerBand,
  professionalNet,
  validateOfferAmount,
} from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

interface Props {
  offer: InstitutionOffer;
  match: OfferMatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  intro: ProIntro;
  /** Plan con la función «negociar el valor» (Esencial o superior). */
  canNegotiate: boolean;
  /** 12 en plan Free, 0 en planes de pago. */
  commissionPct: number;
}

function buildSchema(offer: InstitutionOffer) {
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
      shiftIds: z.array(z.string()),
      negotiate: z.boolean(),
      amount: z.number().optional(),
    })
    .superRefine((value, ctx) => {
      if (offer.hasAgenda && value.shiftIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["shiftIds"], message: "Elige al menos un turno." });
      }
      if (!value.negotiate) return;
      const check = validateOfferAmount(offer.amount, offer.modality, value.amount);
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

/** Postulación a los turnos de una institución: turnos a cubrir, mensaje y, con plan de pago, otro valor. */
export function ApplyOfferDialog({
  offer,
  match,
  open,
  onOpenChange,
  userId,
  intro,
  canNegotiate,
  commissionPct,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const schema = useMemo(() => buildSchema(offer), [offer]);
  const draft = useMemo(
    () => buildOfferApplicationDraft(offer, intro, match.freeShiftIds),
    [offer, intro, match.freeShiftIds],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      message: draft,
      shiftIds: match.freeShiftIds,
      negotiate: false,
      amount: offer.amount,
    },
  });

  const negotiate = watch("negotiate");
  const amount = watch("amount");
  const shiftIds = watch("shiftIds");
  const message = watch("message") ?? "";
  const effective = negotiate && amount ? amount : offer.amount;
  const band = offerBand(offer.amount, offer.modality);
  const chosen = offer.shifts.filter((s) => shiftIds.includes(s.id));
  const total = contractTotal(
    offer.modality,
    effective,
    (offer.hasAgenda ? chosen : []).map((s) => ({ hours: hoursBetween(s.starts_at, s.ends_at) })),
  );
  const net = professionalNet(total, commissionPct);
  const conflicting = new Set(match.conflictingShiftIds);

  const toggleShift = (id: string, checked: boolean) => {
    const next = checked ? [...shiftIds, id] : shiftIds.filter((x) => x !== id);
    setValue("shiftIds", next, { shouldValidate: true });
  };

  const apply = useMutation({
    mutationFn: async (v: FormValues) => {
      const allFree = match.freeShiftIds.length;
      const subset =
        offer.hasAgenda && !(v.shiftIds.length === allFree && allFree === offer.shifts.length);
      const { data, error } = await sb.rpc("apply_to_offer", {
        p_offer_id: offer.id,
        p_amount: v.negotiate && v.amount && v.amount !== offer.amount ? v.amount : null,
        p_message: v.message.trim() || null,
        p_shift_ids: subset ? v.shiftIds : null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Postulación enviada", {
        description: "La institución ya puede ver tu perfil y responderte.",
      });
      void qc.invalidateQueries({ queryKey: instKeys.offers(userId) });
      void qc.invalidateQueries({ queryKey: instKeys.myApps(userId) });
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
      if (
        failure.kind === "unavailable" ||
        failure.kind === "duplicate" ||
        failure.kind === "conflict"
      ) {
        void qc.invalidateQueries({ queryKey: instKeys.offers(userId) });
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Postularme a «{offer.title}»</DialogTitle>
          <DialogDescription>
            {offer.institutionName} · {offer.city || "Ciudad sin indicar"}
            {offer.serviceArea ? ` · ${offer.serviceArea}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit((v) => apply.mutate(v))} className="space-y-4" noValidate>
          {offer.hasAgenda ? (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Turnos que puedes cubrir</legend>
              <ul className="space-y-1.5">
                {offer.shifts.map((s) => {
                  const clash = conflicting.has(s.id);
                  const id = `shift-${s.id}`;
                  return (
                    <li key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={shiftIds.includes(s.id)}
                        disabled={clash}
                        onCheckedChange={(c) => toggleShift(s.id, c === true)}
                      />
                      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                        {formatShiftRange(s.starts_at, s.ends_at)}
                        {clash && (
                          <span className="ml-2 text-xs text-warn">Se cruza con tu agenda</span>
                        )}
                      </Label>
                    </li>
                  );
                })}
              </ul>
              {errors.shiftIds && (
                <p className="text-xs text-destructive">{errors.shiftIds.message}</p>
              )}
            </fieldset>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Esta oferta no tiene turnos definidos: el horario lo confirma la institución al
              aceptar.
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Valor publicado</dt>
              <dd className="text-sm font-semibold">
                {formatCOP(offer.amount)} {MODALITY_LABEL[offer.modality]}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total que propones</dt>
              <dd className="text-sm font-semibold">{total > 0 ? formatCOP(total) : "—"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">
                Te quedan{commissionPct > 0 ? ` (−${commissionPct}% comisión)` : " (sin comisión)"}
              </dt>
              <dd className="text-sm font-semibold text-ok">
                {total > 0 ? formatCOP(net.net) : "—"}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor="offer-negotiate"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <TrendingUp className="h-4 w-4 text-biosensor" aria-hidden /> Proponer otro valor
                {!canNegotiate && (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                )}
              </Label>
              <Switch
                id="offer-negotiate"
                checked={negotiate}
                disabled={!canNegotiate}
                onCheckedChange={(checked) => {
                  setValue("negotiate", checked, { shouldValidate: true });
                  if (checked && !amount) setValue("amount", offer.amount);
                }}
              />
            </div>

            {!canNegotiate ? (
              <p className="text-xs text-muted-foreground">
                Puedes postularte al valor publicado. Proponer otro valor está disponible desde el
                plan Esencial (COP 9.000/mes), que además no cobra comisión.{" "}
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
                  aria-label={`Valor ${MODALITY_LABEL[offer.modality]} que propones`}
                  aria-invalid={!!errors.amount}
                  {...register("amount", {
                    setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
                  })}
                />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Rango permitido: {formatCOP(band.min)} a {formatCOP(band.max)}{" "}
                  {MODALITY_LABEL[offer.modality]}. La institución puede aceptar, rechazar o
                  contraofertar (hasta 3 rondas).
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin cambios te postulas al valor publicado ({formatCOP(offer.amount)}{" "}
                {MODALITY_LABEL[offer.modality]}).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="offer-message" className="text-sm font-medium">
                Mensaje para la institución
              </Label>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-biosensor hover:underline"
                onClick={() =>
                  setValue("message", buildOfferApplicationDraft(offer, intro, shiftIds), {
                    shouldValidate: true,
                  })
                }
              >
                <Sparkles className="h-3 w-3" aria-hidden /> Usar sugerencia
              </button>
            </div>
            <Textarea
              id="offer-message"
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
              No incluyas teléfono, correo ni datos de pago. La dirección exacta y el WhatsApp se
              ven al aceptar la reserva (la dirección) o con plan Esencial o superior (el contacto).
              Los pagos se hacen únicamente en la página web.
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
