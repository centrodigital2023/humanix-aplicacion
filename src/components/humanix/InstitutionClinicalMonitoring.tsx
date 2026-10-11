/**
 * InstitutionClinicalMonitoring — Panel Live de monitoreo remoto multi-paciente
 *
 * Casos de uso:
 *  · Pacientes en camilla (hospital): dispositivos BLE/telemetría sincronizados
 *  · Pacientes remotos / rurales: smartphone o smartwatch via app Humanix
 *  · Posoperatorios y crónicos: seguimiento continuo con alertas por umbral
 *  · Adultos mayores: monitoreo de caídas, SpO₂ y PA
 *  · Triage IA: score de riesgo derivado de los últimos signos vitales
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ClinicalMonitor } from "./ClinicalMonitor";
import {
  Heart,
  Activity,
  AlertTriangle,
  Plus,
  Search,
  X,
  Loader2,
  Users,
  RefreshCw,
  QrCode,
  Bell,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Wifi,
  WifiOff,
  ScanLine,
  Copy,
  Sparkles,
  Filter,
  UserCircle,
  MapPin,
  Smartphone,
  Watch,
  Bed,
  TreePine,
  Stethoscope,
  HeartPulse,
  Thermometer,
  Wind,
  Brain,
  Shield,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  PhoneCall,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import QRCode from "react-qr-code";

// ─── Types ────────────────────────────────────────────────────────────────────

type PatientContext = "hospital" | "remote" | "postop" | "chronic" | "elder";
type TriageScore = "verde" | "amarillo" | "naranja" | "rojo";

interface StoredPatient {
  id: string;
  addedAt: string;
  label: string | null;
  context: PatientContext;
  room: string | null; // habitación / cama (hospital)
  location: string | null; // municipio / vereda (remoto)
  deviceType: "smartwatch" | "smartphone" | "sensor" | "manual";
}

interface VitalLatest {
  heart_rate?: number;
  spo2?: number;
  temperature?: number;
  blood_pressure_sys?: number;
  blood_pressure_dia?: number;
  respiration_rate?: number;
  fall_detected?: number;
}

interface MonitoredPatient extends StoredPatient {
  full_name: string | null;
  last_vital_at: string | null;
  online: boolean;
  critical_count: number;
  alert_count: number;
  triage: TriageScore;
  trend: "up" | "down" | "stable";
  vitals: VitalLatest;
}

interface PatientAlert {
  id: string;
  patient_id: string;
  patient_name: string | null;
  reading_type: string;
  value: number;
  unit: string | null;
  severity: "high" | "critical";
  recorded_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_META: Record<
  PatientContext,
  { label: string; icon: React.ReactNode; color: string }
> = {
  hospital: {
    label: "Hospitalizado",
    icon: <Bed className="h-3 w-3" />,
    color: "text-blue-600   bg-blue-500/10   border-blue-500/20",
  },
  remote: {
    label: "Remoto",
    icon: <TreePine className="h-3 w-3" />,
    color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
  },
  postop: {
    label: "Posoperatorio",
    icon: <Heart className="h-3 w-3" />,
    color: "text-violet-600  bg-violet-500/10  border-violet-500/20",
  },
  chronic: {
    label: "Crónico",
    icon: <Clock className="h-3 w-3" />,
    color: "text-amber-600   bg-amber-500/10   border-amber-500/20",
  },
  elder: {
    label: "Adulto mayor",
    icon: <Shield className="h-3 w-3" />,
    color: "text-rose-600    bg-rose-500/10    border-rose-500/20",
  },
};

const DEVICE_META: Record<StoredPatient["deviceType"], { label: string; icon: React.ReactNode }> = {
  smartwatch: { label: "Smartwatch", icon: <Watch className="h-3 w-3" /> },
  smartphone: { label: "Smartphone", icon: <Smartphone className="h-3 w-3" /> },
  sensor: { label: "Sensor IoT", icon: <Activity className="h-3 w-3" /> },
  manual: { label: "Manual", icon: <Stethoscope className="h-3 w-3" /> },
};

const TRIAGE_META: Record<TriageScore, { label: string; color: string; bg: string }> = {
  verde: {
    label: "Estable",
    color: "text-emerald-700",
    bg: "bg-emerald-500/10 border-emerald-500/30",
  },
  amarillo: {
    label: "Atención",
    color: "text-yellow-700",
    bg: "bg-yellow-500/10  border-yellow-500/30",
  },
  naranja: {
    label: "Urgente",
    color: "text-orange-700",
    bg: "bg-orange-500/10  border-orange-500/30",
  },
  rojo: {
    label: "Crítico",
    color: "text-red-700",
    bg: "bg-red-500/10     border-red-500/30 animate-pulse",
  },
};

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORE_KEY = (instId: string) => `hwx_monitored_${instId}`;

function loadPatients(instId: string): StoredPatient[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY(instId)) ?? "[]");
  } catch {
    return [];
  }
}
function saveStore(instId: string, list: StoredPatient[]) {
  localStorage.setItem(STORE_KEY(instId), JSON.stringify(list));
}

// ─── Clinical thresholds ──────────────────────────────────────────────────────

const THRESHOLDS: Record<string, { min?: number; max?: number; unit: string }> = {
  heart_rate: { min: 50, max: 110, unit: "lpm" },
  spo2: { min: 92, unit: "%" },
  oxygen_saturation: { min: 92, unit: "%" },
  temperature: { min: 35.5, max: 37.5, unit: "°C" },
  body_temperature: { min: 35.5, max: 37.5, unit: "°C" },
  blood_pressure_sys: { min: 90, max: 140, unit: "mmHg" },
  blood_pressure_dia: { min: 60, max: 90, unit: "mmHg" },
  respiration_rate: { min: 10, max: 25, unit: "resp/min" },
};

const ALERT_LABEL: Record<string, string> = {
  heart_rate: "Frec. cardíaca",
  spo2: "SpO₂ baja",
  oxygen_saturation: "SpO₂ baja",
  temperature: "Temperatura",
  blood_pressure_sys: "PA sistólica",
  blood_pressure_dia: "PA diastólica",
  respiration_rate: "Respiración",
  fall_detected: "🚨 Caída detectada",
};

const VITAL_ICON: Record<string, React.ReactNode> = {
  heart_rate: <HeartPulse className="h-3 w-3 text-rose-500" />,
  spo2: <Wind className="h-3 w-3 text-sky-500" />,
  temperature: <Thermometer className="h-3 w-3 text-amber-500" />,
  blood_pressure_sys: <Activity className="h-3 w-3 text-violet-500" />,
  respiration_rate: <Wind className="h-3 w-3 text-teal-500" />,
};

function isCritical(type: string, value: number): boolean {
  const t = THRESHOLDS[type];
  if (!t) return false;
  if (t.min !== undefined && value < t.min - 10) return true;
  if (t.max !== undefined && value > t.max + 15) return true;
  return false;
}
function isAbnormal(type: string, value: number): boolean {
  const t = THRESHOLDS[type];
  if (!t) return false;
  if (t.min !== undefined && value < t.min) return true;
  if (t.max !== undefined && value > t.max) return true;
  return false;
}

/** Score de triage derivado in-memory de los umbrales */
function computeTriage(critCount: number, alertCount: number, hasFall: boolean): TriageScore {
  if (hasFall || critCount >= 2) return "rojo";
  if (critCount === 1) return "naranja";
  if (alertCount >= 2) return "amarillo";
  return "verde";
}

// ─── Add Patient Modal ────────────────────────────────────────────────────────

interface AddPatientModalProps {
  institutionId: string;
  onAdded: (p: StoredPatient) => void;
  onClose: () => void;
}

function AddPatientModal({ institutionId, onAdded, onClose }: AddPatientModalProps) {
  const [mode, setMode] = useState<"id" | "qr">("id");
  const [patientId, setPatientId] = useState("");
  const [label, setLabel] = useState("");
  const [context, setContext] = useState<PatientContext>("remote");
  const [device, setDevice] = useState<StoredPatient["deviceType"]>("smartphone");
  const [room, setRoom] = useState("");
  const [location, setLocation] = useState("");

  const inviteLink = `https://humanix.lat/monitor-invite?institution=${institutionId}`;

  const add = () => {
    const trimmed = patientId.trim();
    if (!trimmed) {
      toast.error("Ingresa el ID del paciente");
      return;
    }
    const patient: StoredPatient = {
      id: trimmed,
      addedAt: new Date().toISOString(),
      label: label.trim() || null,
      context,
      deviceType: device,
      room: context === "hospital" ? room.trim() || null : null,
      location: context === "remote" || context === "elder" ? location.trim() || null : null,
    };
    onAdded(patient);
    toast.success("Paciente agregado al panel de monitoreo");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-5 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <UserCircle className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Agregar paciente</h3>
              <p className="text-[11px] text-muted-foreground">Monitoreo remoto en tiempo real</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl">
          {(["id", "qr"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "id" ? <Search className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
              {m === "id" ? "Por ID" : "Por QR"}
            </button>
          ))}
        </div>

        {mode === "id" ? (
          <div className="space-y-3">
            {/* Contexto clínico */}
            <div className="space-y-1.5">
              <Label className="text-xs">Contexto clínico</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  Object.entries(CONTEXT_META) as [
                    PatientContext,
                    (typeof CONTEXT_META)[PatientContext],
                  ][]
                ).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setContext(k)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-xl border text-[10px] font-medium transition-all",
                      context === k
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {v.icon}
                    <span>{v.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Dispositivo */}
            <div className="space-y-1.5">
              <Label className="text-xs">Dispositivo de captura</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  Object.entries(DEVICE_META) as [
                    StoredPatient["deviceType"],
                    (typeof DEVICE_META)[StoredPatient["deviceType"]],
                  ][]
                ).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setDevice(k)}
                    className={cn(
                      "flex items-center gap-1.5 p-2 rounded-xl border text-[11px] font-medium transition-all",
                      device === k
                        ? "bg-primary/10 border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">UUID del paciente en Humanix</Label>
              <Input
                placeholder="Pega el ID del usuario"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value.trim())}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre / etiqueta (opcional)</Label>
              <Input
                placeholder="Ej: Juan García · UCI"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            {context === "hospital" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Habitación / cama</Label>
                <Input
                  placeholder="Ej: Hab 204 · Cama B"
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            )}
            {(context === "remote" || context === "elder") && (
              <div className="space-y-1.5">
                <Label className="text-xs">Municipio / vereda</Label>
                <Input
                  placeholder="Ej: Guatapé · Vereda El Peñol"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            )}
            <Button onClick={add} disabled={!patientId.trim()} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Agregar al panel
            </Button>
          </div>
        ) : (
          <div className="space-y-3 flex flex-col items-center">
            <p className="text-[11px] text-center text-muted-foreground">
              El paciente escanea este QR con la app Humanix desde su teléfono o smartwatch para
              activar el monitoreo remoto con tu institución.
            </p>
            <div className="rounded-2xl border-4 border-violet-500/20 bg-white p-3 shadow-inner">
              <QRCode value={inviteLink} size={160} bgColor="#ffffff" fgColor="#1e1b4b" level="H" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ScanLine className="h-3 w-3 text-violet-500" />
              <span>Compatible con smartphones y smartwatches</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(inviteLink);
                toast.success("Enlace copiado");
              }}
              className="flex items-center gap-1 text-[10px] text-violet-600 hover:underline"
            >
              <Copy className="h-3 w-3" /> Copiar enlace de invitación
            </button>
            <div className="w-full rounded-xl bg-muted/40 border border-border p-3 space-y-1.5 text-[10px] text-muted-foreground">
              <p className="font-semibold text-foreground text-xs">¿Cómo funciona?</p>
              <p>1. Paciente instala app Humanix (iOS / Android)</p>
              <p>2. Escanea el QR o abre el enlace</p>
              <p>3. Acepta el monitoreo → sus signos aparecen aquí en tiempo real</p>
              <p>4. Smartwatch o sensores Bluetooth envían datos automáticamente</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mini vitals strip ────────────────────────────────────────────────────────

function VitalsStrip({ vitals }: { vitals: VitalLatest }) {
  const items: { type: string; value?: number; unit: string; label: string }[] = [
    { type: "heart_rate", value: vitals.heart_rate, unit: "lpm", label: "FC" },
    { type: "spo2", value: vitals.spo2, unit: "%", label: "SpO₂" },
    { type: "temperature", value: vitals.temperature, unit: "°C", label: "Temp" },
    { type: "blood_pressure_sys", value: vitals.blood_pressure_sys, unit: "mmHg", label: "PAS" },
    { type: "respiration_rate", value: vitals.respiration_rate, unit: "rpm", label: "FR" },
  ].filter((i) => i.value !== undefined);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {items.map((item) => {
        const abnormal = item.value !== undefined && isAbnormal(item.type, item.value);
        const critical = item.value !== undefined && isCritical(item.type, item.value);
        return (
          <span
            key={item.type}
            className={cn(
              "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-mono",
              critical
                ? "bg-red-500/10 border-red-500/30 text-red-700 font-bold"
                : abnormal
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-700"
                  : "bg-muted/50 border-border text-muted-foreground",
            )}
          >
            {VITAL_ICON[item.type]}
            {item.label}: <span className="font-semibold">{item.value}</span>
            <span className="opacity-70">{item.unit}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─── Patient Card ─────────────────────────────────────────────────────────────

function PatientCard({
  patient,
  onRemove,
}: {
  patient: MonitoredPatient;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayName =
    patient.full_name ?? patient.label ?? `Paciente ${patient.id.slice(0, 6).toUpperCase()}`;
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();
  const ctx = CONTEXT_META[patient.context];
  const dev = DEVICE_META[patient.deviceType];
  const tri = TRIAGE_META[patient.triage];

  return (
    <Card
      className={cn(
        "border transition-all duration-300",
        patient.triage === "rojo" &&
          "border-red-500/50 bg-red-500/[0.02] shadow-red-500/10 shadow-md",
        patient.triage === "naranja" && "border-orange-500/40 bg-orange-500/[0.02]",
        patient.triage === "amarillo" && "border-amber-500/30",
      )}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div
            className={cn(
              "h-10 w-10 rounded-full border flex items-center justify-center flex-shrink-0 font-bold text-xs",
              patient.triage === "rojo"
                ? "bg-red-500/10 border-red-500/20 text-red-700"
                : patient.triage === "naranja"
                  ? "bg-orange-500/10 border-orange-500/20 text-orange-700"
                  : "bg-violet-500/10 border-violet-500/20 text-violet-700",
            )}
          >
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold truncate">{displayName}</p>
              {/* Triage badge */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide",
                  tri.bg,
                  tri.color,
                )}
              >
                <Brain className="h-2.5 w-2.5" /> {tri.label}
              </span>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border",
                  ctx.color,
                )}
              >
                {ctx.icon} {ctx.label}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                {dev.icon} {dev.label}
              </span>
              {patient.room && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Bed className="h-2.5 w-2.5" /> {patient.room}
                </span>
              )}
              {patient.location && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MapPin className="h-2.5 w-2.5" /> {patient.location}
                </span>
              )}
            </div>

            {/* Online / last seen */}
            <div className="flex items-center gap-2 mt-0.5">
              {patient.online ? (
                <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                  <Wifi className="h-2.5 w-2.5" /> En línea
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <WifiOff className="h-2.5 w-2.5" /> Sin señal
                </span>
              )}
              {patient.last_vital_at && (
                <span className="text-[10px] text-muted-foreground">
                  ·{" "}
                  {formatDistanceToNow(new Date(patient.last_vital_at), {
                    locale: es,
                    addSuffix: true,
                  })}
                </span>
              )}
              {/* Trend */}
              {patient.trend === "up" && <TrendingUp className="h-3 w-3 text-amber-500" />}
              {patient.trend === "down" && <TrendingDown className="h-3 w-3 text-blue-500" />}
              {patient.trend === "stable" && <Minus className="h-3 w-3 text-emerald-500" />}
            </div>

            {/* Mini vitals strip */}
            <VitalsStrip vitals={patient.vitals} />
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {patient.critical_count > 0 && (
              <Badge className="bg-red-500 text-white text-[10px] h-5 px-1.5 animate-pulse">
                {patient.critical_count} crítica{patient.critical_count > 1 ? "s" : ""}
              </Badge>
            )}
            {patient.alert_count > 0 && patient.critical_count === 0 && (
              <Badge
                variant="outline"
                className="border-amber-500/30 text-amber-700 text-[10px] h-5 px-1.5"
              >
                {patient.alert_count} alerta{patient.alert_count > 1 ? "s" : ""}
              </Badge>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpanded(!expanded)}
                className="rounded-lg p-1 hover:bg-muted transition-colors"
                title="Ver signos vitales"
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={() => onRemove(patient.id)}
                className="rounded-lg p-1 hover:bg-red-500/10 text-muted-foreground hover:text-red-600 transition-colors"
                title="Quitar del panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <ClinicalMonitor patientId={patient.id} showDeviceGuide={false} compact />
        </div>
      )}
    </Card>
  );
}

// ─── Stats Header ─────────────────────────────────────────────────────────────

function StatsHeader({
  patients,
  onlineCount,
  totalAlerts,
  totalCritical,
}: {
  patients: MonitoredPatient[];
  onlineCount: number;
  totalAlerts: number;
  totalCritical: number;
}) {
  const byTriage = {
    rojo: patients.filter((p) => p.triage === "rojo").length,
    naranja: patients.filter((p) => p.triage === "naranja").length,
    amarillo: patients.filter((p) => p.triage === "amarillo").length,
    verde: patients.filter((p) => p.triage === "verde").length,
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500/10 via-background to-rose-500/10 border border-border p-5">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -left-6 -bottom-6 h-24 w-24 rounded-full bg-rose-500/8 blur-2xl pointer-events-none" />

      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
            <Heart className="h-5 w-5 text-rose-500 animate-pulse" />
          </div>
          <div>
            <p className="font-bold text-base font-display">Monitoreo Clínico · Live</p>
            <p className="text-xs text-muted-foreground">
              {patients.length} paciente{patients.length !== 1 ? "s" : ""} · {onlineCount} en línea
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalCritical > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-red-500 text-white font-bold animate-pulse">
              <AlertTriangle className="h-3 w-3" /> {totalCritical} crítica
              {totalCritical > 1 ? "s" : ""}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-600 border border-fuchsia-500/20 font-medium">
            <Sparkles className="h-3 w-3" /> Triage IA
          </span>
        </div>
      </div>

      {/* KPI grid */}
      <div className="relative mt-4 grid grid-cols-4 gap-2">
        {[
          {
            label: "Total",
            value: patients.length,
            icon: <Users className="h-3.5 w-3.5 text-violet-500" />,
          },
          {
            label: "En línea",
            value: onlineCount,
            icon: <Wifi className="h-3.5 w-3.5 text-emerald-500" />,
          },
          {
            label: "Alertas",
            value: totalAlerts,
            icon: <Bell className="h-3.5 w-3.5 text-amber-500" />,
          },
          {
            label: "Críticos",
            value: byTriage.rojo + byTriage.naranja,
            icon: <AlertTriangle className="h-3.5 w-3.5 text-red-500" />,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl bg-background/70 border border-border p-2.5 text-center"
          >
            <div className="flex items-center justify-center gap-1 mb-1">{s.icon}</div>
            <p className="text-lg font-bold leading-none">{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Triage summary bar */}
      {patients.length > 0 && (
        <div className="relative mt-3 flex items-center gap-2 flex-wrap">
          <p className="text-[10px] text-muted-foreground font-medium">Triage:</p>
          {byTriage.rojo > 0 && (
            <span className="text-[10px] font-bold text-red-700 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full">
              {byTriage.rojo} 🔴 crítico
            </span>
          )}
          {byTriage.naranja > 0 && (
            <span className="text-[10px] font-semibold text-orange-700 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded-full">
              {byTriage.naranja} 🟠 urgente
            </span>
          )}
          {byTriage.amarillo > 0 && (
            <span className="text-[10px] text-yellow-700 bg-yellow-500/10 border border-yellow-500/30 px-2 py-0.5 rounded-full">
              {byTriage.amarillo} 🟡 atención
            </span>
          )}
          {byTriage.verde > 0 && (
            <span className="text-[10px] text-emerald-700 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              {byTriage.verde} 🟢 estable
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type AlertFilter = "all" | "critical" | "high";

export function InstitutionClinicalMonitoring({ institutionId }: { institutionId: string }) {
  const [stored, setStored] = useState<StoredPatient[]>([]);
  const [patients, setPatients] = useState<MonitoredPatient[]>([]);
  const [globalAlerts, setGlobalAlerts] = useState<PatientAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [contextFilter, setContextFilter] = useState<PatientContext | "all">("all");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    setStored(loadPatients(institutionId));
  }, [institutionId]);

  // ── Enrich with live vitals ───────────────────────────────────────────────
  const enrich = useCallback(async (list: StoredPatient[]) => {
    if (list.length === 0) {
      setPatients([]);
      setGlobalAlerts([]);
      return;
    }
    setLoading(true);
    try {
      const ids = list.map((p) => p.id);
      const since4h = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const since8h = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
      const online2m = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      const [profilesRes, vitalsRes, recentRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        // Last 4h for alerts and latest values
        supabase
          .from("vital_signs_readings")
          .select("family_user_id, reading_type, value, unit, severity, recorded_at")
          .in("family_user_id", ids)
          .gte("recorded_at", since4h)
          .order("recorded_at", { ascending: false })
          .limit(500),
        // Last 2 min for "online" status
        supabase
          .from("vital_signs_readings")
          .select("family_user_id")
          .in("family_user_id", ids)
          .gte("recorded_at", online2m)
          .limit(200),
      ]);

      const nameMap: Record<string, string | null> = {};
      for (const p of (profilesRes.data ?? []) as { user_id: string; full_name: string | null }[]) {
        nameMap[p.user_id] = p.full_name;
      }

      const onlineNow = new Set<string>(
        (recentRes.data ?? []).map((r: { family_user_id: string }) => r.family_user_id),
      );

      type VR = {
        family_user_id: string;
        reading_type: string;
        value: number;
        unit: string | null;
        severity: string;
        recorded_at: string;
      };

      // Per-patient state
      const latestAt: Record<string, string> = {};
      const latestVitals: Record<string, VitalLatest> = {};
      const prevVitals: Record<string, VitalLatest> = {};
      const alertCrit: Record<string, number> = {};
      const alertAll: Record<string, number> = {};
      const allAlerts: PatientAlert[] = [];
      const fallSet = new Set<string>();

      for (const r of (vitalsRes.data ?? []) as VR[]) {
        const pid = r.family_user_id;
        if (!latestAt[pid]) latestAt[pid] = r.recorded_at;

        // Latest value per vital type per patient
        if (!latestVitals[pid]) latestVitals[pid] = {};
        const vmap = latestVitals[pid] as Record<string, number>;
        if (vmap[r.reading_type] === undefined) vmap[r.reading_type] = r.value;

        if (r.reading_type === "fall_detected" && r.value > 0) fallSet.add(pid);

        if (isAbnormal(r.reading_type, r.value)) {
          alertAll[pid] = (alertAll[pid] ?? 0) + 1;
          const crit =
            isCritical(r.reading_type, r.value) || r.severity.toLowerCase() === "critical";
          if (crit) alertCrit[pid] = (alertCrit[pid] ?? 0) + 1;
          allAlerts.push({
            id: `${pid}-${r.reading_type}-${r.recorded_at}`,
            patient_id: pid,
            patient_name: nameMap[pid] ?? null,
            reading_type: r.reading_type,
            value: r.value,
            unit: r.unit ?? THRESHOLDS[r.reading_type]?.unit ?? null,
            severity: crit ? "critical" : "high",
            recorded_at: r.recorded_at,
          });
        }
      }

      // Older window for trend (compare last-4h vs 4-8h)
      const { data: oldData } = await supabase
        .from("vital_signs_readings")
        .select("family_user_id, reading_type, value")
        .in("family_user_id", ids)
        .gte("recorded_at", since8h)
        .lt("recorded_at", since4h)
        .order("recorded_at", { ascending: false })
        .limit(300);

      for (const r of (oldData ?? []) as {
        family_user_id: string;
        reading_type: string;
        value: number;
      }[]) {
        const pid = r.family_user_id;
        if (!prevVitals[pid]) prevVitals[pid] = {};
        const pmap = prevVitals[pid] as Record<string, number>;
        if (pmap[r.reading_type] === undefined) pmap[r.reading_type] = r.value;
      }

      const computeTrend = (pid: string): "up" | "down" | "stable" => {
        const cur = (latestVitals[pid] as Record<string, number>) ?? {};
        const prv = (prevVitals[pid] as Record<string, number>) ?? {};
        const TREND_VITALS = ["heart_rate", "blood_pressure_sys", "temperature"];
        let ups = 0;
        let downs = 0;
        for (const k of TREND_VITALS) {
          if (cur[k] !== undefined && prv[k] !== undefined) {
            const delta = cur[k] - prv[k];
            if (delta > 5) ups++;
            else if (delta < -5) downs++;
          }
        }
        if (ups > downs) return "up";
        if (downs > ups) return "down";
        return "stable";
      };

      const enriched: MonitoredPatient[] = list.map((p) => {
        const crit = alertCrit[p.id] ?? 0;
        const alrt = alertAll[p.id] ?? 0;
        return {
          ...p,
          full_name: nameMap[p.id] ?? null,
          last_vital_at: latestAt[p.id] ?? null,
          online: onlineNow.has(p.id),
          critical_count: crit,
          alert_count: alrt,
          triage: computeTriage(crit, alrt, fallSet.has(p.id)),
          trend: computeTrend(p.id),
          vitals: latestVitals[p.id] ?? {},
        };
      });

      // Sort: crítico primero, luego naranja, luego en línea, luego alertas
      enriched.sort((a, b) => {
        const PRIO: Record<TriageScore, number> = { rojo: 0, naranja: 1, amarillo: 2, verde: 3 };
        return PRIO[a.triage] - PRIO[b.triage] || (b.online ? 1 : 0) - (a.online ? 1 : 0);
      });

      // Deduplicate alerts
      const seen = new Set<string>();
      const deduped = allAlerts.filter((a) => {
        const key = `${a.patient_id}:${a.reading_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      deduped.sort(
        (a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1),
      );

      setPatients(enriched);
      setGlobalAlerts(deduped);
    } catch (err) {
      console.warn("[ClinicalMonitoring] enrich:", err);
      toast.error("Error al cargar signos vitales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    enrich(stored);
  }, [stored, enrich]);

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (stored.length === 0) return;
    const ch = supabase
      .channel(`inst-mon-${institutionId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "vital_signs_readings" },
        (payload) => {
          const pid = (payload.new as { family_user_id?: string }).family_user_id;
          if (pid && stored.some((s) => s.id === pid)) {
            enrich(stored);
            // Sound-free visual nudge for critical
            const val = (payload.new as { value?: number }).value;
            const type = (payload.new as { reading_type?: string }).reading_type ?? "";
            if (val !== undefined && isCritical(type, val)) {
              toast.error(`⚠️ Alerta crítica: ${ALERT_LABEL[type] ?? type} = ${val}`, {
                duration: 8000,
              });
            }
          }
        },
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      ch.unsubscribe();
    };
  }, [institutionId, stored, enrich]);

  const addPatient = (p: StoredPatient) => {
    if (stored.some((s) => s.id === p.id)) {
      toast.info("Este paciente ya está en el panel");
      return;
    }
    const next = [p, ...stored];
    saveStore(institutionId, next);
    setStored(next);
  };

  const removePatient = (id: string) => {
    const next = stored.filter((p) => p.id !== id);
    saveStore(institutionId, next);
    setStored(next);
    toast.success("Paciente retirado del panel");
  };

  const refresh = async () => {
    setRefreshing(true);
    await enrich(stored);
    setRefreshing(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalCritical = patients.reduce((s, p) => s + p.critical_count, 0);
  const totalAlerts = patients.reduce((s, p) => s + p.alert_count, 0);
  const onlineCount = patients.filter((p) => p.online).length;

  const filteredPatients = patients.filter((p) => {
    const matchSearch =
      !search || (p.full_name ?? p.label ?? p.id).toLowerCase().includes(search.toLowerCase());
    const matchCtx = contextFilter === "all" || p.context === contextFilter;
    return matchSearch && matchCtx;
  });

  const visibleAlerts = globalAlerts
    .filter((a) => !dismissed.has(a.id))
    .filter((a) => alertFilter === "all" || a.severity === alertFilter);

  return (
    <div className="space-y-5">
      {showAdd && (
        <AddPatientModal
          institutionId={institutionId}
          onAdded={addPatient}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Stats header */}
      <StatsHeader
        patients={patients}
        onlineCount={onlineCount}
        totalAlerts={totalAlerts}
        totalCritical={totalCritical}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-36">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar paciente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        {/* Context filter */}
        <select
          value={contextFilter}
          onChange={(e) => setContextFilter(e.target.value as PatientContext | "all")}
          className="h-8 text-xs border border-border rounded-lg px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">Todos</option>
          {(
            Object.entries(CONTEXT_META) as [
              PatientContext,
              (typeof CONTEXT_META)[PatientContext],
            ][]
          ).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
          className="h-8 text-xs gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </Button>
        <Button
          size="sm"
          onClick={() => setShowAdd(true)}
          className="h-8 text-xs gap-1 bg-violet-600 hover:bg-violet-700 text-white"
        >
          <Plus className="h-3 w-3" /> Agregar
        </Button>
      </div>

      {/* Global alerts panel */}
      {visibleAlerts.length > 0 && (
        <Card
          className={cn(
            "border",
            totalCritical > 0
              ? "border-red-500/40 bg-red-500/5"
              : "border-amber-500/30 bg-amber-500/5",
          )}
        >
          <button
            onClick={() => setAlertsOpen(!alertsOpen)}
            className="w-full flex items-center justify-between p-3 text-sm font-semibold"
          >
            <div className="flex items-center gap-2">
              <Bell
                className={`h-4 w-4 ${totalCritical > 0 ? "text-red-500 animate-bounce" : "text-amber-500"}`}
              />
              <span>
                Panel de alertas — {visibleAlerts.length} activa
                {visibleAlerts.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1 text-[10px]"
                onClick={(e) => e.stopPropagation()}
              >
                <Filter className="h-3 w-3 text-muted-foreground" />
                <select
                  value={alertFilter}
                  onChange={(e) => setAlertFilter(e.target.value as AlertFilter)}
                  className="bg-transparent text-[10px] focus:outline-none"
                >
                  <option value="all">Todas</option>
                  <option value="critical">Críticas</option>
                  <option value="high">Altas</option>
                </select>
              </div>
              {alertsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {alertsOpen && (
            <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto">
              {visibleAlerts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-xl border bg-card">
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0",
                      a.severity === "critical"
                        ? "bg-red-500/10 text-red-700 border-red-500/20 animate-pulse"
                        : "bg-orange-500/10 text-orange-700 border-orange-500/20",
                    )}
                  >
                    {a.severity === "critical" ? "🔴 CRÍTICA" : "🟠 ALTA"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {a.patient_name ?? "Paciente"} ·{" "}
                      {ALERT_LABEL[a.reading_type] ?? a.reading_type}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.value} {a.unit} ·{" "}
                      {formatDistanceToNow(new Date(a.recorded_at), {
                        locale: es,
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Call button for remote patients */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-1.5"
                      title="Llamar al profesional"
                    >
                      <PhoneCall className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setDismissed((prev) => new Set([...prev, a.id]))}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Empty / loading */}
      {loading && stored.length > 0 && (
        <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Cargando signos vitales…
        </div>
      )}

      {stored.length === 0 && (
        <Card className="p-10 text-center border-dashed">
          <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Activity className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-bold text-sm mb-1">Sin pacientes en monitoreo</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-5">
            Agrega pacientes hospitalizados, remotos o crónicos. La app Humanix o un smartwatch
            compatible sincroniza los signos vitales en tiempo real.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mb-5">
            {(
              Object.entries(CONTEXT_META) as [
                PatientContext,
                (typeof CONTEXT_META)[PatientContext],
              ][]
            ).map(([k, v]) => (
              <span
                key={k}
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border font-medium",
                  v.color,
                )}
              >
                {v.icon} {v.label}
              </span>
            ))}
          </div>
          <Button
            onClick={() => setShowAdd(true)}
            className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          >
            <QrCode className="h-4 w-4" /> Agregar primer paciente
          </Button>
        </Card>
      )}

      {/* Patient list */}
      {!loading && filteredPatients.length > 0 && (
        <div className="space-y-3">
          {filteredPatients.map((p) => (
            <PatientCard key={p.id} patient={p} onRemove={removePatient} />
          ))}
        </div>
      )}

      {filteredPatients.length === 0 && stored.length > 0 && !loading && (
        <Card className="p-6 text-center border-dashed">
          <p className="text-sm text-muted-foreground">
            No hay pacientes que coincidan con los filtros seleccionados.
          </p>
        </Card>
      )}
    </div>
  );
}
