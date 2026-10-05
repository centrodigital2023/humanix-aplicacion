// Flujo operativo para IPS / EPS:
//  - Publicación express de turnos con plantillas por rol y horario.
//  - Antes de publicar, muestra cuántos profesionales encajan (dato real).
//  - Sin sesión: guarda el borrador, pide cuenta y al volver queda listo para publicar.
//  - Con sesión institucional: métricas reales del panel (abiertos / por cubrir / cubiertos).
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, BadgeCheck, CheckCircle2, Loader2, Send, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/hooks/use-app-user";
import { loadDraft, saveDraft } from "@/lib/audience";

type RoleTpl = { key: string; emoji: string; label: string; specialty: string; suggested: number };
type ScheduleTpl = { key: string; label: string; hint: string; modality: "shift" | "hour" };

const ROLES: RoleTpl[] = [
  {
    key: "jefe",
    emoji: "🩺",
    label: "Enfermero(a) jefe",
    specialty: "Enfermería",
    suggested: 220000,
  },
  {
    key: "aux",
    emoji: "💉",
    label: "Auxiliar de enfermería",
    specialty: "Auxiliar",
    suggested: 140000,
  },
  { key: "cuidador", emoji: "🤝", label: "Cuidador(a)", specialty: "Cuidador", suggested: 110000 },
  { key: "terapia", emoji: "🦾", label: "Terapeuta", specialty: "Terapia", suggested: 180000 },
];

const SCHEDULES: ScheduleTpl[] = [
  { key: "dia", label: "Día", hint: "7 a. m. – 7 p. m.", modality: "shift" },
  { key: "noche", label: "Noche", hint: "7 p. m. – 7 a. m.", modality: "shift" },
  { key: "24h", label: "24 horas", hint: "Turno completo", modality: "shift" },
  { key: "horas", label: "Por horas", hint: "Valor por hora", modality: "hour" },
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

export function InstitutionFlow({ user }: { user: AppUser | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ShiftDraft>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [matches, setMatches] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ShiftDraft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const isInstitution = Boolean(user?.roles.some((r) => r === "institution"));

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

  // Candidatos que encajan (perfil + ciudad), con pequeño debounce mientras escribe.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(async () => {
      let q = supabase
        .from("public_professionals_safe")
        .select("user_id", { count: "exact", head: true })
        .eq("active", true)
        .ilike("specialty", `%${role.specialty}%`);
      if (draft.city.trim()) q = q.contains("service_cities", [draft.city.trim()]);
      const { count, error } = await q;
      setMatches(error ? null : (count ?? 0));
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
    if (!draft.city.trim()) e.city = "Escribe la ciudad del turno.";
    if (!draft.amount || draft.amount <= 0) e.amount = "Escribe cuánto pagas por el turno.";
    if (!draft.people || draft.people < 1) e.people = "Debe ser al menos 1 persona.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const publish = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    if (!user) {
      // Guardamos todo y pedimos cuenta; al volver el formulario sigue lleno.
      navigate({
        to: "/auth",
        search: { role: "institution", mode: "signup", redirect: "/?para=instituciones" } as never,
      });
      return;
    }

    if (!isInstitution && !user.roles.includes("family")) {
      setPublishError(
        "Esta cuenta es de profesional. Para publicar turnos entra con una cuenta de IPS o EPS.",
      );
      return;
    }

    setBusy(true);
    setPublishError(null);
    const { error } = await supabase.from("job_offers").insert({
      posted_by: user.id,
      poster_type: isInstitution ? "institution" : "family",
      title: `${role.label} · turno ${schedule.label.toLowerCase()}`,
      description: `${schedule.label} (${schedule.hint}). Personas requeridas: ${draft.people}.`,
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
      setPublishError(
        "No pudimos publicar el turno. Tus datos siguen guardados; intenta de nuevo.",
      );
      return;
    }
    setPublished(true);
  };

  const fieldClass =
    "min-h-14 w-full rounded-2xl border-2 border-border bg-background px-4 text-lg outline-none focus:border-trust";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <form
        onSubmit={publish}
        noValidate
        aria-labelledby="shift-title"
        className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8"
      >
        <h3 id="shift-title" className="font-display text-2xl font-bold sm:text-3xl">
          Publica un turno en 1 minuto
        </h3>
        <p className="mt-1 text-base text-muted-foreground">
          Elige una plantilla y ajusta lo necesario.
        </p>

        <fieldset className="mt-6">
          <legend className="text-base font-semibold">1. ¿A quién necesitas?</legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {ROLES.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={draft.role === r.key}
                onClick={() => update({ role: r.key, amount: r.suggested })}
                className={`flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 text-left font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust ${
                  draft.role === r.key
                    ? "border-trust bg-trust/10"
                    : "border-border bg-background hover:border-trust"
                }`}
              >
                <span className="text-2xl" aria-hidden="true">
                  {r.emoji}
                </span>
                {r.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="text-base font-semibold">2. ¿En qué horario?</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SCHEDULES.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={draft.schedule === s.key}
                onClick={() => update({ schedule: s.key })}
                className={`min-h-16 rounded-2xl border-2 px-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust ${
                  draft.schedule === s.key
                    ? "border-trust bg-trust/10"
                    : "border-border bg-background hover:border-trust"
                }`}
              >
                <span className="block font-bold">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="text-base font-semibold">3. ¿Dónde, cuándo y cuánto?</legend>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="shift-city" className="text-sm font-semibold">
                Ciudad
              </label>
              <input
                id="shift-city"
                value={draft.city}
                onChange={(e) => update({ city: e.target.value })}
                placeholder="Ej: Medellín"
                aria-invalid={Boolean(errors.city)}
                aria-describedby={errors.city ? "shift-city-err" : undefined}
                className={`${fieldClass} mt-1`}
              />
              {errors.city && (
                <p id="shift-city-err" role="alert" className="mt-1 text-sm font-medium text-warn">
                  {errors.city}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="shift-date" className="text-sm font-semibold">
                Fecha de inicio
              </label>
              <input
                id="shift-date"
                type="date"
                min={todayISO()}
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
                className={`${fieldClass} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="shift-people" className="text-sm font-semibold">
                ¿Cuántas personas?
              </label>
              <input
                id="shift-people"
                type="number"
                inputMode="numeric"
                min={1}
                value={draft.people}
                onChange={(e) => update({ people: Number(e.target.value) })}
                aria-invalid={Boolean(errors.people)}
                aria-describedby={errors.people ? "shift-people-err" : undefined}
                className={`${fieldClass} mt-1`}
              />
              {errors.people && (
                <p
                  id="shift-people-err"
                  role="alert"
                  className="mt-1 text-sm font-medium text-warn"
                >
                  {errors.people}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="shift-amount" className="text-sm font-semibold">
                Pago {schedule.modality === "hour" ? "por hora" : "por turno"} (COP)
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
                className={`${fieldClass} mt-1`}
              />
              {errors.amount ? (
                <p
                  id="shift-amount-err"
                  role="alert"
                  className="mt-1 text-sm font-medium text-warn"
                >
                  {errors.amount}
                </p>
              ) : (
                <p id="shift-amount-hint" className="mt-1 text-sm text-muted-foreground">
                  {draft.amount > 0
                    ? `${COP(draft.amount)} · lo ve el profesional antes de aceptar`
                    : ""}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <p className="mt-6 flex items-center gap-2 text-base" aria-live="polite">
          <Users className="h-5 w-5 text-trust" aria-hidden="true" />
          {matches === null ? (
            "Calculando candidatos…"
          ) : matches > 0 ? (
            <span>
              <strong>{matches}</strong>{" "}
              {matches === 1 ? "profesional encaja" : "profesionales encajan"} con este turno
              {draft.city.trim() ? ` en ${draft.city.trim()}` : ""}.
            </span>
          ) : (
            "Aún no hay perfiles exactos; te avisamos apenas aparezcan."
          )}
        </p>

        {published ? (
          <div
            role="status"
            className="mt-5 flex items-start gap-3 rounded-2xl bg-ok/10 p-4 text-ok"
          >
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-lg font-bold">Turno publicado</p>
              <p className="text-base text-foreground">
                Te avisaremos cuando lleguen candidatos.{" "}
                <Link to="/dashboard/institucion" className="font-semibold text-trust underline">
                  Ver mi panel
                </Link>
              </p>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="mt-5 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-trust px-5 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 disabled:opacity-70"
          >
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-6 w-6" aria-hidden="true" />
            )}
            {user ? "Publicar turno" : "Publicar turno (crear cuenta gratis)"}
          </button>
        )}
        {publishError && (
          <p role="alert" className="mt-2 text-sm font-medium text-warn">
            {publishError}
          </p>
        )}
        {!user && (
          <p className="mt-2 text-sm text-muted-foreground">
            Tus datos quedan guardados mientras creas la cuenta.
          </p>
        )}
      </form>

      <aside
        aria-labelledby="panel-title"
        className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8"
      >
        <h3 id="panel-title" className="font-display text-xl font-bold">
          {isInstitution ? "Tu operación hoy" : "Así se ve tu panel"}
        </h3>
        <dl className="mt-5 grid grid-cols-1 gap-3">
          {[
            { label: "Turnos abiertos", value: metrics?.open, tone: "text-trust" },
            { label: "Por cubrir en 48 horas", value: metrics?.soon, tone: "text-warn" },
            { label: "Turnos cubiertos", value: metrics?.filled, tone: "text-ok" },
          ].map((m) => (
            <div
              key={m.label}
              className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-3"
            >
              <dt className="text-base font-medium">{m.label}</dt>
              <dd className={`font-display text-2xl font-bold ${m.tone}`}>{m.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-6 space-y-3 text-base">
          {[
            "Candidatos ordenados por cercanía, especialidad y documentos.",
            "Alertas cuando una credencial está por vencer.",
            "Historial de cada servicio para auditoría.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
        <Link
          to={isInstitution ? "/dashboard/institucion" : "/auth"}
          search={isInstitution ? undefined : ({ role: "institution", mode: "signin" } as never)}
          className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-border px-4 font-semibold hover:border-trust focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust"
        >
          {isInstitution ? "Abrir panel completo" : "Ya tengo cuenta: entrar"}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      </aside>
    </div>
  );
}
