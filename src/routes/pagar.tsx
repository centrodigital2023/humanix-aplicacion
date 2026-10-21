// Pagar un plan dentro de Humanix, con los formularios de Mercado Pago (ver `InAppCheckout`). El servidor fija el
// precio y decide si el plan se puede pagar (`getPlanPaymentSetup`); la página solo muestra el resultado.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/humanix/Navbar";
import { PseDetailsDialog } from "@/components/humanix/PseDetailsDialog";
import { withPseDetails, type PseDetails } from "@/lib/pseDetails";
import { useAppUser } from "@/hooks/use-app-user";
import { checkoutErrorMessage, payModeOf, type PayMode } from "@/lib/checkout";
import { safeReturnPath, searchParamsOf } from "@/lib/paymentReturn";
import { savePendingPayment } from "@/lib/pendingPayment";
import { goToBank } from "@/lib/bankRedirect";
import {
  getPlanPaymentSetup,
  payPlanInApp,
  startPlanPayment,
  subscribePlanInApp,
} from "@/lib/payments.functions";
import { COP, PLAN_CATALOG, type PlanKey } from "@/lib/plans";
import { buildSeo } from "@/lib/seo";
import { cn } from "@/lib/utils";

const InAppCheckout = lazy(() => import("@/components/humanix/InAppCheckout"));

export const Route = createFileRoute("/pagar")({
  validateSearch: (search: Record<string, unknown>) => search,
  head: () =>
    buildSeo({
      title: "Pagar tu plan · Humanix",
      path: "/pagar",
      noindex: true,
      description:
        "Paga tu plan de Humanix con tarjeta, PSE o Efecty, de forma segura con Mercado Pago.",
    }),
  component: PagarPage,
});

const newAttempt = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
        Math.floor(Math.random() * 16).toString(16),
      );

function PagarPage() {
  const search = searchParamsOf(Route.useSearch());
  const plan = search.get("plan") ?? "";
  const from = search.get("from");
  const [mode, setMode] = useState<PayMode>(payModeOf(search.get("modo")));
  const navigate = useNavigate();
  const { user, loading: userLoading } = useAppUser({ requireAuth: false });
  const setupFn = useServerFn(getPlanPaymentSetup);
  const payFn = useServerFn(payPlanInApp);
  const subscribeFn = useServerFn(subscribePlanInApp);
  const fallbackFn = useServerFn(startPlanPayment);
  const [mounted, setMounted] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(newAttempt);
  const [redirecting, setRedirecting] = useState(false);
  const [bankUrl, setBankUrl] = useState<string | null>(null);
  const [pseForm, setPseForm] = useState<Record<string, unknown> | null>(null);
  const pseCompletion = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(
    null,
  );
  useEffect(() => setMounted(true), []);

  const setup = useQuery({
    queryKey: ["pay-setup", plan, user?.id],
    queryFn: () => setupFn({ data: { plan } }),
    enabled: !!user,
    retry: 1,
    staleTime: 60_000,
  });

  const def = plan in PLAN_CATALOG ? PLAN_CATALOG[plan as PlanKey] : null;
  const back = from ? safeReturnPath(from) : "/planes";
  const exitoQuery = useMemo(
    () =>
      `tipo=plan&plan=${encodeURIComponent(plan)}&from=${encodeURIComponent(from ?? "/dashboard")}`,
    [plan, from],
  );

  // Cambiar de forma de pago dibuja otro formulario.
  useEffect(() => {
    setFormReady(false);
    setFormError(null);
  }, [mode, plan]);

  const payOnce = async (form: Record<string, unknown>) => {
    const r = await payFn({ data: { plan, returnTo: from, attemptId, form } });
    if (!r.ok) {
      setAttemptId(newAttempt());
      toast(checkoutErrorMessage(r, plan as PlanKey));
      throw new Error(r.error);
    }
    if (r.redirectUrl) {
      // PSE: el banco abre su página y vuelve a /pago/exito. Nunca dentro de un marco (PSE lo rechaza).
      savePendingPayment(r.paymentId);
      setBankUrl(r.redirectUrl);
      if (goToBank(r.redirectUrl, window)) setRedirecting(true);
      return;
    }
    if (r.voucherUrl) {
      savePendingPayment(r.paymentId);
      setVoucher(r.voucherUrl);
      return;
    }
    if (r.state === "failed") {
      setAttemptId(newAttempt());
      toast("Mercado Pago no aprobó el pago.", {
        description: "No se te cobró nada. Revisa los datos o prueba con otro medio de pago.",
      });
      throw new Error("rejected");
    }
    void navigate({ href: `/pago/exito?payment_id=${r.paymentId}&${exitoQuery}` });
  };

  const subscribe = async (form: Record<string, unknown>) => {
    const payer = (form.payer ?? {}) as { email?: unknown };
    const r = await subscribeFn({
      data: {
        plan,
        cardToken: String(form.token ?? ""),
        email: typeof payer.email === "string" ? payer.email : null,
      },
    });
    if (!r.ok) {
      toast(
        r.error === "mp_error"
          ? "Mercado Pago no aceptó la tarjeta para el cobro automático. Prueba con otra tarjeta de crédito o paga 1 mes."
          : checkoutErrorMessage(r, plan as PlanKey),
      );
      throw new Error(r.error);
    }
    void navigate({ href: `/pago/exito?preapproval_id=${r.preapprovalId}&${exitoQuery}` });
  };

  const submitOnce = (form: Record<string, unknown>): Promise<void> => {
    if (form.payment_method_id !== "pse") return payOnce(form);
    return new Promise((resolve, reject) => {
      pseCompletion.current = { resolve, reject };
      setPseForm(form);
    });
  };

  const cancelPse = () => {
    pseCompletion.current?.reject(new Error("payment_cancelled"));
    pseCompletion.current = null;
    setPseForm(null);
  };

  const confirmPse = async (details: PseDetails) => {
    if (!pseForm) return;
    try {
      await payOnce(withPseDetails(pseForm, details));
      pseCompletion.current?.resolve();
    } catch (error) {
      pseCompletion.current?.reject(error instanceof Error ? error : new Error("payment_failed"));
    } finally {
      pseCompletion.current = null;
      setPseForm(null);
    }
  };

  const openFallback = async () => {
    setRedirecting(true);
    const r = await fallbackFn({ data: { plan, returnTo: from } }).catch(() => null);
    if (r?.ok) {
      // La página de Mercado Pago tampoco se deja abrir dentro de un marco.
      if (!goToBank(r.url, window)) {
        setRedirecting(false);
        setBankUrl(r.url);
      }
      return;
    }
    setRedirecting(false);
    toast(checkoutErrorMessage(r && !r.ok ? r : null, plan as PlanKey));
  };

  const s = setup.data;
  let body: React.ReactNode;
  if (!def || def.amountCOP <= 0) {
    body = (
      <Notice
        title="Ese plan no está disponible"
        text="Elige uno de la lista de planes."
        action={<Link to="/planes">Ver planes</Link>}
      />
    );
  } else if (userLoading || (user && setup.isLoading)) {
    body = (
      <div
        className="h-64 animate-pulse rounded-2xl bg-muted/60"
        aria-busy="true"
        aria-label="Preparando el pago"
      />
    );
  } else if (!user) {
    const redirect = `/pagar?${search.toString()}`;
    body = (
      <Notice
        title="Inicia sesión para pagar"
        text="Tu plan queda en tu cuenta de Humanix."
        action={<a href={`/auth?redirect=${encodeURIComponent(redirect)}`}>Iniciar sesión</a>}
      />
    );
  } else if (setup.isError || !s) {
    body = (
      <Notice
        title="No pudimos preparar el pago"
        text="Revisa tu conexión e inténtalo de nuevo. No se te cobró nada."
        action={
          <button type="button" onClick={() => void setup.refetch()}>
            <RefreshCw className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            Reintentar
          </button>
        }
      />
    );
  } else if (!s.ok) {
    body = (
      <Notice
        title={
          s.error === "already_subscribed"
            ? "Tu plan ya se renueva solo"
            : "Este pago no está disponible"
        }
        text={checkoutErrorMessage(s, plan as PlanKey)}
        action={<Link to={back as "/"}>Volver</Link>}
      />
    );
  } else if (bankUrl && !redirecting) {
    body = (
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
        <Lock className="mx-auto h-10 w-10 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Continúa el pago en una pestaña nueva</h2>
        <p className="text-sm text-muted-foreground">
          Tu banco (PSE) no se puede abrir dentro de esta ventana. Ábrelo en una pestaña nueva,
          autoriza el pago y vuelve aquí: tu plan se activa apenas el banco lo apruebe.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="hero">
            <a href={bankUrl} target="_blank" rel="noopener noreferrer">
              Continuar el pago <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/pago/exito?${exitoQuery}` as "/"}>Ya pagué</Link>
          </Button>
        </div>
      </div>
    );
  } else if (voucher) {
    body = (
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
        <ReceiptText className="mx-auto h-10 w-10 text-copper" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Tu código de pago está listo</h2>
        <p className="text-sm text-muted-foreground">
          Paga {COP(s.amount)} en un punto Efecty con este código. Tu plan se activa solo cuando
          Mercado Pago confirme el pago, y te avisamos en la campana.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="hero">
            <a href={voucher} target="_blank" rel="noopener noreferrer">
              Ver código de pago <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to={back as "/"}>Volver al panel</Link>
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pago">
          <ModeOption
            active={mode === "once"}
            onClick={() => setMode("once")}
            title={s.renew ? "Sumar 1 mes" : "Pagar una vez"}
            note="PSE, tarjeta o Efecty"
            icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />}
          />
          <ModeOption
            active={mode === "recurring"}
            onClick={() => setMode("recurring")}
            title="Cobro automático"
            note="Mensual · tarjeta de crédito"
            icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {mode === "once"
            ? "Sin renovación automática. Con PSE pagas desde tu banco, sin cuenta de Mercado Pago."
            : "Renovación mensual. Puedes cancelarla desde tu panel y conservar el mes pagado."}
        </p>
        {mode === "once" && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Medios de pago disponibles">
            {["Tarjeta", "PSE", "Bancolombia", "Nequi", "Efecty"].map((m) => (
              <li
                key={m}
                className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                {m}
              </li>
            ))}
          </ul>
        )}

        <div className="relative min-h-[320px] rounded-lg border border-border bg-card p-2 sm:p-4">
          {(!formReady || redirecting) && !formError && (
            <div
              role="status"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/90 text-sm text-muted-foreground"
            >
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              {redirecting
                ? "Te llevamos a tu banco…"
                : "Cargando el formulario seguro de Mercado Pago…"}
            </div>
          )}
          {formError ? (
            <div className="space-y-3 p-6 text-center text-sm">
              <p className="font-semibold">{formError}</p>
              <p className="text-muted-foreground">
                Puedes pagar en la página de Mercado Pago con los mismos medios de pago.
              </p>
            </div>
          ) : (
            mounted && (
              <Suspense fallback={null}>
                <InAppCheckout
                  key={`${plan}:${mode}`}
                  publicKey={s.publicKey}
                  mode={mode}
                  amount={s.amount}
                  email={s.email}
                  onSubmit={mode === "once" ? submitOnce : subscribe}
                  onReady={() => setFormReady(true)}
                  onError={(m) => setFormError(m)}
                />
              </Suspense>
            )
          )}
        </div>

        {mode === "once" && (
          <p className="text-center text-xs text-muted-foreground">
            ¿No carga el formulario?{" "}
            <Button
              variant="link"
              type="button"
              className="h-auto whitespace-normal p-0 text-xs"
              onClick={() => void openFallback()}
              disabled={redirecting}
            >
              Pagar en la página de Mercado Pago
            </Button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <PseDetailsDialog open={!!pseForm} onCancel={cancelPse} onConfirm={confirmPse} />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-24 sm:pt-28">
        <Link
          to={back as "/"}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver
        </Link>
        <h1 className="text-2xl font-bold">{def ? `Pagar plan ${def.label}` : "Pagar tu plan"}</h1>
        {def && def.amountCOP > 0 && (
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              {mode === "once" ? "1 mes de tu plan" : "Renovación mensual"}
            </p>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {mode === "once" ? "Total a pagar" : "Total cada mes"} · COP
              </p>
              <p className="text-3xl font-bold tabular-nums">
                {COP(s?.ok ? s.amount : def.amountCOP)}
              </p>
            </div>
          </div>
        )}
        <div className="mt-6">{body}</div>
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Pago seguro con Mercado Pago. Los datos de tu tarjeta nunca pasan por Humanix.
        </p>
      </main>
    </div>
  );
}

function ModeOption(props: {
  active: boolean;
  onClick: () => void;
  title: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <Button
      variant="outline"
      type="button"
      role="radio"
      aria-checked={props.active}
      onClick={props.onClick}
      className={cn(
        "h-auto min-h-24 min-w-0 flex-col items-start whitespace-normal rounded-lg border p-3 text-left transition",
        props.active
          ? "border-primary bg-primary/5 hover:bg-primary/5"
          : "border-border hover:border-foreground/30",
      )}
    >
      <span className="flex w-full items-center justify-between text-primary">
        {props.icon}
        {props.active && <Check className="h-4 w-4" aria-hidden="true" />}
      </span>
      <span className="text-sm font-semibold">{props.title}</span>
      <span className="text-xs font-normal text-muted-foreground">{props.note}</span>
    </Button>
  );
}

function Notice(props: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="text-sm text-muted-foreground">{props.text}</p>
      <Button asChild variant="hero">
        {props.action}
      </Button>
    </div>
  );
}
