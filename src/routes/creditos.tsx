import { createFileRoute } from "@tanstack/react-router";
import { useAppUser } from "@/hooks/use-app-user";
import { TokenPackages } from "@/components/humanix/TokenPackages";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/creditos")({
  head: () => ({ meta: [{ title: "Créditos IA · Humanix" }] }),
  component: CreditosPage,
});

function CreditosPage() {
  const { user, loading } = useAppUser();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Créditos IA</h1>
        <p className="text-muted-foreground mt-1">
          Gestiona y recarga tus créditos para funciones de inteligencia artificial.
        </p>
      </div>
      {user ? (
        <TokenPackages userId={user.id} userEmail={user.email} />
      ) : (
        <p className="text-muted-foreground">Inicia sesión para ver tus créditos.</p>
      )}
    </div>
  );
}
