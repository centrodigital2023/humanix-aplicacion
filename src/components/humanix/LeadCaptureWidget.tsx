// Widget de captura de leads: encuesta de 3 pasos en 30 segundos.
// Aparece después de 45 s de inactividad o al 70 % del scroll.
// Solo visible para usuarios no autenticados.
// Guarda datos en Supabase lead_captures (sin requerir cuenta).
import { useState, useEffect, useCallback } from "react";
import { X, Gift, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Step = 1 | 2 | 3;

type Answers = {
  care_scope?: string;
  frequency?: string;
  contact_channel?: string;
  whatsapp?: string;
  email?: string;
};

const CARE_OPTIONS = [
  { id: "solo", emoji: "🧑", label: "Solo yo" },
  { id: "familia", emoji: "👨‍👩‍👧", label: "Mi familia" },
  { id: "cronico", emoji: "🏥", label: "Paciente crónico" },
  { id: "institucion", emoji: "🏢", label: "Institución" },
];

const FREQ_OPTIONS = [
  { id: "urgente", emoji: "⚡", label: "Urgente ahora" },
  { id: "semanas", emoji: "📅", label: "En semanas" },
  { id: "mensual", emoji: "🗓️", label: "Mensual" },
  { id: "explorando", emoji: "🔍", label: "Solo exploro" },
];

export function LeadCaptureWidget({ userId }: { userId?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [answers, setAnswers] = useState<Answers>({});
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [contact, setContact] = useState<"whatsapp" | "email" | null>(null);
  const [inputVal, setInputVal] = useState("");

  // Don't show if user is already logged in
  const shouldShow = !userId;

  useEffect(() => {
    if (!shouldShow) return;
    try {
      if (localStorage.getItem("hx_lead_captured")) return;
    } catch {
      // private mode — still show
    }

    let scrollTriggered = false;
    let timer: ReturnType<typeof setTimeout>;

    const onScroll = () => {
      if (scrollTriggered) return;
      const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      if (pct >= 0.7) {
        scrollTriggered = true;
        setOpen(true);
      }
    };

    timer = setTimeout(() => {
      if (!dismissed) setOpen(true);
    }, 45_000);

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [shouldShow, dismissed]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setDismissed(true);
  }, []);

  const pick = (key: keyof Answers, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (key === "care_scope") setStep(2);
    if (key === "frequency") setStep(3);
  };

  const submit = async () => {
    const payload = {
      ...answers,
      contact_channel: contact ?? "none",
      [contact === "whatsapp" ? "whatsapp" : "email"]: inputVal || null,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("lead_captures").insert([payload]);
      localStorage.setItem("hx_lead_captured", "1");
    } catch {
      // non-fatal — still show success
    }
    setDone(true);
  };

  if (!open || !shouldShow) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Oferta especial: 1 mes Premium gratis"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(2px)" }}
    >
      <div className="relative w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] bg-card shadow-2xl ring-1 ring-border overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-6 pb-4 bg-gradient-to-r from-trust/10 to-ok/10 border-b border-border">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-trust/15 text-2xl">
              🎁
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-trust">Oferta exclusiva</p>
              <p className="text-base font-bold leading-tight">1 mes Premium gratis</p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Cerrar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* progress dots */}
        {!done && (
          <div className="flex justify-center gap-2 pt-4 pb-1">
            {([1, 2, 3] as Step[]).map((s) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s <= step ? "w-8 bg-trust" : "w-3 bg-border"
                }`}
              />
            ))}
          </div>
        )}

        <div className="px-6 pb-7 pt-4 min-h-[200px]">
          {done ? (
            <SuccessView />
          ) : step === 1 ? (
            <StepView
              question="¿A quién cuidas?"
              options={CARE_OPTIONS}
              onPick={(v) => pick("care_scope", v)}
            />
          ) : step === 2 ? (
            <StepView
              question="¿Con qué frecuencia necesitas ayuda?"
              options={FREQ_OPTIONS}
              onPick={(v) => pick("frequency", v)}
            />
          ) : (
            <ContactStep
              contact={contact}
              inputVal={inputVal}
              onContact={setContact}
              onInput={setInputVal}
              onSubmit={submit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepView({
  question,
  options,
  onPick,
}: {
  question: string;
  options: { id: string; emoji: string; label: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-base font-semibold mb-4 text-center">{question}</p>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onPick(o.id)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-background border border-border p-4 text-sm font-semibold transition hover:border-trust hover:bg-trust/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust"
          >
            <span className="text-2xl">{o.emoji}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContactStep({
  contact,
  inputVal,
  onContact,
  onInput,
  onSubmit,
}: {
  contact: "whatsapp" | "email" | null;
  inputVal: string;
  onContact: (c: "whatsapp" | "email") => void;
  onInput: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div>
      <p className="text-base font-semibold mb-4 text-center">
        ¿Cómo te contactamos con tu mes gratis?
      </p>
      <div className="flex gap-2 mb-4">
        {(["whatsapp", "email"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onContact(c)}
            className={`flex-1 rounded-xl border py-2.5 text-sm font-bold transition ${
              contact === c
                ? "border-trust bg-trust/10 text-trust"
                : "border-border bg-background text-muted-foreground hover:border-trust/40"
            }`}
          >
            {c === "whatsapp" ? "📱 WhatsApp" : "✉️ Email"}
          </button>
        ))}
      </div>
      {contact && (
        <div className="space-y-3">
          <input
            type={contact === "email" ? "email" : "tel"}
            placeholder={contact === "whatsapp" ? "+57 3XX XXX XXXX" : "tu@email.com"}
            value={inputVal}
            onChange={(e) => onInput(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm focus:border-trust focus:outline-none focus:ring-2 focus:ring-trust/20"
          />
          <Button
            onClick={onSubmit}
            disabled={!inputVal.trim()}
            className="w-full h-12 rounded-xl bg-trust text-trust-foreground hover:bg-trust/90 font-bold"
          >
            <Gift size={16} className="mr-2" />
            Activar mi mes gratis
            <ChevronRight size={16} className="ml-1" />
          </Button>
          <p className="text-center text-[0.72rem] text-muted-foreground">
            Sin tarjeta de crédito. Sin compromiso. Tu información es privada.
          </p>
        </div>
      )}
    </div>
  );
}

function SuccessView() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-4 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ok/15 text-5xl">
        🎉
      </div>
      <div>
        <p className="text-xl font-bold">¡Listo! Tu mes Premium está reservado.</p>
        <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">
          Te enviaremos el código de activación en menos de 5 minutos. Crea tu cuenta en{" "}
          <a href="/auth" className="text-trust underline underline-offset-2 font-semibold">
            humanix.lat/auth
          </a>{" "}
          para canjearlo.
        </p>
      </div>
      <a
        href="/auth"
        className="inline-flex items-center gap-2 rounded-xl bg-trust px-6 py-3 text-sm font-bold text-trust-foreground hover:bg-trust/90 transition"
      >
        Crear cuenta ahora →
      </a>
    </div>
  );
}
