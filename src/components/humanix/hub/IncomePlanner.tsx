import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "@tanstack/react-router";
import { Calculator, ChevronDown, Info, PiggyBank, Target } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlan } from "@/hooks/use-plan";
import { MAX_HOURLY_RATE, MIN_HOURLY_RATE } from "@/lib/negotiation";
import { PLAN_CATALOG, type PlanKey } from "@/lib/plans";
import { formatCOP } from "@/lib/pricing";
import {
  CO_RULES,
  FREE_COMMISSION_PCT,
  INCOME_DISCLAIMER,
  comparePaidPlan,
  projectIncome,
  requiredHourlyRate,
  type ArlClass,
} from "@/lib/proIncome";
import { cn } from "@/lib/utils";

const optionalNumber = (v: unknown) => (v === "" || v == null ? undefined : Number(v));

const schema = z.object({
  hoursPerWeek: z.number().min(1, "Mínimo 1 hora").max(84, "Máximo 84 horas por semana"),
  hourlyRate: z
    .number()
    .min(MIN_HOURLY_RATE, `Mínimo ${formatCOP(MIN_HOURLY_RATE)}`)
    .max(MAX_HOURLY_RATE, `Máximo ${formatCOP(MAX_HOURLY_RATE)}`),
  paidPlan: z.boolean(),
  paysContributions: z.boolean(),
  arlClass: z.number().int().min(1).max(5),
  targetNet: z.number().min(0).max(100_000_000).optional(),
});
type FormValues = z.infer<typeof schema>;

const ARL_LABEL: Record<ArlClass, string> = {
  1: "Riesgo I · 0,522 %",
  2: "Riesgo II · 1,044 %",
  3: "Riesgo III · 2,436 %",
  4: "Riesgo IV · 4,350 %",
  5: "Riesgo V · 6,960 %",
};

function Line({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "neg" | "pos";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1",
        strong && "border-t border-border pt-2",
      )}
    >
      <dt
        className={cn(
          "text-xs text-muted-foreground",
          strong && "text-sm font-semibold text-foreground",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "text-sm tabular-nums",
          strong && "text-base font-bold",
          tone === "neg" && "text-muted-foreground",
          tone === "pos" && "text-ok",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

interface Props {
  plan: PlanKey;
  defaultRate?: number | null;
  defaultOpen?: boolean;
}

/**
 * Planificador de ingresos: cuánto te queda de verdad por hora después de la comisión y de los
 * aportes de un independiente, y si te conviene un plan de pago. Es una estimación, no asesoría.
 */
export function IncomePlanner({ plan, defaultRate, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      hoursPerWeek: 30,
      hourlyRate: defaultRate && defaultRate >= MIN_HOURLY_RATE ? defaultRate : 22000,
      paidPlan: plan !== "free",
      paysContributions: true,
      arlClass: 1,
      targetNet: undefined,
    },
  });

  const values = watch();
  const parsed = schema.safeParse(values);
  const commissionPct = values.paidPlan ? 0 : FREE_COMMISSION_PCT;

  const calc = useMemo(() => {
    if (!parsed.success) return null;
    const v = parsed.data;
    const base = {
      hoursPerWeek: v.hoursPerWeek,
      hourlyRate: v.hourlyRate,
      paysContributions: v.paysContributions,
      arlClass: v.arlClass as ArlClass,
    };
    const projection = projectIncome({ ...base, commissionPct });
    const free = projectIncome({ ...base, commissionPct: FREE_COMMISSION_PCT });
    const comparison = comparePaidPlan({
      grossMonthly: free.grossMonthly,
      planPrice: PLAN_CATALOG.essential_monthly.amountCOP,
    });
    const needed =
      v.targetNet && v.targetNet > 0
        ? requiredHourlyRate({
            targetNetMonthly: v.targetNet,
            hoursPerWeek: v.hoursPerWeek,
            commissionPct,
            paysContributions: v.paysContributions,
            arlClass: v.arlClass as ArlClass,
          })
        : null;
    return { projection, comparison, needed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), commissionPct]);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="h-4 w-4 text-biosensor" aria-hidden /> Planificador de ingresos
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            · cuánto te queda por hora y qué plan te conviene
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ip-hours" className="text-xs">
                Horas por semana
              </Label>
              <Input
                id="ip-hours"
                type="number"
                inputMode="numeric"
                min={1}
                max={84}
                {...register("hoursPerWeek", { setValueAs: optionalNumber })}
                aria-invalid={!!errors.hoursPerWeek}
              />
              {errors.hoursPerWeek && (
                <p className="text-xs text-destructive">{errors.hoursPerWeek.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ip-rate" className="text-xs">
                Tu valor por hora
              </Label>
              <Input
                id="ip-rate"
                type="number"
                inputMode="numeric"
                step={500}
                {...register("hourlyRate", { setValueAs: optionalNumber })}
                aria-invalid={!!errors.hourlyRate}
              />
              {errors.hourlyRate && (
                <p className="text-xs text-destructive">{errors.hourlyRate.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ip-target" className="text-xs">
                Meta de ingreso neto mensual (opcional)
              </Label>
              <Input
                id="ip-target"
                type="number"
                inputMode="numeric"
                step={100000}
                placeholder="3000000"
                {...register("targetNet", { setValueAs: optionalNumber })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Riesgo ARL de tu actividad</Label>
              <Select
                value={String(values.arlClass)}
                onValueChange={(v) => setValue("arlClass", Number(v), { shouldValidate: true })}
              >
                <SelectTrigger aria-label="Clase de riesgo ARL">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {([1, 2, 3, 4, 5] as ArlClass[]).map((c) => (
                    <SelectItem key={c} value={String(c)}>
                      {ARL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
              <span>Con plan de pago (sin comisión)</span>
              <Switch
                checked={values.paidPlan}
                onCheckedChange={(v) => setValue("paidPlan", v, { shouldValidate: true })}
                aria-label="Simular con plan de pago"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs">
              <span>Cotizo como independiente</span>
              <Switch
                checked={values.paysContributions}
                onCheckedChange={(v) => setValue("paysContributions", v, { shouldValidate: true })}
                aria-label="Cotizo como independiente"
              />
            </label>
          </div>

          {calc && (
            <>
              <dl className="rounded-xl border border-border bg-muted/30 p-3">
                <Line
                  label="Lo que pagan las familias"
                  value={formatCOP(calc.projection.grossMonthly)}
                />
                <Line
                  label={`Comisión de Humanix (${commissionPct} %)`}
                  value={`− ${formatCOP(calc.projection.commission)}`}
                  tone="neg"
                />
                <Line label="Tu ingreso" value={formatCOP(calc.projection.billedMonthly)} />
                {calc.projection.contributions.applicable ? (
                  <>
                    <Line
                      label={`Salud 12,5 % · base ${formatCOP(calc.projection.contributions.ibc)}`}
                      value={`− ${formatCOP(calc.projection.contributions.health)}`}
                      tone="neg"
                    />
                    <Line
                      label="Pensión 16 %"
                      value={`− ${formatCOP(calc.projection.contributions.pension)}`}
                      tone="neg"
                    />
                    <Line
                      label="ARL"
                      value={`− ${formatCOP(calc.projection.contributions.arl)}`}
                      tone="neg"
                    />
                    {calc.projection.contributions.solidarity > 0 && (
                      <Line
                        label="Fondo de solidaridad pensional"
                        value={`− ${formatCOP(calc.projection.contributions.solidarity)}`}
                        tone="neg"
                      />
                    )}
                  </>
                ) : null}
                <Line
                  label="Neto mensual estimado"
                  value={formatCOP(calc.projection.netMonthly)}
                  tone="pos"
                  strong
                />
                <Line
                  label="Neto por hora trabajada"
                  value={formatCOP(calc.projection.netPerHour)}
                  tone="pos"
                />
              </dl>

              {calc.projection.notes.map((n) => (
                <p key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {n}
                </p>
              ))}

              <div
                className={cn(
                  "flex flex-col gap-2 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between",
                  calc.comparison.worthIt ? "border-ok/40 bg-ok/5" : "border-border bg-muted/20",
                )}
              >
                <div className="flex items-start gap-2">
                  <PiggyBank className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />
                  <p className="text-xs">
                    {calc.comparison.worthIt ? (
                      <>
                        Con este ritmo, el plan <strong>Esencial</strong> te ahorra{" "}
                        <strong>{formatCOP(calc.comparison.monthlySavings)}</strong> al mes: dejas
                        de pagar {formatCOP(calc.comparison.commissionAvoided)} de comisión y el
                        plan cuesta {formatCOP(calc.comparison.planPrice)}.
                      </>
                    ) : (
                      <>
                        Con este ritmo el plan Esencial aún no compensa. Empieza a ahorrar desde{" "}
                        <strong>{formatCOP(calc.comparison.breakEvenMonthly ?? 0)}</strong>{" "}
                        facturados al mes.
                      </>
                    )}
                  </p>
                </div>
                {plan === "free" && (
                  <Button asChild size="sm" variant={calc.comparison.worthIt ? "hero" : "outline"}>
                    <Link to="/planes">Ver planes</Link>
                  </Button>
                )}
              </div>

              {calc.needed && (
                <p className="flex items-start gap-2 text-xs">
                  <Target className="mt-0.5 h-4 w-4 shrink-0 text-biosensor" aria-hidden />
                  {calc.needed.reachable && calc.needed.rate ? (
                    <span>
                      Para llegar a un neto de <strong>{formatCOP(values.targetNet ?? 0)}</strong>{" "}
                      trabajando {values.hoursPerWeek} h por semana necesitas cobrar al menos{" "}
                      <strong>{formatCOP(calc.needed.rate)}</strong> por hora.
                    </span>
                  ) : (
                    <span>
                      Con {values.hoursPerWeek} h por semana esa meta no se alcanza dentro del rango
                      permitido ({formatCOP(MAX_HOURLY_RATE)} por hora). Prueba con más horas.
                    </span>
                  )}
                </p>
              )}
            </>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {INCOME_DISCLAIMER} Salario mínimo usado: {formatCOP(CO_RULES.smmlv)} ({CO_RULES.year}).
          </p>
        </div>
      )}
    </Card>
  );
}

/** Versión lista para el panel: toma el plan vigente del profesional. */
export function IncomePlannerCard({
  userId,
  defaultRate,
}: {
  userId: string;
  defaultRate?: number | null;
}) {
  const { plan, loading } = usePlan(userId);
  if (loading) return null;
  return <IncomePlanner plan={plan} defaultRate={defaultRate} />;
}
