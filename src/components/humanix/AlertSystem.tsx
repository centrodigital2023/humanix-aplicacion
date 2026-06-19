/**
 * AlertSystem — Gestión de umbrales y alertas clínicas
 * Módulo 5: Sistema de alertas automáticas con WhatsApp/Push/Email
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Bell,
  BellOff,
  MessageSquare,
  Mail,
  Smartphone,
  Sliders,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Save,
  Loader2,
  Info,
  Heart,
  Activity,
  Thermometer,
  Wind,
  Droplets,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertThreshold {
  id?: string;
  patient_id: string;
  vital_type: string;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
  notify_whatsapp: boolean;
  notify_push: boolean;
  notify_email: boolean;
}

interface ClinicalAlert {
  id: string;
  alert_type: string;
  actual_value: number;
  unit: string | null;
  severity: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

// ─── Config per vital ────────────────────────────────────────────────────────

interface VitalConfig {
  label: string;
  icon: React.ReactNode;
  unit: string;
  sliderMin: number;
  sliderMax: number;
  defaultMin?: number;
  defaultMax?: number;
  step: number;
  hasMin: boolean;
  hasMax: boolean;
}

const VITAL_CONFIGS: Record<string, VitalConfig> = {
  heart_rate: {
    label: "Frecuencia Cardíaca",
    icon: <Heart className="h-4 w-4 text-rose-500" />,
    unit: "lpm",
    sliderMin: 30,
    sliderMax: 200,
    defaultMin: 50,
    defaultMax: 110,
    step: 1,
    hasMin: true,
    hasMax: true,
  },
  spo2: {
    label: "Saturación O₂ (SpO₂)",
    icon: <Droplets className="h-4 w-4 text-sky-500" />,
    unit: "%",
    sliderMin: 70,
    sliderMax: 100,
    defaultMin: 92,
    step: 0.5,
    hasMin: true,
    hasMax: false,
  },
  temperature: {
    label: "Temperatura",
    icon: <Thermometer className="h-4 w-4 text-orange-500" />,
    unit: "°C",
    sliderMin: 34,
    sliderMax: 42,
    defaultMin: 35.5,
    defaultMax: 37.5,
    step: 0.1,
    hasMin: true,
    hasMax: true,
  },
  blood_pressure_sys: {
    label: "Presión Sistólica",
    icon: <Activity className="h-4 w-4 text-violet-500" />,
    unit: "mmHg",
    sliderMin: 60,
    sliderMax: 200,
    defaultMin: 90,
    defaultMax: 140,
    step: 1,
    hasMin: true,
    hasMax: true,
  },
  blood_pressure_dia: {
    label: "Presión Diastólica",
    icon: <Activity className="h-4 w-4 text-purple-500" />,
    unit: "mmHg",
    sliderMin: 40,
    sliderMax: 130,
    defaultMin: 60,
    defaultMax: 90,
    step: 1,
    hasMin: true,
    hasMax: true,
  },
  respiration_rate: {
    label: "Frecuencia Respiratoria",
    icon: <Wind className="h-4 w-4 text-teal-500" />,
    unit: "resp/min",
    sliderMin: 5,
    sliderMax: 40,
    defaultMin: 10,
    defaultMax: 25,
    step: 1,
    hasMin: true,
    hasMax: true,
  },
};

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_CLS: Record<string, string> = {
  low:      "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  medium:   "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  high:     "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const STATUS_CLS: Record<string, string> = {
  active:         "text-red-500",
  acknowledged:   "text-amber-500",
  resolved:       "text-emerald-500",
  false_positive: "text-muted-foreground",
};

const ALERT_LABELS: Record<string, string> = {
  high_heart_rate:     "FC elevada",
  low_heart_rate:      "FC baja",
  low_spo2:            "SpO₂ baja",
  high_temperature:    "Fiebre",
  low_temperature:     "Hipotermia",
  high_blood_pressure: "Hipertensión arterial",
  low_blood_pressure:  "Hipotensión",
  fall_detected:       "Caída detectada",
  inactivity:          "Inactividad prolongada",
  high_respiration:    "Taquipnea",
  abnormal_glucose:    "Glucosa alterada",
  sos_manual:          "SOS · Botón de pánico",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  patientId: string;
}

export function AlertSystem({ patientId }: Props) {
  const [thresholds, setThresholds] = useState<Record<string, AlertThreshold>>({});
  const [alertHistory, setAlertHistory] = useState<ClinicalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expandedVital, setExpandedVital] = useState<string | null>("heart_rate");
  const [tab, setTab] = useState<"config" | "history">("config");

  // ── Thresholds stored in localStorage (no alert_thresholds table) ────────
  const THRESH_KEY = `hwx_thresholds_${patientId}`;

  const loadData = useCallback(async () => {
    if (!patientId) return;
    try {
      // 1. Load thresholds from localStorage
      let saved: Record<string, AlertThreshold> = {};
      try { saved = JSON.parse(localStorage.getItem(THRESH_KEY) ?? "{}"); } catch { /* empty */ }
      const map: Record<string, AlertThreshold> = {};
      for (const [key, cfg] of Object.entries(VITAL_CONFIGS)) {
        map[key] = saved[key] ?? {
          patient_id: patientId,
          vital_type: key,
          min_value: cfg.defaultMin ?? null,
          max_value: cfg.defaultMax ?? null,
          enabled: true,
          notify_whatsapp: true,
          notify_push: true,
          notify_email: false,
        };
      }
      setThresholds(map);

      // 2. Derive alert history from vital_signs_readings where severity != 'normal'
      const THRESH_MAP: Record<string, { min?: number; max?: number; unit: string }> = {
        heart_rate:         { min: 50,   max: 110, unit: "lpm" },
        spo2:               { min: 92,             unit: "%" },
        temperature:        { min: 35.5, max: 37.5, unit: "°C" },
        blood_pressure_sys: { min: 90,   max: 140, unit: "mmHg" },
        blood_pressure_dia: { min: 60,   max: 90,  unit: "mmHg" },
        respiration_rate:   { min: 10,   max: 25,  unit: "resp/min" },
      };
      const SEV_MAP: Record<string, ClinicalAlert["severity"]> = {
        critical: "critical", high: "high", warning: "high", low: "low", medium: "medium",
      };
      const { data } = await sb
        .from("vital_signs_readings")
        .select("id, reading_type, value, unit, severity, recorded_at")
        .eq("family_user_id", patientId)
        .not("severity", "in", "(normal,Normal,NORMAL)")
        .order("recorded_at", { ascending: false })
        .limit(50);

      if (data) {
        const history: ClinicalAlert[] = (data as {
          id: string; reading_type: string; value: number;
          unit: string | null; severity: string; recorded_at: string;
        }[]).map((r) => {
          const t = THRESH_MAP[r.reading_type];
          const isHigh = t?.max !== undefined && r.value > t.max;
          const alertType = isHigh ? `high_${r.reading_type}` : `low_${r.reading_type}`;
          return {
            id: r.id,
            alert_type: alertType,
            actual_value: r.value,
            unit: r.unit ?? t?.unit ?? null,
            severity: SEV_MAP[r.severity.toLowerCase()] ?? "medium",
            status: "active",
            created_at: r.recorded_at,
            acknowledged_at: null,
            resolved_at: null,
          };
        });
        setAlertHistory(history);
      }
    } catch (err) {
      console.warn("[AlertSystem] loadData:", err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveThreshold = (vitalType: string) => {
    const t = thresholds[vitalType];
    if (!t) return;
    setSaving(vitalType);
    try {
      // Persist all thresholds to localStorage
      const saved: Record<string, AlertThreshold> = {};
      try { Object.assign(saved, JSON.parse(localStorage.getItem(THRESH_KEY) ?? "{}")); } catch { /* empty */ }
      saved[vitalType] = t;
      localStorage.setItem(THRESH_KEY, JSON.stringify(saved));
      toast.success("Umbral guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(null);
    }
  };

  const updateThreshold = (vitalType: string, patch: Partial<AlertThreshold>) => {
    setThresholds((prev) => ({
      ...prev,
      [vitalType]: { ...prev[vitalType], ...patch },
    }));
  };

  const resolveAlert = (alertId: string) => {
    setAlertHistory((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: "resolved" } : a)),
    );
    toast.success("Alerta resuelta");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit">
        <button
          onClick={() => setTab("config")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            tab === "config"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Sliders className="h-3 w-3 inline mr-1" />
          Umbrales
        </button>
        <button
          onClick={() => setTab("history")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            tab === "history"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="h-3 w-3 inline mr-1" />
          Historial ({alertHistory.length})
        </button>
      </div>

      {/* Threshold config */}
      {tab === "config" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Configura los valores límite. Las alertas se enviarán automáticamente cuando se superen.
          </div>

          {Object.entries(VITAL_CONFIGS).map(([vitalType, cfg]) => {
            const t = thresholds[vitalType];
            if (!t) return null;
            const isOpen = expandedVital === vitalType;

            return (
              <Card key={vitalType} className={cn("overflow-hidden", !t.enabled && "opacity-60")}>
                {/* Vital header */}
                <button
                  onClick={() => setExpandedVital(isOpen ? null : vitalType)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {cfg.icon}
                    <span className="text-sm font-medium">{cfg.label}</span>
                    {t.enabled ? (
                      <Bell className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <BellOff className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {t.min_value !== null && t.max_value !== null && (
                      <span className="text-[10px] text-muted-foreground">
                        {t.min_value} – {t.max_value} {cfg.unit}
                      </span>
                    )}
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded config */}
                {isOpen && (
                  <div className="px-4 pb-4 space-y-4 border-t border-border/50">
                    {/* Enable toggle */}
                    <div className="flex items-center justify-between pt-3">
                      <Label className="text-xs font-medium">Alertas activas</Label>
                      <Switch
                        checked={t.enabled}
                        onCheckedChange={(v) => updateThreshold(vitalType, { enabled: v })}
                      />
                    </div>

                    {/* Min value */}
                    {cfg.hasMin && t.min_value !== null && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Mínimo crítico</Label>
                          <span className="text-xs font-bold tabular-nums">
                            {t.min_value} {cfg.unit}
                          </span>
                        </div>
                        <Slider
                          min={cfg.sliderMin}
                          max={cfg.sliderMax}
                          step={cfg.step}
                          value={[t.min_value]}
                          onValueChange={([v]) => updateThreshold(vitalType, { min_value: v })}
                          className="[&>span]:bg-amber-500"
                        />
                      </div>
                    )}

                    {/* Max value */}
                    {cfg.hasMax && t.max_value !== null && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Máximo crítico</Label>
                          <span className="text-xs font-bold tabular-nums">
                            {t.max_value} {cfg.unit}
                          </span>
                        </div>
                        <Slider
                          min={cfg.sliderMin}
                          max={cfg.sliderMax}
                          step={cfg.step}
                          value={[t.max_value]}
                          onValueChange={([v]) => updateThreshold(vitalType, { max_value: v })}
                          className="[&>span]:bg-red-500"
                        />
                      </div>
                    )}

                    {/* Notification channels */}
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Canales de notificación</Label>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Switch
                            checked={t.notify_whatsapp}
                            onCheckedChange={(v) => updateThreshold(vitalType, { notify_whatsapp: v })}
                            className="scale-75"
                          />
                          <span className="text-xs flex items-center gap-1">
                            <MessageSquare className="h-3 w-3 text-green-500" />
                            WhatsApp
                          </span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Switch
                            checked={t.notify_push}
                            onCheckedChange={(v) => updateThreshold(vitalType, { notify_push: v })}
                            className="scale-75"
                          />
                          <span className="text-xs flex items-center gap-1">
                            <Smartphone className="h-3 w-3 text-blue-500" />
                            Push
                          </span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Switch
                            checked={t.notify_email}
                            onCheckedChange={(v) => updateThreshold(vitalType, { notify_email: v })}
                            className="scale-75"
                          />
                          <span className="text-xs flex items-center gap-1">
                            <Mail className="h-3 w-3 text-violet-500" />
                            Email
                          </span>
                        </label>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={() => saveThreshold(vitalType)}
                      disabled={saving === vitalType}
                      className="w-full h-8 text-xs"
                    >
                      {saving === vitalType ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <Save className="h-3 w-3 mr-1" />
                      )}
                      Guardar umbral
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Alert history */}
      {tab === "history" && (
        <div className="space-y-2">
          {alertHistory.length === 0 ? (
            <Card className="p-8 text-center border-dashed">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium">Sin alertas registradas</p>
              <p className="text-xs text-muted-foreground mt-1">
                El paciente ha mantenido signos vitales estables.
              </p>
            </Card>
          ) : (
            alertHistory.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start justify-between gap-3 p-3 rounded-xl border bg-card"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle
                    className={cn(
                      "h-4 w-4 flex-shrink-0 mt-0.5",
                      alert.severity === "critical" ? "text-red-500" : "text-amber-500",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold">
                        {ALERT_LABELS[alert.alert_type] ?? alert.alert_type}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                          SEVERITY_CLS[alert.severity],
                        )}
                      >
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {alert.actual_value} {alert.unit} ·{" "}
                      {formatDistanceToNow(new Date(alert.created_at), { locale: es, addSuffix: true })}
                    </p>
                    <p
                      className={cn(
                        "text-[10px] font-medium mt-0.5",
                        STATUS_CLS[alert.status],
                      )}
                    >
                      {alert.status === "active" && "● Activa"}
                      {alert.status === "acknowledged" && "● Reconocida"}
                      {alert.status === "resolved" && "● Resuelta"}
                      {alert.status === "false_positive" && "● Falso positivo"}
                    </p>
                  </div>
                </div>
                {alert.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 flex-shrink-0"
                    onClick={() => resolveAlert(alert.id)}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Resolver
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
