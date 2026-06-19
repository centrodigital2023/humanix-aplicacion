// Panel de la familia: timeline en tiempo real de la bitácora del turno.
import { useEffect, useState } from "react";
import {
  Home, Pill, Activity, Utensils, PersonStanding,
  FileText, AlertTriangle, LogOut, RefreshCw, Radio,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

type EventType =
  | "arrival" | "medication" | "vital_signs" | "meal"
  | "activity" | "note" | "incident" | "departure";

type CareLog = {
  id: string;
  event_type: EventType;
  description: string;
  vital_systolic: number | null;
  vital_diastolic: number | null;
  vital_heart_rate: number | null;
  vital_temperature: number | null;
  vital_oxygen: number | null;
  is_alert: boolean;
  created_at: string;
};

const EVENT_META: Record<EventType, { icon: React.ElementType; label: string; color: string }> = {
  arrival:     { icon: Home,          label: "Llegada",        color: "text-biosensor bg-biosensor/10" },
  medication:  { icon: Pill,          label: "Medicamento",    color: "text-copper bg-copper/10" },
  vital_signs: { icon: Activity,      label: "Signos vitales", color: "text-fuchsia-neural bg-fuchsia-neural/10" },
  meal:        { icon: Utensils,      label: "Alimentación",   color: "text-emerald-400 bg-emerald-400/10" },
  activity:    { icon: PersonStanding, label: "Actividad",     color: "text-blue-400 bg-blue-400/10" },
  note:        { icon: FileText,      label: "Nota",           color: "text-slate-400 bg-slate-400/10" },
  incident:    { icon: AlertTriangle, label: "Incidente",      color: "text-destructive bg-destructive/10" },
  departure:   { icon: LogOut,        label: "Fin de turno",   color: "text-muted-foreground bg-muted/20" },
};

type Props = {
  bookingId: string;
};

export function CareFeed({ bookingId }: Props) {
  const [logs, setLogs] = useState<CareLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const { data } = await sb
        .from("care_logs")
        .select("*")
        .eq("booking_id", bookingId)
        .order("created_at", { ascending: false });
      if (active) setLogs((data as CareLog[]) ?? []);
      setLoading(false);
    };

    load();

    const suffix = Math.random().toString(36).slice(2, 8);
    const channel = sb
      .channel(`care_${bookingId}_${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "care_logs",
          filter: `booking_id=eq.${bookingId}`,
        },
        (payload) => {
          const newLog = payload.new as CareLog;
          if (!active) return;
          setLogs((prev) => [newLog, ...prev]);
          setLiveCount((n) => n + 1);

          if (newLog.is_alert) {
            toast.error(
              `⚠️ ALERTA: ${newLog.description}`,
              { duration: 12000, position: "top-center" },
            );
          } else {
            const meta = EVENT_META[newLog.event_type];
            toast.success(`${meta.label} registrado`, { duration: 3000 });
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      sb.removeChannel(channel);
    };
  }, [bookingId]);

  const hasVitals = (log: CareLog) =>
    log.vital_systolic || log.vital_heart_rate || log.vital_temperature || log.vital_oxygen;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm justify-center">
        <RefreshCw className="h-4 w-4 animate-spin" /> Cargando bitácora...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Live header */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-biosensor/30 bg-biosensor/10 px-2.5 py-1 text-xs font-semibold text-biosensor">
          <Radio className="h-3 w-3 animate-pulse" />
          EN VIVO
        </div>
        <span className="text-xs text-muted-foreground">
          Bitácora del turno · {logs.length} eventos
        </span>
        {liveCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            +{liveCount} nuevos
          </Badge>
        )}
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        {logs.length > 1 && (
          <div className="absolute left-5 top-5 bottom-5 w-px bg-border/60" />
        )}

        <div className="space-y-3">
          {logs.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              El profesional aún no ha registrado eventos.{" "}
              <br className="sm:hidden" />
              Te notificaremos en tiempo real.
            </Card>
          ) : (
            logs.map((log) => {
              const meta = EVENT_META[log.event_type];
              const Icon = meta.icon;
              return (
                <div
                  key={log.id}
                  className={`relative flex gap-3 rounded-xl border p-4 transition-all ${
                    log.is_alert
                      ? "border-destructive/40 bg-destructive/5 shadow-[0_0_12px_oklch(var(--destructive)/0.1)]"
                      : "border-border bg-card"
                  }`}
                >
                  {/* Icon */}
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{meta.label}</span>
                      {log.is_alert && (
                        <Badge variant="destructive" className="text-[10px] py-0">ALERTA</Badge>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString("es-CO", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 leading-snug">{log.description}</p>

                    {/* Vitals badge */}
                    {hasVitals(log) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {log.vital_systolic && log.vital_diastolic && (
                          <span className="rounded-md bg-fuchsia-neural/10 px-2 py-0.5 text-[11px] font-medium text-fuchsia-neural">
                            PA {log.vital_systolic}/{log.vital_diastolic} mmHg
                          </span>
                        )}
                        {log.vital_heart_rate && (
                          <span className="rounded-md bg-fuchsia-neural/10 px-2 py-0.5 text-[11px] font-medium text-fuchsia-neural">
                            FC {log.vital_heart_rate} bpm
                          </span>
                        )}
                        {log.vital_temperature && (
                          <span className="rounded-md bg-copper/10 px-2 py-0.5 text-[11px] font-medium text-copper">
                            T° {log.vital_temperature}°C
                          </span>
                        )}
                        {log.vital_oxygen && (
                          <span className="rounded-md bg-biosensor/10 px-2 py-0.5 text-[11px] font-medium text-biosensor">
                            SpO₂ {log.vital_oxygen}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
