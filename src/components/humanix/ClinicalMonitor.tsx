/**
 * ClinicalMonitor — Panel de monitoreo clínico en tiempo real
 * Usa la tabla vital_signs_readings (family_user_id, reading_type, value,
 * value_secondary, unit, severity, source, recorded_at).
 * Las alertas se derivan en memoria de los umbrales clínicos.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VitalSignsPanel, type VitalStatus, type VitalDataPoint } from "./VitalSignsPanel";
import {
  Heart,
  Activity,
  Thermometer,
  Wind,
  Footprints,
  Droplets,
  AlertTriangle,
  RefreshCw,
  Smartphone,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  Zap,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ─── Types ────────────────────────────────────────────────────────────────────

export type VitalType =
  | "heart_rate"
  | "spo2"
  | "temperature"
  | "blood_pressure_sys"
  | "blood_pressure_dia"
  | "respiration_rate"
  | "steps"
  | "fall_detected";

/** Row from vital_signs_readings */
interface VitalReading {
  id: string;
  family_user_id: string;
  reading_type: string;
  value: number;
  value_secondary: number | null;
  unit: string | null;
  severity: string;        // 'normal' | 'warning' | 'critical' | 'low' | 'high'
  source: string;          // device source
  recorded_at: string;
  recorded_by: string | null;
  patient_label: string | null;
}

interface InMemoryAlert {
  id: string;
  alert_type: string;
  actual_value: number;
  unit: string | null;
  severity: "low" | "medium" | "high" | "critical";
  created_at: string;
}

// ─── Clinical thresholds ──────────────────────────────────────────────────────

const THRESHOLDS: Record<VitalType, { min?: number; max?: number; unit: string; range: string }> = {
  heart_rate:         { min: 50,   max: 110,  unit: "lpm",      range: "50 – 110 lpm" },
  spo2:               { min: 92,              unit: "%",         range: "≥ 92 %" },
  temperature:        { min: 35.5, max: 37.5, unit: "°C",       range: "35.5 – 37.5 °C" },
  blood_pressure_sys: { min: 90,   max: 140,  unit: "mmHg",     range: "90 – 140 mmHg" },
  blood_pressure_dia: { min: 60,   max: 90,   unit: "mmHg",     range: "60 – 90 mmHg" },
  respiration_rate:   { min: 10,   max: 25,   unit: "resp/min", range: "10 – 25 resp/min" },
  steps:              {                        unit: "pasos",    range: "meta 5000/día" },
  fall_detected:      {                        unit: "",         range: "ninguna" },
};

function computeStatus(type: VitalType, value: number): VitalStatus {
  const t = THRESHOLDS[type];
  if (type === "fall_detected") return value > 0 ? "critical" : "normal";
  if (type === "steps") return "normal";
  const { min, max } = t;
  if (min !== undefined && value < min) return value < min - 10 ? "critical" : "warning";
  if (max !== undefined && value > max) return value > max + 15 ? "critical" : "warning";
  return "normal";
}

// ─── Vital metadata ───────────────────────────────────────────────────────────

const VITAL_META: Record<VitalType, { icon: React.ReactNode; label: string }> = {
  heart_rate:         { icon: <Heart className="h-4 w-4 text-rose-500" />,        label: "Frec. Cardíaca" },
  spo2:               { icon: <Droplets className="h-4 w-4 text-sky-500" />,      label: "SpO₂" },
  temperature:        { icon: <Thermometer className="h-4 w-4 text-orange-500" />, label: "Temperatura" },
  blood_pressure_sys: { icon: <Activity className="h-4 w-4 text-violet-500" />,   label: "PA Sistólica" },
  blood_pressure_dia: { icon: <Activity className="h-4 w-4 text-purple-500" />,   label: "PA Diastólica" },
  respiration_rate:   { icon: <Wind className="h-4 w-4 text-teal-500" />,         label: "Respiración" },
  steps:              { icon: <Footprints className="h-4 w-4 text-lime-500" />,   label: "Pasos hoy" },
  fall_detected:      { icon: <AlertTriangle className="h-4 w-4 text-red-500" />, label: "Caída" },
};

/** Map reading_type strings to VitalType */
const READING_TYPE_MAP: Record<string, VitalType> = {
  heart_rate: "heart_rate",
  spo2: "spo2",
  oxygen_saturation: "spo2",
  temperature: "temperature",
  body_temperature: "temperature",
  blood_pressure_sys: "blood_pressure_sys",
  blood_pressure_systolic: "blood_pressure_sys",
  blood_pressure_dia: "blood_pressure_dia",
  blood_pressure_diastolic: "blood_pressure_dia",
  respiration_rate: "respiration_rate",
  respiratory_rate: "respiration_rate",
  steps: "steps",
  step_count: "steps",
  fall_detected: "fall_detected",
};

const SEVERITY_COLORS: Record<string, string> = {
  low:      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  medium:   "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  high:     "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 animate-pulse",
};

const ALERT_LABEL: Record<VitalType, { high: string; low: string }> = {
  heart_rate:         { high: "FC elevada",    low: "FC baja" },
  spo2:               { high: "SpO₂ elevada",  low: "SpO₂ baja" },
  temperature:        { high: "Fiebre",         low: "Hipotermia" },
  blood_pressure_sys: { high: "HTA sistólica",  low: "Hipotensión" },
  blood_pressure_dia: { high: "HTA diastólica", low: "Hipotensión" },
  respiration_rate:   { high: "Taquipnea",      low: "Bradipnea" },
  steps:              { high: "",               low: "" },
  fall_detected:      { high: "Caída detectada",low: "" },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  patientId: string;
  showDeviceGuide?: boolean;
  compact?: boolean;
}

type VitalsMap = Partial<Record<VitalType, { latest: VitalReading; history: VitalDataPoint[] }>>;

const VITAL_ORDER: VitalType[] = [
  "heart_rate", "spo2", "temperature",
  "blood_pressure_sys", "blood_pressure_dia",
  "respiration_rate", "steps", "fall_detected",
];

export function ClinicalMonitor({ patientId, showDeviceGuide = true, compact = false }: Props) {
  const [vitals, setVitals] = useState<VitalsMap>({});
  const [alerts, setAlerts] = useState<InMemoryAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Build alerts in-memory from readings ──────────────────────────────────
  const buildAlerts = useCallback((map: VitalsMap): InMemoryAlert[] => {
    const result: InMemoryAlert[] = [];
    for (const [typeKey, data] of Object.entries(map)) {
      const type = typeKey as VitalType;
      if (!data) continue;
      const value = data.latest.value;
      const status = computeStatus(type, value);
      if (status === "normal" || type === "steps") continue;
      const t = THRESHOLDS[type];
      const isHigh = t.max !== undefined && value > t.max;
      const label = ALERT_LABEL[type];
      const alertLabel = isHigh ? label.high : label.low;
      if (!alertLabel) continue;
      result.push({
        id: `${type}-${data.latest.id}`,
        alert_type: alertLabel,
        actual_value: value,
        unit: t.unit || null,
        severity: status === "critical" ? "critical" : "high",
        created_at: data.latest.recorded_at,
      });
    }
    return result;
  }, []);

  // ── Load vitals from vital_signs_readings ────────────────────────────────
  const loadVitals = useCallback(async () => {
    if (!patientId) return;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("vital_signs_readings")
        .select("id, family_user_id, reading_type, value, value_secondary, unit, severity, source, recorded_at, recorded_by, patient_label")
        .eq("family_user_id", patientId)
        .gte("recorded_at", since)
        .order("recorded_at", { ascending: false })
        .limit(500);

      if (error) throw error;
      if (!data) return;

      const map: VitalsMap = {};
      for (const row of (data as VitalReading[]).reverse()) {
        const vtype = READING_TYPE_MAP[row.reading_type];
        if (!vtype) continue;
        if (!map[vtype]) {
          map[vtype] = { latest: row, history: [] };
        }
        map[vtype]!.history.push({ value: row.value, recorded_at: row.recorded_at });
        map[vtype]!.latest = row;
      }

      // blood_pressure: if we have sys but not dia, try value_secondary
      if (map["blood_pressure_sys"] && !map["blood_pressure_dia"]) {
        const sec = map["blood_pressure_sys"]!.latest.value_secondary;
        if (sec !== null && sec !== undefined) {
          map["blood_pressure_dia"] = {
            latest: { ...map["blood_pressure_sys"]!.latest, reading_type: "blood_pressure_dia", value: sec },
            history: map["blood_pressure_sys"]!.history.map((h) => ({ ...h, value: sec })),
          };
        }
      }

      setVitals(map);
      setLastSync(new Date());
      setAlerts(buildAlerts(map));
    } catch (err) {
      console.warn("[ClinicalMonitor] loadVitals:", err);
    }
  }, [patientId, buildAlerts]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadVitals();
    setRefreshing(false);
  }, [loadVitals]);

  useEffect(() => {
    setLoading(true);
    loadVitals().finally(() => setLoading(false));
  }, [loadVitals]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!patientId) return;

    const channel = supabase
      .channel(`clinical:${patientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vital_signs_readings", filter: `family_user_id=eq.${patientId}` },
        (payload) => {
          const row = payload.new as VitalReading;
          const vtype = READING_TYPE_MAP[row.reading_type];
          if (!vtype) return;

          setVitals((prev) => {
            const existing = prev[vtype];
            const next = {
              ...prev,
              [vtype]: {
                latest: row,
                history: [...(existing?.history ?? []).slice(-23), { value: row.value, recorded_at: row.recorded_at }],
              },
            };
            // re-derive alerts
            const newAlerts = buildAlerts(next);
            setAlerts(newAlerts);
            const status = computeStatus(vtype, row.value);
            if (status !== "normal") {
              const label = ALERT_LABEL[vtype];
              const t = THRESHOLDS[vtype];
              const isHigh = t.max !== undefined && row.value > t.max;
              toast.warning(`${isHigh ? label.high : label.low}`, {
                description: `${row.value} ${t.unit}`,
              });
            }
            return next;
          });
          setLastSync(new Date());
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [patientId, buildAlerts]);

  const dismissAlert = (id: string) => {
    setDismissedAlerts((prev) => new Set([...prev, id]));
  };

  const visibleAlerts = alerts.filter((a) => !dismissedAlerts.has(a.id));
  const hasCritical = visibleAlerts.some((a) => a.severity === "critical");

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const hasData = Object.keys(vitals).length > 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-xl bg-rose-500/10 flex items-center justify-center">
            <Heart className="h-4 w-4 text-rose-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Monitoreo Clínico</h3>
            {lastSync && (
              <p className="text-[10px] text-muted-foreground">
                Actualizado {formatDistanceToNow(lastSync, { locale: es, addSuffix: true })}
              </p>
            )}
          </div>
          {hasCritical && (
            <span className="ml-2 text-[10px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
              CRÍTICO
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showDeviceGuide && (
            <Button variant="outline" size="sm" onClick={() => setShowGuide(!showGuide)} className="h-7 text-xs gap-1">
              <Smartphone className="h-3 w-3" /> Dispositivos
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="h-7 text-xs gap-1">
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      {/* Device guide */}
      {showGuide && (
        <Card className="p-4 border-sky-500/30 bg-sky-500/5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-sky-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Sincronización con dispositivos de salud</h4>
              <div className="grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                {[
                  { icon: "🍎", title: "Apple HealthKit (iOS)", desc: "Descarga Humanix en App Store → Ajustes → Salud → Activar sincronización automática" },
                  { icon: "🤖", title: "Google Health Connect (Android)", desc: "Instala Health Connect → Humanix → Permitir permisos → Sincronización cada 5 min" },
                  { icon: <Zap className="h-3 w-3 text-amber-500 inline" />, title: "Dispositivos IoT", desc: "Pulsioxímetros, tensiómetros y termómetros Bluetooth compatibles con Humanix SDK" },
                  { icon: <Activity className="h-3 w-3 text-violet-500 inline" />, title: "Registro manual", desc: "Ingresa mediciones manualmente desde el portal del profesional en cada visita" },
                ].map((item, i) => (
                  <div key={i} className="space-y-1">
                    <p className="font-medium text-foreground flex items-center gap-1">
                      <span>{item.icon}</span> {item.title}
                    </p>
                    <p>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Active alerts */}
      {visibleAlerts.length > 0 && (
        <Card className={`border ${hasCritical ? "border-red-500/40 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <button onClick={() => setAlertsOpen(!alertsOpen)} className="w-full flex items-center justify-between p-3 text-sm font-semibold">
            <div className="flex items-center gap-2">
              <Bell className={`h-4 w-4 ${hasCritical ? "text-red-500 animate-bounce" : "text-amber-500"}`} />
              <span>{visibleAlerts.length} alerta{visibleAlerts.length > 1 ? "s" : ""} activa{visibleAlerts.length > 1 ? "s" : ""}</span>
            </div>
            {alertsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {alertsOpen && (
            <div className="px-3 pb-3 space-y-2">
              {visibleAlerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between gap-2 p-2 rounded-xl border bg-card">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${SEVERITY_COLORS[alert.severity]}`}>
                      {alert.severity.toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{alert.alert_type}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {alert.actual_value} {alert.unit} ·{" "}
                        {formatDistanceToNow(new Date(alert.created_at), { locale: es, addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 whitespace-nowrap" onClick={() => dismissAlert(alert.id)}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* No data */}
      {!hasData && (
        <Card className="p-8 text-center border-dashed">
          <div className="h-12 w-12 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
            <Activity className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-semibold text-sm mb-1">Sin datos de signos vitales</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Conecta un dispositivo compatible o pide al profesional que registre las mediciones durante la visita.
          </p>
          {showDeviceGuide && (
            <Button size="sm" variant="outline" className="mt-3 text-xs" onClick={() => setShowGuide(true)}>
              Ver cómo conectar un dispositivo
            </Button>
          )}
        </Card>
      )}

      {/* Vitals grid */}
      {hasData && (
        <div className={`grid gap-3 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 lg:grid-cols-4"}`}>
          {VITAL_ORDER.map((type) => {
            const data = vitals[type];
            if (!data && type === "fall_detected") return null;
            const meta = VITAL_META[type];
            const threshold = THRESHOLDS[type];
            const value = data?.latest?.value ?? null;
            const status: VitalStatus = value !== null ? computeStatus(type, value) : "unknown";
            const sortedHistory = data?.history ?? [];
            const lastTs = data?.latest?.recorded_at;
            const lastUpdated = lastTs ? formatDistanceToNow(new Date(lastTs), { locale: es, addSuffix: true }) : undefined;

            let trend: "up" | "down" | "stable" | undefined;
            if (sortedHistory.length >= 3) {
              const recent = sortedHistory.slice(-3);
              const diff = recent[recent.length - 1].value - recent[0].value;
              trend = Math.abs(diff) < 1 ? "stable" : diff > 0 ? "up" : "down";
            }

            const online = !!data?.latest?.source && data.latest.source !== "manual";

            return (
              <VitalSignsPanel
                key={type}
                icon={meta.icon}
                label={meta.label}
                value={value}
                unit={threshold.unit}
                status={status}
                trend={trend}
                history={sortedHistory}
                normalRange={threshold.range}
                online={online}
                lastUpdated={lastUpdated}
                compact={compact}
                minRef={threshold.min}
                maxRef={threshold.max}
              />
            );
          })}
        </div>
      )}

      {hasData && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            Datos de las últimas 24 h ·{" "}
            {Object.values(vitals).reduce((acc, v) => acc + (v?.history?.length ?? 0), 0)} mediciones
          </span>
        </div>
      )}
    </div>
  );
}
