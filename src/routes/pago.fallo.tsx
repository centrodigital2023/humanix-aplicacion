import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/pago/fallo")({
  validateSearch: (search: Record<string, unknown>) => search,
  head: () =>
    buildSeo({
      title: "Pagos no disponibles · Humanix",
      path: "/pago/fallo",
      description:
        "Los pagos en línea de Humanix no están disponibles. Consulta tus beneficios vigentes en tu panel.",
    }),
  component: PaymentUnavailable,
});

function PaymentUnavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md space-y-5 text-center">
        <h1 className="text-2xl font-bold">Los pagos en línea no están disponibles</h1>
        <p className="text-muted-foreground">
          Esta página no confirma ni realiza cobros. Si ya pagaste, consulta tu plan o solicita una
          revisión al equipo de Humanix.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/dashboard">Ir al panel</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/contacto">Contactar al equipo</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
