import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAppUser } from "@/hooks/use-app-user";

export const Route = createFileRoute("/superadmin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
  }),
  component: SuperadminLayout,
});

function SuperadminLayout() {
  // Server-side data is already protected by RLS + is_staff(), but we also
  // gate the entire admin UI shell here so unauthenticated/non-staff users
  // never see admin layout chrome before the redirect fires.
  const { user, loading } = useAppUser({ allow: ["superadmin"] });
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Verificando acceso...
      </div>
    );
  }
  return <Outlet />;
}
