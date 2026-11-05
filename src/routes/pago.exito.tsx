// Regreso desde el checkout de Wompi (`/pago/exito?id=<transacción>`). El navegador no decide nada: el servidor consulta la
// transacción directo en Wompi y, si es de un cobro de esta persona, la aplica igual que el aviso firmado (idempotente).
// Si la sesión no está o Wompi aún no responde, igual llega el aviso y el panel se actualiza en vivo.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { CheckCircle2, Clock, LayoutDashboard, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";
import { syncPaymentReturn } from "@/lib/payments.functions";

const search = z.object({ id: z.string().max(80).optional() });

export const Route = createFileRoute("/pago/exito")({
  validateSearch: (s) => search.parse(s),
  head: () =>
    buildSeo({
      noindex: true,
      title: "Tu pago · Humanix",
      path: "/pago/exito",
      description: "Confirmación de tu pago con Wompi.",
    }),
  component: PagoExito,
});

type View = "checking" | "paid" | "pending" | "failed";

function PagoExito() {
  const { id } = Route.useSearch();
  const [view, setView] = useState<View>(id ? "checking" : "pending");

  useEffect(() => {
    if (!id || !/^[A-Za-z0-9_-]{3,80}$/.test(id)) return;
    let alive = true;
    syncPaymentReturn({ data: { transactionId: id } })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) setView("pending");
        else if (r.status === "paid") setView("paid");
        else if (r.status === "failed" || r.status === "underpaid") setView("failed");
        else setView("pending");
      })
      .catch(() => alive && setView("pending"));
    return () => {
      alive = false;
    };
  }, [id]);

  const icon =
    view === "paid" ? (
      <CheckCircle2 className="h-14 w-14 text-biosensor" aria-hidden="true" />
    ) : view === "failed" ? (
      <XCircle className="h-14 w-14 text-destructive" aria-hidden="true" />
    ) : (
      <Clock className="h-14 w-14 text-biosensor" aria-hidden="true" />
    );
  const title =
    view === "paid"
      ? "¡Gracias, pago recibido! 💚"
      : view === "failed"
        ? "El pago no se completó"
        : "¡Gracias! 💚";
  const body =
    view === "paid"
      ? "Ya lo ves en tu panel y te llegó una notificación."
      : view === "failed"
        ? "Wompi no aprobó este intento y no se te cobró. Vuelve a tu panel e inténtalo de nuevo con otro medio de pago."
        : view === "checking"
          ? "Estamos confirmando tu pago con Wompi…"
          : "Wompi nos está confirmando el pago. En segundos lo verás en tu panel y te llegará una notificación.";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-biosensor/5 to-background px-4">
      <div
        className="w-full max-w-md space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500"
        aria-live="polite"
      >
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-biosensor/15">
          {icon}
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          <p className="text-lg text-muted-foreground">{body}</p>
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
