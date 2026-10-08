import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BellRing, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { hubKeys } from "@/hooks/use-opportunity-feed";
import {
  alertMatchesShift,
  parseList,
  type OpportunityAlert,
  type Shift,
} from "@/lib/opportunities";
import { formatCOP } from "@/lib/pricing";

const sb = supabase as unknown as SupabaseClient;

interface AlertRow extends OpportunityAlert {
  id: string;
  name: string;
  active: boolean;
}

const schema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre a la alerta").max(60),
  cities: z.string().max(300),
  careTypes: z.string().max(300),
  minRate: z.number().int().min(0).max(250000).optional(),
  urgentOnly: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  userId: string;
  /** Turnos abiertos ahora: sirven para mostrar cuántos coinciden con cada alerta. */
  shifts: Shift[];
  defaultCity?: string | null;
}

/** Alertas: el servidor avisa (en vivo) cuando una familia publica horas que coinciden. Hasta 5. */
export function AlertsPanel({ userId, shifts, defaultCity }: Props) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const key = hubKeys.alerts(userId);

  const alerts = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await sb
        .from("opportunity_alerts")
        .select("id, name, cities, care_types, min_rate, urgent_only, active")
        .eq("professional_id", userId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "Mis turnos",
      cities: defaultCity ?? "",
      careTypes: "",
      minRate: undefined,
      urgentOnly: false,
    },
  });

  const create = useMutation({
    mutationFn: async (v: FormValues) => {
      const { error } = await sb.from("opportunity_alerts").insert({
        professional_id: userId,
        name: v.name,
        cities: parseList(v.cities),
        care_types: parseList(v.careTypes),
        min_rate: v.minRate ?? null,
        urgent_only: v.urgentOnly,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Alerta creada", {
        description: "Te avisamos apenas aparezca un turno que coincida.",
      });
      reset();
      setCreating(false);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) =>
      toast.error((e as { message?: string }).message ?? "No se pudo crear la alerta"),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await sb.from("opportunity_alerts").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: () => toast.error("No se pudo actualizar la alerta"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("opportunity_alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: () => toast.error("No se pudo eliminar la alerta"),
  });

  const list = alerts.data ?? [];

  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Alertas de oportunidades"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <BellRing className="h-4 w-4 text-biosensor" aria-hidden /> Alertas de turnos
        </p>
        {list.length < 5 && !creating && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Nueva alerta
          </Button>
        )}
      </div>

      {alerts.isLoading ? (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden /> Cargando…
        </p>
      ) : list.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground">
          Crea una alerta con tu ciudad y el tipo de cuidado que prefieres: te avisamos en cuanto
          una familia publique horas que coincidan, sin que tengas que revisar.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => {
            const matches = shifts.filter((s) => alertMatchesShift(a, s)).length;
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <div className="flex flex-wrap gap-1">
                    {a.cities.map((c) => (
                      <Badge key={c} variant="secondary" className="text-[10px]">
                        {c}
                      </Badge>
                    ))}
                    {a.care_types.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">
                        {c}
                      </Badge>
                    ))}
                    {a.min_rate != null && (
                      <Badge variant="outline" className="text-[10px]">
                        desde {formatCOP(a.min_rate)}/h
                      </Badge>
                    )}
                    {a.urgent_only && (
                      <Badge variant="outline" className="text-[10px]">
                        solo urgentes
                      </Badge>
                    )}
                    {a.cities.length + a.care_types.length === 0 &&
                      a.min_rate == null &&
                      !a.urgent_only && (
                        <Badge variant="outline" className="text-[10px]">
                          todos los turnos
                        </Badge>
                      )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {matches === 0
                      ? "Ningún turno abierto coincide ahora."
                      : `${matches} turno(s) abiertos coinciden ahora.`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={a.active}
                    onCheckedChange={(active) => toggle.mutate({ id: a.id, active })}
                    aria-label={`Alerta ${a.name} ${a.active ? "activa" : "pausada"}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => remove.mutate(a.id)}
                    aria-label={`Eliminar alerta ${a.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <form
          onSubmit={handleSubmit((v) => create.mutate(v))}
          className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
          noValidate
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="alert-name" className="text-xs">
              Nombre
            </Label>
            <Input id="alert-name" {...register("name")} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="alert-cities" className="text-xs">
              Ciudades (separadas por coma)
            </Label>
            <Input id="alert-cities" placeholder="Bogotá, Soacha" {...register("cities")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alert-care" className="text-xs">
              Tipo de cuidado (opcional)
            </Label>
            <Input id="alert-care" placeholder="adulto mayor, oxígeno" {...register("careTypes")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="alert-rate" className="text-xs">
              Valor mínimo por hora (opcional)
            </Label>
            <Input
              id="alert-rate"
              type="number"
              inputMode="numeric"
              step={500}
              min={0}
              placeholder="20000"
              {...register("minRate", {
                setValueAs: (v) => (v === "" || v == null ? undefined : Number(v)),
              })}
              aria-invalid={!!errors.minRate}
            />
            {errors.minRate && (
              <p className="text-xs text-destructive">Escribe un valor entre 0 y 250.000</p>
            )}
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--biosensor)]"
              {...register("urgentOnly")}
            />
            Solo turnos urgentes (hoy o en menos de 6 h)
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" variant="hero" disabled={create.isPending}>
              {create.isPending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              )}
              Guardar alerta
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
