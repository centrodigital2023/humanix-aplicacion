// Familias: 3 toques, sin registro → máximo 3 personas verificadas.
//   1. ¿Para quién?  2. ¿Cuándo?  3. ¿Dónde?
// Autoguardado; la cuenta se pide solo al tocar "Pedir".
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Loader2,
  MapPin,
  MessageCircle,
  RotateCcw,
  Star,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { COLOMBIA_CITIES, distanceKm, formatKm, getBrowserLocation, type LatLng } from "@/lib/geo";
import { CONTACT } from "@/lib/social";
import { loadDraft, saveDraft, whatsappLink } from "@/lib/audience";
import { PictoCard, StepDots, ghostBtn, okBtn, primaryBtn, type Tint } from "./ui";
import { useSpeakOnChange, useVoice } from "./voice";
import { QuickBooking, type BookablePro } from "./QuickBooking";

type NeedKey = "elder" | "kids" | "post-op" | "chronic";
type WhenKey = "now" | "today" | "tomorrow";

const NEEDS: Array<{ key: NeedKey; emoji: string; label: string; tint: Tint; match: string }> = [
  { key: "elder", emoji: "👵", label: "Adulto mayor", tint: "rose", match: "adulto" },
  { key: "kids", emoji: "🧒", label: "Niño o niña", tint: "sky", match: "pedi" },
  { key: "post-op", emoji: "🩹", label: "Cirugía", tint: "amber", match: "herida" },
  { key: "chronic", emoji: "💊", label: "Enfermedad", tint: "emerald", match: "enfermer" },
];

const WHENS: Array<{ key: WhenKey; emoji: string; label: string; tint: Tint }> = [
  { key: "now", emoji: "⚡", label: "Ahora", tint: "amber" },
  { key: "today", emoji: "☀️", label: "Hoy", tint: "sky" },
  { key: "tomorrow", emoji: "🌙", label: "Mañana", tint: "violet" },
];

const QUICK_CITIES = ["Bogotá", "Medellín", "Cali", "Barranquilla"];

const QUESTIONS = {
  1: "¿Para quién es el cuidado?",
  2: "¿Cuándo?",
  3: "¿Dónde?",
} as const;

type Draft = {
  step: 1 | 2 | 3 | 4;
  need: NeedKey | null;
  when: WhenKey | null;
  place: string;
  coords: LatLng | null;
};

const DRAFT_KEY = "humanix-family-search";
const EMPTY: Draft = { step: 1, need: null, when: null, place: "", coords: null };
const MY_LOCATION = "Cerca de ti";

type Pro = {
  user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  years_experience: number | null;
  hourly_rate: number | null;
  shift_rate: number | null;
  avg_rating: number | null;
  verified: boolean | null;
  rethus_verified: boolean | null;
  available: boolean | null;
  lat: number | null;
  lng: number | null;
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
    .filter(Boolean)
    .reverse();
  for (const p of parts) {
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

const isVerified = (p: Pro) => Boolean(p.verified || p.rethus_verified);
const firstName = (p: Pro) => (p.full_name ?? "Profesional").split(" ").slice(0, 2).join(" ");

export function FamilyFlow() {
  const { say } = useVoice();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Pro[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [booking, setBooking] = useState<BookablePro | null>(null);

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

  useSpeakOnChange(hydrated && draft.step <= 3 ? QUESTIONS[draft.step as 1 | 2 | 3] : "");

  const search = useCallback(
    async (d: Draft) => {
      setLoading(true);
      setLoadError(false);
      const needCfg = NEEDS.find((n) => n.key === d.need);
      const city = resolveCity(d.place);
      const columns =
        "user_id, full_name, avatar_url, specialty, years_experience, hourly_rate, shift_rate, avg_rating, verified, rethus_verified, available, lat, lng";

      const run = (withSpecialty: boolean) => {
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
      // Si nadie tiene esa especialidad exacta, ampliamos a cualquier perfil de la zona.
      if (!error && (data?.length ?? 0) === 0) ({ data, error } = await run(false));

      if (error) {
        console.error(error);
        setLoadError(true);
        setResults([]);
        setLoading(false);
        say("No pudimos cargar. Toca el botón verde para hablar con nosotros.");
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
      say(
        top.length
          ? `Encontramos ${top.length} ${top.length === 1 ? "persona" : "personas"}. ${top
              .map((p) => firstName(p))
              .join(", ")}.`
          : "Aún no hay personas en tu zona. Toca el botón verde para hablar con nosotros.",
      );
    },
    [say],
  );

  // Si vuelve con un borrador ya en "resultados", recalculamos.
  useEffect(() => {
    if (hydrated && draft.step === 4 && results === null && !loading) void search(draft);
  }, [hydrated, draft, results, loading, search]);

  const goResults = (next: Draft) => {
    setDraft(next);
    setHint(null);
    void search(next);
  };

  const useMyLocation = async () => {
    say("Buscando dónde estás");
    setLocating(true);
    setHint(null);
    const coords = await getBrowserLocation();
    setLocating(false);
    if (!coords) {
      setHint("No vimos tu ubicación. Escribe tu barrio.");
      say("No vimos tu ubicación. Escribe tu barrio o toca tu ciudad.");
      return;
    }
    goResults({ ...draft, coords, place: MY_LOCATION, step: 4 });
  };

  const submitPlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.place.trim() && !draft.coords) {
      setHint("Escribe tu barrio o toca tu ciudad.");
      say("Escribe tu barrio o toca tu ciudad.");
      return;
    }
    goResults({ ...draft, step: 4 });
  };

  const restart = () => {
    setDraft(EMPTY);
    setResults(null);
  };

  const requestPro = (pro: Pro) => {
    if (!pro.user_id) return;
    setBooking({
      id: pro.user_id,
      name: firstName(pro),
      hourlyRate: pro.hourly_rate,
      avatarUrl: pro.avatar_url,
    });
  };

  const waText = (pro?: Pro) =>
    [
      "Hola Humanix, necesito cuidado.",
      need ? `Para: ${need.label}.` : "",
      when ? `Cuándo: ${when.label}.` : "",
      draft.place && draft.place !== MY_LOCATION ? `Zona: ${draft.place}.` : "",
      pro?.full_name ? `Me interesa: ${pro.full_name}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const back = () =>
    draft.step === 4 ? restart() : update({ step: (draft.step - 1) as Draft["step"] });

  return (
    <section
      aria-labelledby="family-q"
      className="rounded-[2rem] border border-border bg-card/80 p-4 shadow-xl shadow-trust/5 backdrop-blur sm:p-8"
    >
      <div className="flex min-h-12 items-center justify-between gap-3">
        {draft.step <= 3 ? <StepDots step={draft.step} total={3} /> : <span />}
        {draft.step > 1 && (
          <button
            type="button"
            onClick={back}
            className="inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-base font-bold hover:bg-muted active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
          >
            {draft.step === 4 ? (
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            )}
            {draft.step === 4 ? "Otra vez" : "Atrás"}
          </button>
        )}
      </div>

      <div key={draft.step} className="animate-in fade-in slide-in-from-right-4 duration-300">
        {draft.step === 1 && (
          <fieldset className="mt-3">
            <legend id="family-q" className="font-display text-3xl font-bold">
              {QUESTIONS[1]}
            </legend>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {NEEDS.map((n) => (
                <PictoCard
                  key={n.key}
                  emoji={n.emoji}
                  label={n.label}
                  tint={n.tint}
                  selected={draft.need === n.key}
                  onSelect={() => update({ need: n.key, step: 2 })}
                />
              ))}
            </div>
          </fieldset>
        )}

        {draft.step === 2 && (
          <fieldset className="mt-3">
            <legend id="family-q" className="font-display text-3xl font-bold">
              {QUESTIONS[2]}
            </legend>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {WHENS.map((w) => (
                <PictoCard
                  key={w.key}
                  emoji={w.emoji}
                  label={w.label}
                  tint={w.tint}
                  selected={draft.when === w.key}
                  onSelect={() => update({ when: w.key, step: 3 })}
                />
              ))}
            </div>
          </fieldset>
        )}

        {draft.step === 3 && (
          <form className="mt-3" onSubmit={submitPlace} noValidate>
            <h3 id="family-q" className="font-display text-3xl font-bold">
              {QUESTIONS[3]}
            </h3>
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className={`${primaryBtn} mt-5 min-h-20 text-xl`}
            >
              {locating ? (
                <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className="text-3xl">
                  📍
                </span>
              )}
              {locating ? "Buscando…" : "Aquí donde estoy"}
            </button>

            <div className="mt-5 flex flex-wrap gap-2">
              {QUICK_CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={draft.place === c}
                  onClick={() => {
                    say(c);
                    goResults({ ...draft, place: c, coords: null, step: 4 });
                  }}
                  className={`min-h-12 rounded-full border-2 px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40 ${
                    draft.place === c
                      ? "border-trust bg-trust/10 text-trust"
                      : "border-border bg-card hover:border-trust"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <label htmlFor="family-place" className="sr-only">
              Tu barrio o ciudad
            </label>
            <div className="mt-4 flex items-center gap-2 rounded-2xl border-2 border-border bg-background pl-4 focus-within:border-trust">
              <MapPin className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                id="family-place"
                value={draft.place === MY_LOCATION ? "" : draft.place}
                onChange={(e) => {
                  update({ place: e.target.value, coords: null });
                  setHint(null);
                }}
                placeholder="Otro barrio o ciudad"
                autoComplete="address-level2"
                aria-invalid={Boolean(hint)}
                aria-describedby={hint ? "family-hint" : undefined}
                className="min-h-16 w-full bg-transparent text-lg outline-none"
              />
              <button
                type="submit"
                className="m-1.5 min-h-12 shrink-0 rounded-xl bg-trust px-5 text-base font-bold text-trust-foreground active:scale-95"
              >
                Ver
              </button>
            </div>
            {hint && (
              <p id="family-hint" role="alert" className="mt-2 text-base font-semibold text-warn">
                {hint}
              </p>
            )}
          </form>
        )}

        {draft.step === 4 && (
          <div className="mt-1">
            <h3
              id="family-q"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-2xl font-bold sm:text-3xl"
            >
              <span aria-hidden="true">{need?.emoji}</span>
              {need?.label ?? "Cuidado"}
              <span className="text-muted-foreground" aria-hidden="true">
                ·
              </span>
              {when?.label ?? "Pronto"}
              <span className="text-muted-foreground" aria-hidden="true">
                ·
              </span>
              {draft.place || "Tu zona"}
            </h3>

            {loading && (
              <div
                className="mt-6 grid gap-4 md:grid-cols-3"
                aria-busy="true"
                aria-label="Buscando personas"
              >
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-80 animate-pulse rounded-3xl bg-muted" />
                ))}
              </div>
            )}

            {!loading && results && results.length > 0 && (
              <ul className="mt-6 grid gap-4 md:grid-cols-3">
                {results.map((pro, i) => (
                  <li
                    key={pro.user_id}
                    style={{ animationDelay: `${i * 90}ms` }}
                    className="flex flex-col rounded-3xl border-2 border-border bg-background p-5 animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500"
                  >
                    <div className="flex flex-col items-center text-center">
                      {pro.avatar_url ? (
                        <img
                          src={pro.avatar_url}
                          alt={`Foto de ${pro.full_name ?? "profesional"}`}
                          className="h-24 w-24 rounded-full object-cover ring-4 ring-ok/30"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="flex h-24 w-24 items-center justify-center rounded-full bg-trust/10 text-4xl font-bold text-trust"
                          aria-hidden="true"
                        >
                          {(pro.full_name ?? "?").charAt(0)}
                        </div>
                      )}
                      <p className="mt-3 text-xl font-bold">{firstName(pro)}</p>
                      <p className="text-base text-muted-foreground">
                        {pro.specialty ?? "Cuidado en casa"}
                      </p>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {isVerified(pro) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-3 py-1.5 text-sm font-bold text-ok">
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                            Verificado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/10 px-3 py-1.5 text-sm font-bold text-warn">
                            En revisión
                          </span>
                        )}
                        {(pro.avg_rating ?? 0) > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-sm font-bold">
                            <Star className="h-4 w-4 fill-warn text-warn" aria-hidden="true" />
                            {pro.avg_rating?.toFixed(1)}
                          </span>
                        )}
                        {(pro.years_experience ?? 0) > 0 && (
                          <span className="rounded-full bg-muted px-3 py-1.5 text-sm font-bold">
                            {pro.years_experience} años
                          </span>
                        )}
                      </div>
                      <p className="mt-4 text-base">
                        {pro.hourly_rate ? (
                          <>
                            <span className="text-2xl font-bold">{COP(pro.hourly_rate)}</span> /
                            hora
                          </>
                        ) : pro.shift_rate ? (
                          <>
                            <span className="text-2xl font-bold">{COP(pro.shift_rate)}</span> /
                            turno
                          </>
                        ) : (
                          <span className="text-muted-foreground">Precio antes de confirmar</span>
                        )}
                      </p>
                      {draft.coords && pro.lat != null && pro.lng != null && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          📍 {formatKm(distanceKm(draft.coords, { lat: pro.lat, lng: pro.lng }))}
                        </p>
                      )}
                    </div>

                    <div className="mt-auto grid grid-cols-[1fr_auto] gap-2 pt-5">
                      <button
                        type="button"
                        onClick={() => requestPro(pro)}
                        className={`${primaryBtn} min-h-14`}
                      >
                        Pedir
                      </button>
                      <a
                        href={whatsappLink(CONTACT.whatsappNumber, waText(pro))}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Hablar por WhatsApp sobre ${firstName(pro)}`}
                        className={`${ghostBtn} w-14 px-0`}
                      >
                        <MessageCircle className="h-6 w-6 text-ok" aria-hidden="true" />
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!loading && results && results.length === 0 && (
              <div role="status" className="mt-6 rounded-3xl bg-muted/60 p-6 text-center">
                <p className="text-5xl" aria-hidden="true">
                  🤝
                </p>
                <p className="mt-3 text-xl font-bold">
                  {loadError ? "Te ayudamos por WhatsApp" : "Te ayudamos a encontrar a alguien"}
                </p>
                <a
                  href={whatsappLink(CONTACT.whatsappNumber, waText())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${okBtn} mx-auto mt-5 max-w-sm`}
                >
                  <MessageCircle className="h-6 w-6" aria-hidden="true" />
                  WhatsApp
                </a>
              </div>
            )}
          </div>
        )}
      </div>
      <QuickBooking
        pro={booking}
        onClose={() => setBooking(null)}
        defaultAddress={draft.place && draft.place !== MY_LOCATION ? draft.place : ""}
        defaultCoords={draft.coords}
      />
    </section>
  );
}
