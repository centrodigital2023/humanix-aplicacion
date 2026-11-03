// Regreso desde el banco cuando el pago por Bre-B no se completó. No se cobró nada: se puede volver a intentar.
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";
import { CONTACT } from "@/lib/social";
import { whatsappLink } from "@/lib/audience";

export const Route = createFileRoute("/pago/fallo")({
  head: () =>
    buildSeo({
      noindex: true,
      title: "Pago no completado · Humanix",
      path: "/pago/fallo",
      description: "Tu pago no se completó. No se hizo ningún cobro.",
    }),
  component: PagoFallo,
});

function PagoFallo() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-copper/5 to-background px-4">
      <div className="w-full max-w-md space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <p aria-hidden="true" className="text-6xl">
          🤝
        </p>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">El pago no se completó</h1>
          <p className="text-lg text-muted-foreground">
            Tranquilo: no se hizo ningún cobro. Puedes intentarlo de nuevo desde tu turno, o pagar
            en efectivo si lo acuerdas con el profesional.
          </p>
        </div>
        <div className="grid gap-2">
          <Button asChild size="lg" className="h-14 rounded-2xl text-base font-bold">
            <Link to="/dashboard">
              <RotateCcw className="mr-2 h-5 w-5" aria-hidden="true" /> Intentar de nuevo
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 rounded-2xl">
            <a
              href={whatsappLink(
                CONTACT.whatsappNumber,
                "Hola Humanix, tuve un problema con un pago por Bre-B.",
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle className="mr-2 h-5 w-5" aria-hidden="true" /> Escribir a soporte
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}
