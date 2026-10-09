import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { instKeys } from "@/hooks/use-institution-hub";
import {
  CANCELLATION_NOTICE_OPTIONS,
  MAX_EXTRA_CONDITIONS,
  type ContractConditions,
} from "@/lib/contractTemplate";
import {
  MESSAGE_ERROR_COPY,
  checkOutgoingMessage,
  classifyHubError,
  type ServerError,
} from "@/lib/opportunities";

const sb = supabase as unknown as SupabaseClient;

const schema = z.object({
  cancellation_notice_hours: z
    .number()
    .refine((n) => (CANCELLATION_NOTICE_OPTIONS as readonly number[]).includes(n)),
  institution_late_cancel_pct: z.number().int().min(0, "Entre 0 y 100").max(100, "Entre 0 y 100"),
  tolerance_minutes: z.number().int().min(0, "Entre 0 y 60").max(60, "Entre 0 y 60"),
  checkin_required: z.boolean(),
  biosafety_provided: z.boolean(),
  replacement_duty: z.boolean(),
  extra: z
    .string()
    .max(MAX_EXTRA_CONDITIONS, `Máximo ${MAX_EXTRA_CONDITIONS} caracteres`)
    .superRefine((value, ctx) => {
      const check = checkOutgoingMessage(value);
      if (!check.ok) ctx.addIssue({ code: "custom", message: MESSAGE_ERROR_COPY[check.reason] });
    }),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  contractId: string;
  initial: ContractConditions;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * La institución ajusta las condiciones del contrato mientras nadie haya firmado. Cada cambio genera una
 * versión nueva con otra huella; el profesional es avisado y revisa la versión vigente antes de firmar.
 */
export function ContractConditionsForm({ contractId, initial, onSaved, onCancel }: Props) {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      cancellation_notice_hours: initial.cancellation_notice_hours,
      institution_late_cancel_pct: initial.institution_late_cancel_pct,
      tolerance_minutes: initial.tolerance_minutes,
      checkin_required: initial.checkin_required,
      biosafety_provided: initial.biosafety_provided,
      replacement_duty: initial.replacement_duty,
      extra: initial.extra ?? "",
    },
  });
  const v = watch();

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const { error } = await sb.rpc("update_contract_conditions", {
        p_contract_id: contractId,
        p_conditions: {
          cancellation_notice_hours: values.cancellation_notice_hours,
          institution_late_cancel_pct: values.institution_late_cancel_pct,
          tolerance_minutes: values.tolerance_minutes,
          checkin_required: values.checkin_required,
          biosafety_provided: values.biosafety_provided,
          replacement_duty: values.replacement_duty,
          extra: values.extra.trim() || null,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Condiciones actualizadas", {
        description: "El profesional fue avisado de la nueva versión.",
      });
      void qc.invalidateQueries({ queryKey: instKeys.contract(contractId) });
      void qc.invalidateQueries({ queryKey: ["inst"] });
      onSaved();
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  return (
    <form onSubmit={handleSubmit((values) => save.mutate(values))} className="space-y-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cond-notice" className="text-xs">
            Aviso para cancelar sin costo
          </Label>
          <Select
            value={String(v.cancellation_notice_hours)}
            onValueChange={(x) =>
              setValue("cancellation_notice_hours", Number(x), { shouldValidate: true })
            }
          >
            <SelectTrigger id="cond-notice" aria-label="Horas de aviso para cancelar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANCELLATION_NOTICE_OPTIONS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h === 0 ? "Sin aviso mínimo" : `${h} horas antes`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cond-pct" className="text-xs">
            Cancelación tardía de la institución (% del turno)
          </Label>
          <Input
            id="cond-pct"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={10}
            aria-invalid={!!errors.institution_late_cancel_pct}
            {...register("institution_late_cancel_pct", { valueAsNumber: true })}
          />
          {errors.institution_late_cancel_pct && (
            <p className="text-xs text-destructive">{errors.institution_late_cancel_pct.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cond-tol" className="text-xs">
            Tolerancia de llegada (minutos)
          </Label>
          <Input
            id="cond-tol"
            type="number"
            inputMode="numeric"
            min={0}
            max={60}
            step={5}
            aria-invalid={!!errors.tolerance_minutes}
            {...register("tolerance_minutes", { valueAsNumber: true })}
          />
          {errors.tolerance_minutes && (
            <p className="text-xs text-destructive">{errors.tolerance_minutes.message}</p>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-3">
        <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
          Registro de llegada y salida
          <Switch
            checked={v.checkin_required}
            onCheckedChange={(c) => setValue("checkin_required", c)}
          />
        </label>
        <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
          La institución da los EPP
          <Switch
            checked={v.biosafety_provided}
            onCheckedChange={(c) => setValue("biosafety_provided", c)}
          />
        </label>
        <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
          El profesional ayuda con el reemplazo
          <Switch
            checked={v.replacement_duty}
            onCheckedChange={(c) => setValue("replacement_duty", c)}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cond-extra" className="text-xs">
          Condiciones adicionales (opcional)
        </Label>
        <Textarea
          id="cond-extra"
          rows={3}
          maxLength={MAX_EXTRA_CONDITIONS}
          aria-invalid={!!errors.extra}
          placeholder="Ej.: traer carné y documento de identidad, ingreso por urgencias…"
          {...register("extra")}
        />
        <div className="flex justify-between gap-2">
          <p className="text-xs text-destructive">{errors.extra?.message}</p>
          <p className="text-xs text-muted-foreground">
            {(v.extra ?? "").length}/{MAX_EXTRA_CONDITIONS}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sin teléfonos, correos, enlaces, direcciones ni datos de pago: los pagos se hacen
          únicamente en la página web.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="hero" disabled={save.isPending}>
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="mr-2 h-4 w-4" aria-hidden />
          )}
          Guardar nueva versión
        </Button>
      </div>
    </form>
  );
}
