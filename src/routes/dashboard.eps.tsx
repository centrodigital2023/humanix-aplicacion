/**
 * Ruta: /dashboard/eps
 * Portal EPS/IPS — Dashboard ejecutivo multi-tenant con KPIs clínicos
 * Módulo 7: Dashboard EPS · Módulo 8: Multi-tenant
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAppUser } from "@/hooks/use-app-user";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { EPSDashboard } from "@/components/humanix/EPSDashboard";
import { ClinicalMonitor } from "@/components/humanix/ClinicalMonitor";
import { PatientRiskCard } from "@/components/humanix/PatientRiskCard";
import { AlertSystem } from "@/components/humanix/AlertSystem";
import {
  Loader2,
  LayoutDashboard,
  Heart,
  AlertTriangle,
  Users,
  FileBarChart2,
  Settings,
  Building2,
  ShieldCheck,
  ClipboardList,
  Stethoscope,
  ChevronRight,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/eps")({
  head: () => ({
    meta: [
      { title: "Portal EPS · Humanix" },
      { name: "description", content: "Dashboard ejecutivo EPS/IPS con KPIs clínicos, riesgo poblacional y monitoreo en tiempo real." },
    ],
  }),
  component: EPSPortalPage,
});

const NAV: NavItem[] = [
  { label: "KPIs",        to: "/dashboard/eps",          icon: LayoutDashboard },
  { label: "Monitoreo",   to: "/dashboard/monitoreo",    icon: Heart },
  { label: "Profesionales", to: "/buscar",               icon: Users },
  { label: "Institución", to: "/dashboard/institucion",  icon: Building2 },
  { label: "Configuración", to: "/institution/profile",  icon: Settings },
];

type EpsTab = "overview" | "patients" | "alerts" | "reports" | "compliance";

// ─── Compliance card ──────────────────────────────────────────────────────────

function ComplianceCard({ label, value, target, icon }: {
  label: string;
  value: number;
  target: number;
  icon: React.ReactNode;
}) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card">
      <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium truncate">{label}</span>
          <span className="text-xs font-bold tabular-nums ml-2">{value}/{target}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", color)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={cn("text-[10px] mt-0.5 block font-medium",
          pct >= 90 ? "text-emerald-600" : pct >= 70 ? "text-amber-600" : "text-red-600"
        )}>
          {pct}% cumplimiento
        </span>
      </div>
    </div>
  );
}

// ─── Patient row ──────────────────────────────────────────────────────────────

function PatientRow({ name, riskLevel, riskScore, lastService, onClick }: {
  name: string;
  riskLevel: string;
  riskScore: number;
  lastService: string;
  onClick?: () => void;
}) {
  const riskColor: Record<string, string> = {
    critical: "bg-red-500/10 text-red-600 dark:text-red-400",
    high:     "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    medium:   "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    low:      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  };
  const riskLabel: Record<string, string> = {
    critical: "Crítico", high: "Alto", medium: "Moderado", low: "Bajo",
  };
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/30 transition-colors",
        onClick && "cursor-pointer",
      )}
    >
      <div className="h-8 w-8 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 text-xs font-bold">
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{name}</p>
        <p className="text-[10px] text-muted-foreground">{lastService}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", riskColor[riskLevel] ?? riskColor.low)}>
          {riskLabel[riskLevel] ?? riskLevel}
        </span>
        <span className="text-xs font-bold tabular-nums text-muted-foreground w-8 text-right">
          {riskScore}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function EPSPortalPage() {
  const { user, loading, logout } = useAppUser({
    requireAuth: true,
    allow: ["institution", "superadmin"],
  });
  const [tab, setTab] = useState<EpsTab>("overview");
  const [searchPatient, setSearchPatient] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const TABS: Array<{ id: EpsTab; label: string; icon: React.ReactNode }> = [
    { id: "overview",    label: "Resumen",      icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    { id: "patients",   label: "Pacientes",    icon: <Users className="h-3.5 w-3.5" /> },
    { id: "alerts",     label: "Alertas",      icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { id: "compliance", label: "Cumplimiento", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { id: "reports",    label: "Reportes IA",  icon: <FileBarChart2 className="h-3.5 w-3.5" /> },
  ];

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Portal EPS"
      subtitle="Dashboard ejecutivo clínico"
      badge={{ label: "EPS", tone: "cyber" }}
    >
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* Hero ejecutivo premium */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-biosensor/10 via-background to-fuchsia-neural/10 border border-border p-5">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-fuchsia-neural/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-biosensor/10 border border-biosensor/20 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-6 w-6 text-biosensor" />
              </div>
              <div>
                <p className="text-base font-bold font-display leading-tight">{user.fullName}</p>
                <p className="text-xs text-muted-foreground">Centro de mando clínico · Multi-tenant</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/20 font-medium">
                <Heart className="h-3 w-3" /> Monitoreo en vivo
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural border border-fuchsia-neural/20 font-medium">
                <Stethoscope className="h-3 w-3" /> IA clínica Humanix
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                <ShieldCheck className="h-3 w-3" /> HIPAA · GDPR ready
              </span>
            </div>
          </div>
        </div>

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

        {/* Overview */}
        {tab === "overview" && (
          <EPSDashboard
            title={`Dashboard EPS · ${user.fullName}`}
          />
        )}

        {/* Patients tab */}
        {tab === "patients" && (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar paciente por nombre o ID…"
                value={searchPatient}
                onChange={(e) => setSearchPatient(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>

            {/* Selected patient detail */}
            {selectedPatientId && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Detalle del paciente</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedPatientId(null)}
                    className="h-7 text-xs"
                  >
                    Volver a la lista
                  </Button>
                </div>
                <div className="grid lg:grid-cols-2 gap-4">
                  <ClinicalMonitor
                    patientId={selectedPatientId}
                    showDeviceGuide={false}
                    compact
                  />
                  <PatientRiskCard
                    patientId={selectedPatientId}
                    compact
                  />
                </div>
              </div>
            )}

            {/* Patient list placeholder */}
            {!selectedPatientId && (
              <div className="space-y-2">
                <Card className="p-8 text-center border-dashed">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">Lista de pacientes EPS</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                    Los pacientes vinculados a tu EPS/IPS aparecerán aquí.
                    Haz clic en un paciente para ver su monitoreo clínico y score de riesgo.
                  </p>
                  <div className="mt-4 space-y-2 text-left max-w-sm mx-auto">
                    {[
                      { name: "Carlos Rodríguez M.", level: "critical", score: 78, svc: "Visita hace 2 h" },
                      { name: "María González P.",   level: "high",     score: 62, svc: "Visita ayer" },
                      { name: "Juan Pablo Soto L.",  level: "medium",   score: 44, svc: "Visita hace 3 días" },
                      { name: "Ana Martínez R.",     level: "low",      score: 18, svc: "Visita hace 1 semana" },
                    ].map((p) => (
                      <PatientRow
                        key={p.name}
                        name={p.name}
                        riskLevel={p.level}
                        riskScore={p.score}
                        lastService={p.svc}
                        onClick={() => setSelectedPatientId(user.id)} // demo: use current user as patient
                      />
                    ))}
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* Alerts tab */}
        {tab === "alerts" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Alertas clínicas — toda la red
              </p>
            </div>
            <AlertSystem patientId={user.id} />
          </div>
        )}

        {/* Compliance tab */}
        {tab === "compliance" && (
          <div className="space-y-4">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Cumplimiento operativo
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <ComplianceCard
                label="Servicios con Check-in/out"
                value={87}
                target={100}
                icon={<ClipboardList className="h-4 w-4 text-sky-500" />}
              />
              <ComplianceCard
                label="Evidencias fotográficas"
                value={74}
                target={100}
                icon={<FileBarChart2 className="h-4 w-4 text-violet-500" />}
              />
              <ComplianceCard
                label="Contratos firmados digitalmente"
                value={92}
                target={100}
                icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
              />
              <ComplianceCard
                label="Profesionales con docs vigentes"
                value={68}
                target={100}
                icon={<Users className="h-4 w-4 text-amber-500" />}
              />
              <ComplianceCard
                label="Vitales registrados (semana)"
                value={156}
                target={200}
                icon={<Heart className="h-4 w-4 text-rose-500" />}
              />
              <ComplianceCard
                label="Alertas resueltas en < 2 h"
                value={43}
                target={50}
                icon={<Stethoscope className="h-4 w-4 text-teal-500" />}
              />
            </div>

            {/* HIPAA/GDPR readiness */}
            <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Seguridad y Regulaciones
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {[
                  { label: "RLS Supabase", ok: true },
                  { label: "MFA habilitado", ok: true },
                  { label: "Auditoría activa", ok: true },
                  { label: "HIPAA Ready", ok: true },
                  { label: "GDPR Ready", ok: true },
                  { label: "Habeas Data CO", ok: true },
                  { label: "Encriptación TLS 1.3", ok: true },
                  { label: "Backups automáticos", ok: true },
                  { label: "ISO 27001", ok: false },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5 text-xs">
                    {item.ok ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                    )}
                    <span className={item.ok ? "text-foreground" : "text-muted-foreground"}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Reports tab */}
        {tab === "reports" && (
          <div className="space-y-4">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <FileBarChart2 className="h-4 w-4 text-violet-500" />
              Reportes clínicos automáticos — IA
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { title: "Reporte semanal de signos vitales", date: "Lun 02 Jun 2026", status: "ready", pages: 4 },
                { title: "Análisis de riesgo poblacional",    date: "Dom 01 Jun 2026", status: "ready", pages: 7 },
                { title: "Resumen de alertas críticas",       date: "Sáb 31 May 2026", status: "ready", pages: 2 },
                { title: "Cumplimiento operativo mensual",    date: "Vie 30 May 2026", status: "ready", pages: 5 },
              ].map((report) => (
                <Card key={report.title} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">{report.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{report.date} · {report.pages} páginas</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0">
                    Ver PDF
                  </Button>
                </Card>
              ))}
            </div>

            <Card className="p-4 border-dashed text-center space-y-2">
              <FileBarChart2 className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">Generar reporte IA personalizado</p>
              <p className="text-xs text-muted-foreground">
                Selecciona el período y tipo de análisis. El motor Humanix AI genera el reporte en menos de 30 segundos.
              </p>
              <Button size="sm" className="gap-1">
                <Stethoscope className="h-3.5 w-3.5" />
                Generar reporte
              </Button>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
