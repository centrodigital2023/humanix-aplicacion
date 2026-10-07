// Worksheet de validación MLP — 4 pasos + verificación OTP + resultado + código Premium.
// Flujo: survey (0-3) → OTP (canal elegido) → resultado con promo code.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProfileType = "familia" | "ips_eps" | "profesional";
type Channel = "whatsapp" | "email";
type Phase = "survey" | "otp" | "result";

type FormData = {
  profile_type: ProfileType;
  full_name: string;
  contact: string;
  service_offer: string;
  pain_point: string;
  target_customer: string;
  key_benefit: string;
  current_solutions: string;
  competitors: string;
  retention_channels: string;
  willingness_pct: number;
  comments: string;
  score_problem: number;
  score_demand: number;
  score_reach: number;
  score_benefit: number;
  score_advantage: number;
  score_passion: number;
};

const EMPTY: FormData = {
  profile_type: "familia",
  full_name: "",
  contact: "",
  service_offer: "",
  pain_point: "",
  target_customer: "",
  key_benefit: "",
  current_solutions: "",
  competitors: "",
  retention_channels: "",
  willingness_pct: 50,
  comments: "",
  score_problem: 0,
  score_demand: 0,
  score_reach: 0,
  score_benefit: 0,
  score_advantage: 0,
  score_passion: 0,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PROFILES = [
  { key: "familia" as ProfileType, emoji: "👨‍👩‍👧", label: "Familia / Usuario" },
  { key: "ips_eps" as ProfileType, emoji: "🏥", label: "IPS / EPS" },
  { key: "profesional" as ProfileType, emoji: "👩‍⚕️", label: "Profesional de Salud" },
];

const SCORE_FACTORS: {
  key: keyof Pick<
    FormData,
    | "score_problem"
    | "score_demand"
    | "score_reach"
    | "score_benefit"
    | "score_advantage"
    | "score_passion"
  >;
  label: string;
  question: string;
}[] = [
  { key: "score_problem", label: "Problema Claro", question: "¿Qué tan claro y urgente es el problema que resuelves?" },
  { key: "score_demand", label: "Demanda Real", question: "¿Existe demanda comprobada con usuarios reales?" },
  { key: "score_reach", label: "Alcance", question: "¿A cuántas personas podrías llegar en 12 meses?" },
  { key: "score_benefit", label: "Beneficio Clave", question: "¿Qué tan valioso es el beneficio para quien lo recibe?" },
  { key: "score_advantage", label: "Ventaja Competitiva", question: "¿Tienes una ventaja diferencial difícil de copiar?" },
  { key: "score_passion", label: "Pasión / Experiencia", question: "¿Tienes pasión y experiencia demostrada en este campo?" },
];

const SURVEY_STEPS = 4; // steps 0-3 in survey phase

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectChannel(contact: string): Channel {
  return contact.includes("@") ? "email" : "whatsapp";
}

function maskContact(contact: string): string {
  if (contact.includes("@")) {
    const [user, domain] = contact.split("@");
    return (user.slice(0, 2) || "**") + "***@" + domain;
  }
  const clean = contact.replace(/\D/g, "");
  if (clean.length >= 8) return clean.slice(0, 3) + " *** " + clean.slice(-3);
  return contact.slice(0, 3) + "***";
}

function totalScore(f: FormData) {
  return (
    f.score_problem + f.score_demand + f.score_reach +
    f.score_benefit + f.score_advantage + f.score_passion
  );
}

function tier(score: number) {
  if (score >= 22)
    return { emoji: "🏆", label: "Idea Altamente Validada", sub: "Tu propuesta tiene base sólida para escalar.", color: "text-ok", ring: "ring-ok/30 bg-ok/5" };
  if (score >= 15)
    return { emoji: "🔧", label: "Ajustar Propuesta", sub: "Hay potencial, pero algunos factores necesitan más evidencia.", color: "text-amber-600 dark:text-amber-400", ring: "ring-amber-400/30 bg-amber-50 dark:bg-amber-900/20" };
  return { emoji: "🔄", label: "Reevaluar", sub: "Aún es el momento ideal para pivotar antes de invertir más.", color: "text-warn", ring: "ring-warn/30 bg-warn/5" };
}

function scoreChip(n: number) {
  if (n === 0) return "border-2 border-border bg-background text-muted-foreground";
  if (n <= 2) return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-2 border-red-300 dark:border-red-700";
  if (n === 3) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-2 border-amber-300 dark:border-amber-700";
  if (n === 4) return "bg-trust/15 text-trust border-2 border-trust/40";
  return "bg-ok/15 text-ok border-2 border-ok/40";
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const input = "min-h-14 w-full rounded-2xl border-2 border-border bg-background px-4 text-lg font-medium outline-none focus:border-trust";
const textarea = "min-h-24 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-medium outline-none focus:border-trust resize-none";

// ── Component ─────────────────────────────────────────────────────────────────

export function ValidationSurvey() {
  // Survey state
  const [phase, setPhase] = useState<Phase>("survey");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);

  // OTP state
  const [otpId, setOtpId] = useState<string | null>(null);
  const [otpChannel, setOtpChannel] = useState<Channel>("whatsapp");
  const [otpContact, setOtpContact] = useState("");
  const [otpMasked, setOtpMasked] = useState("");
  const [showAltInput, setShowAltInput] = useState(false);
  const [altContact, setAltContact] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Result state
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const up = (patch: Partial<FormData>) => setForm((f) => ({ ...f, ...patch }));

  // Cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // ── Survey submit → go to OTP phase ────────────────────────────────────────
  const submitSurvey = async () => {
    setSubmitting(true);
    setSurveyError(null);
    try {
      const { data, error } = await (supabase as any)
        .from("validation_responses")
        .insert([
          {
            profile_type: form.profile_type,
            full_name: form.full_name || null,
            whatsapp: form.contact?.includes("@") ? null : form.contact || null,
            email: form.contact?.includes("@") ? form.contact : null,
            service_offer: form.service_offer || null,
            pain_point: form.pain_point || null,
            target_customer: form.target_customer || null,
            key_benefit: form.key_benefit || null,
            current_solutions: form.current_solutions || null,
            competitors: form.competitors || null,
            retention_channels: form.retention_channels || null,
            willingness_pct: form.willingness_pct,
            comments: form.comments || null,
            score_clear_problem: form.score_problem,
            score_demand: form.score_demand,
            score_reach: form.score_reach,
            score_benefit: form.score_benefit,
            score_competitive_adv: form.score_advantage,
            score_passion: form.score_passion,
          },
        ])
        .select("id")
        .single();

      if (error) throw error;
      setResponseId(data.id);

      // Auto-detect channel and contact for OTP
      const detectedChannel = detectChannel(form.contact);
      setOtpChannel(detectedChannel);
      setOtpContact(form.contact);
      setPhase("otp");
    } catch (e) {
      console.error(e);
      setSurveyError("No se pudo guardar. Intenta otra vez.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── OTP: send ───────────────────────────────────────────────────────────────
  const sendOtp = async (contactOverride?: string, channelOverride?: Channel) => {
    const contact = contactOverride ?? otpContact;
    const channel = channelOverride ?? otpChannel;
    if (!contact.trim()) return;

    setOtpSending(true);
    setOtpError(null);
    setOtpDigits(["", "", "", "", "", ""]);

    try {
      const { data, error } = await supabase.functions.invoke("send-validation-otp", {
        body: { contact, channel, response_id: responseId },
      });
      if (error || !data?.sent) {
        setOtpError(data?.error ?? "No se pudo enviar el código. Intenta otra vez.");
        return;
      }
      setOtpId(data.otp_id);
      setOtpMasked(data.masked ?? maskContact(contact));
      setOtpSent(true);
      setCooldown(30);
      // Focus first box
      setTimeout(() => codeRefs.current[0]?.focus(), 100);
    } catch {
      setOtpError("Error de conexión. Intenta otra vez.");
    } finally {
      setOtpSending(false);
    }
  };

  // ── OTP: verify ─────────────────────────────────────────────────────────────
  const verifyOtp = async (code: string) => {
    if (!otpId || code.length !== 6) return;
    setOtpVerifying(true);
    setOtpError(null);
    try {
      const { data, error } = await supabase.functions.invoke("verify-validation-otp", {
        body: { otp_id: otpId, code },
      });
      if (error || !data?.valid) {
        setOtpError(data?.error ?? "Código incorrecto. Intenta otra vez.");
        setOtpDigits(["", "", "", "", "", ""]);
        setTimeout(() => codeRefs.current[0]?.focus(), 80);
        return;
      }
      setPromoCode(data.promo_code ?? null);
      setPhase("result");
    } catch {
      setOtpError("Error de verificación. Intenta otra vez.");
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── OTP input handlers ──────────────────────────────────────────────────────
  const handleDigit = (idx: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const digit = val.slice(-1);
    const next = otpDigits.map((d, i) => (i === idx ? digit : d));
    setOtpDigits(next);
    if (digit && idx < 5) codeRefs.current[idx + 1]?.focus();
    if (next.every((d) => d !== "")) verifyOtp(next.join(""));
  };

  const handleDigitKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!otpDigits[idx] && idx > 0) {
        const next = otpDigits.map((d, i) => (i === idx - 1 ? "" : d));
        setOtpDigits(next);
        codeRefs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      codeRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      codeRefs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length >= 4) {
      const next = Array.from({ length: 6 }, (_, i) => text[i] ?? "");
      setOtpDigits(next);
      const lastIdx = Math.min(text.length - 1, 5);
      codeRefs.current[lastIdx]?.focus();
      if (text.length === 6) verifyOtp(text);
    }
  };

  // ── Channel switch ──────────────────────────────────────────────────────────
  const switchChannel = (ch: Channel) => {
    const isPhone = !form.contact.includes("@");
    const hasOriginal = (ch === "whatsapp" && isPhone) || (ch === "email" && !isPhone);
    if (hasOriginal) {
      setOtpChannel(ch);
      setOtpContact(form.contact);
      setShowAltInput(false);
      setOtpSent(false);
      setOtpId(null);
    } else {
      setOtpChannel(ch);
      setShowAltInput(true);
      setOtpSent(false);
      setOtpId(null);
    }
    setOtpDigits(["", "", "", "", "", ""]);
    setOtpError(null);
  };

  const score = totalScore(form);
  const t = tier(score);
  const progress = Math.round((step / SURVEY_STEPS) * 100);

  // ── Copy promo code ─────────────────────────────────────────────────────────
  const copyCode = async () => {
    if (!promoCode) return;
    await navigator.clipboard.writeText(promoCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-ok/10 px-4 py-1 text-sm font-bold text-ok ring-1 ring-ok/20">
          🎁 1 mes Premium gratis al verificar tu contacto
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-trust sm:text-5xl">
          Valida tu idea con los criterios de los inversionistas
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">5 minutos · Sin registro · Resultado inmediato</p>
      </div>

      {/* ── Progress bar (only during survey phase) ───────────────────────── */}
      {phase === "survey" && (
        <div className="mb-6" role="progressbar" aria-valuenow={progress} aria-valuemax={100}>
          <div className="mb-1 flex justify-between text-xs font-semibold text-muted-foreground">
            <span>Paso {step + 1} de {SURVEY_STEPS}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-2 rounded-full bg-trust transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div
        key={`${phase}-${step}`}
        className="rounded-[2rem] border border-border bg-card/80 p-6 shadow-xl shadow-trust/5 backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-400 sm:p-8"
      >

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* SURVEY PHASE                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}

        {/* Step 0: Perfil + Contacto */}
        {phase === "survey" && step === 0 && (
          <div className="space-y-6">
            <h2 className="font-display text-2xl font-bold">¿Quién eres?</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {PROFILES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => up({ profile_type: p.key })}
                  className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center font-bold transition active:scale-95 ${
                    form.profile_type === p.key ? "border-trust bg-trust/10 text-trust" : "border-border bg-background hover:border-trust/40"
                  }`}
                >
                  <span className="text-3xl" aria-hidden="true">{p.emoji}</span>
                  <span className="text-sm leading-tight">{p.label}</span>
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <label className="block text-base font-bold">Nombre (opcional)</label>
              <input value={form.full_name} onChange={(e) => up({ full_name: e.target.value })} placeholder="Tu nombre" className={input} />
              <label className="block text-base font-bold">
                WhatsApp o correo <span className="text-warn">*</span>
              </label>
              <input
                value={form.contact}
                onChange={(e) => up({ contact: e.target.value })}
                placeholder="3001234567 o correo@ejemplo.com"
                className={input}
                inputMode="email"
              />
              <p className="text-xs text-muted-foreground">
                Aquí recibirás el código para reclamar tu mes Premium. No spam, nunca.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={!form.contact.trim()}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98] disabled:opacity-50"
            >
              Comenzar <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Step 1: Tu propuesta */}
        {phase === "survey" && step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-bold">Tu propuesta</h2>
              <p className="mt-1 text-base text-muted-foreground">Sé concreto — una idea clara vale más que diez vagas.</p>
            </div>
            {[
              { field: "service_offer" as const, label: "¿Qué servicio o producto ofreces?", placeholder: "Ej: Plataforma de cuidadores certificados a domicilio" },
              { field: "pain_point" as const, label: "¿Qué problema resuelve?", placeholder: "Ej: Las familias no saben cómo encontrar cuidadores confiables" },
              { field: "target_customer" as const, label: "¿Para quién es?", placeholder: "Ej: Adultos mayores con familiares trabajadores en ciudades principales" },
              { field: "key_benefit" as const, label: "¿Cuál es el beneficio principal?", placeholder: "Ej: Tranquilidad de tener a alguien verificado y rastreado en casa" },
            ].map(({ field, label, placeholder }) => (
              <div key={field}>
                <label className="mb-2 block text-base font-bold">{label}</label>
                <textarea value={form[field] as string} onChange={(e) => up({ [field]: e.target.value })} placeholder={placeholder} className={textarea} />
              </div>
            ))}
            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(0)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">Atrás</button>
              <button type="button" onClick={() => setStep(2)} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98]">
                Continuar <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Mercado + Demanda */}
        {phase === "survey" && step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-bold">El mercado</h2>
              <p className="mt-1 text-base text-muted-foreground">Los inversionistas necesitan ver que conoces a tu competencia.</p>
            </div>
            <div>
              <label className="mb-2 block text-base font-bold">¿Qué soluciones de pago ya existen?</label>
              <textarea value={form.current_solutions} onChange={(e) => up({ current_solutions: e.target.value })} placeholder="Ej: Agencias de enfermería tradicionales, grupos de WhatsApp informales" className={textarea} />
            </div>
            <div>
              <label className="mb-2 block text-base font-bold">Hasta 3 competidores: nombre + oferta + diferencial tuyo</label>
              <textarea value={form.competitors} onChange={(e) => up({ competitors: e.target.value })} placeholder="Ej: 1) JobsInSalud — bolsa general, no especializada. 2) Sanitas — solo sus empleados…" className={`${textarea} min-h-32`} />
            </div>
            <div>
              <label className="mb-2 block text-base font-bold">
                Disposición a pagar: <span className="font-display text-trust">{form.willingness_pct}%</span> pagarían por esto
              </label>
              <input type="range" min={0} max={100} step={5} value={form.willingness_pct} onChange={(e) => up({ willingness_pct: Number(e.target.value) })} className="w-full accent-trust" />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>0% — Nadie</span><span>50%</span><span>100% — Todos</span>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-base font-bold">Comentarios de demanda (evidencia, entrevistas, cifras)</label>
              <textarea value={form.comments} onChange={(e) => up({ comments: e.target.value })} placeholder="Ej: En 20 entrevistas, 14 familias dijeron que pagarían $150.000/mes" className={textarea} />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">Atrás</button>
              <button type="button" onClick={() => setStep(3)} className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98]">
                Puntuar <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Puntuación */}
        {phase === "survey" && step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold">Puntuación de validación</h2>
              <p className="mt-1 text-base text-muted-foreground">Valora cada factor de 0 a 5. Sé honesto — los inversionistas lo detectan.</p>
            </div>
            {SCORE_FACTORS.map(({ key, label, question }) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-bold">{label}</p>
                  <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${scoreChip(form[key] as number)}`}>{form[key]} / 5</span>
                </div>
                <p className="mb-2 text-sm text-muted-foreground">{question}</p>
                <div className="flex gap-2">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => up({ [key]: n } as any)}
                      aria-label={`${label}: ${n} de 5`}
                      className={`flex min-h-11 flex-1 items-center justify-center rounded-xl text-base font-bold transition active:scale-90 ${
                        form[key] === n ? scoreChip(n) : "border-2 border-border bg-background hover:border-trust/40"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className={`flex items-center justify-between rounded-2xl p-4 ring-2 ${t.ring}`}>
              <span className="font-bold">Puntaje total</span>
              <span className={`font-display text-3xl font-bold ${t.color}`}>{score}<span className="text-lg text-muted-foreground"> / 30</span></span>
            </div>
            {surveyError && <p role="alert" className="text-base font-semibold text-warn">{surveyError}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">Atrás</button>
              <button
                type="button"
                onClick={submitSurvey}
                disabled={submitting}
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98] disabled:opacity-70"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : "🎁 Reclamar mi mes Premium"}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* OTP PHASE                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}

        {phase === "otp" && (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-5xl mb-2" aria-hidden="true">🔐</p>
              <h2 className="font-display text-2xl font-bold">Verifica tu contacto</h2>
              <p className="mt-1 text-base text-muted-foreground">
                Un código de 6 dígitos para confirmar que eres tú.
              </p>
            </div>

            {/* Channel tabs */}
            <div>
              <p className="mb-2 text-sm font-bold text-muted-foreground">Enviar código por:</p>
              <div className="grid grid-cols-2 gap-2">
                {(["whatsapp", "email"] as Channel[]).map((ch) => {
                  const isPhone = !form.contact.includes("@");
                  const hasOriginal = (ch === "whatsapp" && isPhone) || (ch === "email" && !isPhone);
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => switchChannel(ch)}
                      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-sm font-bold transition active:scale-95 ${
                        otpChannel === ch ? "border-trust bg-trust/10 text-trust" : "border-border bg-background hover:border-trust/40"
                      }`}
                    >
                      <span className="text-xl" aria-hidden="true">{ch === "whatsapp" ? "📱" : "📧"}</span>
                      <span>{ch === "whatsapp" ? "WhatsApp" : "Correo"}</span>
                      {!hasOriginal && <span className="text-xs font-normal text-muted-foreground">(Ingresar)</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Alt contact input when user switches channel */}
            {showAltInput && (
              <div>
                <label className="mb-2 block text-base font-bold">
                  {otpChannel === "whatsapp" ? "📱 Tu número de WhatsApp" : "📧 Tu correo electrónico"}
                </label>
                <div className="flex gap-2">
                  <input
                    value={altContact}
                    onChange={(e) => setAltContact(e.target.value)}
                    placeholder={otpChannel === "whatsapp" ? "3001234567" : "tu@correo.com"}
                    className={`${input} flex-1`}
                    inputMode={otpChannel === "whatsapp" ? "tel" : "email"}
                  />
                </div>
              </div>
            )}

            {/* Send button */}
            {!otpSent ? (
              <button
                type="button"
                onClick={() => {
                  const contact = showAltInput ? altContact.trim() : otpContact;
                  if (contact) {
                    setOtpContact(contact);
                    sendOtp(contact, otpChannel);
                  }
                }}
                disabled={otpSending || (showAltInput && !altContact.trim())}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98] disabled:opacity-60"
              >
                {otpSending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : (
                  <>{otpChannel === "whatsapp" ? "📱" : "📧"} Enviar código</>
                )}
              </button>
            ) : (
              <div className="space-y-4">
                {/* Sent confirmation */}
                <div className="flex items-center gap-3 rounded-2xl bg-ok/10 p-4 ring-1 ring-ok/30">
                  <span className="text-2xl" aria-hidden="true">✅</span>
                  <div>
                    <p className="font-bold text-ok">¡Código enviado!</p>
                    <p className="text-sm text-muted-foreground">
                      {otpChannel === "whatsapp" ? "📱 WhatsApp" : "📧 Email"} → <strong>{otpMasked}</strong>
                    </p>
                  </div>
                </div>

                {/* 6-box OTP input */}
                <div>
                  <label className="mb-3 block text-base font-bold text-center">
                    {otpVerifying ? "Verificando…" : "Ingresa el código de 6 dígitos"}
                  </label>
                  <div
                    className="flex justify-center gap-2"
                    onPaste={handlePaste}
                    role="group"
                    aria-label="Código de verificación"
                  >
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => { codeRefs.current[idx] = el; }}
                        type="tel"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleDigit(idx, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                        disabled={otpVerifying}
                        aria-label={`Dígito ${idx + 1}`}
                        className={`h-14 w-11 rounded-2xl border-2 text-center text-2xl font-bold outline-none transition disabled:opacity-60 sm:h-16 sm:w-14 ${
                          digit ? "border-trust bg-trust/10 text-trust" : "border-border bg-background focus:border-trust"
                        }`}
                      />
                    ))}
                  </div>
                  {otpVerifying && (
                    <div className="mt-3 flex justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-trust" aria-hidden="true" />
                    </div>
                  )}
                </div>

                {/* Error */}
                {otpError && (
                  <p role="alert" className="text-center text-base font-semibold text-warn">
                    {otpError}
                  </p>
                )}

                {/* Resend */}
                <div className="text-center">
                  {cooldown > 0 ? (
                    <p className="text-sm text-muted-foreground">Reenviar en {cooldown}s</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendOtp(otpContact, otpChannel)}
                      disabled={otpSending}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-trust underline underline-offset-4 hover:text-trust/80"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reenviar código
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Top-level OTP error (not after send) */}
            {otpError && !otpSent && (
              <p role="alert" className="text-center text-base font-semibold text-warn">{otpError}</p>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* RESULT PHASE                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}

        {phase === "result" && (
          <div className="space-y-6 text-center">
            {/* Tier badge */}
            <div className={`rounded-2xl p-6 ring-2 ${t.ring}`}>
              <p className="text-6xl mb-3" aria-hidden="true">{t.emoji}</p>
              <h2 className={`font-display text-3xl font-bold ${t.color}`}>{t.label}</h2>
              <p className="mt-2 text-base text-muted-foreground">{t.sub}</p>
              <p className={`mt-3 font-display text-5xl font-bold ${t.color}`}>
                {score}
                <span className="text-2xl text-muted-foreground"> / 30</span>
              </p>
            </div>

            {/* Score breakdown */}
            <div className="rounded-2xl border border-border bg-background p-4 text-left">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">Desglose</p>
              {SCORE_FACTORS.map(({ key, label }) => {
                const v = form[key] as number;
                return (
                  <div key={key} className="flex items-center justify-between border-b border-border py-1.5 last:border-0">
                    <span className="text-sm font-semibold">{label}</span>
                    <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${scoreChip(v)}`}>{v} / 5</span>
                  </div>
                );
              })}
            </div>

            {/* Promo code */}
            {promoCode ? (
              <div className="rounded-2xl bg-ok/10 p-5 ring-2 ring-ok/30">
                <p className="text-lg font-bold text-ok">🎁 Tu mes Premium gratis</p>
                <p className="mt-1 text-sm text-muted-foreground mb-3">
                  Ingresa este código al registrarte o en Ajustes → Suscripción.
                </p>
                <div className="flex items-center gap-3 rounded-2xl border-2 border-ok/40 bg-background px-4 py-3">
                  <code className="flex-1 font-mono text-xl font-bold tracking-widest text-ok">
                    {promoCode}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    aria-label="Copiar código"
                    className="flex items-center gap-1.5 rounded-xl bg-ok px-3 py-2 text-sm font-bold text-ok-foreground transition hover:bg-ok/90 active:scale-95"
                  >
                    {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                    {copied ? "¡Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-muted/60 p-5">
                <p className="text-sm text-muted-foreground">El equipo de Humanix te contactará para activar tu mes Premium.</p>
              </div>
            )}

            {/* CTAs */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="/auth?mode=signup"
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-base font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98]"
              >
                Activar cuenta gratis →
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`¡Acabo de validar mi idea en Humanix! Obtuve ${score}/30 · ${t.label} 🚀 Valida la tuya gratis en humanix.lat/validacion`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-6 text-base font-bold text-white transition hover:bg-[#1ebe5d] active:scale-[0.98]"
              >
                📤 Compartir resultado
              </a>
            </div>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Tus respuestas se guardan de forma privada. Solo el equipo de Humanix puede verlas.
      </p>
    </div>
  );
}
