// Sección "Cerca de ti, en vivo" para cada perfil.
//  - Familias: profesionales → "Pedir" abre la reserva en un toque.
//  - IPS/EPS: profesionales → "Ver perfil".
//  - Profesionales: ofertas abiertas → "Ver oferta" + compartir mi ubicación en vivo.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { AppUser } from "@/hooks/use-app-user";
import { useLivePresence } from "@/hooks/use-live-presence";
import type { Audience } from "@/lib/audience";
import { whatsappLink } from "@/lib/audience";
import { CONTACT } from "@/lib/social";
import { SimpleLiveMap, type MapPin } from "./SimpleLiveMap";
import { QuickBooking, type BookablePro } from "./QuickBooking";
import { useVoice } from "./voice";

type ProRaw = { hourly_rate: number | null };

function ShareMyLocation({ user }: { user: AppUser }) {
  const { say } = useVoice();
  const { isTracking, startTracking, stopTracking } = useLivePresence({
    userId: user.id,
    userType: "professional",
    loadAll: false,
  });
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      if (isTracking) {
        await stopTracking();
        say("Ya no compartes tu ubicación.");
      } else {
        await startTracking();
        say("Ahora te ven en el mapa.");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isTracking}
      onClick={toggle}
      disabled={busy}
      className={`inline-flex min-h-14 items-center gap-3 rounded-2xl px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40 ${
        isTracking ? "bg-ok text-ok-foreground shadow-lg shadow-ok/25" : "bg-card shadow-sm"
      }`}
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="text-xl">
          📡
        </span>
      )}
      {isTracking ? "Te ven en el mapa" : "Mostrarme en el mapa"}
    </button>
  );
}

export function LiveNearby({ audience, user }: { audience: Audience; user: AppUser | null }) {
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookablePro | null>(null);
  const isPro = Boolean(user?.roles.includes("professional"));

  if (audience === "profesionales") {
    return (
      <div className="space-y-4">
        {isPro && user && <ShareMyLocation user={user} />}
        <SimpleLiveMap
          mode="offers"
          primaryLabel="Ver oferta"
          onPrimary={(pin: MapPin) => {
            if (!user)
              navigate({
                to: "/auth",
                search: {
                  role: "professional",
                  mode: "signup",
                  redirect: `/oferta/${pin.id}`,
                } as never,
              });
            else navigate({ to: "/oferta/$offerId", params: { offerId: pin.id } });
          }}
        />
      </div>
    );
  }

  if (audience === "instituciones") {
    return (
      <SimpleLiveMap
        mode="pros"
        primaryLabel="Ver perfil"
        onPrimary={(pin) => navigate({ to: "/profesional/$proId", params: { proId: pin.id } })}
      />
    );
  }

  return (
    <>
      <SimpleLiveMap
        mode="pros"
        primaryLabel="Pedir"
        onPrimary={(pin) =>
          setBooking({
            id: pin.id,
            name: pin.title,
            hourlyRate: (pin.raw as ProRaw | undefined)?.hourly_rate ?? null,
            avatarUrl: pin.avatarUrl,
          })
        }
        secondary={{
          emoji: "💬",
          label: "WhatsApp",
          href: (pin) =>
            whatsappLink(CONTACT.whatsappNumber, `Hola Humanix, me interesa ${pin.title}.`),
        }}
      />
      <QuickBooking pro={booking} onClose={() => setBooking(null)} />
    </>
  );
}
