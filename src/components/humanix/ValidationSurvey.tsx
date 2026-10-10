// Formulario inteligente de validación de mercado: «Registro de usuario y beneficio premium».
// Flujo: 4 secciones → verificación del contacto (código de 6 dígitos) → resultado con el beneficio
// (1 mes del plan Esencial). Cada formulario lleno llega al panel de superadmin, que lo tabula solo.
//
// Lo «inteligente»: los ejemplos y las pistas se adaptan al perfil, el borrador se guarda solo en el
// dispositivo, se pide claridad con sugerencias (sin IA ni envío de datos), las respuestas vacías o copiadas
// no valen como formulario lleno y, si la persona ya inició sesión, el beneficio se activa al verificar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, type DefaultValues, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, Gift, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { submitMarketValidation } from "@/lib/marketValidation.functions";
import {
  BENEFIT,
  DRAFT_KEY,
  MIN_FILL_MS,
  crossFieldIssues,
  emptyForm,
  marketValidationSchema,
  type MarketValidationInput,
  type Profile,
} from "@/lib/marketValidation";
import { StepClarify, StepDemanda, StepMercado, StepRegistro } from "./validation/ValidationSteps";
import { ValidationOtpStep, type VerifiedResult } from "./validation/ValidationOtpStep";
import { ValidationResult } from "./validation/ValidationResult";

type Phase = "form" | "otp" | "result";
type FieldName = FieldPath<MarketValidationInput>;

const STEPS: Array<{ title: string; subtitle: string; fields: FieldName[] }> = [
  {
    title: "Registro de usuario",
    subtitle: "Tres datos para saber quién eres y cómo confirmarte.",
    fields: ["fullName", "profile", "contact", "city"],
  },
  {
    title: "Claridad de la propuesta de valor",
    subtitle: "Sé concreto: una idea clara vale más que diez vagas.",
    fields: ["serviceOffer", "painPoint", "targetAudience", "dailyChange"],
  },
  {
    title: "Panorama del mercado y competencia",
    subtitle: "Cómo resuelves hoy este problema.",
    fields: ["paysCurrently", "alternatives", "searchChannels", "searchChannelsOther"],
  },
  {
    title: "Prueba de demanda y comentarios de valor",
    subtitle: "Lo que más nos ayuda a construir algo que sí necesites.",
    fields: ["willingnessPct", "comments", "consent"],
  },
];

const stepOfField = (name: string): number => {
  const top = name.split(".")[0];
  const i = STEPS.findIndex((s) => (s.fields as string[]).includes(top));
  return i === -1 ? STEPS.length - 1 : i;
};

const SERVER_FIELD_MESSAGE: Record<string, string> = {
  consent: "Debes autorizar el tratamiento de tus datos.",
  contact: "Revisa tu WhatsApp o correo.",
  profile: "Elige tu perfil.",
  paysCurrently: "Elige una opción.",
};

type Draft = {
  v: 1;
  step: number;
  savedAt: number;
  /** Tiempo que la persona ya dedicó al formulario: quien vuelve a un borrador no es un robot que envía de golpe. */
  elapsedMs?: number;
  values: Partial<MarketValidationInput>;
};

const SAVE_EXCLUDED = ["contact", "consent", "website", "fillMs"] as const;

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // Los borradores vencen a los 14 días.
    if (d?.v !== 1 || Date.now() - d.savedAt > 14 * 86_400_000) return null;
    return d;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* modo privado */
  }
}

const ROLE_TO_PROFILE: Array<[string, Profile]> = [
  ["professional", "profesional"],
  ["institution", "ips_eps"],
  ["family", "familia"],
];

export function ValidationSurvey() {
  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [response, setResponse] = useState<{
    id: string;
    kind: "whatsapp" | "email";
    masked: string;
  } | null>(null);
  const [result, setResult] = useState<VerifiedResult | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  // Tiempo llenando el formulario con un reloj monotónico: no depende de la hora del dispositivo.
  const openedAt = useRef<number>(0);
  const carriedMs = useRef<number>(0);
  const elapsedMs = () =>
    Math.max(0, Math.round(carriedMs.current + performance.now() - openedAt.current));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const form = useForm<MarketValidationInput>({
    resolver: zodResolver(marketValidationSchema),
    defaultValues: emptyForm() as unknown as DefaultValues<MarketValidationInput>,
    mode: "onTouched",
  });
  const profile = form.watch("profile") as Profile | undefined;

  // Cuándo se abrió el formulario (el servidor descarta envíos imposiblemente rápidos).
  useEffect(() => {
    openedAt.current = performance.now();
  }, []);

  // Borrador guardado en este dispositivo (nunca incluye contacto ni autorización).
  useEffect(() => {
    const d = readDraft();
    if (d) {
      (Object.keys(d.values) as Array<keyof MarketValidationInput>).forEach((k) => {
        if (!(SAVE_EXCLUDED as readonly string[]).includes(k))
          form.setValue(k, d.values[k] as never);
      });
      setStep(Math.min(Math.max(d.step ?? 0, 0), STEPS.length - 1));
      carriedMs.current = Math.max(typeof d.elapsedMs === "number" ? d.elapsedMs : 0, MIN_FILL_MS);
      setDraftRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = form.watch((values) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const safe: Record<string, unknown> = { ...values };
        SAVE_EXCLUDED.forEach((k) => delete safe[k]);
        try {
          localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({
              v: 1,
              step: stepRef.current,
              savedAt: Date.now(),
              elapsedMs: elapsedMs(),
              values: safe,
            }),
          );
        } catch {
          /* modo privado o sin espacio: el formulario sigue funcionando */
        }
      }, 600);
    });
    return () => {
      clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [form]);

  // Si ya tiene sesión: se prellenan nombre, correo y perfil, y el beneficio se activará al verificar.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || !active) return;
      setLoggedIn(true);
      const [{ data: prof }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (!active) return;
      if (!form.getValues("fullName") && prof?.full_name) form.setValue("fullName", prof.full_name);
      if (!form.getValues("contact") && user.email) form.setValue("contact", user.email);
      if (!form.getValues("profile")) {
        const have = new Set((roles ?? []).map((r) => String(r.role)));
        const match = ROLE_TO_PROFILE.find(([role]) => have.has(role));
        if (match) form.setValue("profile", match[1]);
      }
    })().catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toTop = useCallback(() => {
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      headingRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const focusFirstError = () =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el && "focus" in el) el.focus({ preventScroll: true });
    });

  const next = async () => {
    setServerError(null);
    const ok = await form.trigger(STEPS[step].fields);
    let cross = false;
    if (step === 2) {
      // Zod omite las reglas cruzadas mientras haya campos de otros pasos sin llenar: se aplican aquí.
      const issues = crossFieldIssues(form.getValues());
      issues.forEach((i) => form.setError(i.path, { type: "custom", message: i.message }));
      cross = issues.length > 0;
    }
    if (!ok || cross) {
      focusFirstError();
      return;
    }
    setStep((s) => s + 1);
    toTop();
  };

  const back = () => {
    setServerError(null);
    setStep((s) => Math.max(0, s - 1));
    toTop();
  };

  const onInvalid = (errors: Record<string, unknown>) => {
    const first = Math.min(...Object.keys(errors).map(stepOfField));
    setStep(first);
    toTop();
    focusFirstError();
  };

  const onValid = async (values: MarketValidationInput) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await submitMarketValidation({
        data: {
          ...values,
          fillMs: elapsedMs(),
          source: new URLSearchParams(window.location.search).get("utm_source") ?? undefined,
        },
      });
      if (!res.ok) {
        if (res.error === "validation" || res.error === "low_quality") {
          res.fields.forEach((f) =>
            form.setError(f as FieldName, {
              type: "server",
              message:
                res.error === "low_quality"
                  ? "Cuéntalo con tus palabras: esta respuesta parece incompleta o copiada."
                  : (SERVER_FIELD_MESSAGE[f] ?? "Revisa este campo."),
            }),
          );
          setServerError(
            res.error === "low_quality"
              ? "Para entregarte el beneficio necesitamos respuestas reales. Revisa los campos marcados."
              : "Revisa los campos marcados.",
          );
          onInvalid(Object.fromEntries(res.fields.map((f) => [f, true])));
        } else if (res.error === "rate_limited") {
          setServerError(
            "Ya enviaste varios formularios desde esta conexión. Inténtalo de nuevo en una hora.",
          );
        } else {
          setServerError("No pudimos guardar tus respuestas. Inténtalo de nuevo en un momento.");
        }
        return;
      }
      // El borrador se conserva hasta verificar el contacto: si la solicitud venciera, no se pierde nada.
      setResponse({ id: res.responseId, kind: res.contact.kind, masked: res.contact.masked });
      setPhase("otp");
      toTop();
    } catch {
      setServerError("Error de conexión. Tus respuestas siguen aquí: inténtalo de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const isLast = step === STEPS.length - 1;
  const progress = useMemo(() => Math.round(((step + 1) / STEPS.length) * 100), [step]);

  /** Vuelve a la última sección con las respuestas intactas (por ejemplo, si la solicitud venció). */
  const backToForm = () => {
    setPhase("form");
    setStep(STEPS.length - 1);
    setResponse(null);
    setServerError(null);
    toTop();
  };

  /** Vuelve a las respuestas abiertas (sección 2) con lo escrito, para reescribirlas con otras palabras. */
  const rewrite = () => {
    setResult(null);
    setResponse(null);
    setPhase("form");
    setStep(1);
    setServerError(null);
    toTop();
  };

  const restart = () => {
    clearDraft();
    form.reset(emptyForm() as unknown as DefaultValues<MarketValidationInput>);
    setDraftRestored(false);
    setStep(0);
    setPhase("form");
    setResponse(null);
    setServerError(null);
    toTop();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <header className="mb-8 text-center">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-ok/10 px-4 py-1 text-sm font-bold text-ok ring-1 ring-ok/20">
          <Gift className="h-4 w-4" aria-hidden="true" /> Gana {BENEFIT.label}
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-trust sm:text-5xl">
          Registro de usuario y beneficio premium
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Cuéntanos qué necesitas (unos 4 minutos). Al confirmar tu contacto ganas {BENEFIT.label}:
          el plan básico de pago, sin tarjeta.
        </p>
      </header>

      {phase === "form" && (
        <div className="mb-6">
          <div className="mb-1 flex justify-between text-xs font-semibold text-muted-foreground">
            <span>
              Sección {step + 1} de {STEPS.length}
            </span>
            <span>{progress}%</span>
          </div>
          <Progress
            value={progress}
            aria-label={`Avance del formulario: sección ${step + 1} de ${STEPS.length}`}
            className="h-2"
          />
        </div>
      )}

      <div
        ref={cardRef}
        className="relative scroll-mt-24 rounded-[2rem] border border-border bg-card/80 p-6 shadow-xl shadow-trust/5 backdrop-blur sm:p-8"
      >
        {phase === "form" && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (isLast) void form.handleSubmit(onValid, onInvalid)();
              else void next();
            }}
            className="space-y-6"
          >
            {draftRestored && (
              <div
                className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3 text-sm"
                role="status"
              >
                <span>Recuperamos tu borrador en este dispositivo (sin tu contacto).</span>
                <button
                  type="button"
                  onClick={restart}
                  className="inline-flex items-center gap-1.5 font-semibold text-trust underline underline-offset-4"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Empezar de nuevo
                </button>
              </div>
            )}

            <div>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-2xl font-bold outline-none"
              >
                {STEPS[step].title}
              </h2>
              <p className="mt-1 text-base text-muted-foreground">{STEPS[step].subtitle}</p>
            </div>

            {step === 0 && <StepRegistro form={form} />}
            {step === 1 && <StepClarify form={form} profile={profile} />}
            {step === 2 && <StepMercado form={form} profile={profile} />}
            {step === 3 && <StepDemanda form={form} profile={profile} />}

            {serverError && (
              <p role="alert" className="text-base font-semibold text-destructive">
                {serverError}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={back}
                  className="min-h-14 rounded-2xl px-5 text-base"
                >
                  <ChevronLeft className="mr-1 h-5 w-5" aria-hidden="true" /> Atrás
                </Button>
              )}
              <Button
                type="submit"
                disabled={submitting}
                className={`h-auto min-h-14 flex-1 whitespace-normal rounded-2xl py-3 text-center text-base font-bold leading-tight sm:text-lg ${isLast ? "min-w-56" : ""}`}
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-label="Enviando" />
                ) : isLast ? (
                  <>
                    <Gift className="mr-2 h-5 w-5" aria-hidden="true" /> Enviar y reclamar mi
                    beneficio
                  </>
                ) : (
                  <>
                    Continuar <ChevronRight className="ml-1 h-5 w-5" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          </form>
        )}

        {phase === "otp" && response && (
          <ValidationOtpStep
            responseId={response.id}
            initial={{ kind: response.kind, masked: response.masked }}
            onVerified={(r) => {
              // Si debe reescribir sus respuestas, el borrador se conserva: recargar la página no le hace perder nada.
              if (r.benefit !== "review") clearDraft();
              setResult(r);
              setPhase("result");
              toTop();
            }}
            onRestart={backToForm}
          />
        )}

        {phase === "result" && result && (
          <ValidationResult
            result={result}
            profile={profile}
            loggedIn={loggedIn}
            onRewrite={rewrite}
          />
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Tus respuestas se guardan de forma privada. Solo el equipo de Humanix puede verlas.
      </p>
    </div>
  );
}
