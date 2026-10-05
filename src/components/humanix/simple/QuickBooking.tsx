// Reserva en un toque (familias): cuándo, cuántas horas, dónde → total claro.
// Crea un service_booking real (igual que BookNowButton) y lleva al
// seguimiento en vivo /servicio/$id. El pago es directo al profesional
// (payment_mode por defecto: direct_to_professional), sin cobros ocultos.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, LocateFixed, MessageCircle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getBrowserLocation, type LatLng } from "@/lib/geo";
import { CONTACT } from "@/lib/social";
import { whatsappLink } from "@/lib/audience";
import { PictoCard, okBtn, primaryBtn, type Tint } from "./ui";
import { useVoice } from "./voice";

export type BookablePro = {
  id: string;
  name: string;
  hourlyRate: number | null;
  avatarUrl?: string | null;
};

type WhenKey = "now" | "afternoon" | "tomorrow";

const WHENS: Array<{ key: WhenKey; emoji: string; label: string; tint: Tint }> = [
  { key: "now", emoji: "⚡", label: "Ya", tint: "amber" },
  { key: "afternoon", emoji: "☀️", label: "Esta tarde", tint: "sky" },
  { key: "tomorrow", emoji: "🌙", label: "Mañana", tint: "violet" },
];

const HOURS = [2, 4, 8, 12, 24];

function whenToDate(w: WhenKey): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  if (w === "now") {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  } else if (w === "afternoon") {
    d.setMinutes(0);
    d.setHours(Math.max(d.getHours() + 2, 14));
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0);
  }
  return d;
}

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function QuickBooking({
  pro,
  onClose,
  defaultAddress = "",
  defaultCoords = null,
}: {
  pro: BookablePro | null;
  onClose: () => void;
  defaultAddress?: string;
  defaultCoords?: LatLng | null;
}) {
  const navigate = useNavigate();
  const { say } = useVoice();
  const [when, setWhen] = useState<WhenKey>("now");
  const [hours, setHours] = useState(4);
  const [address, setAddress] = useState(defaultAddress);
  const [coords, setCoords] = useState<LatLng | null>(defaultCoords);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pro) return;
    setError(null);
    say(`Pedir a ${pro.name}. ¿Cuándo y cuántas horas?`);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pro]);

  if (!pro) return null;

  const rate = pro.hourlyRate ?? 0;
  const total = Math.round(hours * rate);

  const locate = async () => {
    setLocating(true);
    const pos = await getBrowserLocation();
    setLocating(false);
    if (pos) {
      setCoords(pos);
      if (!address) setAddress("Mi ubicación actual");
    } else setError("No vimos tu ubicación. Escribe la dirección.");
  };

  const confirm = async () => {
    if (!address.trim()) {
      setError("Escribe la dirección.");
      say("Escribe la dirección.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setBusy(false);
      navigate({
        to: "/auth",
        search: { role: "family", mode: "signup", redirect: `/profesional/${pro.id}` } as never,
      });
      return;
    }
    const { data, error: err } = await supabase
      .from("service_bookings")
      .insert({
        client_id: sess.session.user.id,
        professional_id: pro.id,
        scheduled_at: whenToDate(when).toISOString(),
        duration_hours: hours,
        hourly_rate: rate,
        total_amount: total,
        service_address: address.trim(),
        service_lat: coords?.lat ?? null,
        service_lng: coords?.lng ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    setBusy(false);
    if (err || !data) {
      console.error(err);
      setError("No se pudo pedir. Intenta otra vez o escríbenos.");
      say("No se pudo pedir. Intenta otra vez.");
      return;
    }
    say("Listo. Te llevamos al seguimiento.");
    navigate({ to: "/servicio/$bookingId", params: { bookingId: data.id } });
  };

  // Portal a <body>: así ningún contenedor con z-index lo tapa.
  return createPortal(
    <div
      className="fixed inset-0 z-[900] flex items-end justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qb-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-card p-5 shadow-2xl animate-in slide-in-from-bottom-8 duration-300 sm:rounded-[2rem] sm:p-7"
      >
        <div className="flex items-center gap-4">
          {pro.avatarUrl ? (
            <img src={pro.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-trust/10 text-3xl"
            >
              👩‍⚕️
            </span>
          )}
          <h2 id="qb-title" className="flex-1 font-display text-2xl font-bold">
            Pedir a {pro.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-muted active:scale-90"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {!rate ? (
          <div className="mt-6 text-center">
            <p className="text-lg font-bold">Su precio se acuerda por chat.</p>
            <a
              href={whatsappLink(
                CONTACT.whatsappNumber,
                `Hola Humanix, quiero pedir a ${pro.name}.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className={`${okBtn} mt-4`}
            >
              <MessageCircle className="h-6 w-6" aria-hidden="true" />
              WhatsApp
            </a>
          </div>
        ) : (
          <>
            <fieldset className="mt-6">
              <legend className="text-lg font-bold">¿Cuándo?</legend>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {WHENS.map((w) => (
                  <PictoCard
                    key={w.key}
                    size="md"
                    emoji={w.emoji}
                    label={w.label}
                    tint={w.tint}
                    selected={when === w.key}
                    onSelect={() => setWhen(w.key)}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="text-lg font-bold">¿Cuántas horas?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={hours === h}
                    onClick={() => {
                      setHours(h);
                      say(`${h} horas`);
                    }}
                    className={`min-h-14 min-w-16 rounded-2xl border-2 px-4 text-lg font-bold transition active:scale-95 ${
                      hours === h
                        ? "border-trust bg-trust text-trust-foreground"
                        : "border-border bg-background hover:border-trust"
                    }`}
                  >
                    {h} h
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-5">
              <label htmlFor="qb-address" className="text-lg font-bold">
                ¿Dónde?
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  id="qb-address"
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setError(null);
                  }}
                  placeholder="Calle 100 #15-20"
                  autoComplete="street-address"
                  className="min-h-14 w-full rounded-2xl border-2 border-border bg-background px-4 text-lg outline-none focus:border-trust"
                />
                <button
                  type="button"
                  onClick={locate}
                  aria-label="Usar mi ubicación"
                  className="flex min-h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-trust/10 text-trust active:scale-95"
                >
                  {locating ? (
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  ) : (
                    <LocateFixed className="h-6 w-6" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-3xl bg-trust/5 p-5">
              <div className="flex items-end justify-between gap-3">
                <span className="text-base font-semibold text-muted-foreground">
                  {hours} h × {COP(rate)}
                </span>
                <span className="font-display text-3xl font-bold text-trust">{COP(total)}</span>
              </div>
              <p className="mt-3 text-base">
                💵 Pagas directo a {pro.name.split(" ")[0]} al terminar. Sin cobros ocultos.
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-base font-semibold text-warn">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className={`${primaryBtn} mt-5`}
            >
              {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> : null}
              Confirmar · {COP(total)}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
