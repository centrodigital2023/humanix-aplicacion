/**
 * InstitutionClinicalMonitoring — Panel Live de monitoreo remoto multi-paciente
 * Lista de pacientes en localStorage (no requiere tabla extra).
 * Signos vitales desde vital_signs_readings. Alertas derivadas in-memory.
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

interface StoredPatient {
  id: string;
  addedAt: string;
  label: string | null; // custom label if entered manually
}

interface MonitoredPatient extends StoredPatient {
  full_name: string | null;
  last_vital_at: string | null;
  online: boolean;
  critical_count: number;
  alert_count: number;
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

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORE_KEY = (instId: string) => `hwx_monitored_${instId}`;

function loadPatients(instId: string): StoredPatient[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY(instId)) ?? "[]"); }
  catch { return []; }
}
function savePatientsStore(instId: string, list: StoredPatient[]) {
  localStorage.setItem(STORE_KEY(instId), JSON.stringify(list));
}

// ─── Severity / threshold helpers ────────────────────────────────────────────

const THRESHOLDS: Record<string, { min?: number; max?: number; unit: string }> = {
  heart_rate:         { min: 50,   max: 110, unit: "lpm" },
  spo2:               { min: 92,             unit: "%" },
  oxygen_saturation:  { min: 92,             unit: "%" },
  temperature:        { min: 35.5, max: 37.5, unit: "°C" },
  body_temperature:   { min: 35.5, max: 37.5, unit: "°C" },
  blood_pressure_sys: { min: 90,   max: 140, unit: "mmHg" },
  blood_pressure_dia: { min: 60,   max: 90,  unit: "mmHg" },
  respiration_rate:   { min: 10,   max: 25,  unit: "resp/min" },
};

function isCritical(readingType: string, value: number): boolean {
  const t = THRESHOLDS[readingType];
  if (!t) return false;
  if (t.min !== undefined && value < t.min - 10) return true;
  if (t.max !== undefined && value > t.max + 15) return true;
  return false;
}
function isAbnormal(readingType: string, value: number): boolean {
  const t = THRESHOLDS[readingType];
  if (!t) return false;
  if (t.min !== undefined && value < t.min) return true;
  if (t.max !== undefined && value > t.max) return true;
  return false;
}

const ALERT_LABEL: Record<string, string> = {
  heart_rate:         "Frec. cardíaca anormal",
  spo2:               "SpO₂ baja",
  oxygen_saturation:  "SpO₂ baja",
  temperature:        "Temperatura anormal",
  blood_pressure_sys: "PA sistólica anormal",
  blood_pressure_dia: "PA diastólica anormal",
  respiration_rate:   "Respiración anormal",
  fall_detected:      "Caída detectada",
};

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

  const inviteLink = `humanix://monitor-invite?institution=${institutionId}`;

  const add = () => {
    const trimmed = patientId.trim();
    if (!trimmed) { toast.error("Ingresa el ID del paciente"); return; }
    const patient: StoredPatient = { id: trimmed, addedAt: new Date().toISOString(), label: label.trim() || null };
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
              <p className="text-[11px] text-muted-foreground">Seguimiento remoto en tiempo real</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl">
          {(["id", "qr"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={cn("flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {m === "id" ? <Search className="h-3 w-3" /> : <QrCode className="h-3 w-3" />}
              {m === "id" ? "Por ID" : "Por QR"}
            </button>
          ))}
        </div>

        {mode === "id" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">UUID del paciente</Label>
              <Input placeholder="Pega el ID del paciente" value={patientId}
                onChange={(e) => setPatientId(e.target.value.trim())} className="h-9 text-xs font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre o etiqueta (opcional)</Label>
              <Input placeholder="Ej: Habitación 204 · Juan García" value={label}
                onChange={(e) => setLabel(e.target.value)} className="h-9 text-xs" />
            </div>
            <Button onClick={add} disabled={!patientId.trim()} className="w-full gap-2">
              <Plus className="h-4 w-4" /> Agregar al panel
            </Button>
          </div>
        ) : (
          <div className="space-y-3 flex flex-col items-center">
            <p className="text-[11px] text-center text-muted-foreground">
              El paciente escanea este QR con la app Humanix para aceptar el monitoreo de tu institución.
            </p>
            <div className="rounded-2xl border-4 border-violet-500/20 bg-white p-3 shadow-inner">
              <QRCode value={inviteLink} size={160} bgColor="#ffffff" fgColor="#1e1b4b" level="H" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ScanLine className="h-3 w-3 text-violet-500" />
              <span>El paciente acepta desde su app</span>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(inviteLink); toast.success("Enlace copiado"); }}
              className="flex items-center gap-1 text-[10px] text-violet-600 hover:underline">
              <Copy className="h-3 w-3" /> Copiar enlace de invitación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Patient Card ─────────────────────────────────────────────────────────────

function PatientCard({ patient, onRemove }: { patient: MonitoredPatient; onRemove: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = patient.full_name ?? patient.label ?? patient.id.slice(0, 8).toUpperCase();
  const initials = displayName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <Card className={cn("border transition-colors",
      patient.critical_count > 0 && "border-red-500/40 bg-red-500/[0.02]",
      patient.alert_count > 0 && patient.critical_count === 0 && "border-amber-500/30")}>
      <div className="p-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0 font-bold text-xs text-violet-700">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{displayName}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {patient.online
              ? <span className="flex items-center gap-1 text-[10px] text-emerald-600"><Wifi className="h-2.5 w-2.5" /> En línea</span>
              : <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><WifiOff className="h-2.5 w-2.5" /> Sin datos recientes</span>}
            {patient.last_vital_at && (
              <span className="text-[10px] text-muted-foreground">
                · {formatDistanceToNow(new Date(patient.last_vital_at), { locale: es, addSuffix: true })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {patient.critical_count > 0 && (
            <Badge className="bg-red-500 text-white text-[10px] h-5 px-1.5 animate-pulse">
              {patient.critical_count} crítica{patient.critical_count > 1 ? "s" : ""}
            </Badge>
          )}
          {patient.alert_count > 0 && patient.critical_count === 0 && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-700 text-[10px] h-5 px-1.5">
              {patient.alert_count} alerta{patient.alert_count > 1 ? "s" : ""}
            </Badge>
          )}
          <button onClick={() => setExpanded(!expanded)} className="rounded-lg p-1 hover:bg-muted transition-colors">
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          <button onClick={() => onRemove(patient.id)}
            className="rounded-lg p-1 hover:bg-red-500/10 text-muted-foreground hover:text-red-600 transition-colors" title="Quitar del panel">
            <X className="h-3.5 w-3.5" />
          </button>
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

// ─── Main Component ───────────────────────────────────────────────────────────

type AlertFilter = "all" | "critical" | "high";

export function InstitutionClinicalMonitoring({ institutionId }: { institutionId: string }) {
  const [stored, setStored] = useState<StoredPatient[]>([]);
  const [patients, setPatients] = useState<MonitoredPatient[]>([]);
  const [globalAlerts, setGlobalAlerts] = useState<PatientAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  const [alertsOpen, setAlertsOpen] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Load from localStorage on mount ──────────────────────────────────────
  useEffect(() => {
    setStored(loadPatients(institutionId));
  }, [institutionId]);

  // ── Enrich patients with live data ────────────────────────────────────────
  const enrich = useCallback(async (list: StoredPatient[]) => {
    if (list.length === 0) { setPatients([]); setGlobalAlerts([]); return; }
    setLoading(true);
    try {
      const ids = list.map((p) => p.id);
      const since2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const [profilesRes, vitalsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name").in("user_id", ids),
        supabase.from("vital_signs_readings")
          .select("family_user_id, reading_type, value, unit, severity, recorded_at")
          .in("family_user_id", ids)
          .gte("recorded_at", since2h)
          .order("recorded_at", { ascending: false })
          .limit(300),
      ]);

      const nameMap: Record<string, string | null> = {};
      for (const p of (profilesRes.data ?? []) as { user_id: string; full_name: string | null }[]) {
        nameMap[p.user_id] = p.full_name;
      }

      type VReading = { family_user_id: string; reading_type: string; value: number; unit: string | null; severity: string; recorded_at: string };
      const latestAt: Record<string, string> = {};
      const onlineSet = new Set<string>();
      const alertCrit: Record<string, number> = {};
      const alertAll: Record<string, number> = {};
      const allAlerts: PatientAlert[] = [];

      for (const r of (vitalsRes.data ?? []) as VReading[]) {
        if (!latestAt[r.family_user_id]) latestAt[r.family_user_id] = r.recorded_at;
        onlineSet.add(r.family_user_id);
        if (isAbnormal(r.reading_type, r.value)) {
          alertAll[r.family_user_id] = (alertAll[r.family_user_id] ?? 0) + 1;
          const crit = isCritical(r.reading_type, r.value) || r.severity.toLowerCase() === "critical";
          if (crit) alertCrit[r.family_user_id] = (alertCrit[r.family_user_id] ?? 0) + 1;
          allAlerts.push({
            id: `${r.family_user_id}-${r.reading_type}-${r.recorded_at}`,
            patient_id: r.family_user_id,
            patient_name: nameMap[r.family_user_id] ?? null,
            reading_type: r.reading_type,
            value: r.value,
            unit: r.unit ?? THRESHOLDS[r.reading_type]?.unit ?? null,
            severity: crit ? "critical" : "high",
            recorded_at: r.recorded_at,
          });
        }
      }

      const enriched: MonitoredPatient[] = list.map((p) => ({
        ...p,
        full_name: nameMap[p.id] ?? null,
        last_vital_at: latestAt[p.id] ?? null,
        online: onlineSet.has(p.id),
        critical_count: alertCrit[p.id] ?? 0,
        alert_count: alertAll[p.id] ?? 0,
      }));

      enriched.sort((a, b) =>
        b.critical_count - a.critical_count || b.alert_count - a.alert_count || (b.online ? 1 : 0) - (a.online ? 1 : 0)
      );

      // Deduplicate alerts (keep worst per patient+type)
      const seen = new Set<string>();
      const deduped = allAlerts.filter((a) => {
        const key = `${a.patient_id}:${a.reading_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      deduped.sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1));

      setPatients(enriched);
      setGlobalAlerts(deduped);
    } catch (err) {
      console.warn("[InstitutionMonitoring] enrich:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { enrich(stored); }, [stored, enrich]);

  // ── Realtime: new vitals refresh the summary ─────────────────────────────
  useEffect(() => {
    if (stored.length === 0) return;
    const channel = supabase
      .channel(`inst-mon-${institutionId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "vital_signs_readings" },
        () => enrich(stored))
      .subscribe();
    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [institutionId, stored, enrich]);

  const addPatient = (p: StoredPatient) => {
    if (stored.some((s) => s.id === p.id)) { toast.info("Este paciente ya está en el panel"); return; }
    const next = [p, ...stored];
    savePatientsStore(institutionId, next);
    setStored(next);
  };

  const removePatient = (id: string) => {
    const next = stored.filter((p) => p.id !== id);
    savePatientsStore(institutionId, next);
    setStored(next);
    toast.success("Paciente retirado del panel");
  };

  const dismissAlert = (id: string) => setDismissedAlerts((prev) => new Set([...prev, id]));

  const refresh = async () => { setRefreshing(true); await enrich(stored); setRefreshing(false); };

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalCritical = patients.reduce((s, p) => s + p.critical_count, 0);
  const totalAlerts   = patients.reduce((s, p) => s + p.alert_count, 0);
  const onlineCount   = patients.filter((p) => p.online).length;

  const filteredPatients = patients.filter((p) =>
    !search || (p.full_name ?? p.label ?? p.id).toLowerCase().includes(search.toLowerCase())
  );

  const visibleAlerts = globalAlerts
    .filter((a) => !dismissedAlerts.has(a.id))
    .filter((a) => alertFilter === "all" || a.severity === alertFilter);

  return (
    <div className="space-y-5">
      {showAdd && <AddPatientModal institutionId={institutionId} onAdded={addPatient} onClose={() => setShowAdd(false)} />}

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500/10 via-background to-rose-500/10 border border-border p-5">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <Heart className="h-5 w-5 text-rose-500 animate-pulse" />
            </div>
            <div>
              <p className="font-bold text-base font-display">Monitoreo Remoto · Live</p>
              <p className="text-xs text-muted-foreground">
                {patients.length} paciente{patients.length !== 1 ? "s" : ""} · {onlineCount} en línea
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {totalCritical > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-red-500 text-white font-bold animate-pulse">
                <AlertTriangle className="h-3 w-3" /> {totalCritical} crítica{totalCritical > 1 ? "s" : ""}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-600 border border-fuchsia-500/20 font-medium">
              <Sparkles className="h-3 w-3" /> IA clínica
            </span>
          </div>
        </div>

        <div className="relative mt-4 grid grid-cols-3 gap-3">
          {[
            { label: "Pacientes", value: patients.length, icon: <Users className="h-3.5 w-3.5 text-violet-500" /> },
            { label: "En línea",  value: onlineCount,     icon: <Wifi  className="h-3.5 w-3.5 text-emerald-500" /> },
            { label: "Alertas",   value: totalAlerts,     icon: <Bell  className="h-3.5 w-3.5 text-amber-500" /> },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-background/70 border border-border p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">{s.icon}</div>
              <p className="text-lg font-bold leading-none">{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Buscar paciente..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-8 text-xs" />
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="h-8 text-xs gap-1">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </Button>
        <Button size="sm" onClick={() => setShowAdd(true)} className="h-8 text-xs gap-1 bg-violet-600 hover:bg-violet-700 text-white">
          <Plus className="h-3 w-3" /> Agregar paciente
        </Button>
      </div>

      {/* Global alerts */}
      {visibleAlerts.length > 0 && (
        <Card className={cn("border", totalCritical > 0 ? "border-red-500/40 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5")}>
          <button onClick={() => setAlertsOpen(!alertsOpen)} className="w-full flex items-center justify-between p-3 text-sm font-semibold">
            <div className="flex items-center gap-2">
              <Bell className={`h-4 w-4 ${totalCritical > 0 ? "text-red-500 animate-bounce" : "text-amber-500"}`} />
              <span>Panel de alertas — {visibleAlerts.length} activa{visibleAlerts.length > 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
                <Filter className="h-3 w-3 text-muted-foreground" />
                <select value={alertFilter} onChange={(e) => setAlertFilter(e.target.value as AlertFilter)}
                  className="bg-transparent text-[10px] focus:outline-none">
                  <option value="all">Todas</option>
                  <option value="critical">Críticas</option>
                  <option value="high">Altas</option>
                </select>
              </div>
              {alertsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>
          {alertsOpen && (
            <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
              {visibleAlerts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 p-2 rounded-xl border bg-card">
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap flex-shrink-0",
                    a.severity === "critical"
                      ? "bg-red-500/10 text-red-700 border-red-500/20 animate-pulse"
                      : "bg-orange-500/10 text-orange-700 border-orange-500/20")}>
                    {a.severity.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {a.patient_name ?? "Paciente"} · {ALERT_LABEL[a.reading_type] ?? a.reading_type}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.value} {a.unit} · {formatDistanceToNow(new Date(a.recorded_at), { locale: es, addSuffix: true })}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 whitespace-nowrap flex-shrink-0"
                    onClick={() => dismissAlert(a.id)}>
                    <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Loading */}
      {loading && stored.length > 0 && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {stored.length === 0 && (
        <Card className="p-10 text-center border-dashed">
          <div className="h-14 w-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Activity className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-bold text-sm mb-2">Sin pacientes en monitoreo</p>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto mb-4">
            Agrega pacientes para ver sus signos vitales en tiempo real, recibir alertas y gestionar el seguimiento remoto.
          </p>
          <Button onClick={() => setShowAdd(true)} className="gap-2 bg-violet-600 hover:bg-violet-700 text-white">
            <QrCode className="h-4 w-4" /> Agregar primer paciente
          </Button>
        </Card>
      )}

      {/* Patient cards */}
      {!loading && filteredPatients.length > 0 && (
        <div className="space-y-3">
          {filteredPatients.map((p) => (
            <PatientCard key={p.id} patient={p} onRemove={removePatient} />
          ))}
        </div>
      )}

      {filteredPatients.length === 0 && stored.length > 0 && !loading && (
        <Card className="p-6 text-center border-dashed">
          <p className="text-sm text-muted-foreground">No hay pacientes que coincidan con "{search}"</p>
        </Card>
      )}
    </div>
  );
}
