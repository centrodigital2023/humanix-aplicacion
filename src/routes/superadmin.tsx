import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useSuperadmin } from "@/hooks/use-superadmin";

export const Route = createFileRoute("/superadmin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
  }),
  component: SuperadminLayout,
});

function SuperadminLayout() {
  // useSuperadmin nunca redirige a dashboards de familia/profesional/institución.
  // Si no hay sesión o el rol no es superadmin → /admin.
  const { user, loading } = useSuperadmin();

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Verificando acceso…
      </div>
    );
  }

  return <Outlet />;
}
