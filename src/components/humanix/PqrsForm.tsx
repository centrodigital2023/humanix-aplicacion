import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2, PhoneCall } from "lucide-react";
import { formatLongDate } from "@/lib/formatDate";
import { submitPqrs } from "@/lib/pqrs.functions";

const TYPES = [
  { value: "peticion", label: "Petición", help: "Solicitar información o una actuación" },
  { value: "consulta", label: "Consulta", help: "Pedir un concepto o una aclaración" },
  { value: "queja", label: "Queja", help: "Inconformidad con una persona o con el servicio" },
  {
    value: "reclamo",
    label: "Reclamo",
    help: "Pedir solución a un cobro o a un servicio defectuoso",
  },
  { value: "sugerencia", label: "Sugerencia", help: "Propuesta de mejora" },
  { value: "denuncia", label: "Denuncia", help: "Reportar una conducta indebida" },
] as const;

const TOPICS = [
  { value: "soporte", label: "Soporte técnico" },
  { value: "facturacion", label: "Facturación" },
  { value: "servicio", label: "Un servicio o un profesional" },
  { value: "cuenta", label: "Mi cuenta o mis datos" },
  { value: "general", label: "Consulta general" },
  { value: "asociacion", label: "Oportunidad de asociación" },
  { value: "otro", label: "Otro" },
] as const;

const schema = z.object({
  type: z.enum(["peticion", "consulta", "queja", "reclamo", "sugerencia", "denuncia"]),
  topic: z.string().min(1, "Selecciona un tema"),
  name: z.string().trim().min(2, "Escribe tu nombre").max(120),
  email: z.string().trim().email("Escribe un correo válido").max(254),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^\+?[\d\s()-]{7,20}$/.test(v), "Teléfono no válido"),
  message: z.string().trim().min(10, "Cuéntanos un poco más (mínimo 10 caracteres)").max(5000),
  consent: z.boolean().refine((v) => v === true, "Debes autorizar el tratamiento de tus datos"),
  website: z.string().max(0),
});
type FormValues = z.infer<typeof schema>;

interface Receipt {
  radicado: string;
  due_at: string | null;
  emergency_notice: boolean;
}

const inputClass =
  "w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-biosensor";
const labelClass = "block text-sm font-medium text-foreground mb-2";
const errorClass = "mt-1 text-xs text-red-600";

export function PqrsForm() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "peticion",
      topic: "",
      name: "",
      email: "",
      phone: "",
      message: "",
      consent: false,
      website: "",
    },
  });

  const selectedType = TYPES.find((t) => t.value === watch("type"));

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    const topicLabel = TOPICS.find((t) => t.value === values.topic)?.label ?? values.topic;
    let result: Awaited<ReturnType<typeof submitPqrs>>;
    try {
      result = await submitPqrs({
        data: {
          type: values.type,
          subject: topicLabel,
          name: values.name,
          email: values.email,
          phone: values.phone,
          description: values.message,
          consent: values.consent,
          website: values.website,
        },
      });
    } catch {
      setServerError(
        "No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.",
      );
      return;
    }

    if (!result.ok) {
      setServerError(
        result.error === "rate_limited"
          ? "Has enviado varias solicitudes seguidas. Espera un rato e inténtalo de nuevo."
          : result.error === "validation" || result.error === "too_large"
            ? "Revisa los datos del formulario e inténtalo de nuevo."
            : "No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.",
      );
      return;
    }
    if (result.accepted) {
      // Campo trampa: sin radicado. No se informa nada a un posible bot.
      setServerError(
        "No pudimos registrar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp.",
      );
      return;
    }
    setReceipt({
      radicado: result.radicado,
      due_at: result.due_at ?? null,
      emergency_notice: result.emergency_notice,
    });
    reset();
  };

  if (receipt) {
    return (
      <div className="space-y-4" role="status">
        <div className="rounded-2xl border border-biosensor/30 bg-biosensor/5 p-5 text-center">
          <CheckCircle2 className="h-8 w-8 text-biosensor mx-auto" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">Solicitud radicada</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wide text-foreground">
            {receipt.radicado}
          </p>
          <p className="mt-3 text-sm text-foreground">
            Guarda este número: con él y tu correo puedes consultar el estado.
          </p>
          {receipt.due_at && (
            <p className="mt-2 text-xs text-muted-foreground">
              Te responderemos a más tardar el <strong>{formatLongDate(receipt.due_at)}</strong>.
            </p>
          )}
        </div>
        {receipt.emergency_notice && (
          <div className="flex gap-3 rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-foreground">
            <PhoneCall className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <p>
              Si tú o alguien más está en peligro o necesita atención médica urgente,{" "}
              <strong>llama ahora a la línea de emergencias 123</strong>. Esta solicitud ya fue
              marcada como prioritaria para nuestro equipo.
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => setReceipt(null)}
          className="w-full px-6 py-3 rounded-lg border border-input text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          Enviar otra solicitud
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="pqrs-type" className={labelClass}>
          Tipo de solicitud
        </label>
        <select id="pqrs-type" {...register("type")} className={inputClass}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {selectedType && <p className="mt-1 text-xs text-muted-foreground">{selectedType.help}.</p>}
      </div>

      <div>
        <label htmlFor="pqrs-topic" className={labelClass}>
          Tema
        </label>
        <select
          id="pqrs-topic"
          {...register("topic")}
          className={inputClass}
          aria-invalid={!!errors.topic}
        >
          <option value="">Selecciona un tema</option>
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {errors.topic && <p className={errorClass}>{errors.topic.message}</p>}
      </div>

      <div>
        <label htmlFor="pqrs-name" className={labelClass}>
          Nombre completo
        </label>
        <input
          id="pqrs-name"
          type="text"
          autoComplete="name"
          {...register("name")}
          className={inputClass}
          placeholder="Tu nombre"
          aria-invalid={!!errors.name}
        />
        {errors.name && <p className={errorClass}>{errors.name.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pqrs-email" className={labelClass}>
            Correo
          </label>
          <input
            id="pqrs-email"
            type="email"
            autoComplete="email"
            {...register("email")}
            className={inputClass}
            placeholder="tu@email.com"
            aria-invalid={!!errors.email}
          />
          {errors.email && <p className={errorClass}>{errors.email.message}</p>}
        </div>
        <div>
          <label htmlFor="pqrs-phone" className={labelClass}>
            Teléfono <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="pqrs-phone"
            type="tel"
            autoComplete="tel"
            {...register("phone")}
            className={inputClass}
            placeholder="300 123 4567"
            aria-invalid={!!errors.phone}
          />
          {errors.phone && <p className={errorClass}>{errors.phone.message}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="pqrs-message" className={labelClass}>
          Mensaje
        </label>
        <textarea
          id="pqrs-message"
          rows={5}
          {...register("message")}
          className={`${inputClass} resize-none`}
          placeholder="Cuéntanos qué ocurrió o cómo podemos ayudarte. No incluyas datos clínicos ni claves."
          aria-invalid={!!errors.message}
        />
        {errors.message && <p className={errorClass}>{errors.message.message}</p>}
      </div>

      {/* Campo trampa: las personas no lo ven; los bots suelen llenarlo. */}
      <div className="absolute left-[-9999px] h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
        <label htmlFor="pqrs-website">No llenar este campo</label>
        <input
          id="pqrs-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      <div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" {...register("consent")} className="mt-0.5" />
          <span>
            Autorizo el tratamiento de mis datos para gestionar esta solicitud, conforme a la{" "}
            <a href="/privacidad" className="text-biosensor hover:underline">
              Política de Privacidad
            </a>{" "}
            y a la{" "}
            <a href="/habeas-data" className="text-biosensor hover:underline">
              política de Habeas Data
            </a>
            .
          </span>
        </label>
        {errors.consent && <p className={errorClass}>{errors.consent.message}</p>}
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-biosensor text-white rounded-lg font-medium hover:bg-biosensor/90 transition-colors focus:outline-none focus:ring-2 focus:ring-biosensor focus:ring-offset-2 disabled:opacity-60 inline-flex items-center justify-center gap-2"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {isSubmitting ? "Enviando…" : "Radicar solicitud"}
      </button>
    </form>
  );
}
