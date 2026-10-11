import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Sparkles, ArrowRight, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pago/exito")({
  head: () => ({ meta: [{ title: "Pago exitoso · Humanix" }] }),
  component: PagoExito,
});

function PagoExito() {
  const search = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const tipo = search.get("tipo") ?? "plan";
  const plan = search.get("plan") ?? "";
  const creditos = search.get("creditos") ?? "";
  const estado = search.get("estado") ?? "approved";
  const from = search.get("from") ?? "/dashboard";
  const isPending = estado === "pending";

  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    if (isPending) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          window.location.href = decodeURIComponent(from);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [from, isPending]);

  const PLAN_LABELS: Record<string, string> = {
    essential_monthly: "Humanix Esencial",
    pro_monthly: "Humanix Pro",
    institution_monthly: "Humanix IPS Mejorado",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-emerald-500/5 to-biosensor/5 px-4">
      <div className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {isPending ? (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-3 inline-flex">
            <Clock className="h-14 w-14 text-amber-500" />
          </div>
        ) : (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-3 inline-flex">
            <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold mb-2">
            {isPending ? "Pago en proceso" : "¡Pago exitoso!"}
          </h1>
          {tipo === "creditos" && !isPending && creditos && (
            <p className="text-muted-foreground">
              Se acreditaron{" "}
              <strong className="text-biosensor">
                {parseInt(creditos).toLocaleString("es-CO")} créditos IA
              </strong>{" "}
              en tu cuenta. Ya puedes usarlos.
            </p>
          )}
          {tipo === "plan" && !isPending && plan && (
            <p className="text-muted-foreground">
              Tu suscripción <strong>{PLAN_LABELS[plan] ?? plan}</strong> está activa. ¡Disfruta
              todas las funciones premium!
            </p>
          )}
          {isPending && (
            <p className="text-muted-foreground">
              Tu pago está siendo procesado por Mercado Pago. Te notificaremos cuando se confirme.
              Esto puede tardar unos minutos.
            </p>
          )}
        </div>

        {!isPending && (
          <>
            <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 inline mr-1 text-biosensor" />
              Redirigiendo en <strong>{countdown}s</strong>…
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button asChild variant="hero">
                <Link to={decodeURIComponent(from) as "/"}>
                  Ir al panel <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
              {tipo === "creditos" && (
                <Button asChild variant="glass">
                  <Link to={"/creditos" as "/"}>Ver mis créditos</Link>
                </Button>
              )}
            </div>
          </>
        )}

        {isPending && (
          <div className="flex gap-3 justify-center">
            <Button asChild variant="glass">
              <Link to="/dashboard">Ir al panel</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
