// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Building2 } from "lucide-react";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { SmartInstitutionProfileForm } from "@/components/humanix/SmartInstitutionProfileForm";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/institution/profile")({
  head: () => ({ meta: [{ title: "Perfil de Institución · Humanix" }] }),
  component: InstitutionProfile,
});

const getNav = (): NavItem[] => [
  { label: "Inicio", to: "/dashboard/institucion", icon: Building2 },
  { label: "Perfil", to: "/institution/profile", icon: Building2 },
];

function InstitutionProfile() {
  const { user, loading, logout } = useAppUser({ allow: ["institution", "superadmin"] });

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  return (
    <AppShell
      user={user}
      onLogout={logout}
      nav={getNav()}
      title="Perfil de Institución"
      subtitle="Completa y valida tu información organizacional con cumplimiento FUID automático."
      crumbs={[
        { label: "Inicio", to: "/" },
        { label: "Institución" },
        { label: "Perfil" },
      ]}
      badge={{ label: "Perfil", tone: "bio" }}
    >
      <div className="max-w-4xl mx-auto space-y-8">
        <SmartInstitutionProfileForm userId={user.id} defaultCity={user.city || ""} />
      </div>
    </AppShell>
  );
}