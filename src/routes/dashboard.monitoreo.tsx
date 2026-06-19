/**
 * Ruta: /dashboard/monitoreo
 * Portal de monitoreo clínico en tiempo real para paciente / familia / profesional
 * Módulo 4: Monitoreo clínico · Módulo 5: Alertas · Módulo 6: AI
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAppUser } from "@/hooks/use-app-user";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { ClinicalMonitor } from "@/components/humanix/ClinicalMonitor";
import { AlertSystem } from "@/components/humanix/AlertSystem";
import { PatientRiskCard } from "@/components/humanix/PatientRiskCard";
import { WearableConnections } from "@/components/humanix/WearableConnections";
import { SamsungHealthCard } from "@/components/humanix/SamsungHealthCard";
import { SosFamiliarButton } from "@/components/humanix/SosFamiliarButton";
import {
  Loader2,
  Heart,
  Activity,
  Bell,
  ShieldAlert,
  User,
  LayoutDashboard,
  Search,
  MessageSquare,
  Crown,
  Info,
  Sparkles,
  Upload,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

const sb = supabase as unknown as SupabaseClient;

export const Route = createFileRoute("/dashboard/monitoreo")({
  head: () => ({
    meta: [
      { title: "Monitoreo Clínico · Humanix" },
      { name: "description", content: "Monitoreo de signos vitales en tiempo real con Apple HealthKit y Google Health Connect" },
    ],
  }),
  component: MonitoreoPage,
});

const getNav = (role: string): NavItem[] => {
  if (role === "professional") {
    return [
      { label: "Mi panel", to: "/dashboard/profesional", icon: LayoutDashboard },
      { label: "Monitoreo", to: "/dashboard/monitoreo", icon: Heart },
      { label: "Mensajes", to: "/mensajes", icon: MessageSquare },
      { label: "Buscar", to: "/buscar", icon: Search },
    ];
  }
  return [
    { label: "Inicio", to: "/dashboard/familia", icon: LayoutDashboard },
    { label: "Monitoreo", to: "/dashboard/monitoreo", icon: Heart },
    { label: "Mensajes", to: "/mensajes", icon: MessageSquare },
    { label: "Planes", to: "/planes", icon: Crown },
  ];
};

type Tab = "vitales" | "alertas" | "riesgo" | "manual";

function MonitoreoPage() {
  const { user, loading, logout } = useAppUser({ requireAuth: true });
  const [tab, setTab] = useState<Tab>("vitales");
  const [targetPatientId, setTargetPatientId] = useState<string>("");

  // Manual vital input state
  const [manualVital, setManualVital] = useState({
    type: "heart_rate",
    value: "",
  });
  const [savingManual, setSavingManual] = useState(false);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The patient to monitor: for professionals they can enter a patient ID,
  // for patients/families it defaults to the current user
  const patientId = targetPatientId || user.id;

  const isClinician =
    user.roles.includes("professional") ||
    user.roles.includes("institution") ||
    user.roles.includes("superadmin");

  const saveManualVital = async () => {
    if (!manualVital.value || isNaN(Number(manualVital.value))) {
      toast.error("Ingresa un valor numérico válido");
      return;
    }
    setSavingManual(true);
    try {
      const UNITS: Record<string, string> = {
        heart_rate:         "lpm",
        spo2:               "%",
        temperature:        "°C",
        blood_pressure_sys: "mmHg",
        blood_pressure_dia: "mmHg",
        respiratory_rate:   "resp/min",
        glucose:            "mg/dL",
      };

      // El tipo seleccionado por el usuario (viene del <select> abajo)
      const readingType = manualVital.type;

      const { error } = await sb.from("vital_signs_readings").insert({
        family_user_id: patientId,
        reading_type:   readingType,
        value:          parseFloat(manualVital.value),
        unit:           UNITS[readingType] ?? "",
        source:         "manual",
        severity:       "normal",
        recorded_at:    new Date().toISOString(),
      });

      if (error) throw error;
      toast.success("Medición registrada");
      setManualVital((prev) => ({ ...prev, value: "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSavingManual(false);
    }
  };

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "vitales", label: "Signos vitales", icon: <Activity className="h-3.5 w-3.5" /> },
    { id: "alertas", label: "Alertas", icon: <Bell className="h-3.5 w-3.5" /> },
    { id: "riesgo", label: "Riesgo IA", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
    { id: "manual", label: "Registrar", icon: <Upload className="h-3.5 w-3.5" /> },
  ];

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={getNav(user.primaryRole)}
      title="Monitoreo Clínico"
      subtitle="Signos vitales en tiempo real"
      badge={{ label: "Live", tone: "bio" }}
    >
      <div className="space-y-5 max-w-4xl mx-auto">
        {/* Hero premium */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-biosensor/10 via-background to-fuchsia-neural/10 border border-border p-5">
          <div className="absolute -left-10 -bottom-14 h-40 w-40 rounded-full bg-biosensor/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-biosensor/10 border border-biosensor/20 flex items-center justify-center flex-shrink-0">
                <Heart className="h-6 w-6 text-biosensor animate-pulse" />
              </div>
              <div>
                <p className="text-base font-bold font-display leading-tight">
                  {!targetPatientId ? `Hola, ${user.fullName.split(" ")[0]}` : "Monitoreo del paciente"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Signos vitales, alertas e IA clínica sincronizados en tiempo real
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> En vivo
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural border border-fuchsia-neural/20 font-medium">
                <Sparkles className="h-3 w-3" /> Humanix AI
              </span>
            </div>
          </div>
          {!targetPatientId && (
            <div className="relative mt-4 flex items-center justify-between gap-3 rounded-xl border border-red-600/20 bg-red-600/5 p-3">
              <p className="text-xs text-muted-foreground max-w-[60%]">
                ¿Necesitas ayuda urgente? Avisa a tu familia y a tu profesional al instante con tu
                ubicación.
              </p>
              <SosFamiliarButton patientId={patientId} />
            </div>
          )}
        </div>

        {/* Patient selector for clinicians */}
        {isClinician && (
          <Card className="p-4 border-sky-500/30 bg-sky-500/5">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-sky-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-3">
                <p className="text-xs font-medium text-sky-700 dark:text-sky-300">
                  Como profesional, puedes monitorear a un paciente específico.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">UUID del paciente</Label>
                    <Input
                      placeholder="Pega el ID del paciente aquí"
                      value={targetPatientId}
                      onChange={(e) => setTargetPatientId(e.target.value.trim())}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTargetPatientId("")}
                      className="h-8 text-xs"
                    >
                      <User className="h-3 w-3 mr-1" />
                      Mis datos
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Vinculación de wearables (solo sobre los propios datos del usuario) */}
        {!targetPatientId && (
          <>
            <SamsungHealthCard patientId={patientId} />
            <WearableConnections patientId={patientId} />
          </>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted/50 rounded-xl overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "vitales" && (
          <ClinicalMonitor
            patientId={patientId}
            showDeviceGuide={true}
          />
        )}

        {tab === "alertas" && (
          <AlertSystem patientId={patientId} />
        )}

        {tab === "riesgo" && (
          <PatientRiskCard
            patientId={patientId}
            patientName={!targetPatientId ? user.fullName : "Paciente"}
          />
        )}

        {tab === "manual" && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Registrar medición manual</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Ingresa las mediciones tomadas con dispositivos no conectados digitalmente.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tipo de signo vital</Label>
                <select
                  value={manualVital.type}
                  onChange={(e) => setManualVital((p) => ({ ...p, type: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="heart_rate">Frecuencia cardíaca (lpm)</option>
                  <option value="spo2">Saturación O₂ SpO₂ (%)</option>
                  <option value="temperature">Temperatura (°C)</option>
                  <option value="blood_pressure_sys">Presión sistólica (mmHg)</option>
                  <option value="blood_pressure_dia">Presión diastólica (mmHg)</option>
                  <option value="respiratory_rate">Frec. respiratoria (resp/min)</option>
                  <option value="glucose">Glucosa (mg/dL)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Valor medido</Label>
                <Input
                  type="number"
                  placeholder="Ej: 72"
                  value={manualVital.value}
                  onChange={(e) => setManualVital((p) => ({ ...p, value: e.target.value }))}
                  className="h-9 text-sm"
                  step="0.1"
                />
              </div>
            </div>

            <Button
              onClick={saveManualVital}
              disabled={savingManual || !manualVital.value}
              className="w-full gap-2"
            >
              {savingManual ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Registrar medición
            </Button>

            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Las mediciones manuales se marcan como fuente "manual" y quedan en el historial del paciente.
              </p>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
