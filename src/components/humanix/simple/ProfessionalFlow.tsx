// Flujo autónomo para profesionales:
//  - Interruptor grande "Estoy disponible / No estoy disponible" (real si hay sesión).
//  - Bandeja de ofertas cercanas: Aceptar · Proponer horario · Rechazar.
//  - Validación guiada de documentos con foto.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Camera, CheckCircle2, Clock, FileCheck2, MapPin, UserRound, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { AppUser } from "@/hooks/use-app-user";

type Offer = {
  id: string;
  title: string;
  city: string;
  amount: number;
  modality: "hour" | "shift" | "month" | "package";
  start_date: string | null;
};

const MODALITY: Record<Offer["modality"], string> = {
  hour: "por hora",
  shift: "por turno",
  month: "al mes",
  package: "por paquete",
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function ProfessionalFlow({ user }: { user: AppUser | null }) {
  const navigate = useNavigate();
  const isPro = Boolean(user?.roles.includes("professional"));
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [proCity, setProCity] = useState<string | null>(null);

  // Estado real de disponibilidad del profesional con sesión.
  useEffect(() => {
    if (!user || !isPro) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("professional_profiles")
        .select("available, home_city")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active || !data) return;
      setAvailable(Boolean(data.available));
      setProCity(data.home_city ?? null);
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
        .limit(6);
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
      setStatusMsg("No pudimos cambiar tu estado. Revisa tu conexión e intenta de nuevo.");
      return;
    }
    setStatusMsg(
      next ? "Listo: ya te pueden encontrar." : "Listo: nadie te enviará ofertas por ahora.",
    );
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
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <section
        aria-labelledby="availability-title"
        className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8"
      >
        <h3 id="availability-title" className="font-display text-2xl font-bold sm:text-3xl">
          ¿Puedes trabajar ahora?
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={available}
          onClick={toggle}
          disabled={saving}
          className={`mt-6 flex min-h-24 w-full items-center gap-4 rounded-3xl border-2 px-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2 disabled:opacity-70 ${
            available ? "border-ok bg-ok/10" : "border-border bg-background"
          }`}
        >
          <span
            aria-hidden="true"
            className={`relative h-10 w-[4.5rem] shrink-0 rounded-full transition-colors ${available ? "bg-ok" : "bg-muted-foreground/40"}`}
          >
            <span
              className={`absolute top-1 h-8 w-8 rounded-full bg-white shadow transition-all ${available ? "left-[2.25rem]" : "left-1"}`}
            />
          </span>
          <span>
            <span className={`block text-xl font-bold ${available ? "text-ok" : ""}`}>
              {available ? "Estoy disponible" : "No estoy disponible"}
            </span>
            <span className="block text-sm text-muted-foreground">
              {user && isPro ? "Toca para cambiar" : "Crea tu cuenta gratis para activarlo"}
            </span>
          </span>
        </button>
        <p className="mt-2 min-h-6 text-sm font-medium" role="status">
          {statusMsg}
        </p>

        <h4 className="mt-6 text-lg font-bold">Completa tu perfil en 3 pasos</h4>
        <ol className="mt-3 space-y-3">
          {[
            { icon: UserRound, title: "Tus datos básicos", hint: "Nombre, especialidad y zona" },
            {
              icon: Camera,
              title: "Toma foto a tus documentos",
              hint: "Cédula, título y RETHUS. Te guiamos con voz",
            },
            {
              icon: FileCheck2,
              title: "Nosotros los revisamos",
              hint: "Te avisamos si necesitamos revisar un documento",
            },
          ].map((s, i) => (
            <li
              key={s.title}
              className="flex items-start gap-3 rounded-2xl border border-border bg-background p-3"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-trust/10 font-bold text-trust">
                {i + 1}
              </span>
              <span>
                <span className="flex items-center gap-2 font-semibold">
                  <s.icon className="h-4 w-4 text-trust" aria-hidden="true" />
                  {s.title}
                </span>
                <span className="block text-sm text-muted-foreground">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <Link
          to={isPro ? "/dashboard/profesional" : "/auth"}
          search={isPro ? undefined : ({ role: "professional", mode: "signup" } as never)}
          className="mt-5 flex min-h-14 items-center justify-center rounded-2xl bg-trust px-4 text-base font-bold text-trust-foreground hover:bg-trust/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust focus-visible:ring-offset-2"
        >
          {isPro ? "Ir a mi perfil" : "Empezar gratis"}
        </Link>
      </section>

      <section
        aria-labelledby="offers-title"
        className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-8"
      >
        <h3 id="offers-title" className="font-display text-2xl font-bold sm:text-3xl">
          Ofertas {proCity ? `en ${proCity}` : "cerca de ti"}
        </h3>
        <p className="mt-1 text-base text-muted-foreground">
          Ves el pago antes de aceptar. Sin letra pequeña.
        </p>

        {offers === null && (
          <div className="mt-5 space-y-3" aria-busy="true" aria-label="Cargando ofertas">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        )}

        {offers !== null && visible.length === 0 && (
          <p
            role="status"
            className="mt-5 rounded-2xl border-2 border-dashed border-border p-6 text-center text-base"
          >
            No hay ofertas abiertas en este momento. Activa tu disponibilidad y te avisamos.
          </p>
        )}

        <ul className="mt-5 space-y-3">
          {visible.map((o) => (
            <li key={o.id} className="rounded-2xl border-2 border-border bg-background p-4">
              <p className="text-lg font-bold">{o.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  {o.city}
                </span>
                {o.start_date && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    {new Date(o.start_date).toLocaleDateString("es-CO", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                )}
              </p>
              <p className="mt-2 text-base">
                <span className="text-xl font-bold">{COP(o.amount)}</span> {MODALITY[o.modality]}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => openOffer(o.id)}
                  className="flex min-h-12 items-center justify-center gap-1 rounded-xl bg-ok px-2 text-sm font-bold text-ok-foreground hover:bg-ok/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok focus-visible:ring-offset-2"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Aceptar
                </button>
                <button
                  type="button"
                  onClick={() => openOffer(o.id)}
                  className="flex min-h-12 items-center justify-center gap-1 rounded-xl border-2 border-border px-2 text-sm font-semibold hover:border-trust focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust"
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  Proponer horario
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed((d) => [...d, o.id])}
                  aria-label={`Rechazar oferta: ${o.title}`}
                  className="flex min-h-12 items-center justify-center gap-1 rounded-xl border-2 border-border px-2 text-sm font-semibold text-muted-foreground hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Rechazar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
