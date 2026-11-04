// Los pagos en línea están deshabilitados: se retiró Mercado Pago. Los enlaces a /pagar muestran este aviso.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/humanix/Navbar";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/pagar")({
  validateSearch: (search: Record<string, unknown>) => search,
  head: () =>
    buildSeo({
      title: "Pagos en Humanix",
      path: "/pagar",
      noindex: true,
      description: "Los pagos en línea de Humanix no están disponibles por ahora.",
    }),
  component: PagarPage,
});

function PagarPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
        <CreditCard className="mx-auto h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">Pagos no disponibles por ahora</h1>
        <p className="text-muted-foreground">
          Estamos cambiando la forma de pagar los planes. Muy pronto podrás pagar aquí, de forma segura.
        </p>
        <Button asChild variant="outline">
          <Link to="/planes">
            <ArrowLeft className="mr-2 h-4 w-4" /> Ver planes
          </Link>
        </Button>
      </main>
    </div>
  );
}
