// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, FileText } from "lucide-react";
import { AppShell, type NavItem } from "@/components/humanix/AppShell";
import { DynamicFormsBuilder } from "@/components/humanix/DynamicFormsBuilder";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/institution/forms")({
  head: () => ({ meta: [{ title: "Formularios Dinámicos · Humanix" }] }),
  component: InstitutionForms,
});

const getNav = (): NavItem[] => [
  { label: "Inicio", to: "/dashboard/institucion", icon: FileText },
  { label: "Formularios", to: "/institution/forms", icon: FileText },
];

function InstitutionForms() {
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
      title="Formularios Dinámicos"
      subtitle="Crea formularios personalizados con validación IA automática para recopilar información de candidatos."
      crumbs={[
        { label: "Inicio", to: "/" },
        { label: "Institución" },
        { label: "Formularios" },
      ]}
      badge={{ label: "Formularios", tone: "copper" }}
    >
      <div className="max-w-4xl mx-auto space-y-8">
        <DynamicFormsBuilder userId={user.id} organizationId={user.id} />
      </div>
    </AppShell>
  );
}