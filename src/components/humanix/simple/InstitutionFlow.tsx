// IPS / EPS: publicar un turno con plantillas (rol + horario) en un minuto.
// Muestra candidatos reales que encajan y, con sesión, métricas reales.
// Sin sesión: guarda el borrador y lo recupera tras crear la cuenta.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Loader2, Minus, Plus, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/hooks/use-app-user";
import { loadDraft, saveDraft } from "@/lib/audience";
import { PictoCard, primaryBtn, type Tint } from "./ui";
import { useSpeakOnChange, useVoice } from "./voice";

type RoleTpl = {
  key: string;
  emoji: string;
  label: string;
  tint: Tint;
  specialty: string;
  suggested: number;
};
type ScheduleTpl = {
  key: string;
  emoji: string;
  label: string;
  hint: string;
  tint: Tint;
  modality: "shift" | "hour";
};

const ROLES: RoleTpl[] = [
  {
    key: "jefe",
    emoji: "🩺",
    label: "Enfermería jefe",
    tint: "sky",
    specialty: "Enfermería",
    suggested: 220000,
  },
  {
    key: "aux",
    emoji: "💉",
    label: "Auxiliar",
    tint: "emerald",
    specialty: "Auxiliar",
    suggested: 140000,
  },
  {
    key: "cuidador",
    emoji: "🤝",
    label: "Cuidador",
    tint: "rose",
    specialty: "Cuidador",
    suggested: 110000,
  },
  {
    key: "terapia",
    emoji: "🦾",
    label: "Terapeuta",
    tint: "violet",
    specialty: "Terapia",
    suggested: 180000,
  },
];

const SCHEDULES: ScheduleTpl[] = [
  { key: "dia", emoji: "☀️", label: "Día", hint: "7am–7pm", tint: "amber", modality: "shift" },
  { key: "noche", emoji: "🌙", label: "Noche", hint: "7pm–7am", tint: "violet", modality: "shift" },
  { key: "24h", emoji: "🕐", label: "24 horas", hint: "Completo", tint: "sky", modality: "shift" },
  {
    key: "horas",
    emoji: "⏱️",
    label: "Por horas",
    hint: "Valor hora",
    tint: "emerald",
    modality: "hour",
  },
];

type ShiftDraft = {
  role: string;
  schedule: string;
  city: string;
  date: string;
  people: number;
  amount: number;
};

const DRAFT_KEY = "humanix-shift-draft";

const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

const EMPTY: ShiftDraft = {
  role: "aux",
  schedule: "dia",
  city: "",
  date: "",
  people: 1,
  amount: 140000,
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

type Metrics = { open: number; soon: number; filled: number };

const field =
  "min-h-16 w-full rounded-2xl border-2 border-border bg-background px-4 text-lg font-semibold outline-none focus:border-trust";

export function InstitutionFlow({ user }: { user: AppUser | null }) {
  const navigate = useNavigate();
  const { say } = useVoice();
  const [draft, setDraft] = useState<ShiftDraft>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [matches, setMatches] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const isInstitution = Boolean(user?.roles.includes("institution"));

  useSpeakOnChange(hydrated ? "¿A quién necesitas? Luego elige el horario." : "");

  useEffect(() => {
    setDraft(loadDraft(DRAFT_KEY, { ...EMPTY, date: todayISO() }));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveDraft(DRAFT_KEY, draft);
  }, [draft, hydrated]);

  const role = useMemo(() => ROLES.find((r) => r.key === draft.role) ?? ROLES[0], [draft.role]);
  const schedule = useMemo(
    () => SCHEDULES.find((s) => s.key === draft.schedule) ?? SCHEDULES[0],
    [draft.schedule],
  );

  // Candidatos reales que encajan (rol + ciudad), con debounce mientras escribe.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(async () => {
      let q = supabase
        .from("public_professionals_safe")
        .select("user_id", { count: "exact", head: true })
        .eq("active", true)
        .ilike("specialty", `%${role.specialty}%`)
        .abortSignal(AbortSignal.timeout(10000));
      if (draft.city.trim()) q = q.contains("service_cities", [draft.city.trim()]);
      const { count, error } = await q;
      setMatches(error ? -1 : (count ?? 0));
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, role.specialty, draft.city]);

  // Métricas reales del panel para instituciones con sesión.
  useEffect(() => {
    if (!user || !isInstitution) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("job_offers")
        .select("status, start_date")
        .eq("posted_by", user.id)
        .limit(500);
      if (!active || !data) return;
      const in48h = Date.now() + 48 * 3600 * 1000;
      setMetrics({
        open: data.filter((o) => o.status === "open").length,
        soon: data.filter(
          (o) => o.status === "open" && o.start_date && new Date(o.start_date).getTime() <= in48h,
        ).length,
        filled: data.filter((o) => o.status === "filled").length,
      });
    })();
    return () => {
      active = false;
    };
  }, [user, isInstitution, published]);

  const update = (patch: Partial<ShiftDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors({});
    setPublished(false);
    setPublishError(null);
  };

  const validate = () => {
    const e: Partial<Record<keyof ShiftDraft, string>> = {};
    if (!draft.city.trim()) e.city = "Escribe la ciudad.";
    if (!draft.amount || draft.amount <= 0) e.amount = "Escribe el pago.";
    setErrors(e);
    const first = Object.values(e)[0];
    if (first) say(first);
    return !first;
  };

  const publish = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    if (!user) {
      navigate({
        to: "/auth",
        search: { role: "institution", mode: "signup" } as never,
      });
      return;
    }
    if (!isInstitution && !user.roles.includes("family")) {
      setPublishError("Entra con una cuenta de IPS o EPS para publicar.");
      return;
    }

    setBusy(true);
    setPublishError(null);
    const { error } = await supabase.from("job_offers").insert({
      posted_by: user.id,
      poster_type: isInstitution ? "institution" : "family",
      title: `${role.label} · ${schedule.label}`,
      description: `${schedule.label} (${schedule.hint}). Personas: ${draft.people}.`,
      specialty_required: role.specialty,
      city: draft.city.trim(),
      modality: schedule.modality,
      amount: draft.amount,
      shifts_count: draft.people,
      start_date: draft.date || null,
      status: "open",
    });
    setBusy(false);
    if (error) {
      console.error(error);
      setPublishError("No se pudo publicar. Tus datos siguen aquí; intenta otra vez.");
      say("No se pudo publicar. Intenta otra vez.");
      return;
    }
    setPublished(true);
    say("Turno publicado.");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
      <form
        onSubmit={publish}
        noValidate
        aria-labelledby="shift-q"
        className="rounded-[2rem] border border-border bg-card/80 p-4 shadow-xl shadow-trust/5 backdrop-blur sm:p-8"
      >
        <fieldset>
          <legend id="shift-q" className="font-display text-3xl font-bold">
            ¿A quién necesitas?
          </legend>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ROLES.map((r) => (
              <PictoCard
                key={r.key}
                size="md"
                emoji={r.emoji}
                label={r.label}
                tint={r.tint}
                selected={draft.role === r.key}
                onSelect={() => update({ role: r.key, amount: r.suggested })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="font-display text-2xl font-bold">¿Horario?</legend>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SCHEDULES.map((s) => (
              <PictoCard
                key={s.key}
                size="md"
                emoji={s.emoji}
                label={s.label}
                hint={s.hint}
                tint={s.tint}
                selected={draft.schedule === s.key}
                onSelect={() => update({ schedule: s.key })}
              />
            ))}
          </div>
        </fieldset>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="shift-city" className="text-base font-bold">
              📍 Ciudad
            </label>
            <input
              id="shift-city"
              value={draft.city}
              onChange={(e) => update({ city: e.target.value })}
              placeholder="Medellín"
              aria-invalid={Boolean(errors.city)}
              aria-describedby={errors.city ? "shift-city-err" : undefined}
              className={`${field} mt-2`}
            />
            {errors.city && (
              <p
                id="shift-city-err"
                role="alert"
                className="mt-1 text-base font-semibold text-warn"
              >
                {errors.city}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="shift-date" className="text-base font-bold">
              📅 Fecha
            </label>
            <input
              id="shift-date"
              type="date"
              min={todayISO()}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
              className={`${field} mt-2`}
            />
          </div>
          <div>
            <span id="shift-people-label" className="text-base font-bold">
              👥 Personas
            </span>
            <div
              role="group"
              aria-labelledby="shift-people-label"
              className="mt-2 flex min-h-16 items-center justify-between rounded-2xl border-2 border-border bg-background p-1.5"
            >
              <button
                type="button"
                aria-label="Una persona menos"
                onClick={() => update({ people: Math.max(1, draft.people - 1) })}
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted active:scale-90"
              >
                <Minus className="h-5 w-5" aria-hidden="true" />
              </button>
              <span className="text-2xl font-bold" aria-live="polite">
                {draft.people}
              </span>
              <button
                type="button"
                aria-label="Una persona más"
                onClick={() => update({ people: Math.min(50, draft.people + 1) })}
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-trust text-trust-foreground active:scale-90"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="shift-amount" className="text-base font-bold">
              💵 Pago {schedule.modality === "hour" ? "por hora" : "por turno"}
            </label>
            <input
              id="shift-amount"
              type="number"
              inputMode="numeric"
              min={0}
              step={1000}
              value={draft.amount || ""}
              onChange={(e) => update({ amount: Number(e.target.value) })}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? "shift-amount-err" : "shift-amount-hint"}
              className={`${field} mt-2`}
            />
            {errors.amount ? (
              <p
                id="shift-amount-err"
                role="alert"
                className="mt-1 text-base font-semibold text-warn"
              >
                {errors.amount}
              </p>
            ) : (
              <p id="shift-amount-hint" className="mt-1 text-sm text-muted-foreground">
                {draft.amount > 0 ? COP(draft.amount) : ""}
              </p>
            )}
          </div>
        </div>

        <p
          className="mt-6 flex items-center gap-3 rounded-2xl bg-trust/5 p-4 text-lg"
          aria-live="polite"
        >
          <span className="text-2xl" aria-hidden="true">
            👩‍⚕️
          </span>
          {matches === null ? (
            "Buscando candidatos…"
          ) : matches > 0 ? (
            <span>
              <strong className="text-trust">{matches}</strong>{" "}
              {matches === 1 ? "candidato disponible" : "candidatos disponibles"}
            </span>
          ) : (
            "Te avisamos cuando haya candidatos"
          )}
        </p>

        {published ? (
          <div
            role="status"
            className="mt-5 flex items-center gap-3 rounded-2xl bg-ok/10 p-5 animate-in zoom-in-95"
          >
            <CheckCircle2 className="h-8 w-8 shrink-0 text-ok" aria-hidden="true" />
            <div>
              <p className="text-xl font-bold text-ok">¡Turno publicado!</p>
              <Link
                to="/dashboard/institucion"
                className="text-base font-bold text-trust underline"
              >
                Ver mi panel
              </Link>
            </div>
          </div>
        ) : (
          <button type="submit" disabled={busy} className={`${primaryBtn} mt-5`}>
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-6 w-6" aria-hidden="true" />
            )}
            Publicar turno
          </button>
        )}
        {publishError && (
          <p role="alert" className="mt-2 text-base font-semibold text-warn">
            {publishError}
          </p>
        )}
        {!user && (
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Cuenta gratis · tus datos quedan guardados
          </p>
        )}
      </form>

      <aside
        aria-labelledby="panel-title"
        className="rounded-[2rem] bg-trust p-6 text-trust-foreground shadow-xl shadow-trust/20 sm:p-8"
      >
        <h3 id="panel-title" className="font-display text-2xl font-bold">
          {isInstitution ? "Tu operación hoy" : "Tu panel"}
        </h3>
        <dl className="mt-5 grid gap-3">
          {[
            { emoji: "📋", label: "Abiertos", value: metrics?.open },
            { emoji: "⏳", label: "Por cubrir (48 h)", value: metrics?.soon },
            { emoji: "✅", label: "Cubiertos", value: metrics?.filled },
          ].map((m) => (
            <div
              key={m.label}
              className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-4"
            >
              <dt className="flex items-center gap-3 text-lg font-semibold">
                <span aria-hidden="true" className="text-2xl">
                  {m.emoji}
                </span>
                {m.label}
              </dt>
              <dd className="font-display text-3xl font-bold">{m.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-6 space-y-2 text-base opacity-90">
          <li>🎯 Candidatos por cercanía y perfil</li>
          <li>🔔 Alerta de documentos por vencer</li>
          <li>🧾 Historial de cada servicio</li>
        </ul>
        <Link
          to={isInstitution ? "/dashboard/institucion" : "/auth"}
          search={isInstitution ? undefined : ({ role: "institution", mode: "signin" } as never)}
          className="mt-6 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-base font-bold text-trust-deep transition hover:bg-white/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
        >
          {isInstitution ? "Abrir panel" : "Ya tengo cuenta"}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      </aside>
    </div>
  );
}
