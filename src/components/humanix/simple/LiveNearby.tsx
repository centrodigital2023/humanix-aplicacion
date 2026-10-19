// Sección "Cerca de ti, en vivo" para cada perfil.
//  - Familias: profesionales → "Pedir" abre la reserva en un toque.
//  - IPS/EPS: profesionales → "Ver perfil".
//  - Profesionales: familias e instituciones con ofertas abiertas → "Ver oferta" (las instituciones sin turnos, atenuadas) +
//    compartir mi ubicación en vivo; las solicitudes sin ubicación van en una lista debajo del mapa.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { AppUser } from "@/hooks/use-app-user";
import { usePresence } from "@/hooks/use-presence";
import type { Audience } from "@/lib/audience";
import type { MapDemand, MapProfessional } from "@/lib/liveMap";
import { whatsappLink } from "@/lib/audience";
import { CONTACT } from "@/lib/social";
import { SimpleLiveMap, type MapPin } from "./SimpleLiveMap";
import { UnplacedDemandList } from "@/components/humanix/UnplacedDemandList";
import { QuickBooking, type BookablePro } from "./QuickBooking";
import { useVoice } from "./voice";

function ShareMyLocation({ user }: { user: AppUser }) {
  const { say } = useVoice();
  const { isSharing, startSharing, stopSharing, error } = usePresence({ userId: user.id });
  const toggle = () => {
    if (isSharing) {
      stopSharing();
      say("Ya no compartes tu ubicación.");
    } else {
      say(startSharing() ? "Ahora te ven en el mapa." : "No pudimos usar tu ubicación.");
    }
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={isSharing}
        onClick={toggle}
        className={`inline-flex min-h-14 items-center gap-3 rounded-2xl px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ok/40 ${
          isSharing ? "bg-ok text-ok-foreground shadow-lg shadow-ok/25" : "bg-card shadow-sm"
        }`}
      >
        <span aria-hidden="true" className="text-xl">
          📡
        </span>
        {isSharing ? "Te ven en el mapa" : "Mostrarme en el mapa"}
      </button>
      <p className="text-sm text-muted-foreground">
        Se muestra tu zona aproximada (a ~1 km), nunca tu dirección ni tu punto exacto.
      </p>
      {error && (
        <p role="alert" className="text-sm font-medium text-warn">
          {error}
        </p>
      )}
    </div>
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
          primaryLabel={(pin: MapPin) =>
            (pin.raw as MapDemand | undefined)?.offerId ? "Ver oferta" : "Ver oportunidades"
          }
          onPrimary={(pin: MapPin) => {
            // Con oferta, el pin abre esa oferta; con horas sueltas, abre las oportunidades del panel.
            const offerId = (pin.raw as MapDemand | undefined)?.offerId ?? null;
            if (!user)
              navigate({
                to: "/auth",
                search: {
                  role: "professional",
                  mode: "signup",
                  redirect: offerId ? `/oferta/${offerId}` : "/dashboard/profesional",
                } as never,
              });
            else if (offerId) navigate({ to: "/oferta/$offerId", params: { offerId } });
            else navigate({ to: "/dashboard/profesional" });
          }}
        />
        {user && isPro && <UnplacedDemandList />}
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
            hourlyRate: (pin.raw as MapProfessional | undefined)?.hourlyRate ?? null,
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
