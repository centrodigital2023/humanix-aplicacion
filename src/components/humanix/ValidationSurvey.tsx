// Worksheet de validación MLP — 4 pasos + resultado + código Premium gratis.
// Cualquier visitante puede completarlo sin sesión.
import { useState } from "react";
import { Check, ChevronRight, Copy, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type ProfileType = "familia" | "ips_eps" | "profesional";

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
  { key: "score_advantage", label: "Ventaja Competitiva", question: "¿Tienes una ventaja diferencial que sea difícil de copiar?" },
  { key: "score_passion", label: "Pasión / Experiencia", question: "¿Tienes pasión y experiencia demostrada en este campo?" },
];

function scoreChip(n: number) {
  if (n === 0) return "border-2 border-border bg-background text-muted-foreground";
  if (n <= 2) return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-2 border-red-300 dark:border-red-700";
  if (n === 3) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-2 border-amber-300 dark:border-amber-700";
  if (n === 4) return "bg-trust/15 text-trust border-2 border-trust/40";
  return "bg-ok/15 text-ok border-2 border-ok/40";
}

function totalScore(f: FormData) {
  return f.score_problem + f.score_demand + f.score_reach + f.score_benefit + f.score_advantage + f.score_passion;
}

function tier(score: number) {
  if (score >= 22)
    return { emoji: "🏆", label: "Idea Altamente Validada", sub: "Tu propuesta tiene base sólida para escalar.", color: "text-ok", ring: "ring-ok/30 bg-ok/5" };
  if (score >= 15)
    return { emoji: "🔧", label: "Ajustar Propuesta", sub: "Hay potencial, pero algunos factores necesitan más evidencia.", color: "text-amber-600 dark:text-amber-400", ring: "ring-amber-400/30 bg-amber-50 dark:bg-amber-900/20" };
  return { emoji: "🔄", label: "Reevaluar", sub: "Aún es el momento ideal para pivotar antes de invertir más.", color: "text-warn", ring: "ring-warn/30 bg-warn/5" };
}

const input =
  "min-h-14 w-full rounded-2xl border-2 border-border bg-background px-4 text-lg font-medium outline-none focus:border-trust";
const textarea =
  "min-h-24 w-full rounded-2xl border-2 border-border bg-background px-4 py-3 text-base font-medium outline-none focus:border-trust resize-none";
const TOTAL_STEPS = 4;

export function ValidationSurvey() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const up = (patch: Partial<FormData>) => setForm((f) => ({ ...f, ...patch }));

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: err } = await (supabase as any)
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
        .select("promo_code")
        .single();

      if (err) throw err;
      setPromoCode(data?.promo_code ?? null);
      next();
    } catch (e: any) {
      setError("No se pudo guardar. Intenta otra vez.");
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = async () => {
    if (!promoCode) return;
    await navigator.clipboard.writeText(promoCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const score = totalScore(form);
  const t = tier(score);

  // ── Progress bar ──────────────────────────────────────────────────────────
  const progress = step < TOTAL_STEPS ? Math.round((step / TOTAL_STEPS) * 100) : 100;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-ok/10 px-4 py-1 text-sm font-bold text-ok ring-1 ring-ok/20">
          🎁 1 mes Premium gratis al completar
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-trust sm:text-5xl">
          Valida tu idea con los mismos criterios que usan los inversionistas
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          5 minutos · Sin registro · Resultado inmediato
        </p>
      </div>

      {/* Progress */}
      {step < TOTAL_STEPS && (
        <div className="mb-6" role="progressbar" aria-valuenow={progress} aria-valuemax={100}>
          <div className="flex justify-between text-xs font-semibold text-muted-foreground mb-1">
            <span>Paso {step + 1} de {TOTAL_STEPS}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-2 rounded-full bg-trust transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div
        key={step}
        className="rounded-[2rem] border border-border bg-card/80 p-6 shadow-xl shadow-trust/5 backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-400 sm:p-8"
      >

        {/* ── Step 0: Perfil + Contacto ─────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-6">
            <h2 className="font-display text-2xl font-bold">¿Quién eres?</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {PROFILES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => up({ profile_type: p.key })}
                  className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center font-bold transition active:scale-95 ${
                    form.profile_type === p.key
                      ? "border-trust bg-trust/10 text-trust"
                      : "border-border bg-background hover:border-trust/40"
                  }`}
                >
                  <span className="text-3xl" aria-hidden="true">{p.emoji}</span>
                  <span className="text-sm leading-tight">{p.label}</span>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <label className="block text-base font-bold">Nombre (opcional)</label>
              <input
                value={form.full_name}
                onChange={(e) => up({ full_name: e.target.value })}
                placeholder="Tu nombre"
                className={input}
              />
              <label className="block text-base font-bold">WhatsApp o correo <span className="text-warn">*</span></label>
              <input
                value={form.contact}
                onChange={(e) => up({ contact: e.target.value })}
                placeholder="3001234567 o correo@ejemplo.com"
                className={input}
              />
              <p className="text-xs text-muted-foreground">
                Aquí te enviaremos tu código Premium. No spam, nunca.
              </p>
            </div>

            <button
              type="button"
              onClick={next}
              disabled={!form.contact.trim()}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
            >
              Comenzar <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── Step 1: Tu Propuesta (Sección 1) ─────────────────────────── */}
        {step === 1 && (
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
                <label className="block text-base font-bold mb-2">{label}</label>
                <textarea
                  value={form[field] as string}
                  onChange={(e) => up({ [field]: e.target.value })}
                  placeholder={placeholder}
                  className={textarea}
                />
              </div>
            ))}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(0)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">
                Atrás
              </button>
              <button
                type="button"
                onClick={next}
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98]"
              >
                Continuar <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Mercado + Demanda (Secciones 2 y 3) ───────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-2xl font-bold">El mercado</h2>
              <p className="mt-1 text-base text-muted-foreground">Los inversionistas necesitan ver que conoces a tu competencia.</p>
            </div>

            <div>
              <label className="block text-base font-bold mb-2">¿Qué soluciones de pago ya existen para este problema?</label>
              <textarea value={form.current_solutions} onChange={(e) => up({ current_solutions: e.target.value })} placeholder="Ej: Agencias de enfermería tradicionales, grupos de WhatsApp informales" className={textarea} />
            </div>
            <div>
              <label className="block text-base font-bold mb-2">Menciona hasta 3 competidores (nombre + qué ofrecen + en qué te diferencias)</label>
              <textarea value={form.competitors} onChange={(e) => up({ competitors: e.target.value })} placeholder="Ej: 1) InfoJobs — bolsa de empleo general, no especializada en salud. 2) Sanitas — solo sus propios empleados…" className={`${textarea} min-h-32`} />
            </div>

            <div>
              <label className="block text-base font-bold mb-2">
                Disposición a pagar: <span className="text-trust font-bold">{form.willingness_pct}%</span> de tus usuarios objetivos pagarían
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={form.willingness_pct}
                onChange={(e) => up({ willingness_pct: Number(e.target.value) })}
                className="w-full accent-trust"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>

            <div>
              <label className="block text-base font-bold mb-2">¿Cuánto pagarían? Comentarios u otros hallazgos de demanda</label>
              <textarea value={form.comments} onChange={(e) => up({ comments: e.target.value })} placeholder="Ej: En entrevistas con 20 familias, 14 dijeron que pagarían $150.000/mes" className={textarea} />
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">
                Atrás
              </button>
              <button
                type="button"
                onClick={next}
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98]"
              >
                Puntuar <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Puntuación (Sección 4) ────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl font-bold">Puntuación de validación</h2>
              <p className="mt-1 text-base text-muted-foreground">
                Valora cada factor de 0 a 5. Sé honesto — los inversionistas lo notan cuando no lo eres.
              </p>
            </div>

            {SCORE_FACTORS.map(({ key, label, question }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold">{label}</p>
                  <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${scoreChip(form[key] as number)}`}>
                    {form[key]} / 5
                  </span>
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

            {/* Live score preview */}
            <div className={`flex items-center justify-between rounded-2xl p-4 ring-2 ${t.ring}`}>
              <span className="font-bold">Puntaje actual</span>
              <span className={`font-display text-3xl font-bold ${t.color}`}>{score} / 30</span>
            </div>

            {error && <p role="alert" className="text-base font-semibold text-warn">{error}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="min-h-14 rounded-2xl border-2 border-border px-6 font-bold transition hover:border-trust/40">
                Atrás
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-trust px-6 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 active:scale-[0.98] disabled:opacity-70"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Check className="h-5 w-5" aria-hidden="true" />}
                Ver mi resultado
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Resultado + código Premium ────────────────────────── */}
        {step === TOTAL_STEPS && (
          <div className="space-y-6 text-center">
            {/* Tier badge */}
            <div className={`rounded-2xl p-6 ring-2 ${t.ring}`}>
              <p className="text-6xl mb-3" aria-hidden="true">{t.emoji}</p>
              <h2 className={`font-display text-3xl font-bold ${t.color}`}>{t.label}</h2>
              <p className="mt-2 text-base text-muted-foreground">{t.sub}</p>
              <p className={`mt-3 font-display text-5xl font-bold ${t.color}`}>{score}<span className="text-2xl text-muted-foreground"> / 30</span></p>
            </div>

            {/* Score breakdown */}
            <div className="rounded-2xl border border-border bg-background p-4 text-left">
              <p className="font-bold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Desglose</p>
              {SCORE_FACTORS.map(({ key, label }) => {
                const v = form[key] as number;
                return (
                  <div key={key} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <span className="text-sm font-semibold">{label}</span>
                    <span className={`rounded-full px-3 py-0.5 text-sm font-bold ${scoreChip(v)}`}>{v} / 5</span>
                  </div>
                );
              })}
            </div>

            {/* Promo code */}
            {promoCode && (
              <div className="rounded-2xl bg-ok/10 p-5 ring-2 ring-ok/30">
                <p className="text-ok font-bold text-lg mb-1">🎁 Tu mes Premium gratis</p>
                <p className="text-sm text-muted-foreground mb-3">
                  Usa este código al registrarte en Humanix para activar 1 mes gratis.
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
                href={`https://wa.me/?text=${encodeURIComponent(`¡Acabo de validar mi idea en Humanix y obtuve ${score}/30 (${t.label})! 🚀 Valida la tuya gratis en humanix.lat/validacion`)}`}
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

      {/* Investor note */}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        Tus respuestas se guardan de forma privada. Solo el equipo de Humanix puede verlas para mejorar la plataforma.
      </p>
    </div>
  );
}
