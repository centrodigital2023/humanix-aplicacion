// Regreso desde el banco después de pagar por Bre-B (Firux). El pago se confirma solo con el aviso firmado: esta
// página no aplica nada, solo tranquiliza y lleva de vuelta. Si el aviso aún no llegó, el turno o la billetera se
// actualizan en vivo en cuanto llegue.
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/pago/exito")({
  head: () =>
    buildSeo({
      noindex: true,
      title: "Pago recibido · Humanix",
      path: "/pago/exito",
      description: "Gracias por tu pago con Bre-B.",
    }),
  component: PagoExito,
});

function PagoExito() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-biosensor/5 to-background px-4">
      <div className="w-full max-w-md space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-biosensor/15">
          <CheckCircle2 className="h-14 w-14 text-biosensor" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">¡Gracias! 💚</h1>
          <p className="text-lg text-muted-foreground">
            Tu banco nos está confirmando el pago. En segundos lo verás en tu panel y te llegará una
            notificación.
          </p>
        </div>
        <Button asChild size="lg" className="h-14 w-full rounded-2xl text-base font-bold">
          <Link to="/dashboard">
            <LayoutDashboard className="mr-2 h-5 w-5" aria-hidden="true" /> Volver a mi panel
          </Link>
        </Button>
      </div>
    </main>
  );
}
