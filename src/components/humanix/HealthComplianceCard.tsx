/**
 * HealthComplianceCard — Billetera de salud ocupacional (SG-SST)
 * Permite al profesional registrar las fechas de vencimiento de los
 * documentos ocupacionales requeridos. Si alguno vence, un trigger en BD
 * lo oculta automáticamente del mapa/buscador hasta que lo renueve.
 * Módulo: cumplimiento normativo SG-SST
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  Syringe,
  HeartPulse,
  GraduationCap,
  FileBadge,
  Stethoscope,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type ComplianceStatus = "compliant" | "expiring_soon" | "expired" | "incomplete";

interface ComplianceRow {
  id: string;
  vacuna_hepatitis_b_expires: string | null;
  vacuna_tetano_expires: string | null;
  examen_ocupacional_expires: string | null;
  curso_bioseguridad_expires: string | null;
  poliza_rc_expires: string | null;
  primeros_auxilios_expires: string | null;
  status: ComplianceStatus;
}

const FIELDS: Array<{ key: keyof ComplianceRow; label: string; icon: React.ReactNode }> = [
  {
    key: "vacuna_hepatitis_b_expires",
    label: "Vacuna hepatitis B",
    icon: <Syringe className="h-3.5 w-3.5" />,
  },
  {
    key: "vacuna_tetano_expires",
    label: "Vacuna tétano",
    icon: <Syringe className="h-3.5 w-3.5" />,
  },
  {
    key: "examen_ocupacional_expires",
    label: "Examen ocupacional",
    icon: <Stethoscope className="h-3.5 w-3.5" />,
  },
  {
    key: "curso_bioseguridad_expires",
    label: "Curso de bioseguridad",
    icon: <GraduationCap className="h-3.5 w-3.5" />,
  },
  {
    key: "poliza_rc_expires",
    label: "Póliza de resp. civil",
    icon: <FileBadge className="h-3.5 w-3.5" />,
  },
  {
    key: "primeros_auxilios_expires",
    label: "Primeros auxilios",
    icon: <HeartPulse className="h-3.5 w-3.5" />,
  },
];

const STATUS_META: Record<
  ComplianceStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  compliant: {
    label: "Al día",
    className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    icon: <ShieldCheck className="h-3 w-3" />,
  },
  expiring_soon: {
    label: "Por vencer",
    className: "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10",
    icon: <ShieldAlert className="h-3 w-3" />,
  },
  expired: {
    label: "Vencido — oculto del mapa",
    className: "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/10",
    icon: <ShieldX className="h-3 w-3" />,
  },
  incomplete: {
    label: "Incompleto",
    className: "border-sky-500/30 text-sky-600 dark:text-sky-400 bg-sky-500/10",
    icon: <ShieldAlert className="h-3 w-3" />,
  },
};

function fieldStatus(dateStr: string | null): ComplianceStatus | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  if (d < today) return "expired";
  if (d < in30) return "expiring_soon";
  return "compliant";
}

export function HealthComplianceCard({ professionalId }: { professionalId: string }) {
  const [row, setRow] = useState<ComplianceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    const { data } = await sb
      .from("health_compliance")
      .select(
        "id, vacuna_hepatitis_b_expires, vacuna_tetano_expires, examen_ocupacional_expires, curso_bioseguridad_expires, poliza_rc_expires, primeros_auxilios_expires, status",
      )
      .eq("professional_id", professionalId)
      .maybeSingle();
    setRow((data as ComplianceRow | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();

    const channel = sb
      .channel(`health-compliance-${professionalId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "health_compliance",
          filter: `professional_id=eq.${professionalId}`,
        },
        () => load(),
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [professionalId]);

  const updateDate = async (key: keyof ComplianceRow, value: string) => {
    setSavingKey(key as string);
    try {
      const payload = { professional_id: professionalId, [key]: value || null };
      const { error } = await sb
        .from("health_compliance")
        .upsert(payload, { onConflict: "professional_id" });
      if (error) throw error;
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar la fecha");
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const overall = row?.status ?? "incomplete";
  const meta = STATUS_META[overall];

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <h3 className="font-semibold text-sm">Billetera de salud ocupacional (SG-SST)</h3>
        </div>
        <Badge variant="outline" className={`text-[10px] gap-1 ${meta.className}`}>
          {meta.icon} {meta.label}
        </Badge>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Registra las fechas de vencimiento de tus documentos de salud ocupacional. Si alguno vence,
        tu perfil se oculta automáticamente del mapa y buscador hasta que lo renueves.
      </p>

      <div className="grid sm:grid-cols-2 gap-2.5">
        {FIELDS.map((f) => {
          const value = (row?.[f.key] as string | null) ?? "";
          const fStatus = fieldStatus(value || null);
          const isSaving = savingKey === f.key;
          return (
            <div
              key={f.key as string}
              className="rounded-xl border border-border p-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[11px] font-medium flex items-center gap-1.5">
                  <span className="text-muted-foreground">{f.icon}</span>
                  {f.label}
                </Label>
                {fStatus && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] gap-1 px-1.5 py-0 ${STATUS_META[fStatus].className}`}
                  >
                    {STATUS_META[fStatus].label}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={value ?? ""}
                  onChange={(e) => updateDate(f.key, e.target.value)}
                  className="h-8 text-xs"
                />
                {isSaving && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                )}
              </div>
              {value && (
                <p className="text-[10px] text-muted-foreground">
                  Vence: {format(new Date(value), "d 'de' MMMM yyyy", { locale: es })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
