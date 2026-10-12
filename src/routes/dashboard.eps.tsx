/**
 * Ruta: /dashboard/eps
 * Portal EPS/IPS — resumen operativo, pacientes, monitoreo, cumplimiento y reportes de la propia institución.
 *
 * Todo lo que muestra sale de los datos reales de la institución: sus servicios, sus pacientes registrados, el monitoreo
 * de sus pacientes y los indicadores de calidad y de gestión (lógica en `src/lib`). Antes mezclaba cifras inventadas
 * (tendencias al azar, porcentajes fijos, una lista de pacientes de ejemplo y reportes que no existían).
 */
import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppUser } from "@/hooks/use-app-user";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { EPSDashboard } from "@/components/humanix/EPSDashboard";
import { EnhancedPatientsModule } from "@/components/humanix/EnhancedPatientsModule";
import { InstitutionClinicalMonitoring } from "@/components/humanix/InstitutionClinicalMonitoring";
import { EpsCompliance } from "@/components/humanix/institution/EpsCompliance";
import {
  InstSmartCenter,
  type InstSection,
} from "@/components/humanix/institution/InstSmartCenter";
import { useInstitutionIdentity } from "@/hooks/use-eps-intel";
import {
  Loader2,
  LayoutDashboard,
  Heart,
  Users,
  FileBarChart2,
  Settings,
  Building2,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/eps")({
  head: () => ({
    meta: [
      { title: "Portal EPS · Humanix" },
      {
        name: "description",
        content:
          "Portal EPS/IPS: resumen operativo, pacientes, monitoreo, cumplimiento y reportes de gestión de tu institución.",
      },
    ],
  }),
  component: EPSPortalPage,
});

const NAV: NavItem[] = [
  { label: "KPIs", to: "/dashboard/eps", icon: LayoutDashboard },
  { label: "Monitoreo", to: "/dashboard/monitoreo", icon: Heart },
  { label: "Profesionales", to: "/buscar", icon: Users },
  { label: "Institución", to: "/dashboard/institucion", icon: Building2 },
  { label: "Configuración", to: "/institution/profile", icon: Settings },
];

type EpsTab = "overview" | "patients" | "monitoring" | "compliance" | "reports";

const TABS: Array<{ id: EpsTab; label: string; icon: React.ReactNode }> = [
  { id: "overview", label: "Resumen", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
  { id: "patients", label: "Pacientes", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "monitoring", label: "Monitoreo", icon: <Activity className="h-3.5 w-3.5" /> },
  { id: "compliance", label: "Cumplimiento", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { id: "reports", label: "Reportes", icon: <FileBarChart2 className="h-3.5 w-3.5" /> },
];

// ─── Main Component ───────────────────────────────────────────────────────────

function EPSPortalPage() {
  const { user, loading, logout } = useAppUser({
    requireAuth: true,
    allow: ["institution", "superadmin"],
  });
  const navigate = useNavigate();
  const [tab, setTab] = useState<EpsTab>("overview");
  const [section, setSection] = useState<InstSection>("costos");
  const identity = useInstitutionIdentity(user?.id);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const name = identity.data?.institution_name || user.fullName || "Mi institución";
  const detail = [identity.data?.institution_type, identity.data?.city].filter(Boolean).join(" · ");

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={NAV}
      title="Portal EPS"
      subtitle="Panel clínico y de gestión"
      badge={{ label: "EPS", tone: "cyber" }}
    >
      <div className="space-y-5 max-w-5xl mx-auto">
        {/* Encabezado: quién es la institución y qué respalda este portal */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-biosensor/10 via-background to-fuchsia-neural/10 border border-border p-5">
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-fuchsia-neural/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-biosensor/10 border border-biosensor/20 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-6 w-6 text-biosensor" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold font-display leading-tight">{name}</h1>
                <p className="text-xs text-muted-foreground">
                  {detail || "Portal EPS / IPS"} · datos de tus servicios y de tus pacientes
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/20 font-medium">
                <Heart className="h-3 w-3" aria-hidden="true" /> Se actualiza en vivo
              </span>
              <Link
                to="/habeas-data"
                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-muted/50 text-foreground border border-border font-medium hover:bg-muted"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Datos personales · Ley 1581
                de 2012
              </Link>
            </div>
          </div>
        </div>

        {/* Pestañas */}
        <div
          role="tablist"
          aria-label="Secciones del portal"
          className="flex gap-1 p-1 bg-muted/50 rounded-xl overflow-x-auto"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
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

        {tab === "overview" && <EPSDashboard institutionId={user.id} title={`Resumen · ${name}`} />}

        {tab === "patients" && (
          <div className="rounded-2xl border border-border bg-card/95 p-4">
            <EnhancedPatientsModule userId={user.id} />
          </div>
        )}

        {tab === "monitoring" && <InstitutionClinicalMonitoring institutionId={user.id} />}

        {tab === "compliance" && <EpsCompliance userId={user.id} />}

        {tab === "reports" && (
          <InstSmartCenter
            userId={user.id}
            institutionName={name}
            city={identity.data?.city ?? null}
            section={section}
            onSectionChange={setSection}
            onOpenCoverage={() => void navigate({ to: "/dashboard/institucion" })}
          />
        )}
      </div>
    </AppShell>
  );
}
