// Las 4 secciones del formulario inteligente de validación de mercado.
// Cada sección recibe el `form` de react-hook-form (la validación vive en `marketValidationSchema`) y los textos
// que se adaptan al perfil de la persona.
import { useEffect, type ReactNode } from "react";
import { Controller, type FieldPath, type UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  ALTERNATIVE_SUGGESTIONS,
  BENEFIT,
  CHANNELS,
  CITIES,
  LIMITS,
  PAY_LABEL,
  PAY_VALUES,
  PROFILES,
  PROFILE_META,
  clarityHint,
  crossFieldIssues,
  questionsFor,
  wtpSentence,
  type ClarityLevel,
  type MarketValidationInput,
  type Profile,
} from "@/lib/marketValidation";

export type Form = UseFormReturn<MarketValidationInput>;

// ── Piezas comunes ─────────────────────────────────────────────────────────────

const fieldClass =
  "w-full rounded-2xl border-2 border-border bg-background px-4 text-base font-medium outline-none transition focus:border-trust aria-[invalid=true]:border-destructive";
const inputClass = `${fieldClass} min-h-14`;
const textareaClass = `${fieldClass} min-h-28 resize-y py-3`;

const COACH_TONE: Record<ClarityLevel, string> = {
  idle: "",
  short: "text-warn",
  ok: "text-muted-foreground",
  great: "text-ok",
};

function Field({
  id,
  label,
  hint,
  example,
  error,
  required,
  coach,
  counter,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  example?: string;
  error?: string;
  required?: boolean;
  coach?: { level: ClarityLevel; message: string };
  counter?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-base font-bold leading-snug">
        {label}
        {required && (
          <span className="ml-1 text-warn" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {(hint || example) && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
          {example && (
            <>
              {" "}
              <span className="italic">Ej.: {example}</span>
            </>
          )}
        </p>
      )}
      {children}
      <div className="flex items-start justify-between gap-3">
        <div className="min-h-5 text-sm" aria-live="polite">
          {error ? (
            <p id={`${id}-error`} role="alert" className="font-semibold text-destructive">
              {error}
            </p>
          ) : coach && coach.message ? (
            <p className={COACH_TONE[coach.level]}>{coach.message}</p>
          ) : null}
        </div>
        {counter && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{counter}</span>
        )}
      </div>
    </div>
  );
}

function ChipButton({
  pressed,
  onClick,
  children,
  disabled,
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-full border-2 px-4 text-sm font-semibold transition active:scale-95 disabled:opacity-50 ${
        pressed
          ? "border-trust bg-trust/10 text-trust"
          : "border-border bg-background hover:border-trust/40"
      }`}
    >
      {children}
    </button>
  );
}

const err = (form: Form, name: FieldPath<MarketValidationInput>): string | undefined => {
  const e = form.formState.errors as Record<string, { message?: string } | undefined>;
  return e[name.split(".")[0]]?.message;
};

const ariaFor = (form: Form, name: FieldPath<MarketValidationInput>, hint = true) => ({
  "aria-invalid": err(form, name) ? true : undefined,
  "aria-describedby":
    [hint ? `${name}-hint` : "", err(form, name) ? `${name}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined,
});

// ── 1. Registro de usuario ───────────────────────────────────────────────────

export function StepRegistro({ form }: { form: Form }) {
  const { register, control } = form;
  return (
    <div className="space-y-6">
      <Field id="fullName" label="Nombre completo" required error={err(form, "fullName")}>
        <input
          id="fullName"
          autoComplete="name"
          className={inputClass}
          placeholder="Nombre y apellido"
          {...ariaFor(form, "fullName", false)}
          {...register("fullName")}
        />
      </Field>

      <div className="space-y-2">
        <p id="profile-label" className="text-base font-bold">
          Perfil de usuario{" "}
          <span className="text-warn" aria-hidden="true">
            *
          </span>
        </p>
        <Controller
          control={control}
          name="profile"
          render={({ field }) => (
            <RadioGroup
              aria-labelledby="profile-label"
              value={field.value ?? ""}
              onValueChange={field.onChange}
              className="grid gap-3 sm:grid-cols-3"
            >
              {PROFILES.map((p) => (
                <label
                  key={p}
                  htmlFor={`profile-${p}`}
                  className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center font-bold transition active:scale-95 ${
                    field.value === p
                      ? "border-trust bg-trust/10 text-trust"
                      : "border-border bg-background hover:border-trust/40"
                  }`}
                >
                  <span className="text-3xl" aria-hidden="true">
                    {PROFILE_META[p].emoji}
                  </span>
                  <span className="text-sm leading-tight">{PROFILE_META[p].label}</span>
                  <RadioGroupItem id={`profile-${p}`} value={p} className="sr-only" />
                </label>
              ))}
            </RadioGroup>
          )}
        />
        {err(form, "profile") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "profile")}
          </p>
        )}
      </div>

      <Field
        id="contact"
        label="Número de WhatsApp / Correo electrónico"
        required
        hint="Te enviaremos un código de 6 dígitos para confirmar que eres tú y entregarte tu beneficio."
        error={err(form, "contact")}
      >
        <input
          id="contact"
          autoComplete="email"
          inputMode="email"
          className={inputClass}
          placeholder="3001234567 o correo@ejemplo.com"
          {...ariaFor(form, "contact")}
          {...register("contact")}
        />
      </Field>

      <Field
        id="city"
        label="Ciudad (opcional)"
        hint="Nos ayuda a ver dónde hay más necesidad."
        error={err(form, "city")}
      >
        <select id="city" className={inputClass} {...register("city")}>
          <option value="">Prefiero no decirlo</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

// ── 2. Claridad de la propuesta de valor ───────────────────────────────────────

const CLARIFY: Array<{
  name: "serviceOffer" | "painPoint" | "targetAudience" | "dailyChange";
  number: string;
  min: number;
  good: number;
  max: number;
  rows: number;
}> = [
  { name: "serviceOffer", number: "2.1", min: 4, good: 8, max: LIMITS.serviceOffer, rows: 2 },
  { name: "painPoint", number: "2.2", min: 5, good: 14, max: LIMITS.painPoint, rows: 4 },
  { name: "targetAudience", number: "2.3", min: 3, good: 8, max: LIMITS.targetAudience, rows: 3 },
  { name: "dailyChange", number: "2.4", min: 5, good: 12, max: LIMITS.dailyChange, rows: 4 },
];

export function StepClarify({ form, profile }: { form: Form; profile?: Profile }) {
  const copy = questionsFor(profile ?? "familia");
  const values = form.watch();
  return (
    <div className="space-y-7">
      {CLARIFY.map(({ name, number, min, good, max, rows }) => {
        const q = copy[name];
        const value = values[name] ?? "";
        return (
          <Field
            key={name}
            id={name}
            label={`${number}. ${q.label}`}
            hint={q.hint}
            example={q.example}
            required
            error={err(form, name)}
            coach={clarityHint(value, { min, good })}
            counter={`${value.length}/${max}`}
          >
            <textarea
              id={name}
              rows={rows}
              maxLength={max + 50}
              className={textareaClass}
              {...ariaFor(form, name)}
              {...form.register(name)}
            />
          </Field>
        );
      })}
    </div>
  );
}

// ── 3. Panorama del mercado y competencia ─────────────────────────────────────

export function StepMercado({ form, profile }: { form: Form; profile?: Profile }) {
  const { control, register, setValue, getValues, watch } = form;
  const alternatives = watch("alternatives") ?? [];
  const channels = watch("searchChannels") ?? [];
  const pays = watch("paysCurrently");
  const channelsOther = watch("searchChannelsOther");
  const suggestions = ALTERNATIVE_SUGGESTIONS[profile ?? "familia"];

  // Las reglas cruzadas se marcan a mano al pulsar «Continuar»: aquí se retiran en cuanto la persona las corrige.
  // react-hook-form modifica los arreglos en su lugar, así que las dependencias son claves de texto.
  const altKey = alternatives.join("\u0000");
  const channelKey = channels.join("\u0000");
  useEffect(() => {
    const open = (["alternatives", "searchChannels"] as const).filter(
      (path) => form.formState.errors[path]?.type === "custom",
    );
    if (!open.length) return;
    const stillWrong = new Set(crossFieldIssues(form.getValues()).map((i) => i.path));
    open.filter((path) => !stillWrong.has(path)).forEach((path) => form.clearErrors(path));
  }, [form, pays, altKey, channelKey, channelsOther]);

  const addSuggestion = (text: string) => {
    const current = getValues("alternatives");
    if (current.some((a) => a.trim().toLowerCase() === text.toLowerCase())) return;
    const slot = current.findIndex((a) => !a.trim());
    if (slot === -1) return;
    setValue(`alternatives.${slot}`, text, { shouldDirty: true, shouldValidate: true });
  };

  const toggleChannel = (value: (typeof CHANNELS)[number]["value"]) => {
    const current = getValues("searchChannels");
    const next = current.includes(value) ? current.filter((c) => c !== value) : [...current, value];
    setValue("searchChannels", next, {
      shouldDirty: true,
      shouldValidate: true,
      shouldTouch: true,
    });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p id="pays-label" className="text-base font-bold">
          3.1. ¿Actualmente pagas o inviertes en una solución similar?{" "}
          <span className="text-warn" aria-hidden="true">
            *
          </span>
        </p>
        <Controller
          control={control}
          name="paysCurrently"
          render={({ field }) => (
            <RadioGroup
              aria-labelledby="pays-label"
              value={field.value ?? ""}
              onValueChange={field.onChange}
              className="grid gap-3 sm:grid-cols-3"
            >
              {PAY_VALUES.map((v) => (
                <label
                  key={v}
                  htmlFor={`pays-${v}`}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 font-bold transition active:scale-95 ${
                    field.value === v
                      ? "border-trust bg-trust/10 text-trust"
                      : "border-border bg-background hover:border-trust/40"
                  }`}
                >
                  <RadioGroupItem id={`pays-${v}`} value={v} />
                  <span className="text-sm leading-tight">{PAY_LABEL[v]}</span>
                </label>
              ))}
            </RadioGroup>
          )}
        />
        {err(form, "paysCurrently") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "paysCurrently")}
          </p>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-base font-bold">3.2. Mención de hasta 3 alternativas</legend>
        <p className="text-sm text-muted-foreground">
          Agencias, grupos, apps o personas que usas hoy. Escribe o toca una sugerencia.
        </p>
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              aria-label={`Alternativa ${i + 1}`}
              maxLength={LIMITS.alternative}
              className={inputClass}
              placeholder={
                i === 0 ? "Ej.: grupo de WhatsApp del barrio" : `Alternativa ${i + 1} (opcional)`
              }
              {...register(`alternatives.${i}` as const)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Sugerencias de alternativas">
          {suggestions.map((s) => (
            <ChipButton
              key={s}
              onClick={() => addSuggestion(s)}
              disabled={
                alternatives.every((a) => a.trim()) &&
                !alternatives.some((a) => a.trim().toLowerCase() === s.toLowerCase())
              }
            >
              + {s}
            </ChipButton>
          ))}
        </div>
        {err(form, "alternatives") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "alternatives")}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-bold">
          3.3. ¿Dónde buscas información o inviertes tiempo/dinero habitualmente?{" "}
          <span className="text-warn" aria-hidden="true">
            *
          </span>
        </legend>
        <p className="text-sm text-muted-foreground">Marca todos los que uses.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lugares donde buscas">
          {CHANNELS.map((c) => (
            <ChipButton
              key={c.value}
              pressed={channels.includes(c.value)}
              onClick={() => toggleChannel(c.value)}
            >
              {c.label}
            </ChipButton>
          ))}
        </div>
        <input
          aria-label="Otro lugar donde buscas (opcional)"
          maxLength={LIMITS.channelsOther}
          className={inputClass}
          placeholder="Otro: cuéntanos cuál"
          {...register("searchChannelsOther")}
        />
        {err(form, "searchChannels") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "searchChannels")}
          </p>
        )}
      </fieldset>
    </div>
  );
}

// ── 4. Prueba de demanda y comentarios de valor ───────────────────────────────

const QUICK_PCT = [0, 10, 25, 50, 75, 100];

export function StepDemanda({ form, profile }: { form: Form; profile?: Profile }) {
  const { control, register } = form;
  const copy = questionsFor(profile ?? "familia").comments;
  const comments = form.watch("comments") ?? "";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p id="wtp-label" className="text-base font-bold">
          4.1. Disposición a pagar{" "}
          <span className="text-warn" aria-hidden="true">
            *
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          Si recomendaste o consultaste esta idea con otras personas, ¿qué porcentaje estaría
          dispuesto a pagar por ella?
        </p>
        <Controller
          control={control}
          name="willingnessPct"
          render={({ field }) => (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label htmlFor="willingnessPct" className="text-sm font-semibold">
                  Estimado de disposición a pagar:
                </label>
                <div className="relative w-32">
                  <input
                    id="willingnessPct"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    className={`${inputClass} pr-10 text-right`}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      field.onChange(v === "" ? undefined : Math.round(Number(v)));
                    }}
                    onBlur={field.onBlur}
                    aria-describedby="wtp-sentence"
                    aria-invalid={err(form, "willingnessPct") ? true : undefined}
                  />
                  <span
                    className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground"
                    aria-hidden="true"
                  >
                    %
                  </span>
                </div>
              </div>
              <Slider
                aria-label="Disposición a pagar en porcentaje"
                min={0}
                max={100}
                step={5}
                value={[field.value ?? 0]}
                onValueChange={([v]) => field.onChange(v)}
                className="py-2"
              />
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Porcentajes frecuentes"
              >
                {QUICK_PCT.map((n) => (
                  <ChipButton key={n} pressed={field.value === n} onClick={() => field.onChange(n)}>
                    {n}%
                  </ChipButton>
                ))}
              </div>
              <p id="wtp-sentence" className="text-sm font-semibold text-trust" aria-live="polite">
                {wtpSentence(field.value)}
              </p>
            </div>
          )}
        />
        {err(form, "willingnessPct") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "willingnessPct")}
          </p>
        )}
      </div>

      <Field
        id="comments"
        label={`4.2. ${copy.label}`}
        hint={copy.hint}
        example={copy.example}
        error={err(form, "comments")}
        coach={clarityHint(comments, { min: 3, good: 10 })}
        counter={`${comments.length}/${LIMITS.comments}`}
      >
        <textarea
          id="comments"
          rows={4}
          maxLength={LIMITS.comments + 50}
          className={textareaClass}
          {...ariaFor(form, "comments")}
          {...register("comments")}
        />
      </Field>

      <div className="space-y-2 rounded-2xl bg-muted/50 p-4">
        <Controller
          control={control}
          name="consent"
          render={({ field }) => (
            <div className="flex items-start gap-3">
              <Checkbox
                id="consent"
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
                aria-invalid={err(form, "consent") ? true : undefined}
                className="mt-1 h-6 w-6"
              />
              <label htmlFor="consent" className="text-sm leading-snug">
                Autorizo a Humanix a tratar mis datos para este estudio de mercado y para
                contactarme, según la{" "}
                <a
                  href="/habeas-data"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-trust underline underline-offset-4"
                >
                  Política de tratamiento de datos
                </a>{" "}
                (Ley 1581 de 2012).{" "}
                <span className="text-warn" aria-hidden="true">
                  *
                </span>
              </label>
            </div>
          )}
        />
        {err(form, "consent") && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {err(form, "consent")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Tu beneficio: {BENEFIT.label} (el plan básico de pago). Sin tarjeta y sin compromiso de
          renovación.
        </p>
      </div>

      {/* Campo trampa: las personas no lo ven; los robots sí lo llenan. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
        <label htmlFor="website">No llenar este campo</label>
        <input id="website" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>
    </div>
  );
}
