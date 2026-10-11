import { createFileRoute, Link } from "@tanstack/react-router";
import { XCircle, RotateCcw, MessageCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pago/fallo")({
  head: () => ({ meta: [{ title: "Pago no procesado · Humanix" }] }),
  component: PagoFallo,
});

const WA_SUPPORT =
  "https://wa.me/573147444715?text=Hola%2C+tuve+un+problema+con+mi+pago+en+Humanix";

function PagoFallo() {
  const search = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tipo = search.get("tipo") ?? "plan";
  const plan = search.get("plan") ?? "";

  const retryTo = tipo === "creditos" ? "/creditos" : "/planes";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-rose-500/5 to-background px-4">
      <div className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-3 inline-flex">
          <XCircle className="h-14 w-14 text-rose-500" />
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-2">Pago no procesado</h1>
          <p className="text-muted-foreground">
            Mercado Pago no pudo procesar tu pago
            {plan
              ? ` del plan ${plan.replace("_monthly", "").replace("institution", "Institución")}`
              : ""}
            . No se realizó ningún cargo.
          </p>
        </div>

        <div className="rounded-xl bg-muted/30 border border-border p-4 text-sm text-left space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground">Posibles razones:</p>
          <ul className="space-y-1 list-disc pl-4">
            <li>Fondos insuficientes</li>
            <li>Tarjeta rechazada por el banco</li>
            <li>Datos de la tarjeta incorrectos</li>
            <li>Límite de compras en línea alcanzado</li>
          </ul>
        </div>

        <div className="flex gap-3 justify-center flex-wrap">
          <Button asChild variant="hero">
            <Link to={retryTo as "/"}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> Reintentar pago
            </Link>
          </Button>
          <Button asChild variant="glass">
            <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4 mr-1.5" /> Soporte por WhatsApp
            </a>
          </Button>
        </div>

        <Button asChild variant="ghost" className="text-muted-foreground">
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Volver al panel
          </Link>
        </Button>
      </div>
    </div>
  );
}
