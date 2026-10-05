// Flujo de familias en 3 pasos, sin registro previo:
//   1. ¿Qué tipo de ayuda necesitas?  2. ¿Para cuándo?  3. ¿Dónde?
//   → máximo 3 perfiles recomendados, con verificación visible y tarifa clara.
// El registro se pide solo al confirmar ("Solicitar profesional").
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Clock,
  LocateFixed,
  Loader2,
  MapPin,
  MessageCircle,
  RotateCcw,
  Search,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COLOMBIA_CITIES, distanceKm, formatKm, getBrowserLocation, type LatLng } from "@/lib/geo";
import { CONTACT } from "@/lib/social";
import { loadDraft, saveDraft, whatsappLink } from "@/lib/audience";

type NeedKey = "elder" | "kids" | "post-op" | "chronic";
type WhenKey = "now" | "today" | "tomorrow";

const NEEDS: Array<{ key: NeedKey; emoji: string; label: string; hint: string; match: string }> = [
  {
    key: "elder",
    emoji: "👵",
    label: "Adulto mayor",
    hint: "Compañía y cuidado diario",
    match: "adulto",
  },
  { key: "kids", emoji: "🧒", label: "Niño o niña", hint: "Cuidado pediátrico", match: "pedi" },
  {
    key: "post-op",
    emoji: "🩹",
    label: "Recuperación o cirugía",
    hint: "Curaciones y control",
    match: "herida",
  },
  {
    key: "chronic",
    emoji: "💊",
    label: "Enfermedad crónica",
    hint: "Medicamentos y seguimiento",
    match: "enfermer",
  },
];

const WHENS: Array<{ key: WhenKey; label: string; hint: string }> = [
  { key: "now", label: "Ahora", hint: "Lo antes posible" },
  { key: "today", label: "Hoy", hint: "Más tarde hoy" },
  { key: "tomorrow", label: "Mañana", hint: "Para el día de mañana" },
];

const QUICK_CITIES = ["Bogotá", "Medellín", "Cali", "Barranquilla"];

type Draft = {
  step: 1 | 2 | 3 | 4;
  need: NeedKey | null;
  when: WhenKey | null;
  place: string;
  coords: LatLng | null;
};

const DRAFT_KEY = "humanix-family-search";
const EMPTY: Draft = { step: 1, need: null, when: null, place: "", coords: null };

type Pro = {
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  years_experience: number | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  avg_rating: number | null;
  total_jobs: number | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  available: boolean | null;
  ai_summary: string | null;
  lat: number | null;
  lng: number | null;
  service_cities: string[] | null;
  home_city: string | null;
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

/** "Chapinero, Bogotá" → "Bogotá"; localidades de Bogotá → "Bogotá". */
function resolveCity(place: string): string | null {
  const parts = place
    .toLowerCase()
    .split(/[,/-]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts.reverse()) {
    const coords = COLOMBIA_CITIES[p];
    if (!coords) continue;
    const canonical = QUICK_CITIES.concat([
      "Cartagena",
      "Bucaramanga",
      "Pereira",
      "Manizales",
    ]).find((c) => COLOMBIA_CITIES[c.toLowerCase()] === coords);
    return canonical ?? p.charAt(0).toUpperCase() + p.slice(1);
  }
  return null;
}

function oneSentence(pro: Pro): string {
  const years = pro.years_experience ?? 0;
  const base =
    years > 0 ? `${years} ${years === 1 ? "año" : "años"} de experiencia` : "Nuevo en Humanix";
  const summary = (pro.ai_summary ?? "").split(/(?<=[.!?])\s/)[0]?.trim();
  if (summary && summary.length <= 110) return `${base}. ${summary}`;
  return pro.specialty ? `${base} en ${pro.specialty.toLowerCase()}.` : `${base}.`;
}

function isVerified(pro: Pro) {
  return Boolean(pro.verified || pro.rethus_verified);
}

export function FamilyFlow() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Pro[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Autoguardado: si la persona sale o recarga, retoma donde iba.
  useEffect(() => {
    setDraft(loadDraft(DRAFT_KEY, EMPTY));
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveDraft(DRAFT_KEY, draft);
  }, [draft, hydrated]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const need = NEEDS.find((n) => n.key === draft.need) ?? null;
  const when = WHENS.find((w) => w.key === draft.when) ?? null;

  const search = useCallback(async (d: Draft) => {
    setLoading(true);
    setLoadError(false);
    const needCfg = NEEDS.find((n) => n.key === d.need);
    const city = resolveCity(d.place);
    const columns =
      "user_id, full_name, avatar_url, specialty, years_experience, hourly_rate, shift_rate, avg_rating, total_jobs, verified, rethus_verified, available, ai_summary, lat, lng, service_cities, home_city";

    const run = async (withSpecialty: boolean) => {
      let q = supabase
        .from("public_professionals_safe")
        .select(columns)
        .eq("active", true)
        .limit(40)
        .abortSignal(AbortSignal.timeout(10000));
      if (withSpecialty && needCfg) q = q.ilike("specialty", `%${needCfg.match}%`);
      if (city) q = q.contains("service_cities", [city]);
      return q;
    };

    let { data, error } = await run(true);
    // Si no hay nadie con esa especialidad exacta, ampliamos a cualquier perfil de la zona.
    if (!error && (data?.length ?? 0) === 0) ({ data, error } = await run(false));

    if (error) {
      console.error(error);
      setLoadError(true);
      setResults([]);
      setLoading(false);
      return;
    }

    const origin = d.coords ?? (city ? (COLOMBIA_CITIES[city.toLowerCase()] ?? null) : null);
    const score = (p: Pro) => {
      let s = 0;
      if (isVerified(p)) s += 100;
      if (d.when === "now" && p.available) s += 40;
      s += (p.avg_rating ?? 0) * 6;
      if (origin && p.lat != null && p.lng != null)
        s -= Math.min(distanceKm(origin, { lat: p.lat, lng: p.lng }), 50);
      return s;
    };
    const top = ((data ?? []) as Pro[])
      .filter((p) => p.user_id)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 3);
    setResults(top);
    setLoading(false);
  }, []);

  // Si la persona vuelve con un borrador ya en "resultados", recalculamos.
  useEffect(() => {
    if (hydrated && draft.step === 4 && results === null && !loading) void search(draft);
  }, [hydrated, draft, results, loading, search]);

  const useMyLocation = async () => {
    setLocating(true);
    setLocError(null);
    const coords = await getBrowserLocation();
    setLocating(false);
    if (!coords) {
      setLocError("No pudimos ver tu ubicación. Escribe tu barrio o ciudad abajo.");
      return;
    }
    const next = {
      ...draft,
      coords,
      place: draft.place || "Mi ubicación actual",
      step: 4 as const,
    };
    setDraft(next);
    setPlaceError(null);
    void search(next);
  };

  const submitPlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.place.trim() && !draft.coords) {
      setPlaceError("Escribe tu barrio o ciudad, o toca “Usar mi ubicación”.");
      return;
    }
    const next = { ...draft, step: 4 as const };
    setDraft(next);
    void search(next);
  };

  const restart = () => {
    setDraft(EMPTY);
    setResults(null);
  };

  const requestPro = async (pro: Pro) => {
    if (!pro.user_id) return;
    const target = `/profesional/${pro.user_id}`;
    const { data } = await supabase.auth.getSession();
    if (data.session) navigate({ to: "/profesional/$proId", params: { proId: pro.user_id } });
    else
      navigate({
        to: "/auth",
        search: { role: "family", mode: "signup", redirect: target } as never,
      });
  };

  const waText = (pro?: Pro) =>
    [
      "Hola Humanix, necesito ayuda para encontrar cuidado.",
      need ? `Tipo de ayuda: ${need.label}.` : "",
      when ? `Para: ${when.label.toLowerCase()}.` : "",
      draft.place ? `Zona: ${draft.place}.` : "",
      pro?.full_name ? `Me interesa: ${pro.full_name}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const stepLabel = draft.step <= 3 ? `Paso ${draft.step} de 3` : "Tus recomendados";

  return (
    <section
      aria-labelledby="family-flow-title"
      className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-trust" aria-live="polite">
          {stepLabel}
        </p>
        {draft.step > 1 && (
          <button
            type="button"
            onClick={() =>
              draft.step === 4 ? restart() : update({ step: (draft.step - 1) as Draft["step"] })
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust"
          >
            {draft.step === 4 ? (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            )}
            {draft.step === 4 ? "Buscar de nuevo" : "Atrás"}
          </button>
        )}
      </div>
      {draft.step <= 3 && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-full rounded-full bg-trust transition-all"
            style={{ width: `${(draft.step / 3) * 100}%` }}
          />
        </div>
      )}

      {draft.step === 1 && (
        <fieldset className="mt-6">
          <legend id="family-flow-title" className="font-display text-2xl font-bold sm:text-3xl">
            ¿Qué tipo de ayuda necesitas?
          </legend>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {NEEDS.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-pressed={draft.need === n.key}
                onClick={() => update({ need: n.key, step: 2 })}
                className={`flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 p-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 ${
                  draft.need === n.key
                    ? "border-trust bg-trust/10"
                    : "border-border bg-background hover:border-trust"
                }`}
              >
                <span className="text-4xl" aria-hidden="true">
                  {n.emoji}
                </span>
                <span className="text-base font-bold sm:text-lg">{n.label}</span>
                <span className="text-sm text-muted-foreground">{n.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {draft.step === 2 && (
        <fieldset className="mt-6">
          <legend id="family-flow-title" className="font-display text-2xl font-bold sm:text-3xl">
            ¿Para cuándo la necesitas?
          </legend>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {WHENS.map((w) => (
              <button
                key={w.key}
                type="button"
                aria-pressed={draft.when === w.key}
                onClick={() => update({ when: w.key, step: 3 })}
                className={`flex min-h-24 items-center gap-4 rounded-2xl border-2 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 ${
                  draft.when === w.key
                    ? "border-trust bg-trust/10"
                    : "border-border bg-background hover:border-trust"
                }`}
              >
                <Clock className="h-7 w-7 shrink-0 text-trust" aria-hidden="true" />
                <span>
                  <span className="block text-lg font-bold">{w.label}</span>
                  <span className="block text-sm text-muted-foreground">{w.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {draft.step === 3 && (
        <form className="mt-6" onSubmit={submitPlace} noValidate>
          <h3 id="family-flow-title" className="font-display text-2xl font-bold sm:text-3xl">
            ¿Dónde necesitas la ayuda?
          </h3>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="mt-5 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-trust px-5 text-lg font-bold text-trust-foreground transition hover:bg-trust/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 disabled:opacity-70"
          >
            {locating ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="h-6 w-6" aria-hidden="true" />
            )}
            {locating ? "Buscando tu ubicación…" : "Usar mi ubicación"}
          </button>
          {locError && (
            <p role="alert" className="mt-2 text-sm font-medium text-warn">
              {locError}
            </p>
          )}

          <label htmlFor="family-place" className="mt-6 block text-base font-semibold">
            O escribe tu barrio o ciudad
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-border bg-background px-4 focus-within:border-trust">
            <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              id="family-place"
              value={draft.place === "Mi ubicación actual" ? "" : draft.place}
              onChange={(e) => {
                update({ place: e.target.value, coords: null });
                setPlaceError(null);
              }}
              placeholder="Ej: Chapinero, Bogotá"
              autoComplete="address-level2"
              aria-invalid={Boolean(placeError)}
              aria-describedby={placeError ? "family-place-error" : undefined}
              className="min-h-14 w-full bg-transparent text-lg outline-none"
            />
          </div>
          {placeError && (
            <p id="family-place-error" role="alert" className="mt-2 text-sm font-medium text-warn">
              {placeError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_CITIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  update({ place: c, coords: null });
                  setPlaceError(null);
                }}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust ${
                  draft.place === c
                    ? "border-trust bg-trust/10 text-trust"
                    : "border-border hover:border-trust"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            type="submit"
            className="mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-ok px-5 text-lg font-bold text-ok-foreground transition hover:bg-ok/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok focus-visible:ring-offset-2"
          >
            <Search className="h-6 w-6" aria-hidden="true" />
            Ver profesionales recomendados
          </button>
        </form>
      )}

      {draft.step === 4 && (
        <div className="mt-6">
          <h3 id="family-flow-title" className="font-display text-2xl font-bold sm:text-3xl">
            {need ? `${need.label}` : "Cuidado"} · {when?.label ?? "Pronto"} ·{" "}
            {draft.place || "Tu zona"}
          </h3>
          <p className="mt-1 text-base text-muted-foreground">
            Te mostramos máximo 3 personas para que decidas tranquilo. Verás el precio total antes
            de confirmar.
          </p>

          {loading && (
            <div
              className="mt-6 grid gap-4 md:grid-cols-3"
              aria-busy="true"
              aria-label="Buscando profesionales"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )}

          {!loading && results && results.length > 0 && (
            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {results.map((pro) => (
                <li
                  key={pro.user_id}
                  className="flex flex-col rounded-2xl border-2 border-border bg-background p-5"
                >
                  <div className="flex items-center gap-4">
                    {pro.avatar_url ? (
                      <img
                        src={pro.avatar_url}
                        alt={`Foto de ${pro.full_name ?? "profesional"}`}
                        className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-trust/10 text-3xl font-bold text-trust"
                        aria-hidden="true"
                      >
                        {(pro.full_name ?? "?").charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-lg font-bold">
                        {pro.full_name ?? "Profesional Humanix"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {pro.specialty ?? "Cuidado en casa"}
                      </p>
                      {(pro.avg_rating ?? 0) > 0 && (
                        <p className="mt-1 flex items-center gap-1 text-sm font-semibold">
                          <Star className="h-4 w-4 fill-warn text-warn" aria-hidden="true" />
                          {pro.avg_rating?.toFixed(1)} de 5
                          {pro.total_jobs ? (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {pro.total_jobs} servicios
                            </span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  </div>

                  {isVerified(pro) ? (
                    <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-ok/10 px-3 py-1.5 text-sm font-bold text-ok">
                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                      Documentos revisados
                    </p>
                  ) : (
                    <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-warn/10 px-3 py-1.5 text-sm font-bold text-warn">
                      Revisión de documentos en proceso
                    </p>
                  )}

                  <p className="mt-3 text-base">{oneSentence(pro)}</p>

                  <p className="mt-3 text-base">
                    {pro.hourly_rate ? (
                      <>
                        <span className="text-xl font-bold">{COP(pro.hourly_rate)}</span> por hora
                      </>
                    ) : pro.shift_rate ? (
                      <>
                        <span className="text-xl font-bold">{COP(pro.shift_rate)}</span> por turno
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        Tarifa a convenir antes de confirmar
                      </span>
                    )}
                  </p>
                  {draft.coords && pro.lat != null && pro.lng != null && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      A {formatKm(distanceKm(draft.coords, { lat: pro.lat, lng: pro.lng }))} de ti
                    </p>
                  )}

                  <div className="mt-auto grid gap-2 pt-5">
                    <button
                      type="button"
                      onClick={() => requestPro(pro)}
                      className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-trust px-4 text-base font-bold text-trust-foreground hover:bg-trust/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2"
                    >
                      Solicitar profesional
                      <ArrowRight className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <a
                      href={whatsappLink(CONTACT.whatsappNumber, waText(pro))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-border px-4 text-base font-semibold hover:border-ok focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok"
                    >
                      <MessageCircle className="h-5 w-5 text-ok" aria-hidden="true" />
                      Hablar por WhatsApp
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!loading && results && results.length === 0 && (
            <div
              role="status"
              className="mt-6 rounded-2xl border-2 border-dashed border-border p-6 text-center"
            >
              <p className="text-lg font-bold">
                {loadError
                  ? "No pudimos cargar los perfiles en este momento."
                  : "Aún no tenemos perfiles en esa zona."}
              </p>
              <p className="mt-1 text-base text-muted-foreground">
                Escríbenos y una persona de Humanix te ayuda a encontrar cuidado. Tus respuestas ya
                quedaron guardadas.
              </p>
              <a
                href={whatsappLink(CONTACT.whatsappNumber, waText())}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-auto mt-4 flex min-h-14 max-w-sm items-center justify-center gap-2 rounded-xl bg-ok px-4 text-base font-bold text-ok-foreground hover:bg-ok/90"
              >
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
                Pedir ayuda por WhatsApp
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
