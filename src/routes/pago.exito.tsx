import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLAN_CATALOG, longDateEs, type PlanKey } from "@/lib/plans";
import {
  paymentIdFromSearch,
  preapprovalIdFromSearch,
  safeReturnPath,
  searchParamsOf,
  type ConfirmResult,
} from "@/lib/paymentReturn";
import {
  confirmMercadoPagoPayment,
  confirmMercadoPagoSubscription,
} from "@/lib/payments.functions";

// Regreso desde Mercado Pago. La página NO da un pago por hecho por lo que diga la URL: el servidor consulta el pago en
// Mercado Pago, lo aplica si hace falta (misma lógica que el webhook) y aquí se muestra el resultado real.
export const Route = createFileRoute("/pago/exito")({
  validateSearch: (s: Record<string, unknown>) => s,
  head: () => ({ meta: [{ title: "Pago · Humanix" }, { name: "robots", content: "noindex" }] }),
  component: PagoExito,
});

const WA_SUPPORT =
  "https://wa.me/573147444715?text=Hola%2C+mi+pago+en+Humanix+necesita+una+revisi%C3%B3n";

type View =
  | { kind: "checking" }
  | { kind: "active"; plan: string; periodEnd: string | null }
  | { kind: "credited"; credits: number | null }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "review" }
  | { kind: "unconfirmed" };

function viewOf(result: ConfirmResult | undefined, loading: boolean, failed: boolean): View {
  if (loading) return { kind: "checking" };
  if (failed || !result) return { kind: "unconfirmed" };
  if (!result.ok) return result.code === "review" ? { kind: "review" } : { kind: "unconfirmed" };
  switch (result.state) {
    case "active":
      return { kind: "active", plan: result.plan, periodEnd: result.periodEnd };
    case "credited":
      return { kind: "credited", credits: result.credits };
    case "pending":
      return { kind: "pending" };
    case "failed":
      return { kind: "failed" };
  }
}

function planLabel(plan: string): string {
  return plan in PLAN_CATALOG ? PLAN_CATALOG[plan as PlanKey].label : plan;
}

function PagoExito() {
  const rawSearch = Route.useSearch();
  const search = useMemo(() => searchParamsOf(rawSearch), [rawSearch]);
  const tipo = search.get("tipo") === "creditos" ? "creditos" : "plan";
  const from = safeReturnPath(search.get("from"));
  const paymentId = paymentIdFromSearch(search);
  // Al volver de una suscripción Mercado Pago agrega `preapproval_id` (y no siempre un `payment_id`).
  const preapprovalId = paymentId ? null : preapprovalIdFromSearch(search);
  const confirm = useServerFn(confirmMercadoPagoPayment);
  const confirmSub = useServerFn(confirmMercadoPagoSubscription);

  const q = useQuery({
    queryKey: ["mp-confirm", paymentId, preapprovalId],
    queryFn: () =>
      paymentId
        ? confirm({ data: { paymentId } })
        : confirmSub({ data: { preapprovalId: preapprovalId! } }),
    enabled: !!paymentId || !!preapprovalId,
    retry: 1,
    staleTime: Infinity,
  });
  const view =
    paymentId || preapprovalId
      ? viewOf(q.data, q.isLoading, q.isError)
      : { kind: "unconfirmed" as const };
  const confirmed = view.kind === "active" || view.kind === "credited";

  const [countdown, setCountdown] = useState(8);
  useEffect(() => {
    if (!confirmed) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(t);
          window.location.assign(from);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [confirmed, from]);

  const retryTo = tipo === "creditos" ? "/creditos" : "/planes";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div
        className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
        aria-live="polite"
      >
        <div className="rounded-2xl bg-muted p-3 inline-flex">
          {view.kind === "checking" && <Loader2 className="h-14 w-14 text-primary animate-spin" />}
          {confirmed && <CheckCircle2 className="h-14 w-14 text-biosensor" />}
          {(view.kind === "pending" || view.kind === "unconfirmed") && (
            <Clock className="h-14 w-14 text-warn" />
          )}
          {(view.kind === "failed" || view.kind === "review") && (
            <AlertCircle className="h-14 w-14 text-destructive" />
          )}
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-2">
            {view.kind === "checking" && "Confirmando tu pago…"}
            {confirmed && "¡Pago confirmado!"}
            {view.kind === "pending" && "Pago en proceso"}
            {view.kind === "unconfirmed" && "Estamos confirmando tu pago"}
            {view.kind === "failed" && "El pago no se completó"}
            {view.kind === "review" && "Tu pago necesita una revisión"}
          </h1>
          <p className="text-muted-foreground">
            {view.kind === "checking" && "Lo estamos verificando directamente con Mercado Pago."}
            {view.kind === "active" && (
              <>
                Tu plan <strong className="text-foreground">{planLabel(view.plan)}</strong> está
                activo
                {view.periodEnd ? ` hasta el ${longDateEs(Date.parse(view.periodEnd))}` : ""}.
                {preapprovalId
                  ? " Se renueva solo cada mes y puedes cancelar la renovación desde tu panel."
                  : " Sin cobros automáticos: tú decides cuándo renovar."}
              </>
            )}
            {view.kind === "credited" && (
              <>
                Se acreditaron{" "}
                <strong className="text-biosensor">
                  {view.credits
                    ? `${view.credits.toLocaleString("es-CO")} créditos IA`
                    : "tus créditos IA"}
                </strong>{" "}
                en tu cuenta. Ya puedes usarlos.
              </>
            )}
            {view.kind === "pending" &&
              "Mercado Pago aún lo está procesando (con PSE o efectivo puede tardar). Te avisaremos en la campana apenas se confirme."}
            {view.kind === "unconfirmed" &&
              "Todavía no tenemos la confirmación de Mercado Pago. Te avisaremos en la campana apenas llegue; no necesitas pagar de nuevo."}
            {view.kind === "failed" &&
              "Mercado Pago no aprobó el pago, así que no se activó nada. Puedes intentarlo otra vez."}
            {view.kind === "review" &&
              "El pago llegó, pero no coincide con lo que se compró. Escríbenos y lo resolvemos contigo."}
          </p>
        </div>

        {confirmed && (
          <div className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 inline mr-1 text-biosensor" />
            Redirigiendo en <strong>{countdown}s</strong>…
          </div>
        )}

        <div className="flex gap-3 justify-center flex-wrap">
          {view.kind === "failed" ? (
            <Button asChild variant="hero">
              <Link to={retryTo as "/"}>Intentar de nuevo</Link>
            </Button>
          ) : (
            <Button asChild variant={confirmed ? "hero" : "glass"}>
              <Link to={from as "/"}>
                Ir al panel <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          )}
          {view.kind === "credited" && (
            <Button asChild variant="glass">
              <Link to={"/creditos" as "/"}>Ver mis créditos</Link>
            </Button>
          )}
          {view.kind === "review" && (
            <Button asChild variant="hero">
              <a href={WA_SUPPORT} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4 mr-1.5" /> Escribir a soporte
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
