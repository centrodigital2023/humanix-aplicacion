// Profesionales: un interruptor gigante (disponible / no disponible),
// ofertas cercanas con 3 botones y perfil en 3 pasos.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Clock, MapPin, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/hooks/use-app-user";
import { TINTS, primaryBtn } from "./ui";
import { useSpeakOnChange, useVoice } from "./voice";
import {
  ProfessionalShareCard,
  type ProCardData,
} from "@/components/humanix/ProfessionalShareCard";

type Offer = {
  id: string;
  title: string;
  city: string;
  amount: number;
  modality: "hour" | "shift" | "month" | "package";
  start_date: string | null;
};

const MODALITY: Record<Offer["modality"], string> = {
  hour: "/ hora",
  shift: "/ turno",
  month: "/ mes",
  package: "/ paquete",
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

const STEPS = [
  { emoji: "🙋", label: "Tus datos", tint: "sky" },
  { emoji: "📸", label: "Foto a tus documentos", tint: "amber" },
  { emoji: "✅", label: "Te verificamos", tint: "emerald" },
] as const;

export function ProfessionalFlow({ user }: { user: AppUser | null }) {
  const navigate = useNavigate();
  const { say } = useVoice();
  const isPro = Boolean(user?.roles.includes("professional"));
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [proCity, setProCity] = useState<string | null>(null);
  const [proCardData, setProCardData] = useState<ProCardData | null>(null);

  useSpeakOnChange("¿Puedes trabajar ahora? Toca el botón grande.");

  useEffect(() => {
    if (!user || !isPro) return;
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("professional_profiles")
        .select(
          "available, home_city, full_name, avatar_url, specialty, years_experience, avg_rating, verified, rethus_verified",
        )
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active || !data) return;
      const d = data as {
        available?: boolean | null;
        home_city?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
        specialty?: string | null;
        years_experience?: number | null;
        avg_rating?: number | null;
        verified?: boolean | null;
        rethus_verified?: boolean | null;
      };
      setAvailable(Boolean(d.available));
      setProCity(d.home_city ?? null);
      if (d.full_name) {
        const slug = d.full_name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
        setProCardData({
          name: d.full_name,
          username: slug || user.id,
          photoUrl: d.avatar_url ?? undefined,
          specialty: d.specialty ?? "Profesional de salud",
          city: d.home_city ?? "Colombia",
          yearsExp: d.years_experience ?? 0,
          rating: d.avg_rating ?? undefined,
          rethusBadge: Boolean(d.verified || d.rethus_verified),
          certBadge: Boolean(d.verified),
          availableNow: Boolean(d.available),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [user, isPro]);

  useEffect(() => {
    let active = true;
    (async () => {
      let q = supabase
        .from("job_offers")
        .select("id, title, city, amount, modality, start_date")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(6)
        .abortSignal(AbortSignal.timeout(10000));
      if (proCity) q = q.ilike("city", `%${proCity}%`);
      const { data, error } = await q;
      if (active) setOffers(error ? [] : ((data ?? []) as Offer[]));
    })();
    return () => {
      active = false;
    };
  }, [proCity]);

  const goSignup = () =>
    navigate({
      to: "/auth",
      search: { role: "professional", mode: "signup", redirect: "/?para=profesionales" } as never,
    });

  const toggle = async () => {
    if (!user || !isPro) {
      say("Primero crea tu cuenta gratis.");
      goSignup();
      return;
    }
    const next = !available;
    setAvailable(next);
    setSaving(true);
    setStatusMsg(null);
    const { error } = await supabase
      .from("professional_profiles")
      .update({ available: next })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) {
      setAvailable(!next);
      setStatusMsg("No se pudo cambiar. Intenta otra vez.");
      say("No se pudo cambiar. Intenta otra vez.");
      return;
    }
    const msg = next ? "¡Listo! Ya te pueden encontrar." : "Listo. Descansa.";
    setStatusMsg(msg);
    say(msg);
  };

  const openOffer = (id: string) => {
    if (!user) {
      goSignup();
      return;
    }
    navigate({ to: "/oferta/$offerId", params: { offerId: id } });
  };

  const visible = (offers ?? []).filter((o) => !dismissed.includes(o.id)).slice(0, 3);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <section
        aria-labelledby="availability-q"
        className="rounded-[2rem] border border-border bg-card/80 p-4 shadow-xl shadow-trust/5 backdrop-blur sm:p-8"
      >
        <h3 id="availability-q" className="font-display text-3xl font-bold">
          ¿Puedes trabajar?
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          aria-label="Estoy disponible"
          onClick={toggle}
          disabled={saving}
          className={`mt-5 flex min-h-28 w-full items-center gap-5 rounded-[1.75rem] px-6 text-left transition duration-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40 disabled:opacity-70 ${
            available
              ? "bg-ok text-ok-foreground shadow-xl shadow-ok/30"
              : "border-2 border-border bg-background"
          }`}
        >
          <span
            aria-hidden="true"
            className={`relative h-12 w-[5.5rem] shrink-0 rounded-full transition-colors ${
              available ? "bg-white/30" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute top-1 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-md transition-all duration-300 ${
                available ? "left-[2.75rem]" : "left-1"
              }`}
            >
              {available ? "😊" : "😴"}
            </span>
          </span>
          <span className="text-2xl font-bold">{available ? "Disponible" : "No disponible"}</span>
        </button>
        <p className="mt-3 min-h-7 text-center text-base font-semibold" role="status">
          {statusMsg ?? (user && isPro ? "" : "Cuenta gratis para activarlo")}
        </p>

        <ol className="mt-4 grid grid-cols-3 gap-2">
          {STEPS.map((s, i) => (
            <li key={s.label} className="flex flex-col items-center gap-2 text-center">
              <span
                aria-hidden="true"
                className={`relative flex h-16 w-16 items-center justify-center rounded-full text-3xl ${TINTS[s.tint]}`}
              >
                {s.emoji}
                <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-trust text-xs font-bold text-trust-foreground">
                  {i + 1}
                </span>
              </span>
              <span className="text-sm font-bold leading-tight">{s.label}</span>
            </li>
          ))}
        </ol>
        <Link
          to={isPro ? "/dashboard/profesional" : "/auth"}
          search={isPro ? undefined : ({ role: "professional", mode: "signup" } as never)}
          className={`${primaryBtn} mt-6`}
        >
          {isPro ? "Mi perfil" : "Empezar gratis"}
        </Link>
      </section>

      <section
        aria-labelledby="offers-title"
        className="rounded-[2rem] border border-border bg-card/80 p-4 shadow-xl shadow-trust/5 backdrop-blur sm:p-8"
      >
        <h3 id="offers-title" className="font-display text-3xl font-bold">
          Ofertas {proCity ? `en ${proCity}` : "nuevas"}
        </h3>

        {offers === null && (
          <div className="mt-5 space-y-3" aria-busy="true" aria-label="Cargando ofertas">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-3xl bg-muted" />
            ))}
          </div>
        )}

        {offers !== null && visible.length === 0 && (
          <div role="status" className="mt-5 rounded-3xl bg-muted/60 p-8 text-center">
            <p className="text-5xl" aria-hidden="true">
              🔔
            </p>
            <p className="mt-3 text-xl font-bold">Te avisamos cuando haya ofertas</p>
          </div>
        )}

        <ul className="mt-5 space-y-3">
          {visible.map((o, i) => (
            <li
              key={o.id}
              style={{ animationDelay: `${i * 90}ms` }}
              className="rounded-3xl border-2 border-border bg-background p-4 animate-in fade-in slide-in-from-bottom-4 fill-mode-both duration-500"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-bold leading-snug">{o.title}</p>
                <p className="shrink-0 text-right">
                  <span className="block text-xl font-bold text-ok">{COP(o.amount)}</span>
                  <span className="text-sm text-muted-foreground">{MODALITY[o.modality]}</span>
                </p>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {o.city}
                </span>
                {o.start_date && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    {new Date(o.start_date).toLocaleDateString("es-CO", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                )}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => openOffer(o.id)}
                  className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-ok text-sm font-bold text-ok-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40"
                >
                  <Check className="h-5 w-5" aria-hidden="true" />
                  Aceptar
                </button>
                <button
                  type="button"
                  onClick={() => openOffer(o.id)}
                  className="flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 border-border text-sm font-bold active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
                >
                  <Clock className="h-5 w-5 text-trust" aria-hidden="true" />
                  Otra hora
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((d) => [...d, o.id])}
                  aria-label={`No me interesa: ${o.title}`}
                  className="flex min-h-14 flex-col items-center justify-center rounded-2xl border-2 border-border text-sm font-bold text-muted-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trust/40"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                  No
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {isPro && proCardData && (
        <section
          aria-label="Tu tarjeta profesional"
          className="mt-5 card-viral rounded-[2rem] p-4 sm:p-6"
        >
          <h3 className="font-display text-xl font-bold mb-1">Tu tarjeta profesional</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Compártela antes de cada servicio. Tu familia sabe exactamente quién viene.
          </p>
          <ProfessionalShareCard pro={proCardData} compact />
        </section>
      )}
    </div>
  );
}
